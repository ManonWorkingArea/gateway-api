const express = require('express');
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
const axios = require('axios'); // Import axios for HTTP requests
const { authenticateClient, safeObjectId, errorHandler } = require('./routes/middleware/mongoMiddleware'); // Import your middleware

const router = express.Router();

// Secret key for signing JWT (You should store this securely)
const JWT_SECRET = 'ZCOKU1v3TO2flcOqCdrJ3vWbWhmnZNQn'; // Replace with your own secret key

// Use authenticateClient to manage the MongoDB connection based on the client key
router.use(authenticateClient);

// Function to verify the token
function verifyToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        return reject({ status: false, message: 'Invalid or expired token' });
      }
      resolve({ status: true, message: 'Token is valid', decoded });
    });
  });
}

// Function to get site-specific database and collection
async function getSiteSpecificDb(client, site) {
    const apiDb = client.db('API');
    const siteCollection = apiDb.collection('hostname');
    const siteData = await siteCollection.findOne({ hostname: site });

    if (!siteData) {
        throw new Error(`Invalid site ID. Site not found: ${site}`);
    }

    const targetDb = client.db(siteData.key);
    const userCollection = targetDb.collection('user');
    return { targetDb, userCollection, siteData };
}

// Function to create a delay (in ms)
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const ORDER_BATCH_LIMIT = 100;
const STALE_PROCESSING_MS = 15 * 60 * 1000;

async function claimPendingOrders(orderCollection, filter) {
    const claimedOrders = [];

    for (let i = 0; i < ORDER_BATCH_LIMIT; i += 1) {
        const claimedAt = new Date();
        const claimResult = await orderCollection.findOneAndUpdate(
            {
                ...filter,
                status: 'pending',
                $or: [
                    { process: { $exists: false } },
                    { process: null },
                    { process: 'pending' },
                    { process: 'draft' }
                ]
            },
            {
                $set: {
                    process: 'processing',
                    processingStartedAt: claimedAt
                }
            },
            {
                sort: { createdAt: -1 },
                projection: {
                    _id: 1,
                    orderCode: 1,
                    rawCode: 1,
                    courseID: 1,
                    formID: 1,
                    userID: 1,
                    unit: 1,
                    status: 1,
                    payment: 1,
                    type: 1,
                    approve: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    ref1: 1,
                    ref2: 1,
                    detailData: 1,
                    process: 1,
                    processingStartedAt: 1
                },
                returnDocument: 'after'
            }
        );

        const claimedOrder = claimResult && Object.prototype.hasOwnProperty.call(claimResult, 'value')
            ? claimResult.value
            : claimResult;
        if (!claimedOrder) {
            break;
        }

        claimedOrders.push(claimedOrder);
    }

    return claimedOrders;
}

async function releaseOrderForRetry(orderCollection, orderId) {
    await orderCollection.updateOne(
        { _id: orderId },
        {
            $set: {
                process: 'pending'
            },
            $unset: {
                processingStartedAt: ''
            }
        }
    );
}

async function resetStaleProcessingOrders(orderCollection, unit) {
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);

    const result = await orderCollection.updateMany(
        {
            unit,
            process: 'processing',
            processingStartedAt: { $lte: staleBefore }
        },
        {
            $set: {
                process: 'pending'
            },
            $unset: {
                processingStartedAt: ''
            }
        }
    );

    return result.modifiedCount || 0;
}

async function findRelatedForm(formCollection, order) {
    if (!order) {
        return null;
    }

    const filters = [];

    if (order.formID && order.userID) {
        filters.push({ formID: order.formID, userID: order.userID });
    }

    if (order._id) {
        filters.push({ orderID: order._id.toString() });
    }

    if (filters.length === 0) {
        return null;
    }

    return formCollection.findOne(
        filters.length === 1 ? filters[0] : { $or: filters },
        {
            projection: {
                _id: 1,
                formID: 1,
                orderID: 1,
                status: 1,
                process: 1,
                formData: 1,
            }
        }
    );
}

async function syncConfirmedOrderRelations({ enrollCollection, formCollection, order }) {
    let enrollModified = 0;
    let formModified = 0;

    if (order.courseID && order.userID) {
        const enrollResult = await enrollCollection.updateOne(
            {
                courseID: order.courseID.toString(),
                userID: order.userID.toString(),
                orderID: order._id.toString()
            },
            { $set: { status: true } }
        );

        enrollModified = enrollResult.modifiedCount || 0;
    }

    if (order.formID && order.userID) {
        const formResult = await formCollection.updateOne(
            {
                $or: [
                    { formID: order.formID, userID: order.userID },
                    { orderID: order._id.toString() }
                ]
            },
            { $set: { status: true, process: 'confirm' } }
        );

        formModified = formResult.modifiedCount || 0;
    }

    return { enrollModified, formModified };
}

async function markOrderAsConfirmed({
    orderCollection,
    enrollCollection,
    formCollection,
    order,
    transferedDate,
    confirmedBy,
    confirmNote,
}) {
    const orderUpdate = {
        $set: {
            status: 'confirm',
            process: 'confirm',
            confirmedAt: new Date(),
            confirmSource: 'offline_manual',
        },
        $unset: {
            processingStartedAt: ''
        }
    };

    if (transferedDate) {
        orderUpdate.$set['detailData.transfered_date'] = transferedDate;
    }

    if (confirmedBy) {
        orderUpdate.$set.confirmedBy = confirmedBy;
    }

    if (confirmNote) {
        orderUpdate.$set.confirmNote = confirmNote;
    }

    await orderCollection.updateOne({ _id: order._id }, orderUpdate);

    await syncConfirmedOrderRelations({
        enrollCollection,
        formCollection,
        order,
    });
}

// Function to make a POST request to the /PostReceipt API
async function postReceiptApi({
    div_code, 
    sub_section_items, 
    bank_account, 
    transfered_date, 
    transfered_amount, 
    transfered_ref1, 
    transfered_ref2, 
    tax_id, 
    branch_id, 
    customer_name, 
    address_1, 
    address_2, 
    city_name, 
    province_name, 
    post_code
}) {
    const url = `https://fti-api-mg.azure-api.net/PostReceipt`;

    const requestBody = {
        div_code,
        sub_section_items,
        bank_account,
        transfered_date,
        transfered_amount,
        transfered_ref1,
        transfered_ref2,
        tax_id,
        branch_id,
        customer_name,
        address_1,
        address_2,
        city_name,
        province_name,
        post_code
    };

    try {
        // Delay before making the API call (1 second)
        await delay(10000);  // 1000 ms = 1 second

        const response = await axios.post(url, requestBody, {
            headers: {
                'Clientid': 'f423b069-6c7c-4422-b4f6-9b438aa391f2',
                'Clientsecret': 'a653f1c1-a1b8-4f5a-b5ea-3e4bef4be14a',
                'Content-Type': 'application/json',
                'Ocp-Apim-Subscription-Key': '52bcf82678b346de824fed6f832d63a3',
                'User-Agent': 'HTTPie',
            }
        });
        return response.data; // Return the data from the API
        
        //return requestBody;
        
    } catch (error) {
        console.error('PostReceipt API call error:', error);
        return null; // Return null if there's an error
    }
}

// Function to call external API for BillLookup with delay
async function callBillLookupApi(reference1, reference2, transactionAmount) {
    // Format reference1 as '097' + padded value
    const formattedRef1 = `097${reference1.padStart(11, '0')}`;

    // Ensure reference2 starts with '000'
    const formattedRef2 = `000${reference2}`;

    // Convert transactionAmount to cents and validate the length
    const amountInCents = Math.round(transactionAmount * 100);

    // Check if amountInCents exceeds 10 digits
    if (amountInCents.toString().length > 10) {
        console.error("Transaction amount exceeds 10 digits.");
        return null;  // Return null if the amount exceeds 10 digits
    }

    console.log("formattedRef1", formattedRef1);
    console.log("formattedRef2", formattedRef2);  // Log formatted ref2
    console.log("transactionAmount", transactionAmount);

    const url = `https://fti-api-mg.azure-api.net/BillLookup?reference1=${formattedRef1}&reference2=${formattedRef2}&tranAmount=${amountInCents}`;

    try {
        // Delay before making the API call (1 second)
        await delay(1000);  // 1000 ms = 1 second

        const response = await axios.get(url, {
            headers: {
                'Clientid': 'f423b069-6c7c-4422-b4f6-9b438aa391f2',
                'Clientsecret': 'a653f1c1-a1b8-4f5a-b5ea-3e4bef4be14a',
                'Content-Type': 'application/json',
                'Ocp-Apim-Subscription-Key': '52bcf82678b346de824fed6f832d63a3',
                'User-Agent': 'HTTPie',
            }
        });
        return response.data; // Return the data from the API
    } catch (error) {
        console.error('API call error:', error);
        return null; // Return null if there's an error
    }
}


router.post('/orders/reset-processing', async (req, res) => {
    try {
        const { site } = req.body;
        const client = req.client;

        if (!site) {
            return res.status(400).json({ status: false, message: 'Site ID is required' });
        }

        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const orderCollection = targetDb.collection('order');
        const resetCount = await resetStaleProcessingOrders(orderCollection, siteData._id.toString());

        return res.status(200).json({
            status: true,
            message: 'Stale processing orders reset successfully',
            resetCount,
        });
    } catch (error) {
        console.error('An error occurred while resetting processing orders:', error);
        return res.status(500).json({ status: false, message: 'An error occurred while resetting processing orders' });
    }
});

router.post('/orders/offline-confirm', async (req, res) => {
    try {
        const {
            site,
            ref1,
            ref2,
            amount,
            dryRun,
            transferedDate,
            confirmedBy,
            confirmNote,
        } = req.body;
        const client = req.client;

        const ref1List = Array.isArray(ref1)
            ? ref1.map((value) => String(value).trim()).filter(Boolean)
            : [String(ref1 || '').trim()].filter(Boolean);

        if (!site || ref1List.length === 0) {
            return res.status(400).json({ status: false, message: 'site and ref1 are required' });
        }

        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ status: false, message: 'Site data not found or invalid' });
        }

        const orderCollection = targetDb.collection('order');
        const enrollCollection = targetDb.collection('enroll');
        const formCollection = targetDb.collection('form');
        const siteIdString = siteData._id.toString();

        const buildQuery = (ref1Value, includeConfirmed = false) => {
            const query = {
                unit: siteIdString,
                ref1: String(ref1Value)
            };

            if (!includeConfirmed) {
                query.status = { $ne: 'confirm' };
            }

            if (ref2) {
                query.ref2 = String(ref2);
            }

            if (amount !== undefined && amount !== null && amount !== '') {
                query['detailData.transfered_amount'] = Number(amount);
            }

            return query;
        };

        const projection = {
            _id: 1,
            orderCode: 1,
            ref1: 1,
            ref2: 1,
            status: 1,
            process: 1,
            userID: 1,
            formID: 1,
            courseID: 1,
            detailData: 1,
        };

        if (dryRun) {
            const results = await Promise.all(ref1List.map(async (ref1Value) => {
                const matches = await orderCollection.find(buildQuery(ref1Value, true), { projection }).toArray();

                const matchesWithForm = await Promise.all(matches.map(async (order) => {
                    const form = await findRelatedForm(formCollection, order);

                    return {
                        orderId: order._id,
                        orderCode: order.orderCode,
                        ref1: order.ref1,
                        ref2: order.ref2,
                        amount: order.detailData?.transfered_amount ?? null,
                        status: order.status,
                        process: order.process,
                        form: form ? {
                            formObjectId: form._id,
                            formID: form.formID,
                            orderID: form.orderID,
                            status: form.status,
                            process: form.process,
                            ref2: form.formData?.ref2 || form.formData?.['hidden-8-0-5']?.value || null,
                            needsConfirmSync: order.status === 'confirm' && (form.status !== true || form.process !== 'confirm'),
                        } : null,
                    };
                }));

                return {
                    ref1: ref1Value,
                    matchCount: matches.length,
                    canConfirm: matches.length === 1 && matches[0].status !== 'confirm',
                    needsFormSync: matchesWithForm.some((order) => order.form?.needsConfirmSync),
                    matches: matchesWithForm
                };
            }));

            return res.status(200).json({
                status: true,
                dryRun: true,
                results,
            });
        }

        if (ref1List.length !== 1) {
            return res.status(400).json({ status: false, message: 'offline confirm requires exactly one ref1 unless dryRun is true' });
        }

        let matches = await orderCollection.find(buildQuery(ref1List[0]), { projection }).toArray();

        if (matches.length === 0) {
            matches = await orderCollection.find(buildQuery(ref1List[0], true), { projection }).toArray();
        }

        if (matches.length === 0) {
            return res.status(404).json({ status: false, message: 'No matching order found for offline confirm' });
        }

        if (matches.length > 1) {
            return res.status(409).json({
                status: false,
                message: 'Multiple matching orders found. Provide ref2 or amount to narrow the match.',
                matches: matches.map((order) => ({
                    orderId: order._id,
                    orderCode: order.orderCode,
                    ref1: order.ref1,
                    ref2: order.ref2,
                    amount: order.detailData?.transfered_amount ?? null,
                    status: order.status,
                    process: order.process,
                }))
            });
        }

        const order = matches[0];
        const normalizedTransferedDate = transferedDate ? new Date(transferedDate) : null;

        if (order.status === 'confirm') {
            const syncResult = await syncConfirmedOrderRelations({
                enrollCollection,
                formCollection,
                order,
            });
            const form = await findRelatedForm(formCollection, order);

            return res.status(200).json({
                status: true,
                message: 'Order is already confirmed. Related form and enroll records were synced.',
                order: {
                    orderId: order._id,
                    orderCode: order.orderCode,
                    ref1: order.ref1,
                    ref2: order.ref2,
                    finalStatus: order.status,
                    finalProcess: order.process,
                },
                syncResult,
                form: form ? {
                    formObjectId: form._id,
                    formID: form.formID,
                    orderID: form.orderID,
                    status: form.status,
                    process: form.process,
                } : null,
            });
        }

        await markOrderAsConfirmed({
            orderCollection,
            enrollCollection,
            formCollection,
            order,
            transferedDate: normalizedTransferedDate,
            confirmedBy,
            confirmNote,
        });

        return res.status(200).json({
            status: true,
            message: 'Order confirmed successfully by offline manual confirmation',
            order: {
                orderId: order._id,
                orderCode: order.orderCode,
                ref1: order.ref1,
                ref2: order.ref2,
                finalStatus: 'confirm',
                confirmSource: 'offline_manual',
            }
        });
    } catch (error) {
        console.error('An error occurred while confirming offline payment:', error);
        return res.status(500).json({ status: false, message: 'An error occurred while confirming offline payment' });
    }
});


router.post('/orders', async (req, res) => {
    try {
        const jobStartedAt = new Date();
        const { site } = req.body;
        const client = req.client;

        if (!site) {
            return res.status(400).json({ status: false, message: 'Site ID is required' });
        }

        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const orderCollection = targetDb.collection('order');
        const siteIdString = siteData._id.toString();

        // Get current date in UTC to ensure filtering for orders created in 2025
        const startOf2025 = new Date('2026-05-01T00:00:00.000Z');
        const endOf2025 = new Date('2026-06-30T23:59:59.999Z');

        // Claim newest pending orders first so the next cron run does not pick them again.
        const orders = await claimPendingOrders(orderCollection, {
            unit: siteIdString,
            createdAt: { $gte: startOf2025, $lte: endOf2025 }
        });

        if (orders.length === 0) {
            return res.status(404).json({ status: false, message: 'No pending orders found for the given unit in the configured date window' });
        }

        // For each order, fetch userID, formID, enrollID along with order data
        const enrichedOrders = await Promise.all(orders.map(async (order) => {
            try {
                const userCollection = targetDb.collection('user');
                const enrollCollection = targetDb.collection('enroll');
                const formCollection = targetDb.collection('form');

                // Fetch userID from the user collection (just _id)
                const user = await userCollection.findOne({ _id: order.userID }, { projection: { _id: 1 } });

                // Fetch formID from the form collection (just _id)
                const form = await formCollection.findOne({ formID: order.formID, userID: order.userID }, { projection: { _id: 1 } });

                // Fetch enrollID by orderID from the enroll collection (just _id)
                const enroll = await enrollCollection.findOne({
                    courseID: order.courseID.toString(),
                    userID: order.userID.toString(),
                    orderID: order._id.toString()
                }, { projection: { _id: 1 } });

                // Make API call to check BillLookup with 1 second delay per request
                const billData = await callBillLookupApi(order.detailData.transfered_ref1, order.detailData.transfered_ref2, order.detailData.transfered_amount);

                if (!billData) {
                    console.log(`Failed to get Bill Lookup data for Order: ${order._id}`);
                    return {
                        orderId: order._id,
                        orderCode: order.orderCode,
                        createdAt: order.createdAt,
                        processingStartedAt: order.processingStartedAt,
                        enrollID: enroll ? enroll._id : null,
                        result: 'bill_lookup_failed',
                        paymentDetected: false,
                        receiptIssued: false,
                        finalStatus: 'processing',
                        billData: null,
                    };
                }

                const formattedRef1 = `097${order.detailData.transfered_ref1.padStart(11, '0')}`;
                const formattedRef2 = `000${order.detailData.transfered_ref2}`;

                if (billData.responseCode === '0002' && billData.reference1 === formattedRef1 && billData.reference2 === formattedRef2) {
                    if (billData.tranAmount !== order.detailData.transfered_amount) {
                        console.log("Order:" + order._id + " has Already paid but Amount not Match");
                
                        // Update Order Status, Process, and Details to 'draft' since the amounts don't match
                        await orderCollection.updateOne(
                            { _id: order._id },
                            { 
                                $set: { 
                                    status: 'draft', 
                                    process: 'draft',
                                    'detailData.transfered_date': billData.tranDate,
                                    'detailData.bankAccount': billData.bankAccount 
                                },
                                $unset: {
                                    processingStartedAt: ''
                                }
                            }
                        );
                
                        // Change Enroll Status to false if found
                        if (enroll) {
                            await enrollCollection.updateOne(
                                { _id: enroll._id },
                                { $set: { status: false } }
                            );
                        }
                
                        // Change Form Status and Process to 'draft' if found
                        if (form) {
                            await formCollection.updateOne(
                                { _id: form._id },
                                { $set: { status: false, process: 'draft' } }
                            );
                        }

                        return {
                            orderId: order._id,
                            orderCode: order.orderCode,
                            createdAt: order.createdAt,
                            processingStartedAt: order.processingStartedAt,
                            enrollID: enroll ? enroll._id : null,
                            result: 'amount_mismatch',
                            paymentDetected: true,
                            receiptIssued: false,
                            finalStatus: 'draft',
                            billData,
                        };
                    } else {
                        console.log("Order:" + order._id + " has Already paid");
                
                        const postReceiptData = {
                            div_code: order.detailData.div_code,
                            sub_section_items: [
                                {
                                    sub_section_code: order.detailData.sub_section_items[0].sub_section_code,
                                    sub_section_qty: order.detailData.sub_section_items[0].sub_section_qty,
                                    sub_section_amount: order.detailData.sub_section_items[0].sub_section_amount
                                }
                            ],
                            bank_account: order.detailData.bank_account,
                            transfered_date: billData.tranDate,
                            transfered_amount: order.detailData.transfered_amount,
                            transfered_ref1: formattedRef1,
                            transfered_ref2: formattedRef2,
                            tax_id: order.detailData.tax_id,
                            branch_id: order.detailData.branch_id,
                            customer_name: order.detailData.customer_name,
                            address_1: order.detailData.address_1,
                            address_2: order.detailData.address_2,
                            city_name: order.detailData.city_name,
                            province_name: order.detailData.province_name,
                            post_code: String(order.detailData.post_code)
                        };
                        
                        const receiptResponse = await postReceiptApi(postReceiptData);
                        
                        if (receiptResponse && receiptResponse.success) {
                            console.log("Receipt successfully posted:", receiptResponse);

                            // Update Order Status, Process, and Details to 'confirm' since the amounts match
                            await orderCollection.updateOne(
                                { _id: order._id },
                                { 
                                    $set: { 
                                        status: 'confirm', 
                                        process: 'confirm',
                                        'detailData.transfered_date': billData.tranDate,
                                        'detailData.receipt_date': new Date(),
                                        'detailData.bankAccount': billData.bankAccount,
                                        'detailData.tranNo': receiptResponse.data 
                                    },
                                    $unset: {
                                        processingStartedAt: ''
                                    }
                                }
                            );
                    
                            // Change Enroll Status to true if found
                            if (enroll) {
                                await enrollCollection.updateOne(
                                    { _id: enroll._id },
                                    { $set: { status: true } }
                                );
                            }
                    
                            // Change Form Status and Process to 'confirm' if found
                            if (form) {
                                await formCollection.updateOne(
                                    { _id: form._id },
                                    { $set: { status: true, process: 'confirm' } }
                                );
                            }

                            return {
                                orderId: order._id,
                                orderCode: order.orderCode,
                                createdAt: order.createdAt,
                                processingStartedAt: order.processingStartedAt,
                                enrollID: enroll ? enroll._id : null,
                                result: 'receipt_issued',
                                paymentDetected: true,
                                receiptIssued: true,
                                finalStatus: 'confirm',
                                billData,
                                receiptNo: receiptResponse.data,
                            };
                            
                        } else {
                            console.log("Failed to post receipt.");
                            return {
                                orderId: order._id,
                                orderCode: order.orderCode,
                                createdAt: order.createdAt,
                                processingStartedAt: order.processingStartedAt,
                                enrollID: enroll ? enroll._id : null,
                                result: 'receipt_failed',
                                paymentDetected: true,
                                receiptIssued: false,
                                    finalStatus: 'processing',
                                billData,
                            };
                        }
                    }
                } else {
                    return {
                        orderId: order._id,
                        orderCode: order.orderCode,
                        createdAt: order.createdAt,
                        processingStartedAt: order.processingStartedAt,
                        enrollID: enroll ? enroll._id : null,
                        result: 'not_paid',
                        paymentDetected: false,
                        receiptIssued: false,
                        finalStatus: 'processing',
                        billData,
                    };
                }
            } catch (orderError) {
                console.error(`Order processing failed for ${order._id}:`, orderError);

                return {
                    orderId: order._id,
                    orderCode: order.orderCode,
                    createdAt: order.createdAt,
                    processingStartedAt: order.processingStartedAt,
                    formID: order.formID,
                    enrollID: null,
                    billData: null,
                    result: 'error',
                    paymentDetected: false,
                    receiptIssued: false,
                    finalStatus: 'processing',
                    error: orderError.message,
                };
            }
        }));

        const jobFinishedAt = new Date();
        const summary = enrichedOrders.reduce((accumulator, order) => {
            accumulator.claimedCount += 1;

            if (order.paymentDetected) {
                accumulator.paymentDetectedCount += 1;
            }

            if (order.receiptIssued) {
                accumulator.receiptIssuedCount += 1;
            }

            if (order.result === 'amount_mismatch') {
                accumulator.draftCount += 1;
            }

            if (order.result === 'not_paid' || order.result === 'bill_lookup_failed' || order.result === 'receipt_failed') {
                accumulator.pendingRetryCount += 1;
            }

            if (order.result === 'error') {
                accumulator.errorCount += 1;
            }

            return accumulator;
        }, {
            claimedCount: 0,
            paymentDetectedCount: 0,
            receiptIssuedCount: 0,
            draftCount: 0,
            pendingRetryCount: 0,
            errorCount: 0,
        });

        return res.status(200).json({
            status: true,
            message: 'Orders retrieved successfully',
            job: {
                startedAt: jobStartedAt,
                finishedAt: jobFinishedAt,
                durationMs: jobFinishedAt.getTime() - jobStartedAt.getTime(),
            },
            summary,
            orders: enrichedOrders,
        });

    } catch (error) {
        console.error('An error occurred:', error);
        res.status(500).json({ status: false, message: 'An error occurred while retrieving the data' });
    }
});



// Use error handling middleware
router.use(errorHandler);

module.exports = router;
