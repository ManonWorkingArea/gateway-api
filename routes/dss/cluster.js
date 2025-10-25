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

// ==================== BILLS ENDPOINTS ====================

// GET /clusters/:clusterId/bills (Get all bills for a cluster)
router.get('/:clusterId/bills', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const billsCollection = db.collection('bills');
        const clusterId = req.params.clusterId;
        const { sort, paging, page, limit, omId, vcId, status, ...filters } = req.query;

        // Build query object
        let query = { clusterId: clusterId };
        
        // Add optional filters
        if (omId) query.omId = omId;
        if (vcId) query.vcId = vcId;
        if (status) query.status = status;
        
        // Add other filters
        Object.keys(filters).forEach(key => {
            if (filters[key] && key !== 'key') {
                // For text search use regex
                if (typeof filters[key] === 'string' && !filters[key].match(/^[0-9a-fA-F]{24}$/)) {
                    query[key] = { $regex: filters[key], $options: 'i' };
                } else {
                    query[key] = filters[key];
                }
            }
        });

        console.log('Bills Debug - Query:', query);

        let cursor = billsCollection.find(query);

        // Add sorting if specified
        if (sort) {
            const sortObj = {};
            if (sort.startsWith('-')) {
                sortObj[sort.substring(1)] = -1;
            } else {
                sortObj[sort] = 1;
            }
            cursor = cursor.sort(sortObj);
        } else {
            // Default sort by createdAt descending
            cursor = cursor.sort({ createdAt: -1 });
        }

        let result = [];
        
        // Add pagination if specified
        if (paging === 'true' || page || limit) {
            const pageNum = parseInt(page) || 1;
            const limitNum = parseInt(limit) || 10;
            const skip = (pageNum - 1) * limitNum;
            
            const totalCount = await billsCollection.countDocuments(query);
            result = await cursor.skip(skip).limit(limitNum).toArray();
            
            res.status(200).json({
                success: true,
                data: result,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: totalCount,
                    pages: Math.ceil(totalCount / limitNum)
                }
            });
        } else {
            result = await cursor.toArray();
            res.status(200).json({ success: true, data: result });
        }
    } catch (error) {
        console.error('Error fetching bills data:', error);
        res.status(500).json({ error: 'Failed to fetch bills data' });
    }
});

// POST /clusters/:clusterId/bills (Add new bill)
router.post('/:clusterId/bills', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const billsCollection = db.collection('bills');
        const clusterId = req.params.clusterId;
        
        const newBill = {
            ...req.body,
            clusterId: clusterId,
            createdAt: new Date()
        };

        // Generate invoiceId if not provided
        if (!newBill.invoiceId) {
            newBill.invoiceId = `AUTO_${Date.now()}`;
        }

        // Set default status if not provided
        if (!newBill.status) {
            newBill.status = 'pending';
        }

        const result = await billsCollection.insertOne(newBill);
        res.status(201).json({ 
            success: true, 
            data: { id: result.insertedId, ...newBill } 
        });
    } catch (error) {
        console.error('Error adding bill:', error);
        res.status(500).json({ error: 'Failed to add bill' });
    }
});

// GET /clusters/:clusterId/bills/:id (Get specific bill)
router.get('/:clusterId/bills/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const billsCollection = db.collection('bills');
        const clusterId = req.params.clusterId;
        const billId = safeObjectId(req.params.id);

        if (!billId) {
            return res.status(400).json({ error: 'Invalid bill ID format' });
        }

        const bill = await billsCollection.findOne({ 
            _id: billId, 
            clusterId: clusterId 
        });

        if (!bill) {
            return res.status(404).json({ error: 'Bill not found' });
        }

        res.status(200).json({ success: true, data: bill });
    } catch (error) {
        console.error('Error fetching bill:', error);
        res.status(500).json({ error: 'Failed to fetch bill' });
    }
});

// PUT /clusters/:clusterId/bills/:id (Update bill)
router.put('/:clusterId/bills/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const billsCollection = db.collection('bills');
        const clusterId = req.params.clusterId;
        const billId = safeObjectId(req.params.id);
        
        if (!billId) {
            return res.status(400).json({ error: 'Invalid bill ID format' });
        }

        const updatedData = {
            ...req.body,
            clusterId: clusterId,
            updatedAt: new Date()
        };
        delete updatedData._id;

        const result = await billsCollection.updateOne(
            { _id: billId, clusterId: clusterId },
            { $set: updatedData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Bill not found' });
        }

        const updatedBill = await billsCollection.findOne({ 
            _id: billId, 
            clusterId: clusterId 
        });
        res.status(200).json({ success: true, data: updatedBill });
    } catch (error) {
        console.error('Error updating bill:', error);
        res.status(500).json({ error: 'Failed to update bill' });
    }
});

// DELETE /clusters/:clusterId/bills/:id (Delete bill)
router.delete('/:clusterId/bills/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const billsCollection = db.collection('bills');
        const clusterId = req.params.clusterId;
        const billId = safeObjectId(req.params.id);

        if (!billId) {
            return res.status(400).json({ error: 'Invalid bill ID format' });
        }

        const result = await billsCollection.deleteOne({ 
            _id: billId, 
            clusterId: clusterId 
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Bill not found' });
        }

        res.status(200).json({ 
            success: true, 
            message: 'Bill deleted successfully' 
        });
    } catch (error) {
        console.error('Error deleting bill:', error);
        res.status(500).json({ error: 'Failed to delete bill' });
    }
});

// ==================== VC-MARKERS MAPPING ====================

// GET /clusters/:clusterId/vc-markers
// Returns mapping of vcId -> markerIds[] for a given cluster. Two shapes supported based on query 'array=true'
router.get('/:clusterId/vc-markers', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const mappingCol = db.collection('vc_markers');
        const { clusterId } = req.params;

        const docs = await mappingCol.find({ clusterId }).toArray();
        const wantsArray = String(req.query.array || '').toLowerCase() === 'true';

        if (wantsArray) {
            const data = docs.map(d => ({ vcId: d.vcId, markerIds: d.markerIds || [] }));
            return res.status(200).json({ success: true, data });
        }

        const obj = {};
        for (const d of docs) obj[d.vcId] = d.markerIds || [];
        return res.status(200).json({ success: true, data: obj });
    } catch (error) {
        console.error('Error fetching cluster VC markers mapping:', error);
        res.status(500).json({ error: 'Failed to fetch VC markers mapping' });
    }
});

// PUT /clusters/:clusterId/vc-markers { vcId, markerIds: [] }
router.put('/:clusterId/vc-markers', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const mappingCol = db.collection('vc_markers');
        const { clusterId } = req.params;
        const { vcId, markerIds } = req.body || {};

        if (!vcId || !Array.isArray(markerIds)) {
            return res.status(400).json({ error: 'vcId and markerIds[] are required' });
        }

        // Upsert mapping document keyed by clusterId + vcId
        await mappingCol.updateOne(
            { clusterId, vcId },
            { $set: { markerIds } },
            { upsert: true }
        );

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error updating VC markers mapping:', error);
        res.status(500).json({ error: 'Failed to update VC markers mapping' });
    }
});