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
        let omDataForResponse = []; // Initialize variable for response

        if (user.clusterId) {
            try {
                // Fetch basic cluster data
                const clusterIdObject = safeObjectId(user.clusterId);
                clusterData = await clusterCollection.findOne({ _id: clusterIdObject });

                // Call the helper function to get nested OM/VC/SubVC data
                let fullyPopulatedOmData = await getNestedOmDataByClusterId(db, user.clusterId);

                // --- Filter omData if user type is 'sub' ---
                if (user.type === 'sub' && Array.isArray(user.assignments) && user.assignments.length > 0) {
                    // Create a map for faster lookup: { omIdString: Set<vcIdString> }
                    const assignmentMap = user.assignments.reduce((acc, assignment) => {
                        if (assignment.omId) {
                            // Ensure vcIds is an array, default to empty array if not present or null
                            const vcIds = Array.isArray(assignment.vcIds) ? assignment.vcIds : [];
                            acc[assignment.omId] = new Set(vcIds); // Store vcIds as a Set
                        }
                        return acc;
                    }, {});

                    omDataForResponse = fullyPopulatedOmData.map(om => {
                        // Convert ObjectId to string for comparison
                        const omIdString = om._id.toString();
                        // Check if this OM is assigned to the sub-user
                        if (assignmentMap[omIdString]) {
                            const allowedVcIds = assignmentMap[omIdString];
                            // Filter vcData based on the assigned vcIds for this OM
                            // Ensure om.vcData exists and is an array
                            const vcData = Array.isArray(om.vcData) ? om.vcData : [];
                            const filteredVcData = vcData.filter(vc =>
                                // Convert vc._id to string for comparison with Set
                                allowedVcIds.has(vc._id.toString())
                            );
                            // Return the OM object with filtered vcData
                            // Make sure to include all original OM fields
                            return { ...om, vcData: filteredVcData };
                        }
                        // If the OM itself is not assigned, return null
                        return null;
                    }).filter(om => om !== null); // Remove the null entries (OMs not assigned)
                } else {
                    // If not a 'sub' user or no assignments, use the full data
                    omDataForResponse = fullyPopulatedOmData;
                }
                 // --- End Filter ---


            } catch (fetchError) {
                console.error('Error fetching cluster/OM/VC/SubVC data for user:', user._id, fetchError);
                // Log error but proceed with login, omDataForResponse will be empty or default
                 omDataForResponse = []; // Ensure it's an empty array on error
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
                omData: omDataForResponse // Use the potentially filtered data
            }
            // Consider adding a session token (e.g., JWT) here for subsequent requests
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

module.exports = router; 