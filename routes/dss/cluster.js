const express = require('express');
const { safeObjectId } = require('../middleware/mongoMiddleware'); // Adjust path
const { ObjectId } = require('mongodb'); // Import ObjectId
const router = express.Router();

// GET / (List All Clusters with nested OM, VC, SubVC) - Mounted at /clusters in dss.js
router.get('/', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const clusterCollection = db.collection('cluster'); // Start with cluster collection

        // Aggregation pipeline to fetch clusters and nest om, vc, and sub_vc
        const pipeline = [
            { // Stage 1: Lookup OM data for each cluster
                $lookup: {
                    from: 'om', // The collection to join
                    let: { cluster_id: "$_id" }, // Variable for the cluster's _id
                    pipeline: [
                        // Match om documents where om.clusterId (string) equals cluster._id (ObjectId converted to string)
                        { $match: { $expr: { $eq: ["$clusterId", { $toString: "$$cluster_id" }] } } },
                        { // Stage 1.1: Lookup VC data for each OM
                            $lookup: {
                                from: 'vc',
                                let: { om_id: "$_id" }, // Variable for the om's _id
                                pipeline: [
                                    // Match vc documents where vc.omId (string) equals om._id (ObjectId converted to string)
                                    { $match: { $expr: { $eq: ["$omId", { $toString: "$$om_id" }] } } },
                                    { // Stage 1.1.1: Lookup SubVC data for each VC
                                        $lookup: {
                                            from: 'sub_vc',
                                            let: { vc_id: "$_id" }, // Variable for the vc's _id
                                            pipeline: [
                                                // Match sub_vc documents where sub_vc.vcId (string) equals vc._id (ObjectId converted to string)
                                                { $match: { $expr: { $eq: ["$vcId", { $toString: "$$vc_id" }] } } }
                                            ],
                                            as: 'sub_vcs' // Output array field for sub_vc
                                        }
                                    }
                                ],
                                as: 'vcs' // Output array field for vc
                            }
                        }
                    ],
                    as: 'oms' // Output array field for om
                }
            }
        ];

        const clustersWithNestedData = await clusterCollection.aggregate(pipeline).toArray();
        // Use 'data' as the key for the array of clusters
        res.status(200).json({ success: true, data: clustersWithNestedData });
    } catch (error) {
        console.error('Error fetching clusters with nested data:', error);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

// POST /clusters (Add New Cluster) - Mounted at /clusters in dss.js
// Note: This route adds a new CLUSTER document.
router.post('/', async (req, res) => {
    try {
        const db = req.client.db('dss');
        // Changed target collection back to 'cluster'
        const clusterCollection = db.collection('cluster');
        const newCluster = req.body;
        const result = await clusterCollection.insertOne(newCluster);
        res.status(201).json({ success: true, data: { id: result.insertedId, ...newCluster } });
    } catch (error) {
        // Changed collection name in error message
        console.error('Error adding new cluster:', error);
        res.status(500).json({ error: 'Failed to add new cluster' });
    }
});

// GET /clusters/:id (Get Single Cluster) - Mounted at /clusters in dss.js
// Note: This route now fetches a single CLUSTER by ID, potentially with nested data.
router.get('/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        // Changed target collection back to 'cluster'
        const clusterCollection = db.collection('cluster');
        const clusterId = safeObjectId(req.params.id); // Assuming ID is for Cluster

        if (!clusterId) {
             return res.status(400).json({ error: 'Invalid ID format' });
        }

        // Aggregation pipeline similar to GET /, but matching specific _id
        const pipeline = [
             { $match: { _id: clusterId } }, // Match the specific Cluster document
             // Reuse the same $lookup stages as the main GET / route
            { // Stage 1: Lookup OM data for the cluster
                $lookup: {
                    from: 'om',
                    let: { cluster_id: "$_id" },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$clusterId", { $toString: "$$cluster_id" }] } } },
                        { // Stage 1.1: Lookup VC data for each OM
                            $lookup: {
                                from: 'vc',
                                let: { om_id: "$_id" },
                                pipeline: [
                                    { $match: { $expr: { $eq: ["$omId", { $toString: "$$om_id" }] } } },
                                    { // Stage 1.1.1: Lookup SubVC data for each VC
                                        $lookup: {
                                            from: 'sub_vc',
                                            let: { vc_id: "$_id" },
                                            pipeline: [
                                                { $match: { $expr: { $eq: ["$vcId", { $toString: "$$vc_id" }] } } }
                                            ],
                                            as: 'sub_vcs'
                                        }
                                    }
                                ],
                                as: 'vcs'
                            }
                        }
                    ],
                    as: 'oms'
                }
            }
        ];

        const result = await clusterCollection.aggregate(pipeline).toArray();

        if (!result || result.length === 0) {
            // Changed collection name in error message
            return res.status(404).json({ error: 'Cluster not found' });
        }
        // Return the first element as we are fetching by specific ID
        res.status(200).json({ success: true, data: result[0] });
    } catch (error) {
         // Changed collection name in error message
        console.error('Error fetching Cluster:', error);
        res.status(500).json({ error: 'Failed to fetch Cluster' });
    }
});

// PUT /clusters/:id (Update Cluster) - Mounted at /clusters in dss.js
// Note: This route now updates a CLUSTER document by ID.
router.put('/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        // Changed target collection back to 'cluster'
        const clusterCollection = db.collection('cluster');
        const clusterId = safeObjectId(req.params.id); // Assuming ID is for Cluster
        const updatedClusterData = req.body;
        delete updatedClusterData._id; // Do not update the _id

        if (!clusterId) {
             return res.status(400).json({ error: 'Invalid ID format' });
        }

        const result = await clusterCollection.updateOne(
            { _id: clusterId },
            { $set: updatedClusterData }
        );
        if (result.matchedCount === 0) {
             // Changed collection name in error message
            return res.status(404).json({ error: 'Cluster not found' });
        }
        // Fetch updated data to return (optional, could return updatedClusterData)
        // Note: This only returns the updated cluster doc, not the nested structure.
        //       If nested structure is needed after update, re-aggregation might be required.
        const updatedDoc = await clusterCollection.findOne({ _id: clusterId });
        res.status(200).json({ success: true, data: updatedDoc });
    } catch (error) {
         // Changed collection name in error message
        console.error('Error updating Cluster:', error);
        res.status(500).json({ error: 'Failed to update Cluster' });
    }
});

// Add DELETE /clusters/:id if needed
// Note: This would likely delete a CLUSTER. Define cascade behavior if needed.

// ==================== SIE ENDPOINTS ====================

// GET /clusters/:clusterId/sie (Get all SIE data for a cluster)
router.get('/:clusterId/sie', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const sieCollection = db.collection('sie');
        const clusterId = req.params.clusterId;

        const data = await sieCollection.find({ clusterId: clusterId }).toArray();
        res.status(200).json({ success: true, data: data });
    } catch (error) {
        console.error('Error fetching SIE data:', error);
        res.status(500).json({ error: 'Failed to fetch SIE data' });
    }
});

// POST /clusters/:clusterId/sie (Add new SIE data)
router.post('/:clusterId/sie', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const sieCollection = db.collection('sie');
        const clusterId = req.params.clusterId;
        
        const newData = {
            ...req.body, // รับข้อมูลทั้งหมดจาก client แบบยืดหยุ่น
            clusterId: clusterId,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await sieCollection.insertOne(newData);
        res.status(201).json({ 
            success: true, 
            data: { id: result.insertedId, ...newData } 
        });
    } catch (error) {
        console.error('Error adding SIE data:', error);
        res.status(500).json({ error: 'Failed to add SIE data' });
    }
});

// GET /clusters/:clusterId/sie/:id (Get specific SIE data)
router.get('/:clusterId/sie/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const sieCollection = db.collection('sie');
        const clusterId = req.params.clusterId;
        const dataId = safeObjectId(req.params.id);

        if (!dataId) {
            return res.status(400).json({ error: 'Invalid ID format' });
        }

        const data = await sieCollection.findOne({ 
            _id: dataId, 
            clusterId: clusterId 
        });

        if (!data) {
            return res.status(404).json({ error: 'SIE data not found' });
        }

        res.status(200).json({ success: true, data: data });
    } catch (error) {
        console.error('Error fetching SIE data:', error);
        res.status(500).json({ error: 'Failed to fetch SIE data' });
    }
});

// PUT /clusters/:clusterId/sie/:id (Update SIE data)
router.put('/:clusterId/sie/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const sieCollection = db.collection('sie');
        const clusterId = req.params.clusterId;
        const dataId = safeObjectId(req.params.id);
        
        if (!dataId) {
            return res.status(400).json({ error: 'Invalid ID format' });
        }

        const updatedData = {
            ...req.body,
            clusterId: clusterId,
            updatedAt: new Date()
        };
        delete updatedData._id;

        const result = await sieCollection.updateOne(
            { _id: dataId, clusterId: clusterId },
            { $set: updatedData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'SIE data not found' });
        }

        const updatedDoc = await sieCollection.findOne({ 
            _id: dataId, 
            clusterId: clusterId 
        });
        res.status(200).json({ success: true, data: updatedDoc });
    } catch (error) {
        console.error('Error updating SIE data:', error);
        res.status(500).json({ error: 'Failed to update SIE data' });
    }
});

// DELETE /clusters/:clusterId/sie/:id (Delete SIE data)
router.delete('/:clusterId/sie/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const sieCollection = db.collection('sie');
        const clusterId = req.params.clusterId;
        const dataId = safeObjectId(req.params.id);

        if (!dataId) {
            return res.status(400).json({ error: 'Invalid ID format' });
        }

        const result = await sieCollection.deleteOne({ 
            _id: dataId, 
            clusterId: clusterId 
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'SIE data not found' });
        }

        res.status(200).json({ 
            success: true, 
            message: 'SIE data deleted successfully' 
        });
    } catch (error) {
        console.error('Error deleting SIE data:', error);
        res.status(500).json({ error: 'Failed to delete SIE data' });
    }
});

// ==================== SCM ENDPOINTS ====================

// GET /clusters/:clusterId/scm (Get all SCM data for a cluster)
router.get('/:clusterId/scm', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const scmCollection = db.collection('scm');
        const clusterId = req.params.clusterId;

        const data = await scmCollection.find({ clusterId: clusterId }).toArray();
        res.status(200).json({ success: true, data: data });
    } catch (error) {
        console.error('Error fetching SCM data:', error);
        res.status(500).json({ error: 'Failed to fetch SCM data' });
    }
});

// POST /clusters/:clusterId/scm (Add new SCM data)
router.post('/:clusterId/scm', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const scmCollection = db.collection('scm');
        const clusterId = req.params.clusterId;
        
        const newData = {
            ...req.body,
            clusterId: clusterId,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await scmCollection.insertOne(newData);
        res.status(201).json({ 
            success: true, 
            data: { id: result.insertedId, ...newData } 
        });
    } catch (error) {
        console.error('Error adding SCM data:', error);
        res.status(500).json({ error: 'Failed to add SCM data' });
    }
});

// GET /clusters/:clusterId/scm/:id (Get specific SCM data)
router.get('/:clusterId/scm/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const scmCollection = db.collection('scm');
        const clusterId = req.params.clusterId;
        const dataId = safeObjectId(req.params.id);

        if (!dataId) {
            return res.status(400).json({ error: 'Invalid ID format' });
        }

        const data = await scmCollection.findOne({ 
            _id: dataId, 
            clusterId: clusterId 
        });

        if (!data) {
            return res.status(404).json({ error: 'SCM data not found' });
        }

        res.status(200).json({ success: true, data: data });
    } catch (error) {
        console.error('Error fetching SCM data:', error);
        res.status(500).json({ error: 'Failed to fetch SCM data' });
    }
});

// PUT /clusters/:clusterId/scm/:id (Update SCM data)
router.put('/:clusterId/scm/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const scmCollection = db.collection('scm');
        const clusterId = req.params.clusterId;
        const dataId = safeObjectId(req.params.id);
        
        if (!dataId) {
            return res.status(400).json({ error: 'Invalid ID format' });
        }

        const updatedData = {
            ...req.body,
            clusterId: clusterId,
            updatedAt: new Date()
        };
        delete updatedData._id;

        const result = await scmCollection.updateOne(
            { _id: dataId, clusterId: clusterId },
            { $set: updatedData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'SCM data not found' });
        }

        const updatedDoc = await scmCollection.findOne({ 
            _id: dataId, 
            clusterId: clusterId 
        });
        res.status(200).json({ success: true, data: updatedDoc });
    } catch (error) {
        console.error('Error updating SCM data:', error);
        res.status(500).json({ error: 'Failed to update SCM data' });
    }
});

// DELETE /clusters/:clusterId/scm/:id (Delete SCM data)
router.delete('/:clusterId/scm/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const scmCollection = db.collection('scm');
        const clusterId = req.params.clusterId;
        const dataId = safeObjectId(req.params.id);

        if (!dataId) {
            return res.status(400).json({ error: 'Invalid ID format' });
        }

        const result = await scmCollection.deleteOne({ 
            _id: dataId, 
            clusterId: clusterId 
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'SCM data not found' });
        }

        res.status(200).json({ 
            success: true, 
            message: 'SCM data deleted successfully' 
        });
    } catch (error) {
        console.error('Error deleting SCM data:', error);
        res.status(500).json({ error: 'Failed to delete SCM data' });
    }
});

// ==================== APPTECH ENDPOINTS ====================

// GET /clusters/:clusterId/apptech (Get all APPTECH data for a cluster)
router.get('/:clusterId/apptech', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const apptechCollection = db.collection('apptech');
        const clusterId = req.params.clusterId;

        const data = await apptechCollection.find({ clusterId: clusterId }).toArray();
        res.status(200).json({ success: true, data: data });
    } catch (error) {
        console.error('Error fetching APPTECH data:', error);
        res.status(500).json({ error: 'Failed to fetch APPTECH data' });
    }
});

// POST /clusters/:clusterId/apptech (Add new APPTECH data)
router.post('/:clusterId/apptech', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const apptechCollection = db.collection('apptech');
        const clusterId = req.params.clusterId;
        
        const newData = {
            ...req.body,
            clusterId: clusterId,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await apptechCollection.insertOne(newData);
        res.status(201).json({ 
            success: true, 
            data: { id: result.insertedId, ...newData } 
        });
    } catch (error) {
        console.error('Error adding APPTECH data:', error);
        res.status(500).json({ error: 'Failed to add APPTECH data' });
    }
});

// GET /clusters/:clusterId/apptech/:id (Get specific APPTECH data)
router.get('/:clusterId/apptech/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const apptechCollection = db.collection('apptech');
        const clusterId = req.params.clusterId;
        const dataId = safeObjectId(req.params.id);

        if (!dataId) {
            return res.status(400).json({ error: 'Invalid ID format' });
        }

        const data = await apptechCollection.findOne({ 
            _id: dataId, 
            clusterId: clusterId 
        });

        if (!data) {
            return res.status(404).json({ error: 'APPTECH data not found' });
        }

        res.status(200).json({ success: true, data: data });
    } catch (error) {
        console.error('Error fetching APPTECH data:', error);
        res.status(500).json({ error: 'Failed to fetch APPTECH data' });
    }
});

// PUT /clusters/:clusterId/apptech/:id (Update APPTECH data)
router.put('/:clusterId/apptech/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const apptechCollection = db.collection('apptech');
        const clusterId = req.params.clusterId;
        const dataId = safeObjectId(req.params.id);
        
        if (!dataId) {
            return res.status(400).json({ error: 'Invalid ID format' });
        }

        const updatedData = {
            ...req.body,
            clusterId: clusterId,
            updatedAt: new Date()
        };
        delete updatedData._id;

        const result = await apptechCollection.updateOne(
            { _id: dataId, clusterId: clusterId },
            { $set: updatedData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'APPTECH data not found' });
        }

        const updatedDoc = await apptechCollection.findOne({ 
            _id: dataId, 
            clusterId: clusterId 
        });
        res.status(200).json({ success: true, data: updatedDoc });
    } catch (error) {
        console.error('Error updating APPTECH data:', error);
        res.status(500).json({ error: 'Failed to update APPTECH data' });
    }
});

// DELETE /clusters/:clusterId/apptech/:id (Delete APPTECH data)
router.delete('/:clusterId/apptech/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const apptechCollection = db.collection('apptech');
        const clusterId = req.params.clusterId;
        const dataId = safeObjectId(req.params.id);

        if (!dataId) {
            return res.status(400).json({ error: 'Invalid ID format' });
        }

        const result = await apptechCollection.deleteOne({ 
            _id: dataId, 
            clusterId: clusterId 
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'APPTECH data not found' });
        }

        res.status(200).json({ 
            success: true, 
            message: 'APPTECH data deleted successfully' 
        });
    } catch (error) {
        console.error('Error deleting APPTECH data:', error);
        res.status(500).json({ error: 'Failed to delete APPTECH data' });
    }
});

module.exports = router; 