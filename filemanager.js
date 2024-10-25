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

/** New File Endpoint
 * Creates a new file entry in the filemanager collection with specified attributes.
 */
router.post('/new_file', async (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(400).json({ status: false, message: 'Token is required' });
  
    try {
      const decodedToken = await verifyToken(token.replace('Bearer ', ''));
      if (!decodedToken.status) return res.status(401).json({ status: false, message: 'Invalid or expired token' });
  
      const { db } = req;
      const {
        name,
        path,
        parent,
        url,
        size,
        mimetype,
        dimensions,
        thumbnail
      } = req.body;
  
      if (!name || !path || !parent || !url || size === undefined || !mimetype) {
        return res.status(400).json({ status: false, message: 'Missing required file parameters' });
      }
  
      const fileCollection = db.collection('filemanager');
  
      // Create a new file entry
      const result = await fileCollection.insertOne({
        name,
        path,
        type: 'file',
        parent: safeObjectId(parent),
        url,
        size: parseFloat(size),
        mimetype,
        dimensions: dimensions || null,
        thumbnail: thumbnail || null,
        createdAt: new Date()
      });
  
      return res.status(200).json({
        status: true,
        message: 'File created successfully',
        _id: result.insertedId // Return the ID of the newly created file
      });
    } catch (error) {
      console.error('Error creating file entry:', error);
      res.status(500).json({ status: false, message: 'An error occurred while creating the file entry' });
    }
  });



/** Function to Restructure Items
 * Fetches all items in the collection, restructures them, and calculates `childCount` and `size`.
 */
const restructureItems = async (db) => {
    const fileCollection = db.collection('filemanager');
    const items = await fileCollection.find().toArray();
  
    const itemMap = new Map();
  
    // Initialize each item in the map with its _id as the key
    items.forEach(item => {
      item.children = [];
      item.childCount = 0;
      item.size = item.type === "file" ? item.size || 0 : 0;
      itemMap.set(item._id.toString(), item);
    });
  
    const nestedItems = [];
    items.forEach(item => {
      if (item.parent && itemMap.has(item.parent.toString())) {
        itemMap.get(item.parent.toString()).children.push(item);
      } else {
        nestedItems.push(item);
      }
    });
  
    const calculateChildrenAndSize = (item) => {
      let count = item.children.length;
      let totalSize = item.size;
  
      item.children.forEach(child => {
        const { childCount, size } = calculateChildrenAndSize(child);
        count += childCount;
        totalSize += size;
      });
  
      item.childCount = count;
      item.size = totalSize;
      return { childCount: count, size: totalSize };
    };
  
    nestedItems.forEach(rootItem => calculateChildrenAndSize(rootItem));
  
    const flatList = items
      .filter(item => item.type === "folder")
      .map(item => ({
        _id: item._id,
        count: item.childCount,
        size: item.size
      }));
  
    return { nestedItems, flatList };
  };
  
  /** List Parent Endpoint
   * Retrieves and updates items by parent ID, then fetches the updated data by parent ID.
   */
  router.post('/list_parent', async (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(400).json({ status: false, message: 'Token is required' });
  
    try {
      const decodedToken = await verifyToken(token.replace('Bearer ', ''));
      if (!decodedToken.status) return res.status(401).json({ status: false, message: 'Invalid or expired token' });
  
      const { db } = req;
      const { parent } = req.body;
  
      if (!parent) {
        return res.status(400).json({ status: false, message: 'Parent ID is required' });
      }
  
      // Fetch and restructure all items in the collection
      const { flatList } = await restructureItems(db);
  
      // Perform batch update on folder counts and sizes
      const fileCollection = db.collection('filemanager');
      const updateOperations = flatList.map(item => {
        const id = safeObjectId(item._id);
        return fileCollection.updateOne({ _id: id }, { $set: { count: item.count, size: item.size } });
      });
      await Promise.all(updateOperations);
  
      // Fetch the updated data for the specified parent
      const updatedItems = await fileCollection.find({ parent: safeObjectId(parent) }).toArray();
  
      return res.status(200).json({
        status: true,
        message: 'Items retrieved and batch updated successfully',
        items: updatedItems
      });
    } catch (error) {
      console.error('Error retrieving and updating items:', error);
      res.status(500).json({ status: false, message: 'An error occurred while retrieving and updating items' });
    }
  });

  /** Rename Endpoint
 * Allows renaming of a file or folder in the filemanager collection.
 */
router.post('/rename', async (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(400).json({ status: false, message: 'Token is required' });
  
    try {
      const decodedToken = await verifyToken(token.replace('Bearer ', ''));
      if (!decodedToken.status) return res.status(401).json({ status: false, message: 'Invalid or expired token' });
  
      const { db } = req;
      const { itemId, newName } = req.body;
  
      if (!itemId || !newName) {
        return res.status(400).json({ status: false, message: 'Item ID and new name are required' });
      }
  
      const fileCollection = db.collection('filemanager');
      const item = await fileCollection.findOne({ _id: safeObjectId(itemId) });
  
      if (!item) {
        return res.status(404).json({ status: false, message: 'Item not found' });
      }
  
      // Perform the rename operation
      const result = await fileCollection.updateOne(
        { _id: safeObjectId(itemId) },
        { $set: { name: newName } }
      );
  
      if (result.modifiedCount === 0) {
        return res.status(500).json({ status: false, message: 'Failed to rename the item' });
      }
  
      // Return the updated item
      const updatedItem = await fileCollection.findOne({ _id: safeObjectId(itemId) });
  
      return res.status(200).json({
        status: true,
        message: 'Item renamed successfully',
        item: updatedItem
      });
    } catch (error) {
      console.error('Error renaming item:', error);
      res.status(500).json({ status: false, message: 'An error occurred while renaming the item' });
    }
  });

  /** Delete Endpoint
 * Allows deleting a file or folder (only if the folder is empty) in the filemanager collection.
 */
router.post('/delete', async (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(400).json({ status: false, message: 'Token is required' });
  
    try {
      const decodedToken = await verifyToken(token.replace('Bearer ', ''));
      if (!decodedToken.status) return res.status(401).json({ status: false, message: 'Invalid or expired token' });
  
      const { db } = req;
      const { itemId } = req.body;
  
      if (!itemId) {
        return res.status(400).json({ status: false, message: 'Item ID is required' });
      }
  
      const fileCollection = db.collection('filemanager');
      const item = await fileCollection.findOne({ _id: safeObjectId(itemId) });
  
      if (!item) {
        return res.status(404).json({ status: false, message: 'Item not found' });
      }
  
      // Check if the item is a folder with contents (count > 0)
      if (item.type === 'folder' && item.count > 0) {
        return res.status(400).json({
          status: false,
          message: 'Cannot delete folder because it contains items'
        });
      }
  
      // Proceed with deletion if item is a file or an empty folder
      await fileCollection.deleteOne({ _id: safeObjectId(itemId) });
  
      return res.status(200).json({
        status: true,
        message: `Item ${itemId} deleted successfully`
      });
    } catch (error) {
      console.error('Error deleting item:', error);
      res.status(500).json({ status: false, message: 'An error occurred while deleting the item' });
    }
  });


// Error handler middleware
router.use(errorHandler);

module.exports = router;
