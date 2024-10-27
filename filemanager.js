const express = require('express');
const jwt = require('jsonwebtoken');
const { authenticateClient, safeObjectId, errorHandler } = require('./routes/middleware/mongoMiddleware');
const router = express.Router();
const JWT_SECRET = 'ZCOKU1v3TO2flcOqCdrJ3vWbWhmnZNQn';
const axios = require('axios');
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


/**
 * Generates a thumbnail in base64 format if the mimetype is an image or video.
 * @param {string} url - The URL of the image or video to generate a thumbnail for.
 * @param {string} mimetype - The mimetype of the file.
 * @returns {Promise<string|null>} - The base64 thumbnail or null if the mimetype is not supported.
 */
async function generateThumbnail(url, mimetype) {
    try {
        let response;
        
        if (mimetype.startsWith('image/')) {
            // Generate thumbnail for an image
            response = await axios.post(
                'https://api.apyhub.com/generate/image/thumbnail/url/file?output=thumbnail&height=56&width=100&auto_orientation=false&preserve_format=true',
                { url },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'apy-token': 'APY02grbaFd83fKSDc8QtNTdld6dgFG4YDna2AIZYh4QGsE1jPsLQDBwuyM77R21Fq7BsSMHAH'
                    },
                    responseType: 'arraybuffer' // Ensure the response is treated as binary data
                }
            );
        } else if (mimetype.startsWith('video/')) {
            // Generate thumbnail for a video
            response = await axios.post(
                'https://api.apyhub.com/generate/image-thumbnail/url/file',
                {
                    size: "100x56",
                    video_url: url
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'apy-token': 'APY02grbaFd83fKSDc8QtNTdld6dgFG4YDna2AIZYh4QGsE1jPsLQDBwuyM77R21Fq7BsSMHAH'
                    },
                    responseType: 'arraybuffer' // Ensure the response is treated as binary data
                }
            );
        } else {
            // Return null for unsupported mimetypes
            return null;
        }

        // Convert binary data to base64
        const base64Thumbnail = `data:${mimetype};base64,${Buffer.from(response.data, 'binary').toString('base64')}`;
        return base64Thumbnail;

    } catch (error) {
        console.error('Error generating thumbnail:', error);
        return null;
    }
}

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
            dimensions
        } = req.body;
  
        if (!name || !path || !parent || !url || size === undefined || !mimetype) {
            return res.status(400).json({ status: false, message: 'Missing required file parameters' });
        }
  
        // Generate thumbnail if the file type is supported (image or video)
        const thumbnailBase64 = await generateThumbnail(url, mimetype);
  
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
            thumbnail: thumbnailBase64,
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
 * Additionally, returns total counts for files and folders and the summary file size.
 */
const restructureItems = async (db) => {
    const fileCollection = db.collection('filemanager');
    const items = await fileCollection.find().toArray();

    const itemMap = new Map();
    let totalFileCount = 0; // Count of all files
    let totalFolderCount = 0; // Count of all folders
    let totalFileSize = 0; // Summary of all file sizes

    // Initialize each item in the map with its _id as the key
    items.forEach(item => {
      item.children = [];
      item.childCount = 0;
      item.size = item.type === "file" ? item.size || 0 : 0;

      // Update counters for files and folders
      if (item.type === "file") {
        totalFileCount++;
        totalFileSize += item.size;
      } else if (item.type === "folder") {
        totalFolderCount++;
      }

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

    return { 
      nestedItems, 
      flatList, 
      totalFileCount, 
      totalFolderCount, 
      totalFileSize 
    };
};

  
  /** List Parent Endpoint
 * Retrieves and updates items by parent ID, then fetches the updated data by parent ID,
 * sorted to display folders first.
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

        // Fetch and restructure all items in the collection, including totals
        const { flatList, totalFileCount, totalFolderCount, totalFileSize } = await restructureItems(db);

        // Perform batch update on folder counts and sizes
        const fileCollection = db.collection('filemanager');
        const updateOperations = flatList.map(item => {
            const id = safeObjectId(item._id);
            return fileCollection.updateOne({ _id: id }, { $set: { count: item.count, size: item.size } });
        });
        await Promise.all(updateOperations);

        // Fetch the updated data for the specified parent
        const updatedItems = await fileCollection.find({ parent: safeObjectId(parent) }).toArray();

        // Sort items to display folders first, then files
        updatedItems.sort((a, b) => {
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;
            return 0;
        });

        return res.status(200).json({
            status: true,
            message: 'Items retrieved and batch updated successfully',
            items: updatedItems,
            totals: {
                totalFileCount,
                totalFolderCount,
                totalFileSize
            }
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

  router.post('/share', async (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(400).json({ status: false, message: 'Token is required' });

    try {
        const decodedToken = await verifyToken(token.replace('Bearer ', ''));
        if (!decodedToken.status) return res.status(401).json({ status: false, message: 'Invalid or expired token' });

        const { db } = req;
        const { itemId, isShare, sharePassword, shareExpire } = req.body;

        if (!itemId) {
            return res.status(400).json({ status: false, message: 'Item ID is required' });
        }

        // Generate a random 15-digit share code
        const shareCode = crypto.randomBytes(15).toString('hex').slice(0, 15);

        // Base64 encode the password if provided
        const encodedPassword = sharePassword ? Buffer.from(sharePassword).toString('base64') : null;

        const fileCollection = db.collection('filemanager');
        const item = await fileCollection.findOne({ _id: safeObjectId(itemId) });

        if (!item) {
            return res.status(404).json({ status: false, message: 'Item not found' });
        }

        // Update the share options
        const updateData = {
            is_share: isShare || false,
            share_password: encodedPassword,
            share_expire: shareExpire ? new Date(shareExpire) : null,
            share_code: shareCode,
        };

        const result = await fileCollection.updateOne(
            { _id: safeObjectId(itemId) },
            { $set: updateData }
        );

        if (result.modifiedCount === 0) {
            return res.status(500).json({ status: false, message: 'Failed to set share options' });
        }

        // Return the updated item with the new share options
        const updatedItem = await fileCollection.findOne({ _id: safeObjectId(itemId) });

        return res.status(200).json({
            status: true,
            message: 'Share options set successfully',
            item: updatedItem
        });
    } catch (error) {
        console.error('Error setting share options:', error);
        res.status(500).json({ status: false, message: 'An error occurred while setting share options' });
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






  // Function to create the nested structure
const createNestedStructure = async (db) => {
  const fileCollection = db.collection('filemanager');
  const items = await fileCollection.find().toArray();

  const itemMap = new Map();

  // Initialize each item with an empty children array and store it in itemMap
  items.forEach(item => {
    item.children = [];
    itemMap.set(item._id.toString(), item);
  });

  const nestedItems = [];

  // Build the nested structure
  items.forEach(item => {
    if (item.parent && itemMap.has(item.parent.toString())) {
      // Add item to the parent's children array
      itemMap.get(item.parent.toString()).children.push(item);
    } else {
      // Add top-level items directly to nestedItems
      nestedItems.push(item);
    }
  });
  return nestedItems; // Returns the nested array structure
};

// Recursive function to find the real path of an item by _id in the nested structure
const findPathById = (targetId, nestedItems, currentPath = []) => {
  for (const item of nestedItems) {
    // Create a new path array that includes the current item as an object with name and _id
    const newPath = [...currentPath, { name: item.name, id: item._id.toString() }];

    if (item._id.toString() === targetId.toString()) {
      return newPath; // Found the item, return the path as an array of objects
    }

    // If the item has children, search recursively within them
    if (item.children && item.children.length > 0) {
      const result = findPathById(targetId, item.children, newPath);
      if (result) return result; // Return the path if found in the children
    }
  }
  return null; // Return null if the target item is not found in this branch
};


// '/search' endpoint to find items and add their real paths
router.post('/search', async (req, res) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(400).json({ status: false, message: 'Token is required' });

  try {
    const decodedToken = await verifyToken(token.replace('Bearer ', ''));
    if (!decodedToken.status) return res.status(401).json({ status: false, message: 'Invalid or expired token' });

    const { db } = req;
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ status: false, message: 'Search query is required' });
    }

    // Search criteria limited to name
    const searchCriteria = {
      name: { $regex: query, $options: 'i' } // Case-insensitive search on name field
    };

    const fileCollection = db.collection('filemanager');
    const searchResults = await fileCollection.find(searchCriteria).toArray();

    if (searchResults.length === 0) {
      return res.status(404).json({ status: false, message: 'Item not found' });
    }

    // Create the nested structure for the entire file collection
    const nestedItems = await createNestedStructure(db);

    // Add realPath to each item in the search results
    const resultsWithPaths = searchResults.map(item => {
      const realPath = findPathById(item._id, nestedItems);
      return { ...item, realPath }; // Add realPath as an array of { name, id } objects
    });

    res.status(200).json({
      status: true,
      message: 'Search completed successfully',
      results: resultsWithPaths
    });
  } catch (error) {
    console.error('Error during search:', error);
    res.status(500).json({ status: false, message: 'An error occurred while performing the search' });
  }
});






// Error handler middleware
router.use(errorHandler);

module.exports = router;
