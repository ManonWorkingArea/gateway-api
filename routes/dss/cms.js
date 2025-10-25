const express = require('express');
const { safeObjectId } = require('../middleware/mongoMiddleware'); // Import validation helper
const router = express.Router();

// Generic CMS controller for any collection
const cmsController = {
  // GET /cms/:collection - Get all items with query support
  getAll: async (req, res) => {
    try {
      const db = req.client.db('dss'); // ใช้ MongoDB connection จาก middleware
      const { collection } = req.params;
      const { sort, paging, page, limit, key, ...filters } = req.query; // เพิ่ม key ใน destructuring
      
      console.log('CMS Debug - Collection:', collection);
      console.log('CMS Debug - Query params:', req.query);
      console.log('CMS Debug - Filters:', filters);
      
      const cmsCollection = db.collection(collection);
      
      // ตรวจสอบว่ามี collection หรือไม่
      const collectionExists = await db.listCollections({ name: collection }).hasNext();
      console.log('CMS Debug - Collection exists:', collectionExists);
      
      // นับจำนวน documents ใน collection
      const totalDocs = await cmsCollection.countDocuments({});
      console.log('CMS Debug - Total documents in collection:', totalDocs);
      
      // Build query object for MongoDB
      let query = {};
      
      // Add filters (ยกเว้น pagination, sort และ key parameters)
      Object.keys(filters).forEach(key => {
        if (filters[key] && key !== 'key') { // ไม่รวม key parameter
          // ถ้าเป็น clusterId ให้ใช้ตรงๆ ไม่ต้อง regex
          if (key === 'clusterId') {
            query[key] = filters[key];
          }
          // สำหรับ text search ใช้ regex
          else if (typeof filters[key] === 'string' && !filters[key].match(/^[0-9a-fA-F]{24}$/)) {
            query[key] = { $regex: filters[key], $options: 'i' };
          } else {
            query[key] = filters[key];
          }
        }
      });
      
      console.log('CMS Debug - MongoDB query:', query);
      
      let cursor = cmsCollection.find(query);
      
      // Add sorting if specified
      if (sort) {
        const sortObj = {};
        // รองรับ format: sort=field หรือ sort=-field (desc)
        if (sort.startsWith('-')) {
          sortObj[sort.substring(1)] = -1;
        } else {
          sortObj[sort] = 1;
        }
        cursor = cursor.sort(sortObj);
      }
      
      // Add pagination if specified
      let totalCount = 0;
      let result = [];
      
      if (paging === 'true' || page || limit) {
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 10;
        const skip = (pageNum - 1) * limitNum;
        
        // Get total count for pagination
        totalCount = await cmsCollection.countDocuments(query);
        
        result = await cursor.skip(skip).limit(limitNum).toArray();
        
        res.json({
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
        console.log('CMS Debug - Result count:', result.length);
        res.json({
          success: true,
          data: result
        });
      }
      
    } catch (error) {
      console.error('CMS getAll error:', error);
      res.status(500).json({ 
        error: error.message,
        collection: req.params.collection
      });
    }
  },

  // GET /cms/:collection/:id - Get single item
  getById: async (req, res) => {
    try {
      const db = req.client.db('dss');
      const { collection, id } = req.params;
      const { clusterId } = req.query;
      
      const cmsCollection = db.collection(collection);
      const objectId = safeObjectId(id);
      
      if (!objectId) {
        return res.status(400).json({ error: 'Invalid ID format' });
      }
      
      // Build query with clusterId if provided
      const query = { _id: objectId };
      if (clusterId) {
        query.clusterId = clusterId;
      }
      
      console.log('CMS Debug - getById query:', query);
      
      const item = await cmsCollection.findOne(query);
      
      if (!item) {
        return res.status(404).json({ 
          error: `${collection} item not found`,
          id: id,
          clusterId: clusterId
        });
      }
      
      res.json({
        success: true,
        data: item
      });
      
    } catch (error) {
      console.error('CMS getById error:', error);
      res.status(500).json({ 
        error: error.message,
        collection: req.params.collection,
        id: req.params.id
      });
    }
  },

  // POST /cms/:collection - Create new item
  create: async (req, res) => {
    try {
      const db = req.client.db('dss');
      const { collection } = req.params;
      const { clusterId } = req.query;
      const data = req.body;
      
      const cmsCollection = db.collection(collection);
      
      // Add timestamps and clusterId if provided
      const newItem = {
        ...data,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      // Add clusterId to document if provided in query
      if (clusterId) {
        newItem.clusterId = clusterId;
      }
      
      console.log('CMS Debug - Creating item:', newItem);
      
      const result = await cmsCollection.insertOne(newItem);
      
      res.status(201).json({
        success: true,
        data: {
          id: result.insertedId,
          ...newItem
        }
      });
      
    } catch (error) {
      console.error('CMS create error:', error);
      res.status(500).json({ 
        error: error.message,
        collection: req.params.collection
      });
    }
  },

  // PUT /cms/:collection/:id - Update item
  update: async (req, res) => {
    try {
      const db = req.client.db('dss');
      const { collection, id } = req.params;
      const { clusterId } = req.query;
      const data = req.body;
      
      const cmsCollection = db.collection(collection);
      const objectId = safeObjectId(id);
      
      if (!objectId) {
        return res.status(400).json({ error: 'Invalid ID format' });
      }
      
      // Build query with clusterId if provided
      const query = { _id: objectId };
      if (clusterId) {
        query.clusterId = clusterId;
      }
      
      console.log('CMS Debug - update query:', query);
      
      // Remove _id from update data and add update timestamp
      const updateData = { ...data };
      delete updateData._id;
      updateData.updatedAt = new Date();
      
      const result = await cmsCollection.updateOne(
        query,
        { $set: updateData }
      );
      
      if (result.matchedCount === 0) {
        return res.status(404).json({ 
          error: `${collection} item not found`,
          id: id,
          clusterId: clusterId
        });
      }
      
      // Return updated document
      const updatedDoc = await cmsCollection.findOne(query);
      
      res.json({
        success: true,
        data: updatedDoc
      });
      
    } catch (error) {
      console.error('CMS update error:', error);
      res.status(500).json({ 
        error: error.message,
        collection: req.params.collection,
        id: req.params.id
      });
    }
  },

  // DELETE /cms/:collection/:id - Delete item
  delete: async (req, res) => {
    try {
      const db = req.client.db('dss');
      const { collection, id } = req.params;
      const { clusterId } = req.query;
      
      const cmsCollection = db.collection(collection);
      const objectId = safeObjectId(id);
      
      if (!objectId) {
        return res.status(400).json({ error: 'Invalid ID format' });
      }
      
      // Build query with clusterId if provided
      const query = { _id: objectId };
      if (clusterId) {
        query.clusterId = clusterId;
      }
      
      console.log('CMS Debug - delete query:', query);
      
      const result = await cmsCollection.deleteOne(query);
      
      if (result.deletedCount === 0) {
        return res.status(404).json({ 
          error: `${collection} item not found`,
          id: id,
          clusterId: clusterId
        });
      }
      
      res.json({
        success: true,
        message: `${collection} item deleted successfully`,
        id: id,
        clusterId: clusterId
      });
      
    } catch (error) {
      console.error('CMS delete error:', error);
      res.status(500).json({ 
        error: error.message,
        collection: req.params.collection,
        id: req.params.id
      });
    }
  }
};

// Helper function สำหรับ validation collection name
function isValidCollectionName(collectionName) {
  // ป้องกัน collection name ที่อันตราย
  const allowedCollections = [
    'banner', 'news', 'promotions', 'categories', 'content', 
    'pages', 'media', 'settings', 'announcements', 'events'
  ];
  
  console.log('CMS Debug - Validating collection:', collectionName);
  console.log('CMS Debug - Is valid:', allowedCollections.includes(collectionName));
  
  // ถ้าต้องการให้เปิดกว้างมากขึ้น ใช้ regex validation แทน
  // return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(collectionName);
  
  return allowedCollections.includes(collectionName);
}

// Middleware สำหรับ validate collection name
router.param('collection', (req, res, next, collection) => {
  if (!isValidCollectionName(collection)) {
    return res.status(400).json({ 
      error: `Invalid collection name: ${collection}`,
      allowedCollections: ['banner', 'news', 'promotions', 'categories', 'content', 'pages', 'media', 'settings', 'announcements', 'events']
    });
  }
  next();
});

// Routes for CMS operations
// Pattern: /cms/:collection for collection operations
// Pattern: /cms/:collection/:id for item operations

router.get('/:collection', cmsController.getAll);
router.get('/:collection/:id', cmsController.getById);
router.post('/:collection', cmsController.create);
router.put('/:collection/:id', cmsController.update);
router.delete('/:collection/:id', cmsController.delete);

module.exports = router;