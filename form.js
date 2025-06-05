const express = require('express');
const { authenticateClient, safeObjectId } = require('./routes/middleware/mongoMiddleware');
const CryptoJS = require('crypto-js');
const router = express.Router();

// Middleware to authenticate client
router.use(authenticateClient);

// Define your secret key
const SALT_KEY = '4KLj7y[Am@/}+J{C1S`k*>qts81HV[>>Q|Qk8*gwv./ij#R.%q=gb<TMh>d*Kn-:';

// Decrypt function
const decrypt = (encryptedText) => {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedText, SALT_KEY);
    return JSON.parse(bytes.toString(CryptoJS.enc.Utf8)); // Parse decrypted JSON
  } catch (error) {
    throw new Error('Decryption failed'); // Handle decryption errors
  }
};

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

router.post('/data/submit', async (req, res) => {
    try {
        // Decrypt the incoming data
        const decryptedData = decrypt(req.body.data);
        const { site, formID, formData, status } = decryptedData;

        if (!site || !formID || !formData) {
            return res.status(400).json({ error: 'Missing required fields: site, formID, formData are required.' });
        }

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const siteIdString = siteData._id.toString();
        const formCollection = targetDb.collection('form');

        // Prepare form document
        const now = new Date();
        const formattedDate = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
        const formattedTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

        const formDocument = {
            parent: siteIdString,
            formID,
            status: status || false,
            formData,
            createdAt: now,
            updatedAt: now,
            date: formattedDate,
            time: formattedTime
        };

        // Insert form data into collection
        const result = await formCollection.insertOne(formDocument);

        if (!result.insertedId) {
            return res.status(500).json({ error: 'Failed to insert form data.' });
        }
        
        res.status(201).json({
            success: true,
            message: 'Form submitted successfully.',
            data: { insertedId: result.insertedId },
        });
    } catch (error) {
        console.error('Error submitting form:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while submitting the form.' });
    }
});

router.post('/data/get', async (req, res) => {
    try {
        // Decrypt the incoming data
        const decryptedData = decrypt(req.body.data);
        const { site, formID, page = 1, limit = 10 } = decryptedData;

        if (!site || !formID) {
            return res.status(400).json({ error: 'Missing required fields: site, formID are required.' });
        }

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const siteIdString = siteData._id.toString();
        const formCollection = targetDb.collection('form');

        // Build query
        const query = {
            parent: siteIdString,
            formID: formID
        };

        // Get total count for pagination
        const totalItems = await formCollection.countDocuments(query);
        const totalPages = Math.ceil(totalItems / limit);
        const skip = (page - 1) * limit;

        // Fetch form submissions with pagination
        const formSubmissions = await formCollection
            .find(query)
            .sort({ createdAt: -1 }) // Sort by newest first
            .skip(skip)
            .limit(limit)
            .toArray();

        res.status(200).json({
            success: true,
            message: 'Form submissions retrieved successfully.',
            data: formSubmissions,
            meta: {
                totalItems,
                totalPages,
                currentPage: page,
                limit,
                hasNextPage: page < totalPages,
                hasPreviousPage: page > 1
            }
        });
    } catch (error) {
        console.error('Error retrieving form submissions:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while retrieving form submissions.' });
    }
});

module.exports = router; 