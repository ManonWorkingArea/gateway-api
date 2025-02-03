const express = require('express');
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
const { authenticateClient, safeObjectId, errorHandler } = require('./routes/middleware/mongoMiddleware'); // Import your middleware

const router = express.Router();

// Secret key for signing JWT (You should store this securely)
const JWT_SECRET = 'ZCOKU1v3TO2flcOqCdrJ3vWbWhmnZNQn'; // Replace with your own secret key

// Use authenticateClient to manage the MongoDB connection based on the client key
router.use(authenticateClient);

// Function to verify the token
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

/**
 * Helper function to get site-specific database and collection
 * @param {Object} client - MongoDB client from middleware
 * @param {String} site - Site ID
 * @returns {Object} - { db, postCollection, siteData }
 * @throws {Error} - If the site is invalid or not found
 */
async function getSiteSpecificDb(client, site) {
  const apiDb = client.db('API'); // Connect to the API database
  const siteCollection = apiDb.collection('hostname'); // Reference the hostname collection

  // Fetch the site data by site ID
  const siteData = await siteCollection.findOne({
    $or: [
      { _id: safeObjectId(site) }, // Match by ObjectId
      { hostname: site },         // Match by hostname string
    ],
  });
  
  if (!siteData) {
    throw new Error(`Invalid site ID. Site not found: ${site}`);
  }

  // Use the site data to determine the target database
  const targetDb = client.db(siteData.key); // Connect to the site-specific database
  const postCollection = targetDb.collection('post'); // Reference the post collection

  return { db: targetDb, postCollection, siteData };
}

router.post('/iframe', async (req, res) => {
    try {
        const { page, post, site } = req.body; // Read page, post, and site from the request body
        const client = req.client; // MongoDB client is attached by authenticateClient middleware

        if (!site) {
            return res.status(400).json({ status: false, message: 'Site ID is required' });
        }

        if (!page) {
            return res.status(400).json({ status: false, message: 'Page is required' });
        }

        const { postCollection } = await getSiteSpecificDb(client, site);

        console.log("page",page);
        // Retrieve the page document
        const pageDoc = await postCollection.findOne({_id: safeObjectId(page)});


        //console.log("pageDoc",pageDoc);

        if (!pageDoc) {
            return res.status(404).json({ status: false, message: 'Page not found' });
        }

        // If a specific post is requested
        if (typeof post === 'string' && post.trim() !== '') {
            const postDoc = await postCollection.findOne({
                _id: post,
                owner: site,
                parent: pageDoc._id.toString(),
                type: 'post',
                status: true,
            });

            if (!postDoc) {
                return res.status(404).json({ status: false, message: 'Post not found for the given page' });
            }

            // Increment the visitor count for the specific post
            const postUpdateResult = await postCollection.updateOne(
                { _id: postDoc._id },
                { $inc: { visitor: 1 } }
            );

            if (postUpdateResult.matchedCount === 0) {
                console.error('Failed to update visitor count for post:', postDoc._id);
                return res.status(500).json({ status: false, message: 'Failed to update visitor count for post' });
            }

            // Retrieve the last 5 posts
            const lastPosts = await postCollection
                .find({
                    owner: site,
                    parent: pageDoc._id.toString(),
                    type: 'post',
                    status: true,
                })
                .sort({ createdAt: -1 }) // Assuming you have a `createdAt` field for sorting
                .limit(5)
                .toArray();

            // Return page, specific post, and last 5 posts
            return res.status(200).json({
                status: true,
                message: 'Data retrieved successfully',
                page: pageDoc,
                post: postDoc,
                last: lastPosts,
            });
        }

        // Check if the page's display is 'group'
        if (pageDoc.display === 'group') {
            // Retrieve all child posts
            const childPosts = await postCollection.find({
                owner: site,
                parent: pageDoc._id.toString(),
                type: 'post',
                status: true,
            }).toArray();

            // Increment the visitor count for the page
            const pageUpdateResult = await postCollection.updateOne(
                { _id: pageDoc._id },
                { $inc: { visitor: 1 } }
            );

            if (pageUpdateResult.matchedCount === 0) {
                console.error('Failed to update visitor count for page:', pageDoc._id);
                return res.status(500).json({ status: false, message: 'Failed to update visitor count for page' });
            }

            return res.status(200).json({
                status: true,
                message: 'Page and group posts retrieved successfully',
                page: pageDoc,
                posts: childPosts,
            });
        }

        // Increment the visitor count for the page
        const pageUpdateResult = await postCollection.updateOne(
            { _id: pageDoc._id },
            { $inc: { visitor: 1 } }
        );

        if (pageUpdateResult.matchedCount === 0) {
            console.error('Failed to update visitor count for page:', pageDoc._id);
            return res.status(500).json({ status: false, message: 'Failed to update visitor count for page' });
        }

        // Return only the page data if no post is requested
        return res.status(200).json({
            status: true,
            message: 'Page retrieved successfully',
            page: pageDoc,
        });
    } catch (error) {
        console.error('An error occurred:', error);
        res.status(500).json({ status: false, message: 'An error occurred while retrieving the data' });
    }
});


router.post('/page', async (req, res) => {
    try {
        const { page, post, site } = req.body; // Read page, post, and site from the request body
        const client = req.client; // MongoDB client is attached by authenticateClient middleware

        if (!site) {
            return res.status(400).json({ status: false, message: 'Site ID is required' });
        }

        if (!page) {
            return res.status(400).json({ status: false, message: 'Page is required' });
        }

        const { postCollection } = await getSiteSpecificDb(client, site);

        console.log(postCollection);
        // Retrieve the page document
        const pageDoc = await postCollection.findOne({
            slug: page,
            owner: site,
            type: { $in: ['page', 'form'] }, // Match 'page' or 'form'
        });


        console.log("pageDoc",pageDoc);

        if (!pageDoc) {
            return res.status(404).json({ status: false, message: 'Page not found' });
        }

        // If a specific post is requested
        if (typeof post === 'string' && post.trim() !== '') {
            const postDoc = await postCollection.findOne({
                slug: post,
                owner: site,
                parent: pageDoc._id.toString(),
                type: 'post',
                status: true,
            });

            if (!postDoc) {
                return res.status(404).json({ status: false, message: 'Post not found for the given page' });
            }

            // Increment the visitor count for the specific post
            const postUpdateResult = await postCollection.updateOne(
                { _id: postDoc._id },
                { $inc: { visitor: 1 } }
            );

            if (postUpdateResult.matchedCount === 0) {
                console.error('Failed to update visitor count for post:', postDoc._id);
                return res.status(500).json({ status: false, message: 'Failed to update visitor count for post' });
            }

            // Retrieve the last 5 posts
            const lastPosts = await postCollection
                .find({
                    owner: site,
                    parent: pageDoc._id.toString(),
                    type: 'post',
                    status: true,
                })
                .sort({ createdAt: -1 }) // Assuming you have a `createdAt` field for sorting
                .limit(5)
                .toArray();

            // Return page, specific post, and last 5 posts
            return res.status(200).json({
                status: true,
                message: 'Data retrieved successfully',
                page: pageDoc,
                post: postDoc,
                last: lastPosts,
            });
        }

        // Check if the page's display is 'group'
        if (pageDoc.display === 'group') {
            // Retrieve all child posts
            const childPosts = await postCollection.find({
                owner: site,
                parent: pageDoc._id.toString(),
                type: 'post',
                status: true,
            }).toArray();

            // Increment the visitor count for the page
            const pageUpdateResult = await postCollection.updateOne(
                { _id: pageDoc._id },
                { $inc: { visitor: 1 } }
            );

            if (pageUpdateResult.matchedCount === 0) {
                console.error('Failed to update visitor count for page:', pageDoc._id);
                return res.status(500).json({ status: false, message: 'Failed to update visitor count for page' });
            }

            return res.status(200).json({
                status: true,
                message: 'Page and group posts retrieved successfully',
                page: pageDoc,
                posts: childPosts,
            });
        }

        // Increment the visitor count for the page
        const pageUpdateResult = await postCollection.updateOne(
            { _id: pageDoc._id },
            { $inc: { visitor: 1 } }
        );

        if (pageUpdateResult.matchedCount === 0) {
            console.error('Failed to update visitor count for page:', pageDoc._id);
            return res.status(500).json({ status: false, message: 'Failed to update visitor count for page' });
        }

        // Return only the page data if no post is requested
        return res.status(200).json({
            status: true,
            message: 'Page retrieved successfully',
            page: pageDoc,
        });
    } catch (error) {
        console.error('An error occurred:', error);
        res.status(500).json({ status: false, message: 'An error occurred while retrieving the data' });
    }
});


router.post('/post', async (req, res) => {
    try {
        const {
            pageId,
            site,
            limit = 10, // Default to 10 items per page
            page = 1, // Default to the first page
            keyword, // Optional search keyword
            sort = 'createdAt', // Default sort field
            order = 'asc', // Default sort order
        } = req.body;

        const client = req.client;

        // Validate inputs
        if (!site) {
            return res.status(400).json({ status: false, message: 'Site ID is required' });
        }
        if (!pageId) {
            return res.status(400).json({ status: false, message: 'Page ID is required' });
        }

        const { postCollection } = await getSiteSpecificDb(client, site);

        // Validate if the page exists
        const pageDoc = await postCollection.findOne({
            _id: safeObjectId(pageId),
            owner: site,
            type: 'page',
            status: true,
        });

        if (!pageDoc) {
            return res.status(404).json({ status: false, message: 'Page not found' });
        }

        const itemsPerPage = parseInt(limit, 10);
        const currentPage = parseInt(page, 10);

        if (isNaN(itemsPerPage) || itemsPerPage <= 0 || isNaN(currentPage) || currentPage <= 0) {
            return res.status(400).json({
                status: false,
                message: 'Invalid pagination parameters',
            });
        }

        // Build query
        const query = {
            owner: site,
            parent: pageId,
            type: 'post',
            status: true,
        };

        // Add keyword search
        if (keyword) {
            query.title = { $regex: keyword, $options: 'i' };
        }

        // Validate sort order and construct sort object
        const validOrders = ['asc', 'desc'];
        if (!validOrders.includes(order)) {
            return res.status(400).json({ status: false, message: 'Invalid sort order' });
        }

        const sortOrder = order === 'asc' ? 1 : -1; // Ascending or descending
        const sortObject = { [sort]: sortOrder, _id: sortOrder }; // Secondary sort by `_id` for consistent ordering

        // Debugging output for validation
        console.log('Query:', query);
        console.log('Sort Object:', sortObject);
        console.log('Current Page:', currentPage);
        console.log('Items Per Page:', itemsPerPage);

        // Count total records
        const totalRecords = await postCollection.countDocuments(query);

        // Fetch paginated posts with stable sorting
        const posts = await postCollection
            .find(query)
            .sort(sortObject)
            .skip((currentPage - 1) * itemsPerPage)
            .limit(itemsPerPage)
            .toArray();

        return res.status(200).json({
            status: true,
            message: keyword ? 'Search results retrieved successfully' : 'Posts retrieved successfully',
            page: pageDoc,
            posts,
            pagination: {
                totalRecords,
                currentPage,
                totalPages: Math.ceil(totalRecords / itemsPerPage),
                itemsPerPage,
            },
        });
    } catch (error) {
        console.error('Error in /post endpoint:', error);
        return res.status(500).json({
            status: false,
            message: 'An error occurred while retrieving the data',
        });
    }
});


const axios = require('axios'); // Import axios for making HTTP requests

// New endpoint for Bill Lookup
router.get('/bill-lookup', async (req, res) => {
    try {
        const { reference1, reference2, tranAmount } = req.query;

        // Validate the required query parameters
        if (!reference1 || !reference2 || !tranAmount) {
            return res.status(400).json({ status: false, message: 'Missing required query parameters' });
        }

        // Prepare the headers and the URL
        const url = `https://fti-api-mg.azure-api.net/BillLookup`;
        const headers = {
            'Clientid': 'f423b069-6c7c-4422-b4f6-9b438aa391f2',
            'Clientsecret': 'a653f1c1-a1b8-4f5a-b5ea-3e4bef4be14a',
            'Content-Type': 'application/json',
            'Ocp-Apim-Subscription-Key': '52bcf82678b346de824fed6f832d63a3',
        };

        // Make the GET request
        const response = await axios.get(url, {
            headers,
            params: {
                reference1,
                reference2,
                tranAmount,
            },
        });

        console.log("response",response.data);

        // Return the API response
        return res.status(200).json({
            status: true,
            message: 'Bill lookup successful',
            data: response.data,
        });
    } catch (error) {
        console.error('Error in /bill-lookup:', error);

        // Handle errors based on the response from the external API
        if (error.response) {
            return res.status(error.response.status).json({
                status: false,
                message: 'Error from external API',
                data: error.response.data,
            });
        }

        // Generic error handling
        return res.status(500).json({
            status: false,
            message: 'An error occurred while performing the bill lookup',
        });
    }
});

// New endpoint for Post Receipt
router.post('/post-receipt', async (req, res) => {
    try {
        const {
            div_code,
            sub_section_items,
            bank_account,
            transfered_date,
            transfered_amount,
            transfered_ref1,
            transfered_ref2,
            tax_id,
            branch_id,
            customer_name,
            address_1,
            address_2,
            city_name,
            province_name,
            post_code,
        } = req.body;

        // Validate required fields
        if (
            !div_code || !sub_section_items || !bank_account || !transfered_date || 
            !transfered_amount || !transfered_ref1 || !transfered_ref2 || 
            !tax_id || branch_id === undefined || !customer_name || 
            !address_1 || !city_name || !province_name || !post_code
        ) {
            return res.status(400).json({ status: false, message: 'Missing required fields in request body' });
        }

        // Validate sub_section_items is an array
        if (!Array.isArray(sub_section_items) || sub_section_items.length === 0) {
            return res.status(400).json({ status: false, message: 'sub_section_items must be a non-empty array' });
        }

        // Prepare the request payload
        const payload = {
            div_code,
            sub_section_items,
            bank_account,
            transfered_date,
            transfered_amount,
            transfered_ref1,
            transfered_ref2,
            tax_id,
            branch_id,
            customer_name,
            address_1,
            address_2,
            city_name,
            province_name,
            post_code,
        };

        // Prepare headers and API URL
        const url = `https://fti-api-mg.azure-api.net/PostReceipt`;
        const headers = {
            'Clientid': 'f423b069-6c7c-4422-b4f6-9b438aa391f2',
            'Clientsecret': 'a653f1c1-a1b8-4f5a-b5ea-3e4bef4be14a',
            'Content-Type': 'application/json',
            'Ocp-Apim-Subscription-Key': '52bcf82678b346de824fed6f832d63a3',
        };

        // Make the POST request
        const response = await axios.post(url, payload, { headers });

        console.log("Response from PostReceipt API:", response.data);

        // Return the API response
        return res.status(200).json({
            status: true,
            message: 'Receipt posted successfully',
            data: response.data,
        });
    } catch (error) {
        console.error('Error in /post-receipt:', error);

        // Handle errors from the external API
        if (error.response) {
            return res.status(error.response.status).json({
                status: false,
                message: 'Error from external API',
                data: error.response.data,
            });
        }

        // Generic error handling
        return res.status(500).json({
            status: false,
            message: 'An error occurred while posting the receipt',
        });
    }
});

// Use error handling middleware
router.use(errorHandler);

module.exports = router;
