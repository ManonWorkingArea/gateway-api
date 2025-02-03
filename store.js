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
        await delay(1000);  // 1000 ms = 1 second

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


router.post('/orders', async (req, res) => {
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
        const siteIdString = siteData._id.toString();

        // Get current date in UTC to ensure filtering for orders created in 2025
        const startOf2025 = new Date('2025-01-01T00:00:00.000Z');
        const endOf2025 = new Date('2025-12-31T23:59:59.999Z');

        // Fetch orders where the unit matches, createdAt is in 2025, and status is pending
        const orders = await orderCollection.find({
            unit: siteIdString,
            status: 'pending',
            createdAt: { $gte: startOf2025, $lte: endOf2025 }
        })
        .project({
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
            detailData: 1
        })
        .limit(20) // Limit to the first 10 results
        .toArray();

        if (orders.length === 0) {
            return res.status(404).json({ status: false, message: 'No pending orders created in 2025 found for the given unit' });
        }

        // For each order, fetch userID, formID, enrollID along with order data
        const enrichedOrders = await Promise.all(orders.map(async (order) => {
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
                    ...order,  // Include the full order data
                    userID: order.userID,  // Include userID
                    formID: order.formID,  // Include formID
                    enrollID: enroll ? enroll._id : null,  // Include enrollID if found
                    billData: null,  // No data from API
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
                    
                    if (receiptResponse.success) {
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
                        
                    } else {
                        console.log("Failed to post receipt.");
                    }
                }
            }            

            return {
                ...order,  // Include the full order data
                userID: order.userID,  // Include userID
                formID: order.formID,  // Include formID
                enrollID: enroll ? enroll._id : null,  // Include enrollID if found
                billData: billData, // Include the result of the API call
            };
        }));

        return res.status(200).json({
            status: true,
            message: 'Orders retrieved successfully',
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
