const express = require('express');
const jwt = require('jsonwebtoken');
const { authenticateClient, safeObjectId, errorHandler } = require('./routes/middleware/mongoMiddleware');

const router = express.Router();
const JWT_SECRET = 'ZCOKU1v3TO2flcOqCdrJ3vWbWhmnZNQn';

// Middleware to verify JWT token
function verifyToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        return reject({ status: false, message: 'Invalid or expired token' });
      }
      resolve({ status: true, message: 'Token is valid', decoded });
    });
  });
}

// Middleware to authenticate MongoDB connection
router.use(authenticateClient);

/** New Folder Endpoint
 * Adds a new folder entry to the database.
 */
router.post('/new_folder', async (req, res) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(400).json({ status: false, message: 'Token is required' });

  try {
    const decodedToken = await verifyToken(token.replace('Bearer ', ''));
    if (!decodedToken.status) return res.status(401).json({ status: false, message: 'Invalid or expired token' });

    const { db } = req;
    const { name, parent, parentName } = req.body;

    if (!name || !parent) {
      return res.status(400).json({ status: false, message: 'Name and parent ID are required' });
    }

    const fileCollection = db.collection('filemanager');
    const result = await fileCollection.insertOne({
      name,
      type: 'folder',
      parent: safeObjectId(parent),
      parentName: parentName || 'Root',
      createdAt: new Date()
    });

    return res.status(200).json({
      status: true,
      message: 'Folder created successfully',
      folderID: result.insertedId
    });
  } catch (error) {
    console.error('Error creating folder:', error);
    res.status(500).json({ status: false, message: 'An error occurred while creating the folder' });
  }
});

// Function to fetch all items in the collection without conditions
const getAllItems = async (db) => {
    const fileCollection = db.collection('filemanager');
    return await fileCollection.find().toArray();
  };
  
  // Function to restructure flat items into a nested format, calculate child counts, and generate a flat list with counts
  const restructureItems = (items) => {
    const itemMap = new Map();
  
    // Initialize each item in the map with its _id as the key, add children array, childCount, and size
    items.forEach(item => {
      item.children = []; // Initialize empty children array for each item
      item.childCount = 0; // Initialize child count for each item
      item.size = item.type === "file" ? item.size || 0 : 0; // Set initial size for files, 0 for folders
      itemMap.set(item._id.toString(), item);
    });
  
    const nestedItems = [];
  
    // Organize each item under its parent
    items.forEach(item => {
      if (item.parent && itemMap.has(item.parent.toString())) {
        itemMap.get(item.parent.toString()).children.push(item);
      } else {
        nestedItems.push(item); // Root item if no valid parent
      }
    });
  
    // Recursive function to calculate child count and accumulate file sizes for each folder
    const calculateChildrenAndSize = (item) => {
      let count = item.children.length;
      let totalSize = item.size;
  
      item.children.forEach(child => {
        const { childCount, size } = calculateChildrenAndSize(child);
        count += childCount;
        totalSize += size;
      });
  
      item.childCount = count;
      item.size = totalSize; // Update item with cumulative size
      return { childCount: count, size: totalSize };
    };
  
    // Calculate size and child count for each top-level item
    nestedItems.forEach(rootItem => calculateChildrenAndSize(rootItem));
  
    // Generate a flat list with folder data for batch updating
    const flatList = items
      .filter(item => item.type === "folder")
      .map(item => ({
        _id: item._id,
        count: item.childCount,
        size: item.size
      }));
  
    return { nestedItems, flatList };
  };
  
  /** List Parent and Batch Update Endpoint
   * Retrieves items in the filemanager collection without a filter, restructures them, and batch updates child counts and sizes.
   */
  router.post('/list_parent', async (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(400).json({ status: false, message: 'Token is required' });
  
    try {
      const decodedToken = await verifyToken(token.replace('Bearer ', ''));
      if (!decodedToken.status) return res.status(401).json({ status: false, message: 'Invalid or expired token' });
  
      const { db } = req;
  
      // Fetch all items
      const items = await getAllItems(db);
  
      // Restructure items and calculate nested structure, sizes, and counts
      const { nestedItems, flatList } = restructureItems(items);
  
      // Batch update each folder's child count and size in the database
      const fileCollection = db.collection('filemanager');
      const bulkOperations = flatList.map(item => ({
        updateOne: {
          filter: { _id: safeObjectId(item._id) },
          update: { $set: { count: item.count, size: item.size } }
        }
      }));
      await fileCollection.bulkWrite(bulkOperations);
  
      return res.status(200).json({
        status: true,
        message: 'Items retrieved and batch updated successfully',
        items: nestedItems // Return the nested structure
      });
    } catch (error) {
      console.error('Error retrieving and updating items:', error);
      res.status(500).json({ status: false, message: 'An error occurred while retrieving and updating items' });
    }
  });

// Error handler middleware
router.use(errorHandler);

module.exports = router;
