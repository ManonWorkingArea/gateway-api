const express = require('express');
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
const { authenticateClient, safeObjectId, errorHandler } = require('./routes/middleware/mongoMiddleware');
const axios = require('axios'); // For making HTTP requests
const { crossOriginResourcePolicy } = require('helmet');
const CryptoJS = require('crypto-js');
const router = express.Router();

// เพิ่มการนำเข้าฟังก์ชันจาก Redis
const { searchChat, searchSimilarChat, saveChat } = require('./routes/middleware/redis');
const { conversation } = require('./middleware/ai');
// Secret key for signing JWT (Use environment variables for security)
const JWT_SECRET = 'ZCOKU1v3TO2flcOqCdrJ3vWbWhmnZNQn';

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

router.post('/new', async (req, res) => {
  try {
    const decryptedData = decrypt(req.body.data);
    const { site, content, course, player, authen } = decryptedData;

    let user = null;

    if (authen) {
      const decodedToken = await verifyToken(authen.replace('Bearer ', ''));
      if (!decodedToken.status) {
        return res.status(401).json({ status: false, message: 'Invalid or expired token' });
      }
      user = decodedToken.decoded.user;
    }

    if (!user || !site || !content) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const { client } = req;
    const { targetDb, siteData } = await getSiteSpecificDb(client, site);
    const messageCollection = targetDb.collection('message');

    const newMessage = {
      userID: user,
      courseID: course,
      playerID: player,
      content,
      status: 'open',
      replies: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await messageCollection.insertOne(newMessage);

    // ค้นหาคำตอบที่คล้ายกันจาก Redis ก่อน
    let autoReply = null;
    const similarResults = await searchSimilarChat(content);
    
    // ถ้าพบคำตอบที่คล้ายกัน ใช้คำตอบนั้น
    if (similarResults && similarResults.length > 2) {
      // ดึงคำตอบที่เจอจาก Redis (มีคะแนนความเหมือนสูง)
      const bestMatch = similarResults[2] ? similarResults[2] : null;
      if (bestMatch && bestMatch.score > 0.85) {
        autoReply = bestMatch.message;
        console.log('RED :: Using similar response from cache');
        console.log(`คำตอบจากแคช (${bestMatch.score.toFixed(2)}): ${autoReply.substring(0, 50)}...`);
      }
    }
    
    // ถ้าไม่พบคำตอบที่คล้ายกัน ใช้ AI สร้างคำตอบ
    if (!autoReply) {
      const customPrompt = `คำถามจากผู้ใช้งาน:\n"${content}"`;
      autoReply = await conversation(customPrompt);
      console.log(`คำตอบจาก AI: ${autoReply.substring(0, 50)}...`);
      
      // บันทึกคำถามและคำตอบลงใน Redis สำหรับการค้นหาในอนาคต เฉพาะเมื่อไม่ใช่ข้อความแสดงข้อผิดพลาด
      if (autoReply !== "ขออภัย ไม่สามารถสร้างข้อความตอบกลับได้ในขณะนี้.") {
        await saveChat(user, `คำถาม: ${content}\nคำตอบ: ${autoReply}`);
      }
    }

    await messageCollection.updateOne(
      { _id: result.insertedId },
      {
        $push: {
          replies: {
            userID: 'system',
            content: autoReply,
            createdAt: new Date(),
          }
        },
        $set: { updatedAt: new Date() }
      }
    );

    res.status(201).json({
      success: true,
      message: 'Message submitted and auto-reply sent successfully.',
      data: { insertedId: result.insertedId }
    });
  } catch (error) {
    console.error('Error submitting message:', error.message);
    res.status(500).json({ error: 'An error occurred while submitting the message.' });
  }
});

router.post('/conversation', async (req, res) => {
    try {
        const decryptedData = decrypt(req.body.data);
        const { site, authen, course, player } = decryptedData;

        let user = null;

        if (authen) {
            const decodedToken = await verifyToken(authen.replace('Bearer ', ''));
            if (!decodedToken.status) {
                return res.status(401).json({ status: false, message: 'Invalid or expired token' });
            }
            user = decodedToken.decoded.user;
        }

        if (!user) {
            return res.status(401).json({ error: 'User authentication failed. Token is required.' });
        }

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);

        const messageCollection = targetDb.collection('message');
        const courseCollection = targetDb.collection('course');
        const playerCollection = targetDb.collection('player');
        const userCollection = targetDb.collection('user');

        // Fetch user messages filtered by course and player
        const filter = {
            userID: user,
            ...(course && { courseID: course }),
            ...(player && { playerID: player }),
        };

        const userMessages = await messageCollection.find(filter).sort({ createdAt: -1 }).toArray();

        // Fetch related data for each message
        const enrichedMessages = await Promise.all(userMessages.map(async (msg) => {
            const courseData = await courseCollection.findOne({ _id: safeObjectId(msg.courseID) }) || {};
            const playerData = await playerCollection.findOne({ _id: safeObjectId(msg.playerID) }) || {};
            const userDetails = await userCollection.findOne({ _id: safeObjectId(msg.userID) }) || {};

            return {
                _id: msg._id,
                content: msg.content,
                replies: msg.replies,
                createdAt: msg.createdAt,
                status: msg.status,
                course: { id: msg.courseID, name: courseData.name },
                player: { id: msg.playerID, name: playerData.name },
                user: userDetails || null
            };
        }));

        res.status(200).json({
            success: true,
            data: enrichedMessages,
        });
    } catch (error) {
        console.error('Error fetching conversations:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while fetching conversations.' });
    }
});

router.post('/reply', async (req, res) => {
    try {
        const decryptedData = decrypt(req.body.data);
        console.log("decryptedData", decryptedData);

        const { site, messageId, replyContent, userID, authen, sendFullHistory = false } = decryptedData; // New Option

        let user = null;

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

        if (!user) {
            return res.status(401).json({ error: 'User authentication failed. Token is required.' });
        }

        const { client } = req;
        const { targetDb } = await getSiteSpecificDb(client, site);
        const messageCollection = targetDb.collection('message');

        const message = await messageCollection.findOne({ _id: safeObjectId(messageId) });
        if (!message) {
            return res.status(404).json({ error: 'Message not found.' });
        }

        // Add user's reply first
        await messageCollection.updateOne(
            { _id: safeObjectId(messageId) },
            {
                $push: {
                    replies: {
                        userID: userID || user,
                        content: replyContent,
                        createdAt: new Date()
                    }
                },
                $set: { updatedAt: new Date() }
            }
        );

        // ค้นหาคำตอบที่คล้ายกันจาก Redis ก่อน
        let aiReply = null;
        const similarResults = await searchSimilarChat(replyContent);
        
        // ถ้าพบคำตอบที่คล้ายกัน ใช้คำตอบนั้น
        if (similarResults && similarResults.length > 2) {
            // ดึงคำตอบที่เจอจาก Redis (มีคะแนนความเหมือนสูง)
            const bestMatch = similarResults[2] ? similarResults[2] : null;
            if (bestMatch && bestMatch.score > 0.85) {
                aiReply = bestMatch.message;
                console.log('RED :: Using similar response from cache');
                console.log(`คำตอบจากแคช (${bestMatch.score.toFixed(2)}): ${aiReply.substring(0, 50)}...`);
            }
        }
        
        // ถ้าไม่พบคำตอบที่คล้ายกัน จึงใช้ AI
        if (!aiReply) {
            // Fetch updated conversation history
            let aiPrompt;
            if (sendFullHistory) {
                // Send entire conversation history
                const updatedMessage = await messageCollection.findOne({ _id: safeObjectId(messageId) });
                const conversationHistory = updatedMessage.replies.map(reply => {
                    const sender = reply.userID === user ? "คุณ" : "ระบบ";
                    return `${sender}: ${reply.content}`;
                }).join('\n');

                aiPrompt = `นี่คือประวัติการสนทนา:\n${conversationHistory}`;
            } else {
                // Send only the last user message
                aiPrompt = `"${replyContent}" ตอบสั้นที่สุด`;
            }

            console.log("aiPrompt", aiPrompt);

            // Generate AI response
            aiReply = await conversation(aiPrompt);
            console.log(`คำตอบจาก AI: ${aiReply.substring(0, 50)}...`);
            
            // บันทึกคำถามและคำตอบลงใน Redis สำหรับการค้นหาในอนาคต เฉพาะเมื่อไม่ใช่ข้อความแสดงข้อผิดพลาด
            if (aiReply !== "ขออภัย ไม่สามารถสร้างข้อความตอบกลับได้ในขณะนี้.") {
                await saveChat(user, `คำถาม: ${replyContent}\nคำตอบ: ${aiReply}`);
            }
        }

        // Add AI's reply
        await messageCollection.updateOne(
            { _id: safeObjectId(messageId) },
            {
                $push: {
                    replies: {
                        userID: 'system',
                        content: aiReply,
                        createdAt: new Date()
                    }
                },
                $set: { updatedAt: new Date() }
            }
        );

        // Update status if it's the first reply
        if (message.replies.length === 0) {
            await messageCollection.updateOne(
                { _id: safeObjectId(messageId) },
                { $set: { status: 'answered', updatedAt: new Date() } }
            );
        }

        res.status(200).json({ 
            success: true, 
            message: 'Reply and AI response added successfully.', 
            aiReply 
        });
    } catch (error) {
        console.error('Error replying to message:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while replying to the message.' });
    }
});

router.post('/close', async (req, res) => {
    try {
        const decryptedData = decrypt(req.body.data);
        const { site, messageId, authen } = decryptedData;

        let admin = null;

        if (authen) {
            const decodedToken = await verifyToken(authen.replace('Bearer ', ''));
            if (!decodedToken.status) {
                return res.status(401).json({ status: false, message: 'Invalid or expired token' });
            }
            admin = decodedToken.decoded.user;
        }

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site)
        const messageCollection = targetDb.collection('message');

        await messageCollection.updateOne(
            { _id: safeObjectId(messageId) },
            { $set: { status: 'closed', updatedAt: new Date() } }
        );

        res.status(200).json({ success: true, message: 'Conversation closed successfully.' });
    } catch (error) {
        console.error('Error closing conversation:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while closing the conversation.' });
    }
});

router.post('/delete', async (req, res) => {
    try {
        const decryptedData = decrypt(req.body.data);
        const { site, messageId, authen } = decryptedData;

        let user = null;

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

        if (!user) {
            return res.status(401).json({ error: 'User authentication failed. Token is required.' });
        }

        const { client } = req;
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);
        const messageCollection = targetDb.collection('message');

        const deleteResult = await messageCollection.deleteOne({ _id: safeObjectId(messageId) });

        if (deleteResult.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'Message not found or already deleted.' });
        }

        res.status(200).json({ success: true, message: 'Message deleted successfully.' });
    } catch (error) {
        console.error('Error deleting message:', error.message, error.stack);
        res.status(500).json({ error: 'An error occurred while deleting the message.' });
    }
});

module.exports = router;
