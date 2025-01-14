const express = require('express');
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
const { authenticateClient, safeObjectId, errorHandler } = require('./routes/middleware/mongoMiddleware');
const axios = require('axios'); // For making HTTP requests
const { crossOriginResourcePolicy } = require('helmet');
const CryptoJS = require('crypto-js');
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

        console.log("examData",examData);

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
                    playlistUpdatedAt: latestUpdatedAt,
                },
                isEnroll: !!enrollment,
                isComplete,
            },
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
                updatedAt: surveyData.updatedAt
            }
            : {
                has: course.survey,
                id: course.surveyId,
            },
            ...(enrollment && { enrollment }), // Add enrollment if present
            ...(player && { player }), // Add specific player data if present
            ...(Object.keys(contest).length > 0 && { contest }),
        };

        res.status(200).json(formattedResponse);
    } catch (error) {
        console.error('Error fetching course and player data:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while fetching data.' });
    }
});

// Endpoint to fetch course details with score, exam, and answer data including questions
router.post('/assessment/:id/:exam?', async (req, res) => {
    const { id, exam } = req.params;
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

        let user = null;

        console.log("decryptedData",decryptedData)

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

        if (!site || !examID || !courseID || score === undefined || !answer) {
            return res.status(400).json({ error: 'Site, examID, courseID, score, and answer parameters are required.' });
        }

        console.log("user",user)

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
        console.log("decryptedData", decryptedData);

        // Extract properties from the decrypted data
        const { site, scoreID, newStatus, authen } = decryptedData;

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
        console.log("Analytics Data:", analytics);

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


router.post('/progress/:option', async (req, res) => {
    
    const { option } = req.params; // Extract the option from the URL

    // Decrypt the data from the request body
    const decryptedData = decrypt(req.body.data);
    console.log("decryptedData",decryptedData);
    
    // Extract properties from the decrypted data
    const { site, courseID, playerID, progressID, progress, lastplay, status, authen } = decryptedData;

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
        console.log("decryptedData", decryptedData);

        // Extract properties from the decrypted data
        const { site, courseID, authen } = decryptedData;

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
        console.log("decryptedData", decryptedData);

        // Extract properties from the decrypted data
        const { site, courseID, authen } = decryptedData;

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
        console.log("decryptedData", decryptedData);

        // Extract properties from the decrypted data
        const { site, authen } = decryptedData;

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

        // Fetch enrollment data for the user
        const enrollments = await enrollCollection.find({ userID: user }).toArray();

        if (enrollments.length === 0) {
            return res.status(200).json({ success: true, data: [] });
        }

        // Extract course IDs from enrollments
        const courseIds = enrollments.map((enrollment) => safeObjectId(enrollment.courseID));

        // Fetch course details for the enrolled courses and sort by updatedAt
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
                createdAt: 1,
            })
            .sort({ createdAt: -1 }) // Sort courses by updatedAt in descending order
            .toArray();

        // Create a map of course details by course ID
        const courseMap = courses.reduce((map, course) => {
            map[course._id.toString()] = course;
            return map;
        }, {});

        // Merge enrollment data with course details
        const enrichedEnrollments = enrollments.map((enrollment) => {
            const courseDetails = courseMap[enrollment.courseID];
            return {
                enrollment,
                course: courseDetails || null, // Include course details or null if not found
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
        console.log("decryptedData", decryptedData);

        // Extract properties from the decrypted data
        const { site, authen } = decryptedData;

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

        // Fetch the last 10 unique transactions by playerID for the user
        const transactions = await progressCollection
            .aggregate([
                { $match: { userID: user } },
                { $sort: { updatedAt: -1 } }, // Sort by most recent
                { $group: {
                    _id: "$playerID", // Group by playerID
                    transaction: { $first: "$$ROOT" } // Keep the latest document for each playerID
                }},
                { $replaceRoot: { newRoot: "$transaction" } }, // Replace group result with the transaction
                { $limit: 5 }, // Limit to the last 10 unique playerIDs
                {
                    $lookup: {
                        from: "course",
                        let: { courseID: { $toObjectId: "$courseID" } },
                        pipeline: [
                            { $match: { $expr: { $eq: ["$_id", "$$courseID"] } } }
                        ],
                        as: "courseData"
                    }
                },
                {
                    $lookup: {
                        from: "player",
                        let: { playerID: { $toObjectId: "$playerID" } },
                        pipeline: [
                            { $match: { $expr: { $eq: ["$_id", "$$playerID"] } } }
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
                        playerData: { $arrayElemAt: ["$playerData", 0] }
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
router.post('/certification/:id', async (req, res) => {
    const { id } = req.params;
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
        const userCollection = targetDb.collection('user');
        const certificationCollection = targetDb.collection('certification');

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
        console.log("course",course);
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

        // Validate required fields
        if (!site || !courseId || !surveyId || !survey) {
            return res.status(400).json({ error: 'Site, courseId, surveyId, and survey data are required.' });
        }

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        if (!siteData || !siteData._id) {
            return res.status(404).json({ error: 'Site data not found or invalid.' });
        }

        const surveyResponsesCollection = targetDb.collection('survey_responses');

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




module.exports = router;
