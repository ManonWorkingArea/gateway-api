const express = require('express');
const { safeObjectId } = require('../middleware/mongoMiddleware'); // Adjust path
const { getNestedOmDataByClusterId } = require('./helpers'); // Import helper
const router = express.Router();

// POST /om (Add New) - Mounted at /om in dss.js
router.post('/', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const omCollection = db.collection('om');
        // Ensure collection exists
        const collections = await db.listCollections({ name: 'om' }).toArray();
        if (collections.length === 0) await db.createCollection('om');

        const newData = req.body;
        const result = await omCollection.insertOne(newData);
        res.status(201).json({ success: true, data: { id: result.insertedId, ...newData } });
    } catch (error) {
        console.error('Error adding data to OM collection:', error);
        res.status(500).json({ error: 'Failed to add data to OM collection' });
    }
});

// GET /om/cluster/:clusterId (Get by Cluster with Nested Data) - Mounted at /om
router.get('/cluster/:clusterId', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const clusterId = req.params.clusterId;
        const nestedOmData = await getNestedOmDataByClusterId(db, clusterId);
        res.status(200).json({ success: true, data: nestedOmData });
    } catch (error) {
        console.error('Error fetching OM data by cluster ID:', error);
        res.status(500).json({ error: 'Failed to fetch OM data' });
    }
});


// PUT /om/:omId (Update) - Mounted at /om
router.put('/:omId', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const omCollection = db.collection('om');
        const omId = safeObjectId(req.params.omId);
        const updatedOmData = req.body;
        delete updatedOmData._id;

        const result = await omCollection.updateOne(
            { _id: omId },
            { $set: updatedOmData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'OM not found' });
        }
        const updatedDoc = await omCollection.findOne({ _id: omId });
        res.status(200).json({ success: true, data: updatedDoc });
    } catch (error) {
        console.error('Error updating OM data by OM ID:', error);
        res.status(500).json({ error: 'Failed to update OM data' });
    }
});

// DELETE /om/:omId (Delete OM and related VC/SubVC) - Mounted at /om
router.delete('/:omId', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const omCollection = db.collection('om');
        const vcCollection = db.collection('vc');
        const subVcCollection = db.collection('sub_vc');
        const omIdString = req.params.omId; // Keep as string for VC/SubVC query if needed, convert for OM delete
        const omIdObject = safeObjectId(omIdString);

        // Find related VC data
        const vcData = await vcCollection.find({ omId: omIdString }).toArray();

        let subVcDeletedCount = 0;
        // Delete related Sub VC data
        for (let vcItem of vcData) {
            const subResult = await subVcCollection.deleteMany({ vcId: vcItem._id.toString() });
            subVcDeletedCount += subResult.deletedCount;
        }

        // Delete related VC data
        const vcDeleteResult = await vcCollection.deleteMany({ omId: omIdString });

        // Delete the OM data
        const omDeleteResult = await omCollection.deleteOne({ _id: omIdObject });

        if (omDeleteResult.deletedCount === 0) {
            return res.status(404).json({ error: 'OM not found' });
        }

        res.status(200).json({
            success: true,
            data: {
                omDeletedCount: omDeleteResult.deletedCount,
                vcDeletedCount: vcDeleteResult.deletedCount,
                subVcDeletedCount: subVcDeletedCount
            }
        });
    } catch (error) {
        console.error('Error deleting OM data and related VC/SubVC data by OM ID:', error);
        res.status(500).json({ error: 'Failed to delete OM data and related VC/SubVC data' });
    }
});

module.exports = router; 