const express = require('express');
const jwt = require('jsonwebtoken');
const { authenticateClient, safeObjectId, errorHandler } = require('./routes/middleware/mongoMiddleware');
const router = express.Router();
const JWT_SECRET = 'ZCOKU1v3TO2flcOqCdrJ3vWbWhmnZNQn';
const axios = require('axios');
const crypto = require('crypto');
// Middleware to verify JWT token
const FIXED_TOKEN_KEY = 'oSpHa80H4csU3Zib1FkrGPQw1ZLikf9BBJSXKswsYJytBGR7vmLRkkre14sycehL';

function verifyToken(token) {
  return new Promise((resolve, reject) => {
    // Check if the token matches the fixed token key
    if (token === FIXED_TOKEN_KEY) {
      // Bypass JWT verification and consider it valid
      return resolve({ 
        status: true, 
        message: 'Fixed token is valid', 
        decoded: { fixedToken: true, user: 'public' } // Add `user: 'public'`
      });
    }

    // Otherwise, perform JWT verification
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

/**
 * Helper function to check if a folder is empty.
 * @param {ObjectId} folderId - The ID of the folder to check.
 * @param {Object} db - The database instance.
 * @returns {Promise<boolean>} - Returns true if the folder is empty, otherwise false.
 */
async function isFolderEmpty(folderId, db) {
  const fileCollection = db.collection('filemanager');
  const childCount = await fileCollection.countDocuments({ parent: folderId });
  return childCount === 0;
}

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
      owner: decodedToken.decoded.user, // Add owner field using decoded user ID
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
      // Verify and decode the token
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

      // Validate required file parameters
      if (!name || !path || !parent || !url || size === undefined || !mimetype) {
          return res.status(400).json({ status: false, message: 'Missing required file parameters' });
      }

      // Generate thumbnail if the file type is supported (image or video)
      const thumbnailBase64 = await generateThumbnail(url, mimetype);

      const fileCollection = db.collection('filemanager');

      // Create a new file entry with the `owner` field
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
          owner: decodedToken.decoded.user, // Add owner field using decoded user ID
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
      
      // Check if the user is the owner of the item
      if (item.owner !== decodedToken.decoded.user) {
        return res.status(403).json({ status: false, message: 'Unauthorized: You do not own this item' });
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
  if (!token) {
      console.error('Token missing in request');
      return res.status(400).json({ status: false, message: 'Token is required' });
  }

  try {
      const decodedToken = await verifyToken(token.replace('Bearer ', ''));
      if (!decodedToken.status) {
          console.error('Invalid or expired token');
          return res.status(401).json({ status: false, message: 'Invalid or expired token' });
      }

      const { db } = req;
      const { itemId, isShare, sharePassword, shareExpire, permissions } = req.body;
      const share_with_password = req.body.isPassword;

      if (!itemId) {
          console.error('Item ID is missing in request');
          return res.status(400).json({ status: false, message: 'Item ID is required' });
      }

      const fileCollection = db.collection('filemanager');
      
      // Check if item exists in the database
      const item = await fileCollection.findOne({ _id: safeObjectId(itemId) });
      if (!item) {
          console.error(`Item with ID ${itemId} not found in the database`);
          return res.status(404).json({ status: false, message: 'Item not found' });
      }

      // Generate a new shareCode only if isShare is true and the item does not already have a shareCode
      const shareCode = isShare && !item.share_code
          ? crypto.randomBytes(50).toString('hex').slice(0, 15)
          : item.share_code; // Keep existing shareCode if already present
      console.log('Using share code:', shareCode);

      // Base64 encode the password if share_with_password is true and sharePassword is provided
      const encodedPassword = share_with_password && sharePassword ? Buffer.from(sharePassword).toString('base64') : null;
      console.log('Encoded password:', encodedPassword);

      // Prepare update data
      const updateData = { 
          is_share: isShare || false, 
          share_with_password: share_with_password || false,
          permissions: permissions || {}, // Include permissions, default to empty object if not provided
          share_code: shareCode // Use the retained or newly generated shareCode
      };

      // Conditionally add or remove share password and expiration date based on flags
      updateData.share_password = share_with_password ? encodedPassword : null;
      updateData.share_expire = shareExpire ? new Date(shareExpire) : null;

      console.log('Update data being set:', updateData);

      // Perform the update operation
      await fileCollection.updateOne(
          { _id: safeObjectId(itemId) },
          { $set: updateData }
      );

      // Fetch the updated item
      const updatedItem = await fileCollection.findOne({ _id: safeObjectId(itemId) });
      console.log('Updated item:', updatedItem);

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

router.get('/external', async (req, res) => {
  const { share_code } = req.query;

  if (!share_code) {
      console.error('share_code is missing in the request');
      return res.status(400).json({ status: false, message: 'share_code is required' });
  }

  try {
      const { db } = req;
      const fileCollection = db.collection('filemanager');

      // Find the item with the matching share_code and where is_share is true
      const item = await fileCollection.findOne({
          share_code,
          is_share: true
      });

      if (!item) {
          console.error(`No shared item found with share_code: ${share_code}`);
          return res.status(404).json({ status: false, message: 'Shared item not found' });
      }

      // Format the response with necessary fields
      const responseData = {
          _id: item._id,
          name: item.name,
          type: item.type,
          parent: item.parent,
          parentName: item.parentName,
          createdAt: item.createdAt,
          count: item.count,
          size: item.size,
          mimetype: item.mimetype,
          is_share: item.is_share,
          share_code: item.share_code,
          share_password: item.share_password,
          share_expire: item.share_expire,
          share_with_password: item.share_with_password,
          permissions: item.permissions || {}
      };

      // Include URL or Base64 data if the item type is 'file'
      if (item.type === 'file') {
          if (item.mimetype && item.mimetype.startsWith('image')) {
              responseData.url = item.thumbnail;
          } else {
              responseData.url = item.url;
          }
      }

      return res.status(200).json({
          status: true,
          message: 'Shared item retrieved successfully',
          data: responseData
      });
  } catch (error) {
      console.error('Error retrieving shared item:', error);
      res.status(500).json({ status: false, message: 'An error occurred while retrieving the shared item' });
  }
});


/** Download Endpoint
 * Downloads the file associated with the provided sharecode by streaming it to the client.
 */
// Endpoint to download file based on share code

router.get('/download_external/:sharecode', async (req, res) => {
  const { db } = req;
  const { sharecode } = req.params;

  try {
    // Find the shared file in the database
    const fileCollection = db.collection('filemanager');
    const item = await fileCollection.findOne({ share_code: sharecode, is_share: true });

    // Handle case where the file is not found or is not shared
    if (!item) {
      return res.status(404).json({ status: false, message: 'Shared file not found' });
    }

    // Ensure the item is a file and has a URL
    if (item.type !== 'file' || !item.url) {
      return res.status(400).json({ status: false, message: 'Invalid file type or missing URL' });
    }

    // Fetch the file as a stream
    const response = await axios({
      url: item.url,
      method: 'GET',
      responseType: 'stream',
      headers: {
        // Add any necessary headers here, such as authorization if required
      }
    });

    // Set headers to initiate a download with the correct filename and type
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(item.name)}"`);
    res.setHeader('Content-Type', response.headers['content-type']);
    res.setHeader('Content-Length', response.headers['content-length']); // Set content length for download reliability

    // Pipe the remote file stream to the client response
    response.data.pipe(res);

  } catch (error) {
    console.error('Error streaming file:', error);
    res.status(500).json({ status: false, message: 'An error occurred while downloading the file' });
  }
});

router.get('/download/:id', async (req, res) => {
  const { db } = req;
  const { id } = req.params;

  try {
    // Convert id to ObjectId and find the file by _id
    const fileCollection = db.collection('filemanager');
    const item = await fileCollection.findOne({ _id: safeObjectId(id) });

    // Handle case where the file is not found or is not shared
    if (!item) {
      return res.status(404).json({ status: false, message: 'Shared file not found' });
    }

    // Ensure the item is a file and has a URL
    if (item.type !== 'file' || !item.url) {
      return res.status(400).json({ status: false, message: 'Invalid file type or missing URL' });
    }

    console.log("item",item);
    // Fetch the file as a stream
    const response = await axios({
      url: item.url,
      method: 'GET',
      responseType: 'stream',
      headers: {
        // Add any necessary headers here, such as authorization if required
      }
    });

    // Set headers to initiate a download with the correct filename and type
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(item.name)}"`);
    res.setHeader('Content-Type', response.headers['content-type']);
    res.setHeader('Content-Length', response.headers['content-length']); // Set content length for download reliability

    // Pipe the remote file stream to the client response
    response.data.pipe(res);

  } catch (error) {
    console.error('Error streaming file:', error);
    res.status(500).json({ status: false, message: 'An error occurred while downloading the file' });
  }
});


router.get('/document/:id', async (req, res) => {
  const { db } = req;
  const { id } = req.params;

  try {
    // Find the document by _id, ensuring to safely handle the ObjectId
    const fileCollection = db.collection('filemanager');
    const item = await fileCollection.findOne({ _id: safeObjectId(id) });

    // Handle case where the document is not found
    if (!item) {
      return res.status(404).json({ status: false, message: 'Document not found' });
    }

    // Prepare the document data to return
    const documentData = {
      name: item.name,
      content: item.content || null,  // Adjust based on your document's actual structure
      metadata: {
        size: item.size,
        mimetype: item.mimetype,
        path: item.path,
        url: item.url,
        createdAt: item.createdAt,
      },
      // Add additional fields if needed
    };

    // Return the document data as JSON
    res.status(200).json({ status: true, data: documentData });

  } catch (error) {
    console.error('Error retrieving document:', error);
    res.status(500).json({ status: false, message: 'An error occurred while retrieving the document' });
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

      // Check if the user is the owner of the item
      if (item.owner !== decodedToken.decoded.user) {
          return res.status(403).json({ status: false, message: 'Unauthorized: You do not own this item' });
      }

      // Apply check for empty folder
      if (item.type === 'folder' && !(await isFolderEmpty(item._id, db))) {
          return res.status(400).json({
              status: false,
              message: 'Cannot delete folder because it contains items'
          });
      }

      // Proceed with deletion
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

  // Function to create the nested structure
  const createNestedStructure = async (db) => {
    const fileCollection = db.collection('filemanager');

    // Specify the fields you want to retrieve (e.g., `_id`, `name`, `parent`, and `type`)
    const items = await fileCollection.find({}, { projection: { _id: 1, name: 1, parent: 1, type: 1, count: 1, size: 1 } }).toArray();
  
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

// '/search_external' endpoint to find items under a specific parent ID and add their real paths
router.post('/search_external', async (req, res) => {
  const { db } = req;
  const { query, fixedParentId } = req.body;

  if (!query) {
    console.error('Search query is required');
    return res.status(400).json({ status: false, message: 'Search query is required' });
  }

  if (!fixedParentId) {
    console.error('Fixed parent ID is required');
    return res.status(400).json({ status: false, message: 'Fixed parent ID is required' });
  }

  try {
    // Search criteria limited to name and is_share
    const searchCriteria = {
      name: { $regex: query, $options: 'i' }, // Case-insensitive search on name
    };

    const fileCollection = db.collection('filemanager');
    const searchResults = await fileCollection.find(searchCriteria).toArray();

    // If no results found, return early
    if (searchResults.length === 0) {
      return res.status(404).json({ status: false, message: 'No shared items found for the query' });
    }

    // Build the nested structure under the fixed parent ID
    const nestedItems = await createNestedStructureForSearchExternal(db, fixedParentId);

    // Filter results to only include items under the fixed parent hierarchy
    const resultsWithPaths = searchResults
      .filter(item => isDescendantOf(item._id, nestedItems))
      .map(item => {
        const realPath = findPathById(item._id, nestedItems);
        return { ...item, realPath };
      });

    if (resultsWithPaths.length === 0) {
      return res.status(404).json({ status: false, message: 'No items found under the specified parent ID' });
    }

    res.status(200).json({
      status: true,
      message: 'Search completed successfully within specified parent hierarchy',
      results: resultsWithPaths
    });
  } catch (error) {
    console.error('Error during search:', error);
    res.status(500).json({ status: false, message: 'An error occurred while performing the search' });
  }
});

// Helper function to check if an item is a descendant of the fixed parent hierarchy
const isDescendantOf = (itemId, nestedItems) => {
  const stack = [...nestedItems];
  while (stack.length > 0) {
    const currentItem = stack.pop();
    if (currentItem._id.toString() === itemId.toString()) return true;
    stack.push(...currentItem.children);
  }
  return false;
};

// Function to create a nested structure for items under the fixed parent ID
const createNestedStructureForSearchExternal = async (db, fixedParentId) => {
  const fileCollection = db.collection('filemanager');
  //const items = await fileCollection.find().toArray();
  // Specify the fields you want to retrieve (e.g., `_id`, `name`, `parent`, and `type`)
  const items = await fileCollection.find({}, { projection: { _id: 1, name: 1, parent: 1, type: 1, count: 1, size: 1 } }).toArray();

  const itemMap = new Map();
  let rootItem = null;

  // Initialize each item with an empty children array and store it in itemMap
  items.forEach(item => {
    item.children = [];
    itemMap.set(item._id.toString(), item);
    if (item._id.toString() === fixedParentId.toString()) {
      rootItem = item; // Identify the root item as the fixed parent
    }
  });

  // If the fixed parent isn't found, return an empty array
  if (!rootItem) {
    console.error(`Fixed parent with ID ${fixedParentId} not found`);
    return [];
  }

  // Build the nested structure only within the hierarchy of fixedParentId
  items.forEach(item => {
    const parentId = item.parent ? item.parent.toString() : null;
    if (parentId && itemMap.has(parentId)) {
      itemMap.get(parentId).children.push(item); // Add as a child to its parent
    }
  });

  // Return only the hierarchy under the fixedParentId
  return [rootItem];
};




// New endpoint to get only folder structure
router.get('/folder_structure', async (req, res) => {
  const { db } = req;
  const { parent } = req.query;

  try {
    // Convert parent ID to ObjectId if provided
    const parentId = parent ? safeObjectId(parent) : null;
    
    // Create the nested folder structure starting from the specified parent ID, if any
    const nestedFolders = await createFolderStructure(db, parentId);

    res.status(200).json({
      status: true,
      message: 'Folder structure retrieved successfully',
      structure: nestedFolders
    });
  } catch (error) {
    console.error('Error retrieving folder structure:', error);
    res.status(500).json({ status: false, message: 'An error occurred while retrieving the folder structure' });
  }
});

/** Function to create a nested folder structure
 * @param {Object} db - The database instance.
 * @param {ObjectId|null} parentId - The ID of the parent to start from. If null, fetch all top-level folders.
 * @returns {Promise<Array>} - A nested array structure containing only folder-type items.
 */
const createFolderStructure = async (db, parentId = null) => {
  const fileCollection = db.collection('filemanager');

  // Define the query condition based on the presence of parentId
  const query = { type: 'folder' };

  console.log(query);

  // Retrieve folder items based on the query
  const items = await fileCollection.find(query, {
    projection: { _id: 1, name: 1, parent: 1, type: 1, count: 1, size: 1 }
  }).toArray();

  const itemMap = new Map();

  // Initialize each folder with an empty children array and store it in itemMap
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

  // If parentId is specified and found, return only its subtree; else, return the full nested structure
  return nestedItems;
};

/** Move Folder Endpoint
 * Changes the parent of a specified folder or file.
 */
router.post('/move_folder', async (req, res) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(400).json({ status: false, message: 'Token is required' });

  try {
    const decodedToken = await verifyToken(token.replace('Bearer ', ''));
    if (!decodedToken.status) return res.status(401).json({ status: false, message: 'Invalid or expired token' });

    const { db } = req;
    const { itemId, newParentId } = req.body;

    if (!itemId || !newParentId) {
      return res.status(400).json({ status: false, message: 'Item ID and new parent ID are required' });
    }

    const fileCollection = db.collection('filemanager');
    const item = await fileCollection.findOne({ _id: safeObjectId(itemId) });

    if (!item) {
      return res.status(404).json({ status: false, message: 'Item not found' });
    }

    // Check if the user is the owner of the item
    if (item.owner !== decodedToken.decoded.user) {
      return res.status(403).json({ status: false, message: 'Unauthorized: You do not own this item' });
    }

    // Update the item's parent
    const result = await fileCollection.updateOne(
      { _id: safeObjectId(itemId) },
      { $set: { parent: safeObjectId(newParentId) } }
    );

    if (result.modifiedCount === 0) {
      return res.status(500).json({ status: false, message: 'Failed to move the item' });
    }

    return res.status(200).json({
      status: true,
      message: 'Item moved successfully',
      itemId: itemId,
      newParentId: newParentId
    });
  } catch (error) {
    console.error('Error moving folder:', error);
    res.status(500).json({ status: false, message: 'An error occurred while moving the folder' });
  }
});



// Error handler middleware
router.use(errorHandler);

module.exports = router;
