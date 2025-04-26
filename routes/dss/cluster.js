const express = require('express');
const { safeObjectId } = require('../middleware/mongoMiddleware'); // Adjust path
const router = express.Router();

// GET /clusters (List) - Mounted at /clusters in dss.js
router.get('/', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const clusterCollection = db.collection('cluster');
        const clusters = await clusterCollection.find({}).toArray();
        res.status(200).json({ success: true, data: clusters });
    } catch (error) {
        console.error('Error fetching clusters:', error);
        res.status(500).json({ error: 'Failed to fetch clusters' });
    }
});

// POST /clusters (Add New) - Mounted at /clusters in dss.js
router.post('/', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const clusterCollection = db.collection('cluster');
        const newCluster = req.body;
        const result = await clusterCollection.insertOne(newCluster);
        res.status(201).json({ success: true, data: { id: result.insertedId, ...newCluster } });
    } catch (error) {
        console.error('Error adding new cluster:', error);
        res.status(500).json({ error: 'Failed to add new cluster' });
    }
});

// GET /clusters/:id (Get Single) - Mounted at /clusters in dss.js
router.get('/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const clusterCollection = db.collection('cluster');
        const clusterId = safeObjectId(req.params.id);
        const clusterData = await clusterCollection.findOne({ _id: clusterId });
        if (!clusterData) {
            return res.status(404).json({ error: 'Cluster not found' });
        }
        res.status(200).json({ success: true, data: clusterData });
    } catch (error) {
        console.error('Error fetching cluster:', error);
        res.status(500).json({ error: 'Failed to fetch cluster' });
    }
});

// PUT /clusters/:id (Update) - Mounted at /clusters in dss.js
router.put('/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const clusterCollection = db.collection('cluster');
        const clusterId = safeObjectId(req.params.id);
        const updatedClusterData = req.body;
        delete updatedClusterData._id;
        const result = await clusterCollection.updateOne(
            { _id: clusterId },
            { $set: updatedClusterData }
        );
        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Cluster not found' });
        }
        // Fetch updated data to return
        const updatedDoc = await clusterCollection.findOne({ _id: clusterId });
        res.status(200).json({ success: true, data: updatedDoc });
    } catch (error) {
        console.error('Error updating cluster:', error);
        res.status(500).json({ error: 'Failed to update cluster' });
    }
});

// Add DELETE /clusters/:id if needed

module.exports = router; 