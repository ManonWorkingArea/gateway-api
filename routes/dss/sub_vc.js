const express = require('express');
const { safeObjectId } = require('../middleware/mongoMiddleware'); // Adjust path
const router = express.Router();

// POST /sub_vc (Add New) - Mounted at /sub_vc in dss.js
router.post('/', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const subVcCollection = db.collection('sub_vc');
        // Ensure collection exists
        const collections = await db.listCollections({ name: 'sub_vc' }).toArray();
        if (collections.length === 0) await db.createCollection('sub_vc');

        const newData = req.body;
        const result = await subVcCollection.insertOne(newData);
        res.status(201).json({ success: true, data: { id: result.insertedId, ...newData } });
    } catch (error) {
        console.error('Error adding data to Sub VC collection:', error);
        res.status(500).json({ error: 'Failed to add data to Sub VC collection' });
    }
});

// PUT /sub_vc/:subVcId (Update by SubVC ID) - Mounted at /sub_vc
router.put('/:subVcId', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const subVcCollection = db.collection('sub_vc');
        const subVcId = safeObjectId(req.params.subVcId);
        const updatedSubVcData = req.body;
        delete updatedSubVcData._id;

        const result = await subVcCollection.updateOne(
            { _id: subVcId },
            { $set: updatedSubVcData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Sub VC not found' });
        }
        const updatedDoc = await subVcCollection.findOne({ _id: subVcId });
        res.status(200).json({ success: true, data: updatedDoc });
    } catch (error) {
        console.error('Error updating Sub VC data by Sub VC ID:', error);
        res.status(500).json({ error: 'Failed to update Sub VC data' });
    }
});

// DELETE /sub_vc/:subVcId (Delete by SubVC ID) - Mounted at /sub_vc
router.delete('/:subVcId', async (req, res) => {
    try {
        const db = req.client.db('dss');
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

module.exports = router; 