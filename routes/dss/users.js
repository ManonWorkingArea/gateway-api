const express = require('express');
const { safeObjectId } = require('../middleware/mongoMiddleware'); // Adjust path
const CryptoJS = require('crypto-js');
const router = express.Router();

// POST /users (Add New) - Mounted at /users
router.post('/', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const usersCollection = db.collection('users');
        // Ensure collection exists
        const collections = await db.listCollections({ name: 'users' }).toArray();
        if (collections.length === 0) await db.createCollection('users');

        const { password, ...userData } = req.body;

        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }

        const salt = CryptoJS.lib.WordArray.random(128 / 8).toString(CryptoJS.enc.Hex);
        const keySize = 256 / 32;
        const iterations = 10000;
        const hashedPassword = CryptoJS.PBKDF2(password, salt, {
            keySize: keySize, iterations: iterations
        }).toString(CryptoJS.enc.Hex);

        const newUser = { ...userData, password: hashedPassword, salt: salt, createdAt: new Date() };
        const result = await usersCollection.insertOne(newUser);

        const responseData = { ...newUser };
        delete responseData.password; delete responseData.salt;

        res.status(201).json({ success: true, data: { id: result.insertedId, ...responseData } });
    } catch (error) {
        console.error('Error adding new user:', error);
        if (error.code === 11000) return res.status(409).json({ error: 'User already exists' });
        res.status(500).json({ error: 'Failed to add new user' });
    }
});


// GET /sub/:userid (List Sub Users) - Mounted at /users
router.get('/sub/:userid', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const usersCollection = db.collection('users');
        const parentId = safeObjectId(req.params.userid);

        const subUsers = await usersCollection.find(
            { parent: parentId, type: 'sub' }, 
            { projection: { password: 0, salt: 0 } } 
        ).toArray();

        res.status(200).json({ success: true, data: subUsers });
    } catch (error) {
        console.error('Error fetching sub users:', error);
        res.status(500).json({ error: 'Failed to fetch sub users' });
    }
});

// GET /users (List) - Mounted at /users
router.get('/', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const usersCollection = db.collection('users');
        // Fetch all users, excluding password and salt
        const allUsers = await usersCollection.find({}, { projection: { password: 0, salt: 0 } }).toArray();

        // Separate main users and sub users
        const mainUsers = allUsers.filter(user => user.type === 'main' || !user.type); // Treat users without type as main
        const subUsers = allUsers.filter(user => user.type === 'sub' && user.parent);

        // Create a map for quick lookup of sub users by parent ID
        const subUsersByParent = subUsers.reduce((acc, subUser) => {
            const parentId = subUser.parent.toString(); // Ensure parent ID is a string for matching
            if (!acc[parentId]) {
                acc[parentId] = [];
            }
            acc[parentId].push(subUser);
            return acc;
        }, {});

        // Attach sub users to their respective main users
        const structuredUsers = mainUsers.map(mainUser => {
            const userId = mainUser._id.toString(); // Ensure user ID is a string for matching
            return {
                ...mainUser,
                subUsers: subUsersByParent[userId] || [] // Add subUsers array, empty if none
            };
        });

        res.status(200).json({ success: true, data: structuredUsers });
    } catch (error) {
        console.error('Error fetching and structuring users:', error);
        res.status(500).json({ error: 'Failed to fetch and structure users' });
    }
});

// GET /users/:id (Single) - Mounted at /users
router.get('/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const usersCollection = db.collection('users');
        const userId = safeObjectId(req.params.id);
        const userData = await usersCollection.findOne({ _id: userId }, { projection: { password: 0, salt: 0 } });
        if (!userData) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.status(200).json({ success: true, data: userData });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});



// PUT /users/:id (Update) - Mounted at /users
router.put('/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const usersCollection = db.collection('users');
        const userId = safeObjectId(req.params.id);
        const { password, ...updatedUserData } = req.body;
        delete updatedUserData._id;
        delete updatedUserData.createdAt; // Prevent updating createdAt

        if (password) {
            const salt = CryptoJS.lib.WordArray.random(128 / 8).toString(CryptoJS.enc.Hex);
            const keySize = 256 / 32;
            const iterations = 10000;
            const hashedPassword = CryptoJS.PBKDF2(password, salt, {
                keySize: keySize, iterations: iterations
            }).toString(CryptoJS.enc.Hex);
            updatedUserData.password = hashedPassword;
            updatedUserData.salt = salt;
        } else {
             delete updatedUserData.password; // Ensure password/salt are not set to null/undefined
             delete updatedUserData.salt;
        }

        const result = await usersCollection.updateOne(
            { _id: userId },
            { $set: updatedUserData, $currentDate: { lastModified: true } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        const updatedDoc = await usersCollection.findOne({ _id: userId }, { projection: { password: 0, salt: 0 } });
        res.status(200).json({ success: true, data: updatedDoc });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// DELETE /users/:id (Delete) - Mounted at /users
router.delete('/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const usersCollection = db.collection('users');
        const userId = safeObjectId(req.params.id);
        const result = await usersCollection.deleteOne({ _id: userId });
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.status(200).json({ success: true, data: { deletedCount: result.deletedCount } });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

module.exports = router; 