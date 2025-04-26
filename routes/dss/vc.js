const express = require('express');
const { safeObjectId } = require('../middleware/mongoMiddleware'); // Adjust path
const router = express.Router();

// POST /vc (Add New) - Mounted at /vc in dss.js
router.post('/', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const vcCollection = db.collection('vc');
        // Ensure collection exists
        const collections = await db.listCollections({ name: 'vc' }).toArray();
        if (collections.length === 0) await db.createCollection('vc');

        const newData = req.body;
        const result = await vcCollection.insertOne(newData);
        res.status(201).json({ success: true, data: { id: result.insertedId, ...newData } });
    } catch (error) {
        console.error('Error adding data to VC collection:', error);
        res.status(500).json({ error: 'Failed to add data to VC collection' });
    }
});

// PUT /vc/:vcId (Update by VC ID) - Mounted at /vc
router.put('/:vcId', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const vcCollection = db.collection('vc');
        const vcId = safeObjectId(req.params.vcId);
        const updatedVcData = req.body;
        delete updatedVcData._id;

        const result = await vcCollection.updateOne(
            { _id: vcId },
            { $set: updatedVcData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'VC not found' });
        }
        const updatedDoc = await vcCollection.findOne({ _id: vcId });
        res.status(200).json({ success: true, data: updatedDoc });
    } catch (error) {
        console.error('Error updating VC data by VC ID:', error);
        res.status(500).json({ error: 'Failed to update VC data' });
    }
});

// DELETE /vc/:vcId (Delete VC and related SubVC) - Mounted at /vc
router.delete('/:vcId', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const vcCollection = db.collection('vc');
        const subVcCollection = db.collection('sub_vc');
        const vcIdObject = safeObjectId(req.params.vcId);
        const vcIdString = req.params.vcId; // For querying SubVC if ID is stored as string there

        // Delete related Sub VC data
        const subVcDeleteResult = await subVcCollection.deleteMany({ vcId: vcIdString }); // Adjust if vcId in sub_vc is ObjectId

        // Delete the VC data
        const vcDeleteResult = await vcCollection.deleteOne({ _id: vcIdObject });

        if (vcDeleteResult.deletedCount === 0) {
            return res.status(404).json({ error: 'VC not found' });
        }

        res.status(200).json({
            success: true,
            data: {
                vcDeletedCount: vcDeleteResult.deletedCount,
                subVcDeletedCount: subVcDeleteResult.deletedCount
            }
        });
    } catch (error) {
        console.error('Error deleting VC data and related Sub VC data by VC ID:', error);
        res.status(500).json({ error: 'Failed to delete VC data and related Sub VC data' });
    }
});

// PUT /vc/om/:omId (Update by OM ID) - Mounted at /vc
router.put('/om/:omId', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const vcCollection = db.collection('vc');
        const omId = req.params.omId; // Assuming omId in vc is stored as string
        const updatedVcData = req.body;
        delete updatedVcData._id; // Prevent updating _id itself

        // Note: This updates ALL VCs associated with the omId.
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

// DELETE /vc/om/:omId (Delete by OM ID) - Mounted at /vc
router.delete('/om/:omId', async (req, res) => {
     try {
        const db = req.client.db('dss');
        const vcCollection = db.collection('vc');
        const subVcCollection = db.collection('sub_vc');
        const omId = req.params.omId; // Assuming omId in vc is stored as string

        // Find VCs to delete to also delete their SubVCs
        const vcsToDelete = await vcCollection.find({ omId: omId }, { projection: { _id: 1 } }).toArray();

        let subVcDeletedCount = 0;
        for (let vcItem of vcsToDelete) {
            const subResult = await subVcCollection.deleteMany({ vcId: vcItem._id.toString() });
            subVcDeletedCount += subResult.deletedCount;
        }

        // Delete the VC data
        const result = await vcCollection.deleteMany({ omId: omId });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'No VC data found for this OM ID' });
        }

        res.status(200).json({ success: true, data: { deletedCount: result.deletedCount, subVcDeletedCount: subVcDeletedCount } });
    } catch (error) {
        console.error('Error deleting VC data by OM ID:', error);
        res.status(500).json({ error: 'Failed to delete VC data' });
    }
});

module.exports = router; 