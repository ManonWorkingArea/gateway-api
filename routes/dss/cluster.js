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

module.exports = router; 