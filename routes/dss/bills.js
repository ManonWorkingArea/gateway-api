const express = require('express');
const { safeObjectId } = require('../middleware/mongoMiddleware'); // Adjust path
const { findOrCreatePerson } = require('./helpers'); // Import helper
const router = express.Router();

// POST /bills (Add New) - Mounted at /bills in dss.js
router.post('/', async (req, res) => {
     try {
        const { client } = req; // Or just use req.client directly
        const db = client.db('dss');

        // Ensure necessary collections exist (bills, products)
        // 'peoples' is checked in findOrCreatePerson
        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map(col => col.name);
        if (!collectionNames.includes('bills')) {
            await db.createCollection('bills');
        }
        if (!collectionNames.includes('products')) {
            await db.createCollection('products');
        }

        const billsCollection = db.collection('bills');
        const productsCollection = db.collection('products');

        const billData = req.body;

        // --- 1. Duplicate Invoice Check ---
        const { invoiceId, clusterId, omId, vcId, subVcId, vendorName, vendorAddress, customerName, customerAddress, items } = billData;

        if (!invoiceId || !clusterId || !omId || !vcId) {
            return res.status(400).json({ error: 'invoiceId, clusterId, omId, and vcId are required' });
        }

        const duplicateQuery = {
            invoiceId: invoiceId, 
            clusterId: clusterId, 
            omId: omId, 
            vcId: vcId
        };
        
        // Only add subVcId to query if it exists
        if (subVcId) {
            duplicateQuery.subVcId = subVcId;
        }

        const existingBill = await billsCollection.findOne(duplicateQuery);

        if (existingBill) {
            return res.status(409).json({ error: 'Duplicate invoiceId for the same cluster, om, and vc combination' });
        }

        // --- 2. Process Vendor ---
        let vendorId = null;
        if (vendorName) {
             try {
                 vendorId = await findOrCreatePerson(db, vendorName, vendorAddress, 'supplier');
             } catch (personError) {
                 console.error("Error processing vendor:", personError);
                 return res.status(500).json({ error: 'Failed to process vendor information' });
             }
        }

        // --- 3. Process Customer ---
        let customerId = null;
         if (customerName) {
             try {
                 customerId = await findOrCreatePerson(db, customerName, customerAddress, 'customer');
             } catch (personError) {
                 console.error("Error processing customer:", personError);
                 return res.status(500).json({ error: 'Failed to process customer information' });
             }
         }

        // --- 4. Process Items ---
        const processedItems = [];
        if (items && Array.isArray(items)) {
            for (const item of items) {
                try {
                    // Prepare product data
                    const productData = {
                        description: item.description,
                        unitPrice: item.unitPrice,
                        createdAt: new Date()
                    };
                    if (item.type) productData.type = item.type;

                    const productResult = await productsCollection.insertOne(productData);

                    const itemWithProductId = {
                        ...item,
                        productId: productResult.insertedId.toString()
                    };
                    processedItems.push(itemWithProductId);

                } catch (productError) {
                     console.error("Error processing bill item:", productError);
                     return res.status(500).json({ error: 'Failed to process bill item information' });
                }
            }
        }

        // --- 5. Prepare Final Bill Data ---
        const finalBillData = { ...billData };
        finalBillData.vendor = { id: vendorId, name: vendorName, address: vendorAddress };
        finalBillData.customer = { id: customerId, name: customerName, address: customerAddress };
        delete finalBillData.vendorName; delete finalBillData.vendorAddress; delete finalBillData.vendorId;
        delete finalBillData.customerName; delete finalBillData.customerAddress; delete finalBillData.customerId;
        finalBillData.items = processedItems;
        finalBillData.status = "pending";
        finalBillData.createdAt = new Date();

        // --- 6. Insert Final Bill ---
        const result = await billsCollection.insertOne(finalBillData);
        res.status(201).json({ success: true, data: { id: result.insertedId, ...finalBillData } });

    } catch (error) {
        console.error('Error adding new bill:', error);
        res.status(500).json({ error: 'Failed to add new bill' });
    }
});

// GET /bills (List) - Mounted at /bills
router.get('/', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const billsCollection = db.collection('bills');
        const bills = await billsCollection.find({}).toArray();
        res.status(200).json({ success: true, data: bills });
    } catch (error) {
        console.error('Error fetching bills:', error);
        res.status(500).json({ error: 'Failed to fetch bills' });
    }
});

// GET /bills/:id (Single) - Mounted at /bills
router.get('/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const billsCollection = db.collection('bills');
        const billId = safeObjectId(req.params.id);
        const billData = await billsCollection.findOne({ _id: billId });
        if (!billData) {
            return res.status(404).json({ error: 'Bill not found' });
        }
        res.status(200).json({ success: true, data: billData });
    } catch (error) {
        console.error('Error fetching bill:', error);
        res.status(500).json({ error: 'Failed to fetch bill' });
    }
});

// PUT /bills/:id (Update) - Mounted at /bills
router.put('/:id', async (req, res) => {
     try {
        const db = req.client.db('dss');
        const billsCollection = db.collection('bills');
        const billId = safeObjectId(req.params.id);
        const updatedBillData = req.body;
        delete updatedBillData._id;
        delete updatedBillData.createdAt; // Prevent updating creation time
        // Consider if items/vendor/customer should be updated here or need special logic

        const result = await billsCollection.updateOne(
            { _id: billId },
            { $set: updatedBillData, $currentDate: { lastModified: true } }
        );
        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Bill not found' });
        }
        const updatedDoc = await billsCollection.findOne({ _id: billId });
        res.status(200).json({ success: true, data: updatedDoc });
    } catch (error) {
        console.error('Error updating bill:', error);
        res.status(500).json({ error: 'Failed to update bill' });
    }
});

// DELETE /bills/:id - Mounted at /bills
router.delete('/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const billsCollection = db.collection('bills');
        const billId = safeObjectId(req.params.id);
        // Consider deleting related products/people if they are no longer referenced? Complex.
        const result = await billsCollection.deleteOne({ _id: billId });
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Bill not found' });
        }
        res.status(200).json({ success: true, data: { deletedCount: result.deletedCount } });
    } catch (error) {
        console.error('Error deleting bill:', error);
        res.status(500).json({ error: 'Failed to delete bill' });
    }
});


module.exports = router; 