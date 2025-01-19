const express = require('express');
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
const { authenticateClient, safeObjectId, errorHandler } = require('./routes/middleware/mongoMiddleware');
const axios = require('axios'); // For making HTTP requests
const { crossOriginResourcePolicy } = require('helmet');
const CryptoJS = require('crypto-js');
const router = express.Router();

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

async function generateCustomMessage(prompt) {
    const GEMINI_API_KEY = "AIzaSyB_DNNNAbBpaQ41rKHgDeL-zzGpQmjcRH4"; // Replace with your actual API key
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`;
    const headers = {
      "Content-Type": "application/json"
    };
    const body = JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ]
    });
  
    try {
      const response = await axios.post(url, body, { headers });
      if (response.status === 200) {
        const generatedText = response.data.candidates[0]?.content.parts[0]?.text.trim();
        return generatedText || "ขออภัย ไม่สามารถสร้างข้อความตอบกลับได้ในขณะนี้.";
      } else {
        console.error("Error generating message:", response.data);
        return "ขออภัย ไม่สามารถสร้างข้อความตอบกลับได้ในขณะนี้.";
      }
    } catch (error) {
      console.error("Network error generating message:", error);
      return "ขออภัย ไม่สามารถสร้างข้อความตอบกลับได้ในขณะนี้.";
    }
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
  
      const customPrompt = `โปรดตอบกลับอย่างสุภาพ กระชับ และเป็นมิตร โดยรับทราบปัญหาที่ผู้ใช้งานแจ้ง หากต้องการข้อมูลเพิ่มเติมให้สอบถามอย่างสุภาพ และหากไม่สามารถตอบได้ ให้แจ้งว่าทีมงานจะตรวจสอบและติดตามผลโดยเร็ว โดยไม่ต้องให้คำมั่นสัญญาหรือกำหนดเวลาในการแก้ไข ตอบกลับเป็นข้อความธรรมดา (Plain Text) โดยไม่ต้องมีรูปแบบหรือฟอร์แมตพิเศษ\n\nคำถามจากผู้ใช้งาน:\n"${content}"`;
      
      const autoReply = await generateCustomMessage(customPrompt);
  
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

        const { site, messageId, replyContent, userID, authen } = decryptedData;

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

        // Fetch updated conversation history
        const updatedMessage = await messageCollection.findOne({ _id: safeObjectId(messageId) });
        const conversationHistory = updatedMessage.replies.map(reply => {
            const sender = reply.userID === user ? "คุณ" : "ระบบ";
            return `${sender}: ${reply.content}`;
        }).join('\n');

        // Enhanced AI prompt for helpful response
        // Context-aware AI prompt
        const aiPrompt = `นี่คือข้อมูลติดต่อของผู้ดูแลระบบ คือ เบอร์ 02123456789 email xxx@xxx.com พยายามไม่แจ้งข้อมูลนี้แก่ผู้ใช้งาน จนกว่าผู้ใช้งานจะขอ นี่คือประวัติการสนทนาระหว่างผู้ใช้งานและระบบ:\n${conversationHistory}\n\nโปรดตอบกลับอย่างสุภาพ กระชับ และเป็นมิตร โดยตอบสนองให้สอดคล้องกับบริบทของการสนทนา หากเป็นการทักทายหรือสอบถามทั่วไป ให้แนะนำการติดต่อหรือบริการที่เกี่ยวข้อง หากเป็นการแจ้งปัญหาให้สอบถามข้อมูลเพิ่มเติมหรือแนะนำวิธีแก้ไขเบื้องต้น ตอบกลับเป็นข้อความธรรมดา (Plain Text) หากบริบทของข้อความมีการกล่าวขอบคุณหรือมีท่าทีต้องการจบการสนทนา กรุณาสอบถามผู้ใช้งานว่า 'ต้องการจบการสนทนานี้หรือไม่? กรุณาตอบ ใช่ หรือ ตกลง เพื่อดำเนินการปิดการสนทนา'`;

        // Generate AI response
        const aiReply = await generateCustomMessage(aiPrompt);

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
