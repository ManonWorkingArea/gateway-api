const express = require('express');
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
const { authenticateClient, safeObjectId, errorHandler } = require('./routes/middleware/mongoMiddleware');
const axios = require('axios'); // For making HTTP requests
const { crossOriginResourcePolicy } = require('helmet');
const CryptoJS = require('crypto-js');
const router = express.Router();
const fetch = require('node-fetch'); // Ensure this package is installed

const { redisClient } = require('./routes/middleware/redis');  // Import Redis helpers

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

// Middleware to authenticate user and return user ID
async function authenticateUserToken(authen, res) {
    if (!authen) {
        return { status: false, response: res.status(401).json({ status: false, message: 'Authentication token is required.' }) };
    }

    try {
        const decodedToken = await verifyToken(authen.replace('Bearer ', ''));
        if (!decodedToken.status) {
            return { status: false, response: res.status(401).json({ status: false, message: 'Invalid or expired token.' }) };
        }
        return { status: true, user: decodedToken.decoded.user };
    } catch (error) {
        console.warn('Token verification failed:', error.message);
        return { status: false, response: res.status(401).json({ status: false, message: 'Invalid or expired token.' }) };
    }
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

// Define your secret key
const SALT_KEY = '4KLj7y[Am@/}+J{C1S`k*>qts81HV[>>Q|Qk8*gwv./ij#R.%q=gb<TMh>d*Kn-:';

// Decrypt function
const decrypt = (encryptedText) => {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedText, SALT_KEY);
    return JSON.parse(bytes.toString(CryptoJS.enc.Utf8)); // Parse decrypted JSON
  } catch (error) {
    throw new Error('Decryption failed'); // Handle decryption errors
  }
};

const getDbCollections = async (client, site, collections) => {
    const db = client.db((await client.db('API').collection('hostname').findOne({ hostname: site })).key);
    return collections.reduce((acc, col) => (acc[col] = db.collection(col), acc), {});
};

const handleResponse = (res, promise) => {
    promise
        .then(data => res.status(200).json({ success: true, data }))
        .catch(err => res.status(500).json({ success: false, message: err.message }));
};

const getAnalytics = async (targetDb, courseId, userId) => {
    // Fetch the course
    const course = await targetDb.collection('course').findOne({ _id: safeObjectId(courseId) });
    if (!course) {
        throw new Error('Course not found');
    }

    // Fetch all players associated with the course
    const coursePlayers = await targetDb.collection('player')
        .find({ courseId: course.master })
        .toArray();

    // Fetch progress data for the user and course
    const playerIds = coursePlayers.map((player) => player._id.toString());
    const progressData = await targetDb.collection('progress')
        .find({
            courseID: course._id.toString(),
            playerID: { $in: playerIds },
            userID: userId,
        })
        .toArray();

    // Map progress data to players
    const mapProgressToPlayers = (players, progressData) => {
        return players.map((player) => {
            const playerProgress = progressData.find((p) => p.playerID === player._id.toString());
            return {
                ...player,
                isProgress: !!playerProgress,
                progress: playerProgress
                    ? {
                        progress: playerProgress.progress,
                        lastplay: playerProgress.lastplay,
                        status: playerProgress.status,
                        updatedAt: playerProgress.updatedAt,
                    }
                    : null,
            };
        });
    };

    const playersWithProgress = mapProgressToPlayers(coursePlayers, progressData);

    // Calculate counts and percentages
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
                    // Include both "complete" and "revising" statuses in the complete count
                    if (item.progress?.status === 'complete' || item.progress?.status === 'revising') {
                        acc.complete += 1;
                    }
                    if (item.progress?.status === 'processing') {
                        acc.processing += 1;
                    }
                }
                return acc;
            },
            { total: 0, complete: 0, processing: 0 }
        );

    const counts = calculateCounts(playersWithProgress);
    counts.completePercent = counts.total > 0
        ? ((counts.complete / counts.total) * 100).toFixed(2)
        : 0;

    const analytics = {
        total: counts.total,
        complete: counts.complete,
        processing: counts.processing,
        percent: counts.completePercent,
    };

    // Pass analytics to updateEnrollAnalytics
    await updateEnrollAnalytics(targetDb, courseId, userId, analytics);

    return { analytics };
};

const updateEnrollAnalytics = async (targetDb, courseId, userId, analytics) => {
    try {
        //("Analytics Data:", analytics);

        // Fetch the enrollment document for the user and course
        const enrollment = await targetDb.collection('enroll').findOne({ courseID: courseId, userID: userId });
        if (!enrollment) {
            throw new Error('Enrollment not found for the specified course and user.');
        }

        // Adjust `complete` count to include `revising` as a valid completion level
        const adjustedComplete = analytics.complete;

        // Map the analytics data to the enrollment format
        const updatedAnalytics = {
            total: analytics.total,
            pending: analytics.total - (analytics.processing + adjustedComplete),
            processing: analytics.processing,
            complete: adjustedComplete,
            percent: analytics.percent,
            status: adjustedComplete === analytics.total
                ? 'complete'
                : analytics.processing > 0
                ? 'processing'
                : adjustedComplete > 0
                ? 'revising'
                : 'pending', // Treat `revising` as intermediate if progress exists
            message: adjustedComplete === analytics.total
                ? 'คุณได้เรียนครบทุกบทเรียนเรียบร้อยแล้ว'
                : analytics.processing > 0
                ? 'คุณกำลังอยู่ระหว่างการเรียน'
                : adjustedComplete > 0
                ? 'คุณกำลังอยู่ระหว่างการทบทวนบทเรียน'
                : 'คุณยังไม่ได้เริ่มต้นการเรียน', // Update message for 'revising'
        };

        console.log("Enrollment ID:", enrollment._id);

        // Update the enrollment document with the new analytics
        const result = await targetDb.collection('enroll').updateOne(
            { _id: enrollment._id },
            {
                $set: {
                    'analytics.total': updatedAnalytics.total,
                    'analytics.pending': updatedAnalytics.pending,
                    'analytics.processing': updatedAnalytics.processing,
                    'analytics.complete': updatedAnalytics.complete,
                    'analytics.percent': updatedAnalytics.percent,
                    'analytics.status': updatedAnalytics.status,
                    'analytics.message': updatedAnalytics.message,
                    updatedAt: new Date(),
                },
            }
        );

        return result.modifiedCount > 0;
    } catch (error) {
        console.error("Error updating enrollment analytics:", error.message);
        throw error;
    }
};

router.post('/categories', async (req, res) => {
    const { site } = req.body;

    try {
        if (!site) { return res.status(400).json({ error: 'Site parameter is required' }); }

        const cacheKey = `categories:${site}`;
        const cachedCategories = await redisClient.get(cacheKey);

        if (cachedCategories) {
            console.log('DAT :: Redis');
            return res.status(200).json({ success: true, data: JSON.parse(cachedCategories), cache: true });
        }
        console.log('DAT :: MongoDB');
        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const siteIdString = siteData._id.toString();
        const { category, course } = await getDbCollections(client, site, ['category', 'course']);

        const allCategories = await category
            .find({ unit: siteIdString })
            .project({ _id: 1, name: 1, code: 1, description: 1, type: 1, parent: 1 })
            .toArray();

        const courseCounts = await course
            .aggregate([
                { $match: { unit: siteIdString, status: true } },
                { $unwind: '$category' },
                { $group: { _id: '$category', count: { $sum: 1 } } }
            ])
            .toArray();

        const courseCountMap = courseCounts.reduce((map, item) => {
            map[item._id] = item.count;
            return map;
        }, {});

        const flatCategories = allCategories.map((category) => ({
            _id: category._id,
            name: category.name,
            code: category.code,
            type: category.type,
            parent: category.type === 'main' ? null : category.parent,
            count: courseCountMap[category.code] || 0,
        }));

        const buildNestedCategories = (categories) => {
            const map = {};
            const roots = [];

            categories.forEach(category => {
                map[category._id] = { ...category, children: [] };
            });

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

        const nestedCategories = buildNestedCategories(flatCategories);
        await redisClient.setEx(cacheKey, 3600, JSON.stringify(nestedCategories));

        res.status(200).json({ success: true, data: nestedCategories, cache: false });
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ error: 'An error occurred while fetching categories.' });
    }
});

router.post('/course', async (req, res) => {
    const { site, page = 1, limit = 10, searchQuery = '', selectedCodes = [] } = req.body;

    try {
        if (!site) {
            return res.status(400).json({ error: 'Site parameter is required' });
        }

        const cacheKey = `courses:${site}`;
        const cachedCourses = await redisClient.get(cacheKey);

        if (cachedCourses) {
            console.log('DAT :: Redis');
            const parsedCourses = JSON.parse(cachedCourses);
            const totalItems = parsedCourses.length;
            const totalPages = Math.ceil(totalItems / limit);
            const paginatedCourses = parsedCourses.slice((page - 1) * limit, page * limit);

            return res.status(200).json({
                success: true,
                data: paginatedCourses,
                meta: {
                    totalItems,
                    totalPages,
                    currentPage: page,
                    limit
                },
                cache: true
            });
        }

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const siteIdString = siteData._id.toString();
        const { course } = await getDbCollections(client, site, ['course']);

        const query = { unit: siteIdString, status: true };

        if (searchQuery) {
            query.$or = [
                { name: { $regex: searchQuery, $options: 'i' } },
                { description: { $regex: searchQuery, $options: 'i' } },
                { slug: { $regex: searchQuery, $options: 'i' } },
            ];
        }

        if (Array.isArray(selectedCodes) && selectedCodes.length > 0) {
            query.category = { $in: selectedCodes };
        }

        console.log('DAT :: MongoDB');
        const allCourses = await course
            .find(query)
            .project({
                _id: 1, name: 1, slug: 1, lecturer: 1, hours: 1, days: 1,
                category: 1, type: 1, mode: 1, display: 1,
                regular_price: 1, sale_price: 1,
                description: 1, short_description: 1,
                cover: 1, lesson_type: 1, status: 1, updatedAt: 1
            })
            .toArray();

        const totalItems = allCourses.length;
        const totalPages = Math.ceil(totalItems / limit);
        const paginatedCourses = allCourses.slice((page - 1) * limit, page * limit);

        const response = {
            success: true,
            data: paginatedCourses,
            meta: {
                totalItems,
                totalPages,
                currentPage: page,
                limit
            },
            cache: false
        };

        await redisClient.setEx(cacheKey, 3600, JSON.stringify(allCourses));

        res.status(200).json(response);
    } catch (error) {
        console.error('Error fetching courses:', error.message);
        res.status(500).json({ error: 'An error occurred while fetching courses.' });
    }
});


// Endpoint to fetch course details and related player data
router.post('/course/:id/:playerID?', async (req, res) => {
    const { id, playerID } = req.params;
    const { site, authen } = req.body;

    // Authen User Middleware
    // Authen User Middleware (optional)
    let user = null;
    if (authen) {
        const authResult = await authenticateUserToken(authen, res);
        if (authResult.status) {
            user = authResult.user;
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

        const cacheKey = `playerData:${courseId}`;
        const cachedPlayerData = await redisClient.get(cacheKey);

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const siteIdString = siteData._id.toString();
        console.log("siteData",siteData.theme.checkout);
        const courseCollection = targetDb.collection('course');
        const playerCollection = targetDb.collection('player');
        const progressCollection = targetDb.collection('progress');
        const enrollCollection = targetDb.collection('enroll');
        const orderCollection = targetDb.collection('order');
        const surveySubmissionCollection = targetDb.collection('survey_submission');

        // Fetch course details
        const course = await courseCollection.findOne({ _id: courseId, unit: siteIdString });
        if (!course) {
            return res.status(404).json({ error: 'Course not found.' });
        }

        // Check for existing order if course is paid
        let isOrder = false;
        let isPaid  = false; // Initialize isPaid flag
        let order   = null;

        if (course.sale_price > 0) {
            order = await orderCollection.findOne({ courseID: course._id.toString(), userID: user });
            isOrder = !!order;

            // Check if the order exists and its status is 'processing'
            if (order && order.status === 'complete') {
                isPaid = true; // Set isPaid to true
            }
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
        
        // Step 1: Fetch the main players with index
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

        // Step 2: Loop through main players and fetch children for folders with indexing
        const players = await Promise.all(
        mainPlayers.map(async (player, index) => {
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

                // Add progress data and index to child items
                const childItemsWithProgress = await Promise.all(
                    childItems.map(async (child, subIndex) => {
                        const progressData = user
                            ? await progressCollection.findOne({
                                courseID: course._id.toString(),
                                userID: user,
                                playerID: child._id.toString(),
                            })
                            : null;

                        return {
                            ...child,
                            index: `${index + 1}.${subIndex + 1}`,
                            isProgress: !!progressData,
                            progress: progressData ? {
                                progress: progressData.progress,
                                lastplay: progressData.lastplay,
                                status: progressData.status,
                                updatedAt: progressData.updatedAt,
                            } : null,
                        };
                    })
                );

                return { ...player, index: `${index + 1}`, child: childItemsWithProgress };
            }

            // For non-folder players, add an empty child array with index
            return { ...player, index: `${index + 1}`, child: [] };
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
                        revise: progress.revise,
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
                        revise: playerProgress.revise,
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
                        if (item.progress?.status === 'complete' || item.progress?.status === 'revising') {
                            acc.complete += 1; // Include both complete and revising in complete count
                        }
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


        const findLatestUpdatedAt = (items) => {
            let latestDate = null;
        
            const checkDate = (date) => {
                const current = new Date(date);
                if (!latestDate || current > new Date(latestDate)) {
                    latestDate = date;
                }
            };
        
            const traverse = (list) => {
                list.forEach((item) => {
                    if (item.updatedAt) checkDate(item.updatedAt);
                    if (item.progress?.updatedAt) checkDate(item.progress.updatedAt);
                    if (item.child && item.child.length > 0) traverse(item.child);
                });
            };
        
            traverse(items);
            return latestDate;
        };
        
        // Example usage
        const latestUpdatedAt = findLatestUpdatedAt(syncedPlayersWithProgress);

        // Fetch enrollment status
        const enrollment = user
            ? await enrollCollection.findOne({ courseID: course._id.toString(), userID: user })
            : null;

            counts.completePercent = counts.total > 0
            ? ((counts.complete / counts.total) * 100).toFixed(2)
            : 0;

        // Determine `isComplete` based on counts
        const isComplete = counts.complete === counts.total;

        // Fetch exam data linked to the course.master
        const examCollection = targetDb.collection('exam');
        const scoreCollection = targetDb.collection('score');

        const examData = await examCollection.find({ courseId: course.master }).toArray();

        //console.log("examData",examData);

        const contest = {};
        if (examData.length > 0) {
            for (const exam of examData) {
                if (['pre', 'post', 'retest'].includes(exam.type)) {
                    // Initialize exam structure dynamically based on exam type
                    contest[exam.type] = {
                        id: exam._id.toString(),
                        name: exam.name,
                        timer: {
                            minute: exam.timer,
                            total: exam.total
                        },
                        meta: {
                            measure: exam.measure,
                            result: exam.result,
                            result_duedate: exam.result_duedate,
                            show: exam.show,
                            adminmode: exam.adminmode,
                            is_repeat: exam.is_repeat,
                            is_score: exam.is_score,
                            is_answer_shuffle: exam.is_answer_shuffle,
                            is_question_shuffle: exam.is_question_shuffle,
                        },
                        type: exam.type,
                        verified: exam.verified
                    };

                    // Fetch score data if the user is authenticated
                    if (user) {
                        const scoreData = await scoreCollection.findOne({
                            examID: exam._id.toString(),
                            userID: user,
                            status: true
                        });

                        // Attach score to the exam data if found
                        if (scoreData) {
                            contest[exam.type].score = {
                                status: scoreData.status,
                                result: scoreData.score,
                                remark: scoreData.remark,
                                startTime: scoreData.startTime,
                                submitTime: scoreData.submitTime,
                                createdAt: scoreData.createdAt,
                            };
                            // Determine if the user passed based on the 'measure' value
                            contest[exam.type].hasResult = scoreData.score >= parseInt(exam.measure);
                            contest[exam.type].hasScore = true;
                        } else {
                            // If no score, set hasScore to false
                            contest[exam.type].hasResult = false;
                            contest[exam.type].hasScore = false;
                        }
                    } else {
                        // If user not authenticated, set hasScore to false
                        contest[exam.type].hasResult = false;
                        contest[exam.type].hasScore = false;
                    }
                }
            }
        }

        const surveyCollection = targetDb.collection('survey');
        let surveyData = null;

        if (course.survey === 'yes' && course.surveyId) {
            surveyData = await surveyCollection.findOne({ _id: safeObjectId(course.surveyId) });
        }

        // Fetch user survey submission
        const surveySubmission = await surveySubmissionCollection.findOne({
            userId: user,
            courseId: courseId.toString(),
            surveyId: course.surveyId
        });

        // Merge survey data with submission status
        if (surveySubmission) {
            surveyData = { ...surveySubmission.survey, isSubmit: true };
        } else if (surveyData) {
            surveyData.isSubmit = false;
        }

        let formData = null;

        // Fetch form data if course type is 'onsite' and formID exists
        if (course.formID) {
            const postCollection = targetDb.collection('post');
            formData = await postCollection.findOne({ _id: safeObjectId(course.formID) });
        }

        // OR if you need only a boolean flag for `isForm`:
        const isForm = enrollment?.submitID ? false : !!formData; // isForm is false if enrollment has submitID

        let submitFormData = null; // To store form data fetched by submitID

        if (enrollment) {
            enrollID = enrollment._id;
        
            // If enrollment has submitID, fetch corresponding form data
            if (enrollment.submitID) {
                const formCollection = targetDb.collection('form');
                submitFormData = await formCollection.findOne({ _id: safeObjectId(enrollment.submitID) });
            }
        } else {
            enrollID = null;
        }

        // Fetch data if isPay = true
        let checkoutData = null;

        if (!isForm && course.sale_price > 0) {
            // Fetch data from the 'post' collection using the siteData.theme.checkout key
            const postCollection = targetDb.collection('post');
            const checkoutKey = siteData?.theme?.checkout; // Get the 'checkout' key from siteData
            if (checkoutKey) {
                checkoutData = await postCollection.findOne({ _id: safeObjectId(checkoutKey) });
            }
        }

        console.log("checkoutData",checkoutData);

        const courseProperties = await calculateCoursePropertiesById(courseId, user, targetDb);

        console.log("courseProperties",courseProperties);

         // Fetch schedule data for onsite courses
         let scheduleData = null;
         if (course.type === 'onsite') {
             const scheduleCollection = targetDb.collection('schedule');
             scheduleData = await scheduleCollection
                 .find({ courseId: courseId.toString(), parent: siteIdString })
                 .sort({ date: 1 }) // Assuming schedules have a 'date' field for sorting
                 .toArray();
         }
         console.log("courseId",courseId.toString());
         console.log("parent",siteIdString);

         console.log("scheduleData",scheduleData);

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
                    regular: course.regular_price || 0,
                    sale: course.sale_price || 0,
                },
                certification: {
                    has: course.certification,
                    template: course.certification_template,
                    type: course.certification_type,
                    id: course.certificationId,
                },
                survey: {
                    has: course.survey,
                    id: course.surveyId,
                },
                meta: {
                    display: course.display,
                    type: course.type,
                    mode: course.mode,
                    status: course.status,
                    updatedAt: course.updatedAt,
                    playlistUpdatedAt: latestUpdatedAt,
                    enrollID,
                    submitID: enrollment?.submitID || null, // Include submitID if available
                },
                isEnroll: !! enrollment,
                isSurvey: !! surveyData,
                isComplete,
                isForm,
                isPay: !isForm && course.sale_price > 0 && !isPaid, // New logic for isPay
                isOrder,
                isPaid
            },
            ...(course.type === 'onsite' && scheduleData && { schedule: scheduleData }), // Include schedule data for onsite courses
            playlist: syncedPlayersWithProgress,
            analytics: {
                total: counts.total,
                complete: counts.complete,
                processing: counts.processing,
                percent: counts.completePercent,
            },
            survey: course.survey === 'yes' && surveyData
            ? {
                id: surveyData._id,
                name: surveyData.name,
                description: surveyData.description,
                choiceGroups: surveyData.choiceGroups.map(group => ({
                    groupName: group.groupName,
                    groupType: group.groupType,
                    choices: group.choices.map(choice => ({
                        choiceText: choice.choiceText,
                        type: choice.type,
                        isRequested: choice.isRequested
                    }))
                })),
                score: surveyData.score,
                labels: surveyData.label,
                createdAt: surveyData.createdAt,
                updatedAt: surveyData.updatedAt,
                isSubmit: surveyData.isSubmit
            }
            : {
                has: course.survey,
                id: course.surveyId,
            },
            ...(enrollment && { 
                enrollment: { 
                    ...enrollment, 
                    submit: submitFormData || null // Add submitFormData into enrollment
                }
            }),
            ...(player && { player }), // Add specific player data if present
            ...(Object.keys(contest).length > 0 && { contest }),
            ...(formData && { form: formData }), // Add form data if available
            ...(checkoutData && { checkout: checkoutData }), // Include checkout data if fetched
            ...(isOrder && { order }),
        };        

        res.status(200).json(formattedResponse);
    } catch (error) {
        console.error('Error fetching course and player data:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while fetching data.' });
    }
});

const calculateCoursePropertiesById = async (courseId, userId, targetDb) => {
    const enrollCollection = targetDb.collection('enroll');
    const surveyCollection = targetDb.collection('survey');
    const postCollection = targetDb.collection('post');

    // Fetch course details
    const course = await targetDb.collection('course').findOne({ _id: safeObjectId(courseId) });
    if (!course) throw new Error('Course not found.');

    // Fetch enrollment details
    const enrollment = userId
        ? await enrollCollection.findOne({ courseID: courseId.toString(), userID: userId })
        : null;

    // Fetch survey details
    const surveyData = course.survey === 'yes' && course.surveyId
        ? await surveyCollection.findOne({ _id: safeObjectId(course.surveyId) })
        : null;

    // Fetch form data if necessary
    let formData = null;
    if (course.formID) {
        formData = await postCollection.findOne({ _id: safeObjectId(course.formID) });
    }

    // Calculate properties
    const isEnroll = !!enrollment;
    const isSurvey = !!surveyData;
    const isForm = enrollment?.submitID ? false : !!formData; // isForm is false if enrollment has submitID
    const isPay = !isForm && course.sale_price > 0; // Logic for paid courses
    const isComplete = enrollment?.analytics?.percent === 100 || false; // Example completion logic

    return {
        isEnroll,
        isSurvey,
        isForm,
        isPay,
        isComplete,
    };
};

router.post('/reset/:id', async (req, res) => {
    const { id } = req.params;
    const { site, authen } = req.body;
    console.log("id",id);
    const courseId = id;
    try {
        if (!courseId) {
            return res.status(400).json({ error: 'Course ID is required.' });
        }

        if (!site) {
            return res.status(400).json({ error: 'Site parameter is required.' });
        }

        // Authenticate user
        const authResult = await authenticateUserToken(authen, res);
        if (!authResult.status) return authResult.response;
        const user = authResult.user;

        if (!user) {
            return res.status(401).json({ error: 'User authentication failed. Token is required.' });
        }

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const progressCollection = targetDb.collection('progress');
        const scoreCollection = targetDb.collection('score');
        const formCollection = targetDb.collection('form');
        const enrollCollection = targetDb.collection('enroll');
        const orderCollection = targetDb.collection('order');

        // Convert courseId to ObjectId
        //const courseObjectId = safeObjectId(courseId);

        console.log("courseId",courseId);
        // Remove progress
        const progressResult = await progressCollection.deleteMany({
            courseID: courseId,
            userID: user,
        });

        // Remove scores
        const scoreResult = await scoreCollection.deleteMany({
            courseID: courseId,
            userID: user,
        });

        // Remove form submissions
        const formResult = await formCollection.deleteMany({
            courseID: courseId,
            userID: user,
        });

        // Remove order submissions
        const orderResult = await orderCollection.deleteMany({
            courseID: courseId,
            userID: user,
        });

        // Remove enrollment
        const enrollResult = await enrollCollection.deleteMany({
            courseID: courseId,
            userID: user,
        });

        res.status(200).json({
            success: true,
            message: 'User data for the course has been reset successfully.',
            details: {
                progressDeleted: progressResult.deletedCount,
                scoresDeleted: scoreResult.deletedCount,
                formsDeleted: formResult.deletedCount,
                enrollmentsDeleted: enrollResult.deletedCount,
                orderDeleted: orderResult.deletedCount,
            },
        });
    } catch (error) {
        console.error('Error resetting user data for the course:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while resetting user data for the course.' });
    }
});

// Endpoint to fetch course details with score, exam, and answer data including questions
router.post('/assessment/:id/:exam?', async (req, res) => {
    const { id, exam } = req.params;
    const { site, authen } = req.body;

    // Authen User Middleware
    const authResult = await authenticateUserToken(authen, res);
    if (!authResult.status) return authResult.response;
    const user = authResult.user;

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

        const courseCollection = targetDb.collection('course');
        const enrollCollection = targetDb.collection('enroll');
        const scoreCollection = targetDb.collection('score');
        const examCollection = targetDb.collection('exam');
        const questionCollection = targetDb.collection('questions');
        const answerCollection = targetDb.collection('answer');

        // Fetch course details
        const course = await courseCollection.findOne({ _id: courseId, unit: siteData._id.toString() });
        if (!course) {
            return res.status(404).json({ error: 'Course not found.' });
        }

        const categoryDetails = await targetDb.collection('category')
            .find({ code: { $in: course.category || [] } })
            .project({ _id: 0, name: 1, code: 1 })
            .toArray();

        // Fetch enrollment status
        const enrollment = user
            ? await enrollCollection.findOne({ courseID: course._id.toString(), userID: user })
            : null;

        // Fetch score data (filtered by exam ID if provided)
        const scoreQuery = { courseID: course._id.toString(), userID: user };
        if (exam) {
            scoreQuery.examID = exam;
        }

        const scoreData = user
            ? await scoreCollection.find(scoreQuery).toArray()
            : [];

        // Fetch exam data by exam ID
        const examData = exam
        ? await examCollection.findOne({ _id: safeObjectId(exam) })
        : null;

        let contest = {};

        if (examData && examData._id) {
            // Fetch questions for the exam
            const questions = await questionCollection.find({ examID: examData._id.toString() }).toArray();

            // Fetch answers for each question
            const questionsWithAnswers = await Promise.all(
                questions.map(async (question) => {
                    if (!question._id) return null;
                    const answers = await answerCollection.find({ questionID: question._id.toString() }).toArray();
                    return {
                        _id: question._id.toString(),
                        text: question.detail,
                        type: question.type,
                        order: question.order,
                        correct: question.correct,
                        createdAt: question.createdAt,
                        updatedAt: question.updatedAt,
                        options: answers.filter(answer => answer && answer._id).map(answer => ({
                            _id: answer._id.toString(),
                            label: answer.detail,
                            order: answer.order,
                            createdAt: answer.createdAt,
                            updatedAt: answer.updatedAt
                        }))
                    };
                })
            ).then(results => results.filter(q => q !== null));

            contest = {
                id: examData._id.toString(),
                name: examData.name,
                timer: {
                    minute: examData.timer,
                    total: examData.total
                },
                meta: {
                    measure: examData.measure,
                    result: examData.result,
                    result_duedate: examData.result_duedate,
                    show: examData.show,
                    adminmode: examData.adminmode,
                    is_repeat: examData.is_repeat,
                    is_score: examData.is_score,
                    is_answer_shuffle: examData.is_answer_shuffle,
                    is_question_shuffle: examData.is_question_shuffle,
                },
                type: examData.type,
                verified: examData.verified,
                questions: questionsWithAnswers
            };

            if (user) {
                const scoreData = await scoreCollection.findOne({
                    examID: examData._id.toString(),
                    userID: user,
                    status: true
                });

                if (scoreData) {
                    contest.score = {
                        id: scoreData._id.toString(),
                        answer: scoreData.answer,
                        result: scoreData.score,
                        remark: scoreData.remark,
                        startTime: scoreData.startTime,
                        submitTime: scoreData.submitTime,
                        createdAt: scoreData.createdAt,
                    };
                    contest.hasScore = scoreData.score >= parseInt(examData.measure);
                } else {
                    contest.hasScore = false;
                }
            } else {
                contest.hasScore = false;
            }
        } else {
            console.error('Error: examData is undefined or examData._id is missing');
        }

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
                certification: {
                    has: course.certification,
                    template: course.certification_template,
                    type: course.certification_type,
                    id: course.certificationId,
                },
                survey: {
                    has: course.survey,
                    id: course.surveyId,
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
            ...(enrollment && { enrollment }),
            scores: scoreData,
            ...(Object.keys(contest).length > 0 && { contest })
        };

        res.status(200).json(formattedResponse);
    } catch (error) {
        console.error('Error fetching course data:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while fetching data.' });
    }
});

router.post('/score/submit', async (req, res) => {
    try {
        const decryptedData = decrypt(req.body.data);
        const { site, examID, courseID, score, remark, startTime, submitTime, answer, authen, status } = decryptedData;

        // Authen User Middleware
        const authResult = await authenticateUserToken(authen, res);
        if (!authResult.status) return authResult.response;
        const user = authResult.user;

        if (!user) {
            return res.status(401).json({ error: 'User authentication failed. Token is required.' });
        }

        if (!site || !examID || !courseID || score === undefined || !answer) {
            return res.status(400).json({ error: 'Site, examID, courseID, score, and answer parameters are required.' });
        }

        //console.log("user",user)

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const scoreCollection = targetDb.collection('score');

        // Check if a score record already exists
        const existingScore = await scoreCollection.findOne({ examID, userID: user, status:true });

        if (existingScore) {
            return res.status(409).json({ error: 'Score already recorded for this exam and user.' });
        }

        // Insert new score record with answer data
        const newScore = {
            examID,
            userID: user,
            courseID,
            score,
            remark: remark || '',
            startTime: startTime ? new Date(startTime) : null,
            submitTime: submitTime ? new Date(submitTime) : new Date(),
            answer,
            status,
            createdAt: new Date(),
        };

        const result = await scoreCollection.insertOne(newScore);

        res.status(201).json({
            success: true,
            message: 'Score and answer recorded successfully.',
            data: { insertedId: result.insertedId },
        });
    } catch (error) {
        console.error('Error recording score and answer:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while recording the score and answer.' });
    }
});

// Endpoint to update the score status
router.post('/score/status', async (req, res) => {
    try {
        // Decrypt the data from the request body
        const decryptedData = decrypt(req.body.data);
        //console.log("decryptedData", decryptedData);

        // Extract properties from the decrypted data
        const { site, scoreID, newStatus, authen } = decryptedData;

        // Authen User Middleware
        const authResult = await authenticateUserToken(authen, res);
        if (!authResult.status) return authResult.response;
        const user = authResult.user;

        if (!user) {
            return res.status(401).json({ error: 'User authentication failed. Token is required.' });
        }

        if (!site || !scoreID || typeof newStatus !== 'boolean') {
            return res.status(400).json({ error: 'Site, scoreID, and newStatus (true/false) parameters are required.' });
        }

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const scoreCollection = targetDb.collection('score');

        // Update the score status
        const result = await scoreCollection.updateOne(
            { _id: safeObjectId(scoreID) },
            { $set: { status: newStatus, updatedAt: new Date() } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Score not found or invalid scoreID.' });
        }

        res.status(200).json({
            success: true,
            message: `Score status updated to '${newStatus ? 'active' : 'inactive'}'.`
        });
    } catch (error) {
        console.error('Error updating score status:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while updating score status.' });
    }
});

router.post('/progress/:option', async (req, res) => {
    
    const { option } = req.params; // Extract the option from the URL

    // Decrypt the data from the request body
    const decryptedData = decrypt(req.body.data);
    //console.log("decryptedData",decryptedData);
    
    // Extract properties from the decrypted data
    const { site, courseID, playerID, progressID, progress, lastplay, status, authen } = decryptedData;

    // Authen User Middleware
    const authResult = await authenticateUserToken(authen, res);
    if (!authResult.status) return authResult.response;
    const user = authResult.user;

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
        
            // Determine the updates based on the current status
            let updateField = {};
            const now = new Date();  // Current timestamp

            if (existingProgress.status === 'processing') {
                // Increment progress and set processingDateAt if not already set
                updateField = {
                    status: 'processing',
                    progress: existingProgress.progress + 5,
                    ...(existingProgress.processingDateAt ? {} : { processingDateAt: now }),
                };
            } else if (existingProgress.status === 'complete') {
                // Switch to revising and set completeDateAt if not already set
                updateField = {
                    status: 'revising',
                    revise: existingProgress.revise + 5,
                    ...(existingProgress.completeDateAt ? {} : { completeDateAt: now }),
                };
            } else if (existingProgress.status === 'revising') {
                // Increment revising count and set revisingDateAt if not already set
                updateField = {
                    status: 'revising',
                    revise: existingProgress.revise + 5,
                    ...(existingProgress.revisingDateAt ? {} : { revisingDateAt: now }),
                };
            }
        
            // Update the progress document
            const update = {
                $set: {
                    ...updateField,
                    lastplay,
                    updatedAt: new Date(),
                },
            };
        
            await progressCollection.updateOne(query, update);
        
            // Fetch analytics using the helper function
            const { analytics } = await getAnalytics(targetDb, existingProgress.courseID, user);
        
            return res.status(200).json({
                success: true,
                message: 'Updated successfully.',
                analytics,
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
        
            // Fetch the existing progress document to get the courseID and userID
            const existingProgress = await progressCollection.findOne(query);
            if (!existingProgress) {
                return res.status(404).json({ error: 'Progress not found after update.' });
            }
        
            const courseId = existingProgress.courseID;
            const userId = existingProgress.userID;
        
            // Call getAnalytics to fetch updated analytics
            const { analytics } = await getAnalytics(targetDb, courseId, userId);
        
            return res.status(200).json({
                success: true,
                message: 'Stopped successfully.',
                analytics, // Include updated analytics in the response
            });
        }
        
    } catch (error) {
        console.error('Error handling progress:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while processing the progress request.' });
    }
});

router.post('/is_enroll', async (req, res) => {
    try {
        // Decrypt the data from the request body
        const decryptedData = decrypt(req.body.data);
        //console.log("decryptedData", decryptedData);

        // Extract properties from the decrypted data
        const { site, courseID, authen } = decryptedData;

        // Authen User Middleware
        const authResult = await authenticateUserToken(authen, res);
        if (!authResult.status) return authResult.response;
        const user = authResult.user;

        if (!user) {
            return res.status(401).json({ error: 'User authentication failed. Token is required.' });
        }

        if (!site) {
            return res.status(400).json({ error: 'Site parameter is required.' });
        }

        if (!courseID) {
            return res.status(400).json({ error: 'courseID parameter is required.' });
        }

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const enrollCollection = targetDb.collection('enroll');

        // Check if the user is enrolled in the specified course
        const enrollment = await enrollCollection.findOne({ userID: user, courseID });

        // Return true if data exists, false otherwise
        const isEnrolled = !!enrollment;

        res.status(200).json({
            success: true,
            isEnrolled,
        });
    } catch (error) {
        console.error('Error checking enrollment:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while checking enrollment.' });
    }
});

router.post('/assign', async (req, res) => {
    try {
        // Decrypt the data from the request body
        const decryptedData = decrypt(req.body.data);
        //console.log("decryptedData", decryptedData);

        // Extract properties from the decrypted data
        const { site, courseID, authen } = decryptedData;

        // Authen User Middleware
        const authResult = await authenticateUserToken(authen, res);
        if (!authResult.status) return authResult.response;
        const user = authResult.user;

        if (!user) {
            return res.status(401).json({ error: 'User authentication failed. Token is required.' });
        }

        if (!site) {
            return res.status(400).json({ error: 'Site parameter is required.' });
        }

        if (!courseID) {
            return res.status(400).json({ error: 'courseID parameter is required.' });
        }

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const enrollCollection = targetDb.collection('enroll');

        // Check if the user is already enrolled in the specified course
        const existingEnrollment = await enrollCollection.findOne({ userID: user, courseID });

        if (existingEnrollment) {
            return res.status(409).json({
                error: 'User is already enrolled in this course.',
                data: { enrollmentId: existingEnrollment._id },
            });
        }

        // Default analytics structure
        const analytics = {
            total: 0,
            pending: 0,
            processing: 0,
            complete: 0,
            status: 'pending',
            message: 'Not started',
            post: {
                req: false,
                has: false,
                measure: null,
                score: null,
                result: false,
                message: null,
            },
            pre: {
                req: false,
                has: false,
                measure: null,
                result: false,
                message: null,
            },
            retest: {
                req: false,
                has: false,
                measure: null,
                result: false,
                message: null,
            },
            option: {
                cert_area: null,
                exam_round: null,
            },
            percent: 0,
        };

        // Construct the new enrollment document
        const newEnrollment = {
            courseID,
            userID: user, // User ID from token
            analytics,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        // Insert the new enrollment
        const result = await enrollCollection.insertOne(newEnrollment);

        res.status(201).json({
            success: true,
            message: 'User enrolled successfully.',
            data: { insertedId: result.insertedId },
        });
    } catch (error) {
        console.error('Error enrolling user:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while enrolling the user.' });
    }
});

router.post('/enroll', async (req, res) => {
    try {
        // Decrypt the data from the request body
        const decryptedData = decrypt(req.body.data);

        // Extract properties from the decrypted data
        const { site, authen } = decryptedData;

        // Authen User Middleware
        const authResult = await authenticateUserToken(authen, res);
        if (!authResult.status) return authResult.response;
        const user = authResult.user;

        if (!user) {
            return res.status(401).json({ error: 'User authentication failed. Token is required.' });
        }

        if (!site) {
            return res.status(400).json({ error: 'Site parameter is required.' });
        }

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const enrollCollection = targetDb.collection('enroll');
        const courseCollection = targetDb.collection('course');
        const orderCollection = targetDb.collection('order');

        // Fetch enrollment data for the user
        const enrollments = await enrollCollection.find({ userID: user }).toArray();

        if (enrollments.length === 0) {
            return res.status(200).json({ success: true, data: [] });
        }

        // Extract course IDs from enrollments
        const courseIds = enrollments.map((enrollment) => safeObjectId(enrollment.courseID));

        // Fetch course details for the enrolled courses and sort by createdAt
        const courses = await courseCollection
            .find({ _id: { $in: courseIds } })
            .project({
                _id: 1,
                name: 1,
                slug: 1,
                description: 1,
                cover: 1,
                hours: 1,
                days: 1,
                regular_price: 1,
                sale_price: 1,
                type: 1,
                createdAt: 1,
                accessDate: 1,
                certDate: 1,
                endDate: 1,
                posttestDate: 1,
                posttestEndDate: 1,
                pretestDate: 1,
                retestDateEndDateRound1: 1,
                retestDateEndDateRound2: 1,
                retestDateRound1: 1,
                retestDateRound2: 1,
                scoreDate: 1,
                endRegistDate: 1,
                startRegistDate: 1,
            })
            .sort({ createdAt: -1 }) // Sort courses by createdAt in descending order
            .toArray();

        // Create a map of course details by course ID
        const courseMap = courses.reduce((map, course) => {
            map[course._id.toString()] = course;
            return map;
        }, {});

        // Fetch related order data for each enrollment
        const orderIds = enrollments.map((enrollment) => safeObjectId(enrollment.orderID)).filter(Boolean);
        const orders = orderIds.length > 0 ? await orderCollection.find({ _id: { $in: orderIds } }).toArray() : [];
        const orderMap = orders.reduce((map, order) => {
            map[order._id.toString()] = order;
            return map;
        }, {});

        // Merge enrollment data with course and order details
        const enrichedEnrollments = enrollments.map((enrollment) => {
            const courseDetails = courseMap[enrollment.courseID];
            const orderDetails = enrollment.orderID ? orderMap[enrollment.orderID] || null : null;

            return {
                enrollment,
                course: courseDetails || null, // Include course details or null if not found
                order: orderDetails, // Include order details if found
                condition: courseDetails
                    ? {
                          accessDate: courseDetails.accessDate || null,
                          certDate: courseDetails.certDate || null,
                          endDate: courseDetails.endDate || null,
                          posttestDate: courseDetails.posttestDate || null,
                          posttestEndDate: courseDetails.posttestEndDate || null,
                          pretestDate: courseDetails.pretestDate || null,
                          retestDateEndDateRound1: courseDetails.retestDateEndDateRound1 || null,
                          retestDateEndDateRound2: courseDetails.retestDateEndDateRound2 || null,
                          retestDateRound1: courseDetails.retestDateRound1 || null,
                          retestDateRound2: courseDetails.retestDateRound2 || null,
                          scoreDate: courseDetails.scoreDate || null,
                          endRegistDate: courseDetails.endRegistDate || null,
                          startRegistDate: courseDetails.startRegistDate || null,
                      }
                    : null,
            };
        });

        res.status(200).json({
            success: true,
            data: enrichedEnrollments,
        });
    } catch (error) {
        console.error('Error fetching enrollments:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while fetching enrollments.' });
    }
});

router.post('/transaction', async (req, res) => {
    try {
        // Decrypt the data from the request body
        const decryptedData = decrypt(req.body.data);

        // Extract properties from the decrypted data
        const { site, authen } = decryptedData;

        // Authen User Middleware
        const authResult = await authenticateUserToken(authen, res);
        if (!authResult.status) return authResult.response;
        const user = authResult.user;

        if (!user) {
            return res.status(401).json({ error: 'User authentication failed. Token is required.' });
        }

        if (!site) {
            return res.status(400).json({ error: 'Site parameter is required.' });
        }

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const progressCollection = targetDb.collection('progress');
        const courseCollection = targetDb.collection('course');
        const playerCollection = targetDb.collection('player');

        // Fetch the last 5 unique transactions by playerID for the user
        const transactions = await progressCollection
            .aggregate([
                { $match: { userID: user } },
                { $sort: { updatedAt: -1 } }, // Sort by most recent
                { $group: {
                    _id: "$playerID", // Group by playerID
                    transaction: { $first: "$$ROOT" } // Keep the latest document for each playerID
                }},
                { $replaceRoot: { newRoot: "$transaction" } }, // Replace group result with the transaction
                { $limit: 5 }, // Limit to the last 5 unique playerIDs
                {
                    $lookup: {
                        from: "course",
                        let: { courseID: { $toObjectId: "$courseID" } },
                        pipeline: [
                            { $match: { $expr: { $eq: ["$_id", "$$courseID"] } } },
                            { 
                                $project: { 
                                    _id: 1, 
                                    name: 1,
                                    accessDate: 1,
                                    certDate: 1,
                                    endDate: 1,
                                    posttestDate: 1,
                                    posttestEndDate: 1,
                                    pretestDate: 1,
                                    retestDateEndDateRound1: 1,
                                    retestDateEndDateRound2: 1,
                                    retestDateRound1: 1,
                                    retestDateRound2: 1,
                                    scoreDate: 1,
                                    endRegistDate: 1,
                                    startRegistDate: 1
                                } 
                            }
                        ],
                        as: "courseData"
                    }
                },
                {
                    $lookup: {
                        from: "player",
                        let: { playerID: { $toObjectId: "$playerID" } },
                        pipeline: [
                            { $match: { $expr: { $eq: ["$_id", "$$playerID"] } } },
                            { $project: { _id: 1, name: 1 } } // Project only _id and name
                        ],
                        as: "playerData"
                    }
                },
                {
                    $project: {
                        userID: 1,
                        courseID: 1,
                        playerID: 1,
                        progress: 1,
                        lastplay: 1,
                        status: 1,
                        createdAt: 1,
                        updatedAt: 1,
                        courseData: { $arrayElemAt: ["$courseData", 0] },
                        playerData: { $arrayElemAt: ["$playerData", 0] },
                        condition: {
                            accessDate: { $arrayElemAt: ["$courseData.accessDate", 0] },
                            certDate: { $arrayElemAt: ["$courseData.certDate", 0] },
                            endDate: { $arrayElemAt: ["$courseData.endDate", 0] },
                            posttestDate: { $arrayElemAt: ["$courseData.posttestDate", 0] },
                            posttestEndDate: { $arrayElemAt: ["$courseData.posttestEndDate", 0] },
                            pretestDate: { $arrayElemAt: ["$courseData.pretestDate", 0] },
                            retestDateEndDateRound1: { $arrayElemAt: ["$courseData.retestDateEndDateRound1", 0] },
                            retestDateEndDateRound2: { $arrayElemAt: ["$courseData.retestDateEndDateRound2", 0] },
                            retestDateRound1: { $arrayElemAt: ["$courseData.retestDateRound1", 0] },
                            retestDateRound2: { $arrayElemAt: ["$courseData.retestDateRound2", 0] },
                            scoreDate: { $arrayElemAt: ["$courseData.scoreDate", 0] },
                            endRegistDate: { $arrayElemAt: ["$courseData.endRegistDate", 0] },
                            startRegistDate: { $arrayElemAt: ["$courseData.startRegistDate", 0] }
                        }
                    }
                }
            ])
            .toArray();

        res.status(200).json({
            success: true,
            data: transactions
        });
    } catch (error) {
        console.error('Error fetching transactions:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while fetching transactions.' });
    }
});

// New endpoint to fetch or create certification details
router.post('/certification/:id/:cid?', async (req, res) => {
    const { id, cid } = req.params;
    const { site, authen } = req.body;

    let user;

    if (!id) {
        // Authen User Middleware (only if cid is not provided)
        const authResult = await authenticateUserToken(authen, res);
        if (!authResult.status) return authResult.response;
        user = authResult.user;
    } else {
        user = id; // Use cid as user ID
    }

    //console.log("user",user);
    //console.log("course",user);
    
    try {
        const courseId = safeObjectId(cid);
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
        const userCollection = targetDb.collection('user');
        const certificationCollection = targetDb.collection('certification');
        console.log(user, courseId, siteIdString)
        // Fetch course details
        const course = await courseCollection.findOne({ _id: courseId, unit: siteIdString });
        if (!course) {
            return res.status(404).json({ error: 'Course not found.' });
        }

        // Fetch user details
        const userDetails = user ? await userCollection.findOne({ _id: safeObjectId(user) }) : null;
        if (!userDetails) {
            return res.status(404).json({ error: 'User not found.' });
        }

        // Check for existing certification
        let certification = await certificationCollection.findOne({ userID: userDetails._id.toString(), courseID: courseId.toString(), unit: siteIdString });

        // Create certification if it doesn't exist
        if (!certification) {
            const newCertification = {
                userID: userDetails._id.toString(),
                courseID: courseId.toString(),
                unit: siteIdString
            };
            const result = await certificationCollection.insertOne(newCertification);
            certification = { _id: result.insertedId, ...newCertification };
        }

        // Assign default certification template if needed
        if (course.certification === 'yes' && !course.certificationId) {
            const defaultTemplate = await certificationTemplateCollection.findOne({ unit: siteIdString, default: true });
            if (defaultTemplate) {
                await courseCollection.updateOne(
                    { _id: course._id },
                    { $set: { certificationId: defaultTemplate._id } }
                );
                course.certificationId = defaultTemplate._id;
            }
        }
        
        // Fetch related certification template details
        const certificationTemplate = await targetDb.collection('certification_template').findOne({ _id: safeObjectId(course.certificationId) });
        //console.log("course",course);
        // Format the response
        const formattedResponse = {
            success: true,
            course: {
                id: course._id,
                name: course.name,
                description: course.description,
                slug: course.slug,
                cover: course.cover,
                createdAt: course.createdAt,
            },
            user: {
                id: userDetails._id,
                firstname: userDetails.firstname,
                lastname: userDetails.lastname,
                email: userDetails.email,
                phone: userDetails.phone,
                avatar_img: userDetails.avatar_img,
            },
            certification: {
                id: certification._id,
                userID: certification.userID,
                courseID: certification.courseID,
                unit: certification.unit,
                createdAt: certification.createdAt,
            },
            template: certificationTemplate
                ? {
                    id: certificationTemplate._id,
                    name: certificationTemplate.name,
                    description: certificationTemplate.description,
                    pages: certificationTemplate.pages,
                    meta: {
                        createdAt: certificationTemplate.createdAt,
                        updatedAt: certificationTemplate.updatedAt,
                    },
                }
                : null,
        };

        res.status(200).json(formattedResponse);
    } catch (error) {
        console.error('Error fetching certification details:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while fetching certification details.' });
    }
});


// New endpoint to fetch certification details by certification ID
router.post('/certification/public/:id', async (req, res) => {
    const { id } = req.params;
    const { site } = req.body;

    try {
        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const siteIdString = siteData._id.toString();
        const courseCollection = targetDb.collection('course');
        const userCollection = targetDb.collection('user');
        const certificationCollection = targetDb.collection('certification');

        // Fetch certification by certification ID
        const certification = await certificationCollection.findOne({ _id: safeObjectId(id), unit: siteIdString });

        if (!certification) {
            return res.status(404).json({ error: 'Certification not found.' });
        }

        // Fetch course details
        const course = await courseCollection.findOne({ _id: safeObjectId(certification.courseID), unit: siteIdString });
        if (!course) {
            return res.status(404).json({ error: 'Course not found.' });
        }

        // Fetch user details
        const userDetails = await userCollection.findOne({ _id: safeObjectId(certification.userID) });
        if (!userDetails) {
            return res.status(404).json({ error: 'User not found.' });
        }

        // Assign default certification template if needed
        if (course.certification === 'yes' && !course.certificationId) {
            const defaultTemplate = await certificationTemplateCollection.findOne({ unit: siteIdString, default: true });
            if (defaultTemplate) {
                await courseCollection.updateOne(
                    { _id: course._id },
                    { $set: { certificationId: defaultTemplate._id } }
                );
                course.certificationId = defaultTemplate._id;
            }
        }
        
        // Fetch related certification template details
        const certificationTemplate = await targetDb.collection('certification_template').findOne({ _id: safeObjectId(course.certificationId) });

        // Format the response
        const formattedResponse = {
            success: true,
            course: {
                id: course._id,
                name: course.name,
                description: course.description,
                slug: course.slug,
                cover: course.cover,
                createdAt: course.createdAt,
            },
            user: {
                id: userDetails._id,
                firstname: userDetails.firstname,
                lastname: userDetails.lastname,
                email: userDetails.email,
                phone: userDetails.phone,
                avatar_img: userDetails.avatar_img,
            },
            certification: {
                id: certification._id,
                userID: certification.userID,
                courseID: certification.courseID,
                unit: certification.unit,
                createdAt: certification.createdAt,
            },
            template: certificationTemplate
            ? {
                id: certificationTemplate._id,
                name: certificationTemplate.name,
                description: certificationTemplate.description,
                pages: certificationTemplate.pages,
                meta: {
                    createdAt: certificationTemplate.createdAt,
                    updatedAt: certificationTemplate.updatedAt,
                },
            }
            : null,
        };

        res.status(200).json(formattedResponse);
    } catch (error) {
        console.error('Error fetching certification details:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while fetching certification details.' });
    }
});

router.post('/survey/submit', async (req, res) => {
    try {
        // Decrypt the incoming data
        const decryptedData = decrypt(req.body.data);
        const { site, courseId, surveyId, survey, authen } = decryptedData;

        // Authen User Middleware
        const authResult = await authenticateUserToken(authen, res);
        if (!authResult.status) return authResult.response;
        const user = authResult.user;

        // Validate required fields
        if (!site || !courseId || !surveyId || !survey) {
            return res.status(400).json({ error: 'Site, courseId, surveyId, and survey data are required.' });
        }

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const surveyResponsesCollection = targetDb.collection('survey_submission');

        // Check if the user has already submitted the survey
        const existingResponse = await surveyResponsesCollection.findOne({
            userId: user,
            courseId,
            surveyId,
        });

        if (existingResponse) {
            return res.status(409).json({ error: 'Survey already submitted for this course.' });
        }

        // Prepare the survey response document
        const surveyResponse = {
            userId: user,
            courseId,
            surveyId,
            survey,
            createdAt: new Date(),
        };

        // Insert the survey response
        const result = await surveyResponsesCollection.insertOne(surveyResponse);

        res.status(201).json({
            success: true,
            message: 'Survey submitted successfully.',
            data: { insertedId: result.insertedId },
        });
    } catch (error) {
        console.error('Error submitting survey:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while submitting the survey.' });
    }
});

router.post('/form/submit', async (req, res) => {
    try {
        // Decrypt the incoming data
        const decryptedData = decrypt(req.body.data);
        const { site, formData, formID, status, courseID, process, enrollID, authen } = decryptedData;

        // Authen User Middleware
        const authResult = await authenticateUserToken(authen, res);
        if (!authResult.status) return authResult.response;
        const user = authResult.user;

        // Validate required fields
        if (!site || !formData || !formID || !courseID || !enrollID) {
            return res.status(400).json({ error: 'Site, formData, formID, courseID, and enrollID are required.' });
        }

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const siteIdString = siteData._id.toString();
        const formCollection = targetDb.collection('form');
        const enrollCollection = targetDb.collection('enroll');

        // Prepare the form document
        const formDocument = {
            parent: siteIdString,
            formData,
            formID,
            status,
            courseID,
            process: process || {},
            userID: user,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        // Insert the form document into the collection
        const result = await formCollection.insertOne(formDocument);
        const insertedId = result.insertedId;

        if (!insertedId) {
            return res.status(500).json({ error: 'Failed to insert form data.' });
        }

        // Update the enroll collection with the provided enrollID
        const updateResult = await enrollCollection.updateOne(
            { _id: safeObjectId(enrollID) },
            { $set: { submitID: insertedId.toString() } }
        );

        if (updateResult.matchedCount === 0) {
            return res.status(404).json({ error: 'Enrollment not found for the specified enrollID.' });
        }

        res.status(201).json({
            success: true,
            message: 'Form submitted successfully.',
            data: { insertedId },
        });
    } catch (error) {
        console.error('Error submitting form:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while submitting the form.' });
    }
});

router.post('/order/submit', async (req, res) => {
    try {
        // Decrypt the incoming data
        const decryptedData = decrypt(req.body.data);
        const { site, authen, orderData, courseID } = decryptedData;
        const {
            products,
            customer,
            amounts,
            address,
            formID,
            process,
            ref1,
            ref2,
            payment,
            notes
        } = orderData;

        // Validate required fields
        if (!products || !customer || !amounts || !address) {
            return res.status(400).json({ error: 'Products, customer, amounts, and address are required.' });
        }

        if (!site) {
            return res.status(400).json({ error: 'Site parameter is required.' });
        }

        // Authenticate user
        const authResult = await authenticateUserToken(authen, res);
        if (!authResult.status) return authResult.response;
        const user = authResult.user;

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const siteIdString = siteData._id.toString();
        const orderCollection = targetDb.collection('order');

        // Check if an order already exists for the given courseID and userID
        const existingOrder = await orderCollection.findOne({ courseID, userID: user });
        if (existingOrder) {
            return res.status(409).json({
                error: 'An order already exists for this course and user.',
                data: { orderId: existingOrder._id },
            });
        }

        // Prepare the order document
        const orderDocument = {
            products,
            customer,
            amounts,
            address,
            formID,
            courseID,
            process,
            ref1,
            ref2,
            payment,
            notes,
            userID: user,
            unit: siteIdString,
            status: 'pending', // Default status for new orders
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        // Insert the order document into the collection
        const result = await orderCollection.insertOne(orderDocument);

        // Check if insertion was successful
        if (!result.insertedId) {
            return res.status(500).json({ error: 'Failed to insert order data.' });
        }

        res.status(201).json({
            success: true,
            message: 'Order submitted successfully.',
            data: { insertedId: result.insertedId },
        });
    } catch (error) {
        console.error('Error submitting order:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while submitting the order.' });
    }
});

function mapOrderData(formData, orderCode, customerTypeCode) {
    const customerType = formData?.["radiobox-17-0-11"]?.value?.value === "offline-corporate" ? "corporate" : "individual";
    const corporateAddress = formData?.["address-21-3-11"]?.value || {};
    const individualAddress = formData?.["address-12-1-7"]?.value || {};
    
    const isValidValue = (value) => value && value !== 'n/a' && value.trim() !== '';
    
    const formatAddress = (address) => {
        return [
            isValidValue(address.NO) ? `เลขที่ ${address.NO}` : '',
            isValidValue(address.MOO) ? `หมู่ ${address.MOO}` : '',
            isValidValue(address.SOI_TH) ? `ซอย ${address.SOI_TH}` : '',
            isValidValue(address.BUILDING_TH) ? `อาคาร ${address.BUILDING_TH}` : '',
            isValidValue(address.ROAD_TH) ? `ถนน ${address.ROAD_TH}` : ''
        ].filter(Boolean).join(' ');
    };

    const formatProvince = (address) => {
        return isValidValue(address.province) && address.province !== "กรุงเทพมหานคร" ? `จังหวัด${address.province}` : address.province;
    };

    const formatSubdistrict = (address) => {
        if (!isValidValue(address.subdistrict)) return '';
        if (isValidValue(address.province) && address.province === "กรุงเทพมหานคร" && !address.subdistrict.startsWith("แขวง")) {
            return `แขวง${address.subdistrict}`;
        }
        return address.province !== "กรุงเทพมหานคร" ? `ตำบล${address.subdistrict}` : address.subdistrict;
    };

    const formatDistrict = (address) => {
        return isValidValue(address.province) && address.province !== "กรุงเทพมหานคร" && isValidValue(address.district) ? `อำเภอ${address.district}` : address.district || '';
    };
    
    const selectedAddress = customerType === "corporate" ? corporateAddress : individualAddress;

    const citizen = formData?.["input-6-0-5"]?.value || {};
    //const citizen = customerType === "corporate" ? formData?.["input-18-1-11"]?.value ?? '' : formData?.["input-6-0-5"]?.value ?? ''

    return {
        //ref1: orderCode,
        ref1: customerTypeCode + citizen, // for DOA
        ref2: formData?.["ref2"] ?? '',
        detailData: {
            div_code: '115-99',
            sub_section_items: [
                {
                    sub_section_code: '103-97-035',
                    sub_section_qty: 1,
                    sub_section_amount: 800,
                },
            ],
            bank_account: 'KBANK',
            transfered_date: null,
            transfered_amount: 800,
            bankAccount: null,
            tranNo: null,
            //transfered_ref1: orderCode,
            transfered_ref1: customerTypeCode + citizen, // for DOA
            transfered_ref2: formData?.["ref2"] ?? '',
            tax_id: customerType === "corporate" ? formData?.["input-18-1-11"]?.value ?? '' : formData?.["input-6-0-5"]?.value ?? '',
            branch_id: customerType === "corporate" ? parseInt(formData?.["input-19-1-11"]?.value ?? '0', 10) : -1,
            customer_name: customerType === "corporate" ? formData?.["input-20-2-11"]?.value ?? '' : `${formData?.["input-1-1-3"]?.value ?? ''} ${formData?.["input-2-2-3"]?.value ?? ''}`,
            address_1: formatAddress(selectedAddress),
            address_2: formatSubdistrict(selectedAddress),
            city_name: formatDistrict(selectedAddress),
            province_name: formatProvince(selectedAddress),
            post_code: selectedAddress.zipcode ?? '',
        }
    };
}

async function generateOrderCode(collection) {
    const now = new Date();
    const thaiYear = (now.getFullYear() + 543).toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    
    const lastOrder = await collection.find({ rawCode: { $regex: `^${thaiYear}${month}` } })
        .sort({ rawCode: -1 })
        .limit(1)
        .toArray();
    
    let runningNumber = 1;
    if (lastOrder.length > 0) {
        const lastNumber = parseInt(lastOrder[0].rawCode.slice(-4), 10);
        runningNumber = lastNumber + 1;
    }
    
    return `${thaiYear}${month}${runningNumber.toString().padStart(4, '0')}`;
}

router.post('/data/submit', async (req, res) => {
    try {
        // Decrypt the incoming data
        const decryptedData = decrypt(req.body.data);
        const { site, authen, courseID, formID, process, mode, mappedData, formData } = decryptedData;

        if (!site || !authen || !courseID || !formID || !process || !mode || !mappedData || !formData) {
            return res.status(400).json({ error: 'Missing required fields.' });
        }

        // Authenticate user
        const authResult = await authenticateUserToken(authen, res);
        if (!authResult.status) return authResult.response;
        const user = authResult.user;

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const siteIdString = siteData._id.toString();
        const collection = targetDb.collection(mode);

        // Generate order code
        const rawCode = await generateOrderCode(collection);
        const customerTypeCode = formData["radiobox-17-0-11"]?.value?.value === "online" ? "02" : "01";
        const orderCode = `${customerTypeCode}${rawCode}`;

        // Check if an order already exists for the given courseID and userID
        const existingOrder = await collection.findOne({ courseID, userID: user });
        if (existingOrder) {
            return res.status(409).json({
                error: 'An order already exists for this course and user.',
                data: { orderId: existingOrder._id },
            });
        }

        const orderDocument = {
            orderCode,
            rawCode,
            courseID,
            formID,
            process,
            mode,
            mappedData,
            formData,
            userID: user,
            unit: siteIdString,
            status: 'pending', // Default status
            payment: 'bill_payment', // Default status
            type: 'lesson', // Default status
            approve: 'manual', // Default status
            createdAt: new Date(),
            updatedAt: new Date(),
            ...mapOrderData(formData, orderCode, customerTypeCode)
        };

        // Insert the order document into the collection
        const result = await collection.insertOne(orderDocument);

        if (!result.insertedId) {
            return res.status(500).json({ error: 'Failed to insert order data.' });
        }

        // Check if enrollment exists before adding
        const enrollCollection = targetDb.collection('enroll');
        const existingEnrollment = await enrollCollection.findOne({ userID: user, courseID });

        let enrollID = null;
        if (!existingEnrollment) {
            // Default analytics structure
            const analytics = {
                total: 0,
                pending: 0,
                processing: 0,
                complete: 0,
                status: 'pending',
                message: 'Not started',
                post: { req: false, has: false, measure: null, score: null, result: false, message: null },
                pre: { req: false, has: false, measure: null, result: false, message: null },
                retest: { req: false, has: false, measure: null, result: false, message: null },
                option: { cert_area: null, exam_round: null },
                percent: 0,
            };

            // New Enrollment Data
            const newEnrollment = {
                courseID,
                userID: user,
                orderID: result.insertedId.toString(),
                status: false,  // Set status to false
                analytics,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const enrollmentResult = await enrollCollection.insertOne(newEnrollment);
            enrollID = enrollmentResult.insertedId.toString();
        } else {
            enrollID = existingEnrollment._id.toString();
        }

        // Insert data into `form` collection
        if (enrollID) {
            const formCollection = targetDb.collection('form');

            const now = new Date();
            const formattedDate = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
            const formattedTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

            const formDocument = {
                parent: siteIdString,
                formID,
                userID: user,
                status: false,
                process: "pending",
                createdAt: now,
                updatedAt: now,
                date: formattedDate,
                time: formattedTime,
                formData,
                courseID,
                orderID: result.insertedId.toString(),
                enrollID
            };

            await formCollection.insertOne(formDocument);
        }
        
        res.status(201).json({
            success: true,
            message: 'Order submitted successfully.',
            data: { insertedId: result.insertedId, orderCode, rawCode },
        });
    } catch (error) {
        console.error('Error submitting order:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while submitting the order.' });
   
    }
});



router.post('/getOrder/:id', async (req, res) => {
    try {
        const { id } = req.params; // Extract Order ID from URL
        const { site, authen } = req.body; // Extract site and authentication from request body

        if (!id) {
            return res.status(400).json({ error: 'Order ID is required.' });
        }

        if (!site) {
            return res.status(400).json({ error: 'Site parameter is required.' });
        }

        console.log("Fetching order details...");

        // Authenticate user
        const authResult = await authenticateUserToken(authen, res);
        if (!authResult.status) return authResult.response;
        const user = authResult.user;

        console.log("Authenticated user:", user);

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        console.log("Site found:", siteData._id);

        const orderCollection = targetDb.collection('order');
        const courseCollection = targetDb.collection('course'); // Course Collection
        const userCollection = targetDb.collection('user');   // User Collection

        // Fetch order details
        const order = await orderCollection.findOne({ _id: safeObjectId(id) });

        if (!order) {
            return res.status(404).json({ error: 'Order not found or you do not have access.' });
        }

        console.log("Order found:", order);

        // Fetch course details using courseID from the order
        const course = await courseCollection.findOne({ _id: safeObjectId(order.courseID) });

        if (!course) {
            console.warn("Course not found for order:", order.courseID);
        }

        // Fetch user data using userID from the order
        const userData = await userCollection.findOne({ _id: safeObjectId(order.userID) }, { projection: { password: 0 } });

        if (!userData) {
            console.warn("User data not found for:", order.userID);
        }

        res.status(200).json({
            success: true,
            data: {
                order,
                course: course || null,   // Include course details (null if not found)
                user: userData || null    // Include user details (null if not found)
            },
        });
    } catch (error) {
        console.error('Error fetching order:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while fetching the order.' });
    }
});



router.post('/qrcode', async (req, res) => {
    const { data, config, size, download, file } = req.body;

    try {
        // Validate required fields
        if (!data || !config || !size || !file) {
            return res.status(400).json({
                error: 'Missing required fields: data, config, size, and file are required.'
            });
        }

        // Create a unique cache key based on the input data
        const cacheKey = `qrcode:${CryptoJS.MD5(JSON.stringify({ data, config, size, file })).toString()}`;

        // Check if the QR code is already cached in Redis
        const cachedQrCode = await redisClient.get(cacheKey);

        if (cachedQrCode) {
            console.log('QR Code retrieved from cache');
            return res.status(200).json({ success: true, base64Image: cachedQrCode, cache: true });
        }

        // API URL for QR Code Monkey
        const apiUrl = 'https://api.qrcode-monkey.com/qr/custom';

        // Payload for the QR Code Monkey API
        const payload = {
            data,
            config,
            size,
            download,
            file
        };

        // Make the POST request to QR Code Monkey
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // Check if the request was successful
        if (!response.ok) {
            const error = await response.json();
            return res.status(response.status).json({
                success: false,
                error: error.message || 'Failed to generate QR code.'
            });
        }

        // Parse the response
        const qrCodeData = await response.json();

        // Construct the full image URL if it is relative
        const imageUrl = qrCodeData.imageUrl.startsWith('//')
            ? `https:${qrCodeData.imageUrl}`
            : qrCodeData.imageUrl;

        // Fetch the QR code image as a buffer
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch QR code image for Base64 conversion.'
            });
        }
        const imageBuffer = await imageResponse.buffer();

        // Convert the image buffer to a Base64 string
        const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;

        // Store the Base64-encoded QR code in Redis with a 1-hour expiration
        await redisClient.setEx(cacheKey, 3600, base64Image);

        console.log('QR Code stored in cache');

        // Return the Base64-encoded QR code
        res.status(200).json({ success: true, base64Image, cache: false });
    } catch (error) {
        console.error('Error generating QR code:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while generating the QR code.' });
    }
});



module.exports = router;
