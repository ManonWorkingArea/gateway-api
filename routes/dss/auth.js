const express = require('express');
const CryptoJS = require('crypto-js');
const { safeObjectId } = require('../middleware/mongoMiddleware'); // Adjust path
const { getNestedOmDataByClusterId } = require('./helpers'); // Import helper
const router = express.Router();

// POST /auth/login (User Login) - Mounted at /auth in dss.js
router.post('/login', async (req, res) => {
    try {
        const db = req.client.db('dss'); // Get DB from client attached by middleware
        const usersCollection = db.collection('users');
        const clusterCollection = db.collection('cluster');
        // No need for om/vc/subvc collections here, handled by helper

        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Find user by email
        const user = await usersCollection.findOne({ email: email });

        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' }); // User not found
        }

        // Verify password
        const keySize = 256 / 32;
        const iterations = 10000; // Must match iterations used during registration/update
        const hashedPasswordAttempt = CryptoJS.PBKDF2(password, user.salt, {
            keySize: keySize,
            iterations: iterations
        }).toString(CryptoJS.enc.Hex);

        if (hashedPasswordAttempt !== user.password) {
            return res.status(401).json({ error: 'Invalid email or password' }); // Password mismatch
        }

        // --- Login Successful ---

        let clusterData = null;
        let fullyPopulatedOmData = [];

        if (user.clusterId) {
            try {
                // Fetch basic cluster data
                const clusterIdObject = safeObjectId(user.clusterId);
                clusterData = await clusterCollection.findOne({ _id: clusterIdObject });

                // Call the helper function to get nested OM/VC/SubVC data
                fullyPopulatedOmData = await getNestedOmDataByClusterId(db, user.clusterId);

            } catch (fetchError) {
                console.error('Error fetching cluster/OM/VC/SubVC data for user:', user._id, fetchError);
                // Log error but proceed with login
            }
        }

        // Prepare user data for response (remove sensitive info)
        const responseUserData = { ...user };
        delete responseUserData.password;
        delete responseUserData.salt;

        // Send success response
        res.status(200).json({
            success: true,
            message: 'Login successful',
            data: {
                user: responseUserData,
                cluster: clusterData,
                omData: fullyPopulatedOmData
            }
            // Consider adding a session token (e.g., JWT) here for subsequent requests
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

module.exports = router; 