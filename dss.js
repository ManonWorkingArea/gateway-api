const express = require('express');
const { authenticateClient, safeObjectId } = require('./routes/middleware/mongoMiddleware');
const router = express.Router();
const CryptoJS = require('crypto-js');

// Middleware to authenticate client
router.use(authenticateClient);

// Get or create MongoDB collections for 'dss' database
const getCollections = async (client) => {
    const db = client.db('dss');
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(col => col.name);

    if (!collectionNames.includes('cluster')) {
        await db.createCollection('cluster');
    }

    return {
        cluster: db.collection('cluster'),
    };
};

// Helper function to get nested OM, VC, SubVC data by Cluster ID
const getNestedOmDataByClusterId = async (db, clusterId) => {
    const omCollection = db.collection('om');
    const vcCollection = db.collection('vc');
    const subVcCollection = db.collection('sub_vc');

    // Find OM data by clusterId
    const omData = await omCollection.find({ clusterId: clusterId }).toArray();

    // For each OM item, find related VC data and nest it
    for (let omItem of omData) {
        const vcData = await vcCollection.find({ omId: omItem._id.toString() }).toArray();

        // For each VC item, find related Sub VC data and nest it
        for (let vcItem of vcData) {
            const subVcData = await subVcCollection.find({ vcId: vcItem._id.toString() }).toArray();
            vcItem.subVcData = subVcData; // Nest Sub VC data under each VC item
        }

        omItem.vcData = vcData; // Nest VC data under each OM item
    }
    return omData; // Return the fully nested data
};

// Helper function to find or create a person (supplier/customer) - Return ID as string
const findOrCreatePerson = async (db, name, address, type) => {
    const peoplesCollection = db.collection('peoples');
    // Ensure 'peoples' collection exists
    const collections = await db.listCollections({ name: 'peoples' }).toArray();
    if (collections.length === 0) {
        await db.createCollection('peoples');
    }

    const existingPerson = await peoplesCollection.findOne({ name: name, type: type });

    if (existingPerson) {
        return existingPerson._id.toString(); // Convert existing ObjectId to string
    } else {
        const newPerson = {
            name: name,
            address: address,
            type: type,
            createdAt: new Date()
        };
        const result = await peoplesCollection.insertOne(newPerson);
        return result.insertedId.toString(); // Convert new ObjectId to string
    }
};

// 📌 Cluster Endpoints
// Get List of Cluster Collection
router.get('/clusters', async (req, res) => {
    try {
        const { client } = req;
        const { cluster } = await getCollections(client);

        const clusters = await cluster.find({}).toArray();

        res.status(200).json({ success: true, data: clusters });
    } catch (error) {
        console.error('Error fetching clusters:', error);
        res.status(500).json({ error: 'Failed to fetch clusters' });
    }
});

// 📌 Add New Cluster
router.post('/cluster', async (req, res) => {
    try {
        const { client } = req;
        const { cluster } = await getCollections(client);

        const newCluster = req.body;

        const result = await cluster.insertOne(newCluster);

        res.status(201).json({ success: true, data: { id: result.insertedId, ...newCluster } });
    } catch (error) {
        console.error('Error adding new cluster:', error);
        res.status(500).json({ error: 'Failed to add new cluster' });
    }
});

// 📌 Update Existing Cluster
router.put('/cluster/:id', async (req, res) => {
    try {
        const { client } = req;
        const { cluster } = await getCollections(client);

        const clusterId = safeObjectId(req.params.id);
        const updatedClusterData = req.body;

        // Remove _id from updatedClusterData to prevent immutable field error
        delete updatedClusterData._id;

        const result = await cluster.updateOne(
            { _id: clusterId },
            { $set: updatedClusterData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Cluster not found' });
        }

        res.status(200).json({ success: true, data: { id: clusterId, ...updatedClusterData } });
    } catch (error) {
        console.error('Error updating cluster:', error);
        res.status(500).json({ error: 'Failed to update cluster' });
    }
});

// 📌 Get Single Cluster by ID
router.get('/cluster/:id', async (req, res) => {
    try {
        const { client } = req;
        const { cluster } = await getCollections(client);

        const clusterId = safeObjectId(req.params.id);

        const clusterData = await cluster.findOne({ _id: clusterId });

        if (!clusterData) {
            return res.status(404).json({ error: 'Cluster not found' });
        }

        res.status(200).json({ success: true, data: clusterData });
    } catch (error) {
        console.error('Error fetching cluster:', error);
        res.status(500).json({ error: 'Failed to fetch cluster' });
    }
});

// 📌 OM Endpoints
// Add New Data to OM Collection
router.post('/om', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
        
        // Check if 'om' collection exists, if not create it
        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map(col => col.name);
        if (!collectionNames.includes('om')) {
            await db.createCollection('om');
        }

        const omCollection = db.collection('om');
        const newData = req.body;

        const result = await omCollection.insertOne(newData);

        res.status(201).json({ success: true, data: { id: result.insertedId, ...newData } });
    } catch (error) {
        console.error('Error adding data to OM collection:', error);
        res.status(500).json({ error: 'Failed to add data to OM collection' });
    }
});

// Get OM Data by Cluster ID with Nested VC and Sub VC Data (Refactored)
router.get('/om/cluster/:clusterId', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
        const clusterId = req.params.clusterId;

        // Call the helper function
        const nestedOmData = await getNestedOmDataByClusterId(db, clusterId);

        // Return the data, even if it's an empty array
        res.status(200).json({ success: true, data: nestedOmData });
    } catch (error) {
        console.error('Error fetching OM data by cluster ID:', error);
        res.status(500).json({ error: 'Failed to fetch OM data' });
    }
});

// Update OM Data by OM ID
router.put('/om/:omId', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
        const omCollection = db.collection('om');

        const omId = safeObjectId(req.params.omId);
        const updatedOmData = req.body;

        // Remove _id from updatedOmData to prevent immutable field error
        delete updatedOmData._id;

        const result = await omCollection.updateOne(
            { _id: omId },
            { $set: updatedOmData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'OM not found' });
        }

        res.status(200).json({ success: true, data: { id: omId, ...updatedOmData } });
    } catch (error) {
        console.error('Error updating OM data by OM ID:', error);
        res.status(500).json({ error: 'Failed to update OM data' });
    }
});

// Delete OM Data by OM ID and Related VC Data
router.delete('/om/:omId', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
        const omCollection = db.collection('om');
        const vcCollection = db.collection('vc');

        const omId = req.params.omId;

        // First, delete all VC data related to this OM ID
        const vcDeleteResult = await vcCollection.deleteMany({ omId: omId });

        // Then, delete the OM data
        const omDeleteResult = await omCollection.deleteOne({ _id: safeObjectId(omId) });

        if (omDeleteResult.deletedCount === 0) {
            return res.status(404).json({ error: 'OM not found' });
        }

        res.status(200).json({ 
            success: true, 
            data: { 
                omDeletedCount: omDeleteResult.deletedCount, 
                vcDeletedCount: vcDeleteResult.deletedCount 
            } 
        });
    } catch (error) {
        console.error('Error deleting OM data and related VC data by OM ID:', error);
        res.status(500).json({ error: 'Failed to delete OM data and related VC data' });
    }
});

// 📌 VC Endpoints
// Add New Data to VC Collection
router.post('/vc', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
        
        // Check if 'vc' collection exists, if not create it
        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map(col => col.name);
        if (!collectionNames.includes('vc')) {
            await db.createCollection('vc');
        }

        const vcCollection = db.collection('vc');
        const newData = req.body;

        const result = await vcCollection.insertOne(newData);

        res.status(201).json({ success: true, data: { id: result.insertedId, ...newData } });
    } catch (error) {
        console.error('Error adding data to VC collection:', error);
        res.status(500).json({ error: 'Failed to add data to VC collection' });
    }
});

// Update VC Data by OM ID
router.put('/vc/om/:omId', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
        const vcCollection = db.collection('vc');

        const omId = req.params.omId;
        const updatedVcData = req.body;

        const result = await vcCollection.updateMany(
            { omId: omId },
            { $set: updatedVcData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'No VC data found for this OM ID' });
        }

        res.status(200).json({ success: true, data: { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount } });
    } catch (error) {
        console.error('Error updating VC data by OM ID:', error);
        res.status(500).json({ error: 'Failed to update VC data' });
    }
});

// Delete VC Data by OM ID
router.delete('/vc/om/:omId', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
        const vcCollection = db.collection('vc');

        const omId = req.params.omId;

        const result = await vcCollection.deleteMany({ omId: omId });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'No VC data found for this OM ID' });
        }

        res.status(200).json({ success: true, data: { deletedCount: result.deletedCount } });
    } catch (error) {
        console.error('Error deleting VC data by OM ID:', error);
        res.status(500).json({ error: 'Failed to delete VC data' });
    }
});

// Delete VC Data by VC ID
router.delete('/vc/:vcId', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
        const vcCollection = db.collection('vc');

        const vcId = safeObjectId(req.params.vcId);

        const result = await vcCollection.deleteOne({ _id: vcId });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'VC not found' });
        }

        res.status(200).json({ success: true, data: { deletedCount: result.deletedCount } });
    } catch (error) {
        console.error('Error deleting VC data by VC ID:', error);
        res.status(500).json({ error: 'Failed to delete VC data' });
    }
});

// Update VC Data by VC ID
router.put('/vc/:vcId', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
        const vcCollection = db.collection('vc');

        const vcId = safeObjectId(req.params.vcId);
        const updatedVcData = req.body;

        // Remove _id from updatedVcData to prevent immutable field error
        delete updatedVcData._id;

        const result = await vcCollection.updateOne(
            { _id: vcId },
            { $set: updatedVcData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'VC not found' });
        }

        res.status(200).json({ success: true, data: { id: vcId, ...updatedVcData } });
    } catch (error) {
        console.error('Error updating VC data by VC ID:', error);
        res.status(500).json({ error: 'Failed to update VC data' });
    }
});

// 📌 Sub VC Endpoints
// Add New Data to Sub VC Collection
router.post('/sub_vc', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
        
        // Check if 'sub_vc' collection exists, if not create it
        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map(col => col.name);
        if (!collectionNames.includes('sub_vc')) {
            await db.createCollection('sub_vc');
        }

        const subVcCollection = db.collection('sub_vc');
        const newData = req.body;

        const result = await subVcCollection.insertOne(newData);

        res.status(201).json({ success: true, data: { id: result.insertedId, ...newData } });
    } catch (error) {
        console.error('Error adding data to Sub VC collection:', error);
        res.status(500).json({ error: 'Failed to add data to Sub VC collection' });
    }
});

// Update Sub VC Data by Sub VC ID
router.put('/sub_vc/:subVcId', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
        const subVcCollection = db.collection('sub_vc');

        const subVcId = safeObjectId(req.params.subVcId);
        const updatedSubVcData = req.body;

        // Remove _id from updatedSubVcData to prevent immutable field error
        delete updatedSubVcData._id;

        const result = await subVcCollection.updateOne(
            { _id: subVcId },
            { $set: updatedSubVcData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Sub VC not found' });
        }

        res.status(200).json({ success: true, data: { id: subVcId, ...updatedSubVcData } });
    } catch (error) {
        console.error('Error updating Sub VC data by Sub VC ID:', error);
        res.status(500).json({ error: 'Failed to update Sub VC data' });
    }
});

// Delete Sub VC Data by Sub VC ID
router.delete('/sub_vc/:subVcId', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
        const subVcCollection = db.collection('sub_vc');

        const subVcId = safeObjectId(req.params.subVcId);

        const result = await subVcCollection.deleteOne({ _id: subVcId });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Sub VC not found' });
        }

        res.status(200).json({ success: true, data: { deletedCount: result.deletedCount } });
    } catch (error) {
        console.error('Error deleting Sub VC data by Sub VC ID:', error);
        res.status(500).json({ error: 'Failed to delete Sub VC data' });
    }
});

// 📌 User Endpoints
// Add New User with Password Hashing using crypto-js
router.post('/users', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
        
        // Check if 'users' collection exists, if not create it
        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map(col => col.name);
        if (!collectionNames.includes('users')) {
            await db.createCollection('users');
        }

        const usersCollection = db.collection('users');
        const { password, ...userData } = req.body;

        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }

        // Generate salt using crypto-js
        const salt = CryptoJS.lib.WordArray.random(128 / 8).toString(CryptoJS.enc.Hex);

        // Hash password using PBKDF2
        const keySize = 256 / 32;
        const iterations = 10000;
        const hashedPassword = CryptoJS.PBKDF2(password, salt, {
            keySize: keySize,
            iterations: iterations
        }).toString(CryptoJS.enc.Hex);

        // Prepare user data for insertion
        const newUser = {
            ...userData,
            password: hashedPassword,
            salt: salt
        };

        const result = await usersCollection.insertOne(newUser);

        // Don't send back password or salt in the response
        const responseData = { ...newUser };
        delete responseData.password;
        delete responseData.salt;

        res.status(201).json({ success: true, data: { id: result.insertedId, ...responseData } });
    } catch (error) {
        console.error('Error adding new user:', error);
        if (error.code === 11000) {
            return res.status(409).json({ error: 'User already exists' });
        }
        res.status(500).json({ error: 'Failed to add new user' });
    }
});

// Get List of Users (Remove sensitive data)
router.get('/users', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
        const usersCollection = db.collection('users');

        const users = await usersCollection.find({}, { projection: { password: 0, salt: 0 } }).toArray();

        res.status(200).json({ success: true, data: users });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Get Single User by ID (Remove sensitive data)
router.get('/users/:id', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
        const usersCollection = db.collection('users');

        const userId = safeObjectId(req.params.id);

        const userData = await usersCollection.findOne({ _id: userId }, { projection: { password: 0, salt: 0 } });

        if (!userData) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.status(200).json({ success: true, data: userData });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

// Update Existing User (Handle password update using crypto-js)
router.put('/users/:id', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
        const usersCollection = db.collection('users');

        const userId = safeObjectId(req.params.id);
        const { password, ...updatedUserData } = req.body;

        // Remove _id from updatedUserData to prevent immutable field error
        delete updatedUserData._id;

        // If password is being updated, hash it using crypto-js
        if (password) {
            const salt = CryptoJS.lib.WordArray.random(128 / 8).toString(CryptoJS.enc.Hex);
            const keySize = 256 / 32;
            const iterations = 10000;
            const hashedPassword = CryptoJS.PBKDF2(password, salt, {
                keySize: keySize,
                iterations: iterations
            }).toString(CryptoJS.enc.Hex);

            updatedUserData.password = hashedPassword;
            updatedUserData.salt = salt;
        } else {
            // Ensure password and salt are not accidentally removed if not provided
            delete updatedUserData.password;
            delete updatedUserData.salt;
        }

        const result = await usersCollection.updateOne(
            { _id: userId },
            { $set: updatedUserData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Don't send back password or salt in the response
        delete updatedUserData.password;
        delete updatedUserData.salt;

        res.status(200).json({ success: true, data: { id: userId, ...updatedUserData } });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// Delete User by ID
router.delete('/users/:id', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
        const usersCollection = db.collection('users');

        const userId = safeObjectId(req.params.id);

        const result = await usersCollection.deleteOne({ _id: userId });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.status(200).json({ success: true, data: { deletedCount: result.deletedCount } });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// 📌 Authentication Endpoint
// User Login (Refactored)
router.post('/login', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
        const usersCollection = db.collection('users');
        const clusterCollection = db.collection('cluster');
        // No need to explicitly get om, vc, subvc collections here anymore

        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Find user by email
        const user = await usersCollection.findOne({ email: email });

        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Hash the provided password using the user's salt
        const keySize = 256 / 32;
        const iterations = 10000;
        const hashedPasswordAttempt = CryptoJS.PBKDF2(password, user.salt, {
            keySize: keySize,
            iterations: iterations
        }).toString(CryptoJS.enc.Hex);

        // Compare the hashed password attempt with the stored hash
        if (hashedPasswordAttempt !== user.password) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // --- Login Successful ---

        let clusterData = null;
        let fullyPopulatedOmData = [];

        if (user.clusterId) {
            try {
                // Fetch basic cluster data
                const clusterIdObject = safeObjectId(user.clusterId);
                clusterData = await clusterCollection.findOne({ _id: clusterIdObject });

                // Call the helper function to get nested data
                fullyPopulatedOmData = await getNestedOmDataByClusterId(db, user.clusterId);

            } catch (fetchError) {
                console.error('Error fetching cluster/OM/VC/SubVC data for user:', user._id, fetchError);
            }
        }

        // Prepare user data for response (remove sensitive info)
        const responseUserData = { ...user };
        delete responseUserData.password;
        delete responseUserData.salt;

        // Send success response
        res.status(200).json({
            success: true,
            message: 'Login successful',
            data: {
                user: responseUserData,
                cluster: clusterData,
                omData: fullyPopulatedOmData
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// 📌 Bills Endpoints
// Add New Bill with Duplicate Check, Vendor/Customer/Product Processing
router.post('/bills', async (req, res) => {
    try {
        const { client } = req;
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
        const { invoiceId, clusterId, omId, vcId, vendorName, vendorAddress, customerName, customerAddress, items } = billData;

        if (!invoiceId || !clusterId || !omId || !vcId) {
            return res.status(400).json({ error: 'invoiceId, clusterId, omId, and vcId are required' });
        }

        const existingBill = await billsCollection.findOne({
            invoiceId: invoiceId, clusterId: clusterId, omId: omId, vcId: vcId
        });

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

        // --- 4. Process Items and add productId (as string) to each item ---
        const processedItems = []; // Array to store items with productId added
        if (items && Array.isArray(items)) {
            for (const item of items) {
                try {
                    // Prepare product data with only specific fields for the products collection
                    const productData = {
                        description: item.description,
                        unitPrice: item.unitPrice, // Assuming unitPrice should be stored in master
                        createdAt: new Date()
                    };
                    // Include 'type' if it exists in the incoming item
                    if (item.type) {
                        productData.type = item.type;
                    }
                    // Note: quantity and totalAmount from the bill item are NOT included here

                    const productResult = await productsCollection.insertOne(productData);

                    // Create a new item object including the original data and the new productId as a string
                    // The original item (with quantity, totalAmount etc.) is kept in the bill's items array
                    const itemWithProductId = {
                        ...item, // Keep original item data (including quantity, totalAmount)
                        productId: productResult.insertedId.toString() // Add the STRING of the created product ID
                    };
                    processedItems.push(itemWithProductId);

                } catch (productError) {
                     console.error("Error processing bill item:", productError);
                     // Consider adding logic to potentially remove already created products if one fails
                     return res.status(500).json({ error: 'Failed to process bill item information' });
                }
            }
        }

        // --- 5. Prepare Final Bill Data with Grouped Vendor/Customer and Default Status ---
        const finalBillData = { ...billData }; // Start with original data

        // Create grouped vendor object
        finalBillData.vendor = {
            id: vendorId,
            name: vendorName,
            address: vendorAddress
        };

        // Create grouped customer object
        finalBillData.customer = {
            id: customerId,
            name: customerName,
            address: customerAddress
        };
        delete finalBillData.vendorName;
        delete finalBillData.vendorAddress;
        delete finalBillData.vendorId;
        delete finalBillData.customerName;
        delete finalBillData.customerAddress;
        delete finalBillData.customerId;

        // Update items array in the bill document
        finalBillData.items = processedItems;

        // Set default status to 'pending'
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

// Get List of Bills
router.get('/bills', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
        const billsCollection = db.collection('bills');

        const bills = await billsCollection.find({}).toArray();

        res.status(200).json({ success: true, data: bills });
    } catch (error) {
        console.error('Error fetching bills:', error);
        res.status(500).json({ error: 'Failed to fetch bills' });
    }
});

// Get Single Bill by ID
router.get('/bills/:id', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
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

// Update Existing Bill
router.put('/bills/:id', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
        const billsCollection = db.collection('bills');

        const billId = safeObjectId(req.params.id);
        const updatedBillData = req.body;

        // Remove _id from updatedBillData to prevent immutable field error
        delete updatedBillData._id;

        const result = await billsCollection.updateOne(
            { _id: billId },
            { $set: updatedBillData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Bill not found' });
        }

        res.status(200).json({ success: true, data: { id: billId, ...updatedBillData } });
    } catch (error) {
        console.error('Error updating bill:', error);
        res.status(500).json({ error: 'Failed to update bill' });
    }
});

// Delete Bill by ID
router.delete('/bills/:id', async (req, res) => {
    try {
        const { client } = req;
        const db = client.db('dss');
        const billsCollection = db.collection('bills');

        const billId = safeObjectId(req.params.id);

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