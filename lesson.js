const express = require('express');
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
const { authenticateClient, safeObjectId, errorHandler } = require('./routes/middleware/mongoMiddleware');
const axios = require('axios'); // For making HTTP requests
const { crossOriginResourcePolicy } = require('helmet');

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
                { 
                    $match: { 
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

        // Function to build the nested structure
        const buildNestedCategories = (categories) => {
            const map = {};
            const roots = [];

            // Create a map of categories by ID
            categories.forEach(category => {
                map[category._id] = { ...category, children: [] };
            });

            // Assign children to their parent categories
            categories.forEach(category => {
                if (category.parent) {
                    const parent = map[category.parent];
                    if (parent) {
                        parent.children.push(map[category._id]);
                    }
                } else {
                    roots.push(map[category._id]);
                }
            });

            return roots;
        };

        // Build the hierarchical structure
        const nestedCategories = buildNestedCategories(flatCategories);

        res.status(200).json({
            success: true,
            data: nestedCategories,
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
    const { site, page = 1, limit = 10, searchQuery = '', selectedCodes = [] } = req.body;

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
        const courseCollection = targetDb.collection('course');

        // Build the query object dynamically
        const query = { unit: siteIdString, status: true };

        // Apply search filter on multiple fields
        if (searchQuery) {
            query.$or = [
                { name: { $regex: searchQuery, $options: 'i' } },        // Search in `name`
                { description: { $regex: searchQuery, $options: 'i' } }, // Search in `description`
                { slug: { $regex: searchQuery, $options: 'i' } },        // Search in `slug`
            ];
        }

        // Apply category filter
        if (selectedCodes && selectedCodes.length > 0) {
            query.category = { $in: selectedCodes }; // Use `query` instead of `filter`
        }

        //console.log('Query:', JSON.stringify(query)); // Debug query object

        // Fetch all matching courses
        const allCourses = await courseCollection
            .find(query)
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

        // Calculate total items and pagination
        const totalItems = allCourses.length;
        const totalPages = Math.ceil(totalItems / limit);

        //console.log(`Total Items: ${totalItems}, Total Pages: ${totalPages}`);

        // Correct slicing logic
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit; // This ensures it gets the last item on the final page
        const paginatedCourses = allCourses.slice(startIndex, Math.min(endIndex, totalItems));

        //console.log(`Start Index: ${startIndex}, End Index: ${endIndex}`);
        // Handle cases where the requested page exceeds total pages
        if (page > totalPages) {
            return res.status(200).json({
                success: true,
                data: [],
                meta: {
                    totalItems,
                    totalPages,
                    currentPage: page,
                    limit,
                },
            });
        }

        // Send response
        res.status(200).json({
            success: true,
            data: paginatedCourses,
            meta: {
                totalItems,
                totalPages,
                currentPage: page,
                limit,
            },
        });
    } catch (error) {
        console.error('Error fetching courses:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while fetching courses.' });
    }
});

// Endpoint to fetch course details and related player data
router.post('/course/:id/:playerID?', async (req, res) => {
    const { id, playerID } = req.params;
    const { site, authen } = req.body;

    let user = null;

    // Authenticate user
    if (authen) {
        try {
            const decodedToken = await verifyToken(authen.replace('Bearer ', ''));
            if (!decodedToken.status) {
                return res.status(401).json({ status: false, message: 'Invalid or expired token' });
            }
            user = decodedToken.decoded.user;
        } catch (error) {
            console.warn('Token verification failed:', error.message);
            return res.status(401).json({ status: false, message: 'Invalid or expired token' });
        }
    }

    try {
        const courseId = safeObjectId(id);
        if (!courseId) {
            return res.status(400).json({ error: 'Invalid course ID format.' });
        }

        if (!site) {
            return res.status(400).json({ error: 'Site parameter is required.' });
        }

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const siteIdString = siteData._id.toString();
        const courseCollection = targetDb.collection('course');
        const playerCollection = targetDb.collection('player');
        const progressCollection = targetDb.collection('progress');
        const enrollCollection = targetDb.collection('enroll');

        // Fetch course details
        const course = await courseCollection.findOne({ _id: courseId, unit: siteIdString });
        if (!course) {
            return res.status(404).json({ error: 'Course not found.' });
        }

        const courseCategoryCodes = Array.isArray(course.category)
            ? course.category.filter((item) => item !== null && item !== undefined && item.trim() !== '')
            : [];

        const regexConditions = courseCategoryCodes.map((code) => ({
            code: { $regex: `^${code.trim()}$`, $options: 'i' }, // Enforce full-string matching
        }));
        
        const categoryDetails = await targetDb.collection('category')
        .aggregate([
            {
                $match: {
                    $or: regexConditions,
                },
            },
            {
                $group: {
                    _id: "$code", // Group by 'code'
                    name: { $first: "$name" }, // Keep the first 'name' for each 'code'
                    code: { $first: "$code" }, // Keep the first 'code' for each group
                },
            },
            {
                $project: { _id: 0, name: 1, code: 1 }, // Remove _id from the output
            },
        ])
        .toArray();
        
        // Step 1: Fetch the main players
        const mainPlayers = await playerCollection
            .find({ courseId: course.master, mode: { $ne: 'sub' } })
            .project({
                _id: 1,
                courseId: 1,
                type: 1,
                name: 1,
                order: 1,
                duration: 1,
                createdAt: 1,
                updatedAt: 1,
                demo: 1
            })
            .sort({ order: 1 })
            .toArray();

        //console.log("Main Players:", mainPlayers);

        // Step 2: Loop through main players and fetch children for folders
        const players = await Promise.all(
            mainPlayers.map(async (player) => {
                if (player.type === 'folder') {
                    // Fetch child items for this folder
                    const childItems = await playerCollection
                        .find({ mode: "sub", root: player._id.toString() })
                        .sort({ order: 1 })
                        .project({
                            _id: 1,
                            courseId: 1,
                            type: 1,
                            name: 1,
                            order: 1,
                            duration: 1,
                            createdAt: 1,
                            updatedAt: 1,
                            demo: 1,
                            mode: 1
                        })
                        .toArray();

                    // Add progress data to child items
                    const childItemsWithProgress = await Promise.all(
                        childItems.map(async (child) => {
                            const progressData = user
                                ? await progressCollection.findOne({
                                    courseID: course._id.toString(),
                                    userID: user,
                                    playerID: child._id.toString(),
                                })
                                : null;

                            return {
                                ...child,
                                isProgress: !!progressData,
                                progress: progressData ? {
                                    progress: progressData.progress,
                                    lastplay: progressData.lastplay,
                                    status: progressData.status,
                                    updatedAt: progressData.updatedAt,
                                } : null,
                            };
                        })
                    )
                    return { ...player, child: childItemsWithProgress };
                }

                // For non-folder players, add an empty child array
                return { ...player, child: [] };
            })
        );
        //console.log("display", course.display);
        // Fetch specific player if playerID is provided
        let player = null;
        if (playerID) {
            const specificPlayerId = safeObjectId(playerID);
            if (specificPlayerId) {
                // Fetch player data
                player = await playerCollection.findOne({ _id: specificPlayerId, courseId: course.master });

                if (!player) {
                    return res.status(404).json({ error: 'Player not found.' });
                }

                // Fetch progress for the specific player
                const progress = user
                    ? await progressCollection.findOne({
                        courseID: course._id.toString(),
                        userID: user,
                        playerID: specificPlayerId.toString(),
                    })
                    : null;

                // Add progress data to the player object
                if (progress) {
                    player.progress = {
                        id: progress._id,
                        progress: progress.progress,
                        lastplay: progress.lastplay,
                        status: progress.status,
                        updatedAt: progress.updatedAt,
                    };
                }
            } else {
                return res.status(400).json({ error: 'Invalid player ID format.' });
            }
        }

        // Fetch progress in bulk for all players
        const playerIds = players.map((player) => player._id.toString());
        const progress = user
            ? await progressCollection.find({
                courseID: course._id.toString(),
                userID: user,
                playerID: { $in: playerIds },
            }).toArray()
            : [];

        const mapProgressToPlayers = (players, progressData) => {
            return players.map((player) => {
                const playerProgress = progressData.find((p) => p.playerID === player._id.toString());
                const includeVideo = playerID && playerID === player._id.toString();

                const playerData = {
                    ...player,
                    isProgress: !!playerProgress,
                    //child: mapProgressToPlayers(player.child || [], progressData),
                };

                if (playerProgress) {
                    playerData.progress = {
                        progress: playerProgress.progress,
                        progress: playerProgress.progress,
                        lastplay: playerProgress.lastplay,
                        status: playerProgress.status,
                        updatedAt: playerProgress.updatedAt,
                    };
                }

                if (!includeVideo) {
                    delete playerData.video;
                }

                return playerData;
            });
        };

        const playersWithProgress = mapProgressToPlayers(players, progress);

        const assignIsPlay = (players, display) => {
            if (display === 'step') {
                let flatArray = []; // To store the flattened array
        
                const processPlayers = (playersList) => {
                    playersList.forEach(player => {
                        if (player.type === "folder") {
                            // Skip folders but still process their children
                            if (player.child && player.child.length > 0) {
                                processPlayers(player.child);
                            }
                            return; // Skip adding this folder to the flat array
                        }
        
                        let updatedPlayer = {
                            ...player,
                            isPlay: player.isProgress || false // Set isPlay = true if isProgress is true
                        };
                        flatArray.push(updatedPlayer);
        
                        // Recursively process children
                        if (updatedPlayer.child && updatedPlayer.child.length > 0) {
                            processPlayers(updatedPlayer.child);
                        }
                    });
                };
        
                processPlayers(players);
        
                // Reverse the array order
                flatArray = flatArray.reverse();
        
                // Assign `nextId` to each item
                for (let i = 0; i < flatArray.length; i++) {
                    flatArray[i].nextId = i < flatArray.length - 1 ? flatArray[i + 1]._id : null;
                }
        
                // Ensure items with isProgress = true and progress.status = "complete" have isPlay = true
                for (let i = 0; i < flatArray.length; i++) {
                    const currentItem = flatArray[i];
                    if (currentItem.isProgress && currentItem.progress?.status === 'complete') {
                        currentItem.isPlay = true;
                    }
                }
        
                // Loop through all items to check `nextId` conditions
                for (let i = 0; i < flatArray.length; i++) {
                    const currentItem = flatArray[i];
        
                    if (currentItem.nextId) {
                        // Find the next item using nextId
                        const nextItem = flatArray.find(item => item._id === currentItem.nextId);
        
                        // Check if the next item meets the conditions
                        if (
                            nextItem &&
                            nextItem.isProgress &&
                            nextItem.progress?.status === 'complete' &&
                            nextItem.isPlay
                        ) {
                            currentItem.isPlay = true;
                        }
                    }
                }
        
                // Check if all items have isProgress = false
                const allIsProgressFalse = flatArray.every(item => !item.isProgress);
                if (allIsProgressFalse && flatArray.length > 0) {
                    flatArray[flatArray.length - 1].isPlay = true; // Set the first item in the original order as isPlay = true
                }
        
                return flatArray;
            }
        
            if (display === 'full') {
                // For `full`, set `isPlay: true` for all items, including children
                return players.map(player => ({
                    ...player,
                    isPlay: true,
                    child: player.child ? assignIsPlay(player.child, display) : [],
                }));
            }
        
            return players; // Default case
        };
    
        const updatedPlayersWithPlay = assignIsPlay(playersWithProgress, course.display);

        const syncIsPlay = (playersWithProgress, updatedPlayersWithPlay) => {
            const isPlayMap = updatedPlayersWithPlay.reduce((map, player) => {
                map[player._id] = player.isPlay;
                return map;
            }, {});
        
            const updatePlayers = (players) => {
                return players.map(player => {
                    const isPlay = isPlayMap[player._id] || false;
                    const updatedPlayer = { ...player, isPlay };
        
                    if (player.child && player.child.length > 0) {
                        updatedPlayer.child = updatePlayers(player.child);
                    }
        
                    return updatedPlayer;
                });
            };
        
            return updatePlayers(playersWithProgress);
        };
        
        // Use the syncIsPlay function after assigning isPlay values
        const syncedPlayersWithProgress = syncIsPlay(playersWithProgress, updatedPlayersWithPlay);

         // Function to calculate counts and percentages
         const calculateCounts = (items) =>
            items.reduce(
                (acc, item) => {
                    if (item.type === 'folder' && item.child) {
                        const childCounts = calculateCounts(item.child);
                        acc.total += childCounts.total;
                        acc.complete += childCounts.complete;
                        acc.processing += childCounts.processing;
                    } else if (item.type !== 'folder') {
                        acc.total += 1;
                        if (item.progress?.status === 'complete') acc.complete += 1;
                        if (item.progress?.status === 'processing') acc.processing += 1;
                    }
                    return acc;
                },
                { total: 0, complete: 0, processing: 0 }
            );

        // Calculate counts from syncedPlayersWithProgress
        const counts = calculateCounts(syncedPlayersWithProgress);
        counts.completePercent = counts.total > 0
            ? ((counts.complete / counts.total) * 100).toFixed(2)
            : 0;

        // Fetch enrollment status
        const enrollment = user
            ? await enrollCollection.findOne({ courseID: course._id.toString(), userID: user })
            : null;

        // Format response
        const formattedResponse = {
            success: true,
            course: {
                id: course._id,
                name: course.name,
                slug: course.slug,
                category: categoryDetails,
                description: course.description,
                shortDescription: course.short_description,
                cover: course.cover,
                hours: course.hours,
                days: course.days,
                prices: {
                    regular: course.regular_price,
                    sale: course.sale_price,
                },
                meta: {
                    display: course.display,
                    type: course.type,
                    mode: course.mode,
                    status: course.status,
                    updatedAt: course.updatedAt,
                },
                isEnroll: !!enrollment,
            },
            playlist: syncedPlayersWithProgress,
            stats: {
                totalItems: counts.total,
                completeItems: counts.complete,
                processingItems: counts.processing,
                completePercent: counts.completePercent,
            },
            ...(enrollment && { enrollment }), // Add enrollment if present
            ...(player && { player }), // Add specific player data if present
        };

        res.status(200).json(formattedResponse);
    } catch (error) {
        console.error('Error fetching course and player data:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while fetching data.' });
    }
});

router.post('/progress/:option', async (req, res) => {
    const { option } = req.params; // Extract the option from the URL
    const { site, courseID, playerID, progressID, progress, lastplay, status, authen } = req.body;

    let user = null;

    // Authenticate user
    if (authen) {
        try {
            const decodedToken = await verifyToken(authen.replace('Bearer ', ''));
            if (!decodedToken.status) {
                return res.status(401).json({ status: false, message: 'Invalid or expired token' });
            }
            user = decodedToken.decoded.user; // Extract user ID from token
        } catch (error) {
            console.warn('Token verification failed:', error.message);
            return res.status(401).json({ status: false, message: 'Invalid or expired token' });
        }
    }

    if (!user) {
        return res.status(401).json({ error: 'User authentication failed. Token is required.' });
    }

    try {
        if (!site) {
            return res.status(400).json({ error: 'Site parameter is required.' });
        }

        if (!['new', 'update', 'pause', 'stop'].includes(option)) {
            return res.status(400).json({ error: 'Invalid option. Use "new", "update", "pause", or "stop".' });
        }

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const progressCollection = targetDb.collection('progress');

        if (option === 'new') {
            // Validation for "new" option
            if (!courseID || !playerID) {
                return res.status(400).json({ error: 'courseID and playerID are required for creating new progress.' });
            }
        
            // Check if progress already exists for the same user, course, and player
            const existingProgress = await progressCollection.findOne({ userID: user, courseID, playerID });
        
            if (existingProgress) {
                return res.status(409).json({
                    error: 'Progress already exists for the specified user, course, and player.',
                    data: { existingProgressId: existingProgress._id },
                });
            }
        
            // Construct the document for insertion
            const newProgress = {
                userID: user, // Use extracted user ID
                courseID,
                playerID,
                progress: 0,
                revise: 0,
                lastplay: 0,
                status: status || 'processing',
                createdAt: new Date(),
                updatedAt: new Date(),
            };
        
            // Insert the new progress document
            const result = await progressCollection.insertOne(newProgress);
        
            return res.status(201).json({
                success: true,
                message: 'Progress created successfully.',
                data: { insertedId: result.insertedId },
            });
        }

        if (option === 'update') {
            // Validation for "update" option
            if (!progressID) {
                return res.status(400).json({ error: 'progressID is required for updating progress.' });
            }

            // Construct the query
            const query = { _id: safeObjectId(progressID) };

            // Fetch the existing progress document
            const existingProgress = await progressCollection.findOne(query);

            if (!existingProgress) {
                return res.status(404).json({ error: 'Progress not found or invalid progressID.' });
            }

            // Determine the field to increment
            let updateField = {};
            if (existingProgress.status === 'processing') {
                updateField.progress = existingProgress.progress +5;
            } else if (existingProgress.status === 'complete') {
                updateField.revise = existingProgress.revise + 5;
            }

            // Update the progress document
            const update = {
                $set: {
                    ...updateField,
                    lastplay,
                    updatedAt: new Date(),
                },
            };

            // Update the progress document
            const result = await progressCollection.updateOne(query, update);

            return res.status(200).json({
                success: true,
                message: 'Updated successfully.',
            });
        }

        if (option === 'stop') {
            // Validation for "stop" option
            if (!progressID) {
                return res.status(400).json({ error: 'progressID is required for stopping progress.' });
            }

            // Construct the query and update object
            const query = { _id: safeObjectId(progressID) };
            const update = {
                $set: {
                    status: 'complete', // Set status to 'complete'
                    updatedAt: new Date(),
                },
            };

            // Update the progress document
            const result = await progressCollection.updateOne(query, update);

            if (result.matchedCount === 0) {
                return res.status(404).json({ error: 'Progress not found or invalid progressID.' });
            }

            return res.status(200).json({
                success: true,
                message: 'Stopped successfully.',
            });
        }
    } catch (error) {
        console.error('Error handling progress:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while processing the progress request.' });
    }
});



module.exports = router;
