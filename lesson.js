const express = require('express');
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
const { authenticateClient, safeObjectId, errorHandler } = require('./routes/middleware/mongoMiddleware');
const axios = require('axios'); // For making HTTP requests

const router = express.Router();

// Secret key for signing JWT (Use environment variables for security)
const JWT_SECRET = 'ZCOKU1v3TO2flcOqCdrJ3vWbWhmnZNQn';

// Middleware to authenticate client
router.use(authenticateClient);

// Function to verify token
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

// Function to generate JWT with adjustable expiration time
function generateJWT(userResponse, key, rememberMe) {
    const expiration = rememberMe ? '30d' : '24h'; // 30 days or 1 day
    const data = {
        user: userResponse._id,
        role: userResponse.role,
        site: key,
    };

    const token = jwt.sign(data, JWT_SECRET, { expiresIn: expiration });
    return { token, data };
}

// Function to get site-specific database and collection
async function getSiteSpecificDb(client, site) {
    const apiDb = client.db('API');
    const siteCollection = apiDb.collection('hostname');
    const siteData = await siteCollection.findOne({ hostname: site });

    if (!siteData) {
        throw new Error(`Invalid site ID. Site not found: ${site}`);
    }

    const targetDb = client.db(siteData.key);
    const userCollection = targetDb.collection('user');
    return { targetDb, userCollection, siteData };
}

// Function to retrieve hostname data
const getHostname = async (hostname) => {
    const client = new MongoClient(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });

    try {
        await client.connect();
        const db = client.db('API');
        const clientsCollection = db.collection('hostname');
        return await clientsCollection.findOne({ hostname });
    } finally {
        await client.close();
    }
};

// New endpoint to fetch data from the 'category' collection
router.post('/categories', async (req, res) => {
    const { site } = req.body;

    try {
        if (!site) {
            return res.status(400).json({ error: 'Site parameter is required' });
        }

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        // Convert siteData._id to a string
        const siteIdString = siteData._id.toString();

        // Access the 'category' collection
        const categoryCollection = targetDb.collection('category');
        const courseCollection = targetDb.collection('course');

        // Query for all categories (main and subcategories)
        const allCategories = await categoryCollection
            .find({ unit: siteIdString })
            .project({ _id: 1, name: 1, code: 1, description: 1, type: 1, parent: 1 })
            .toArray();

        // Query for course counts grouped by category codes
        const courseCounts = await courseCollection
            .aggregate([
                { $match: { 
                    unit: siteIdString,
                    status: true, // Only include active courses
                    },
                }, // Match courses within the site
                { $unwind: '$category' }, // Unwind category array for individual codes
                {
                    $group: {
                        _id: '$category',
                        count: { $sum: 1 }, // Count courses for each category code
                    },
                },
            ])
            .toArray();

        // Create a mapping of category codes to counts
        const courseCountMap = courseCounts.reduce((map, item) => {
            map[item._id] = item.count;
            return map;
        }, {});

        // Convert all categories into a flat list with parent-child relationships
        const flatCategories = allCategories.map((category) => ({
            _id: category._id,
            name: category.name,
            code: category.code,
            type: category.type,
            parent: category.type === 'main' ? null : category.parent, // `null` for main categories, use `parent` for subcategories
            count: courseCountMap[category.code] || 0, // Add course count (default to 0 if no courses found)
        }));

        res.status(200).json({
            success: true,
            data: flatCategories,
        });
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({
            error: 'An error occurred while fetching categories.',
        });
    }
});

// New endpoint to fetch courses
router.post('/course', async (req, res) => {
    const { site } = req.body;

    try {
        if (!site) {
            return res.status(400).json({ error: 'Site parameter is required' });
        }

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const siteIdString = siteData._id.toString();

        // Access the 'course' collection
        const courseCollection = targetDb.collection('course');

        // Query for all courses with relevant fields
        const courses = await courseCollection
            .find({ unit: siteIdString, status: true }) // Only active courses
            .project({
                _id: 1,
                name: 1,
                slug: 1,
                lecturer: 1,
                hours: 1,
                days: 1,
                category: 1,
                type: 1,
                mode: 1,
                display: 1,
                regular_price: 1,
                sale_price: 1,
                description: 1,
                short_description: 1,
                cover: 1,
                lesson_type: 1,
                status: 1,
                updatedAt: 1,
            })
            .toArray();

        res.status(200).json({
            success: true,
            data: courses,
        });
    } catch (error) {
        console.error('Error fetching courses:', error);
        res.status(500).json({
            error: 'An error occurred while fetching courses.',
        });
    }
});



module.exports = router;
