const redis = require('redis');
const { OpenAI } = require('openai');
const crypto = require('crypto');
 
// Redis Client Setup
const redisClient = redis.createClient({
  url: `redis://default:e3PHPsEo92tMA5mNmWmgV8O6cn4tlblB@redis-19867.fcrce171.ap-south-1-1.ec2.redns.redis-cloud.com:19867`,
  socket: {
    tls: true,
    connectTimeout: 10000,
    keepAlive: 5000,
    reconnectStrategy: (retries) => {
      const delay = Math.min(50 * 2 ** retries + Math.random() * 100, 3000);
      console.warn(`Reconnecting to Redis... Attempt ${retries}, retrying in ${delay}ms`);
      return delay;
    }
  }
});

// Event Listeners
redisClient.on('connect', () => console.log('RED :: Connected.'));
redisClient.on('ready', () => console.log('RED :: Ready.'));
redisClient.on('error', (err) => console.error('RED :: Error:', err));
redisClient.on('end', () => console.warn('RED :: Closed.'));
redisClient.on('reconnecting', () => console.warn('RED :: Reconnecting...'));

// Connect to Redis
(async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    console.error('Failed to connect to Redis:', err);
  }
})();

// สร้าง OpenAI client ให้ถูกต้อง
const openaiClient = new OpenAI({
  apiKey: `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`
});

// ตรวจสอบว่า Redis มี RediSearch หรือไม่
let hasRediSearch = false;

async function checkRediSearch() {
  try {
    // ตรวจสอบคำสั่ง FT.INFO
    await redisClient.sendCommand(['FT._LIST']);
    hasRediSearch = true;
    console.log('RED :: RediSearch module is available');
    return true;
  } catch (err) {
    hasRediSearch = false;
    console.warn('RED :: RediSearch module is NOT available, using standard key-value storage instead');
    return false;
  }
}

// เรียกใช้ตรวจสอบทันทีหลังเชื่อมต่อ
redisClient.on('ready', async () => {
  await checkRediSearch();
  // สร้าง indexes เมื่อเชื่อมต่อสำเร็จ
  if (hasRediSearch) {
    await setupIndex();
    await setupVectorIndex();
  }
});

// Cache Configuration
const maxCacheAge = 60 * 60 * 24 * 30; // 30 วัน (ระยะเวลาเก็บแชท)
const maxChatPerCategory = 1000; // จำนวนแชทสูงสุดต่อหมวดหมู่

// ฟังก์ชันการแบ่งหมวดหมู่ข้อความแบบง่าย
function getCategoryFromText(text) {
  // ตรวจสอบคำสำคัญในข้อความเพื่อกำหนดหมวดหมู่
  const lowerText = text.toLowerCase();
  
  if (/บัญชี|สมัคร|ล็อกอิน|เข้าสู่ระบบ|รหัสผ่าน|username|password|login|register|signup/.test(lowerText)) {
    return 'account';
  }
  if (/การชำระ|ชำระเงิน|ราคา|ค่าใช้จ่าย|payment|price|cost|บัตรเครดิต|credit|โอนเงิน/.test(lowerText)) {
    return 'payment';
  }
  if (/หลักสูตร|บทเรียน|วิชา|สอน|เรียน|course|lesson|learn|study|บทเรียน/.test(lowerText)) {
    return 'course';
  }
  if (/เทคนิค|ปัญหา|error|bug|ไม่ทำงาน|ใช้งานไม่ได้|เข้าไม่ได้|technical|problem/.test(lowerText)) {
    return 'technical';
  }
  if (/ติดต่อ|contact|สอบถาม|ช่วยเหลือ|help|support/.test(lowerText)) {
    return 'support';
  }
  
  return 'general'; // หมวดหมู่ทั่วไปถ้าไม่ตรงกับหมวดอื่น
}

// สร้างคลาสสำหรับคำนวณความคล้ายคลึงของข้อความ
class TextSimilarity {
  static tokenize(text) {
    // แยกข้อความเป็นคำ, ลบวรรณยุกต์แลงแปลงเป็นตัวพิมพ์เล็ก
    return text.toLowerCase()
      .replace(/[^\u0E00-\u0E7F\w\s]/g, '') // เก็บเฉพาะตัวอักษรไทย-อังกฤษ-ตัวเลข
      .replace(/[\u0E48-\u0E4E]/g, '') // ลบวรรณยุกต์ไทย
      .split(/\s+/);
  }

  static calculateJaccardSimilarity(text1, text2) {
    const tokens1 = new Set(this.tokenize(text1));
    const tokens2 = new Set(this.tokenize(text2));
    
    const intersection = new Set([...tokens1].filter(token => tokens2.has(token)));
    const union = new Set([...tokens1, ...tokens2]);
    
    return intersection.size / union.size;
  }
  
  static calculateTFIDFSimilarity(text1, text2) {
    // ปรับให้ไม่ใช้ natural แต่คำนวณแบบง่ายเอง
    try {
      // คำนวณความถี่ของคำในแต่ละข้อความ
      const tokens1 = this.tokenize(text1);
      const tokens2 = this.tokenize(text2);
      
      // นับความถี่ในแต่ละข้อความ
      const freq1 = {};
      const freq2 = {};
      
      for (const token of tokens1) {
        freq1[token] = (freq1[token] || 0) + 1;
      }
      
      for (const token of tokens2) {
        freq2[token] = (freq2[token] || 0) + 1;
      }
      
      // หาคำที่มีในทั้งสองข้อความ
      const commonTokens = Object.keys(freq1).filter(token => freq2[token]);
      
      // คำนวณความคล้ายคลึงจากความถี่ของคำร่วมกัน
      let similarity = 0;
      let total1 = 0;
      let total2 = 0;
      
      for (const token of commonTokens) {
        similarity += freq1[token] * freq2[token];
      }
      
      // คำนวณขนาดของเวกเตอร์ทั้งสอง
      for (const token in freq1) {
        total1 += freq1[token] * freq1[token];
      }
      
      for (const token in freq2) {
        total2 += freq2[token] * freq2[token];
      }
      
      // คำนวณความคล้ายคลึงแบบ cosine
      const norm = Math.sqrt(total1) * Math.sqrt(total2);
      return norm === 0 ? 0 : similarity / norm;
    } catch (error) {
      console.error('Error calculating similarity:', error);
      // ถ้าเกิดข้อผิดพลาด ให้ใช้ Jaccard แทน
      return this.calculateJaccardSimilarity(text1, text2);
    }
  }
  
  static findBestMatch(query, candidates) {
    let bestMatch = null;
    let highestScore = 0;
    
    for (const candidate of candidates) {
      // คำนวณความคล้ายคลึงผสมระหว่าง Jaccard และ TF-IDF แบบพื้นฐาน
      const jaccardScore = this.calculateJaccardSimilarity(query, candidate.message);
      const tfidfScore = this.calculateTFIDFSimilarity(query, candidate.message);
      
      // คำนวณคะแนนรวม (ให้น้ำหนัก Jaccard มากกว่า)
      const score = (jaccardScore * 0.7) + (tfidfScore * 0.3);
      
      if (score > highestScore) {
        highestScore = score;
        bestMatch = {
          ...candidate,
          score: score
        };
      }
    }
    
    return bestMatch;
  }
}

// Caching Functions
async function getCachedData(key) {
  try {
    const cachedData = await redisClient.get(key);
    return cachedData ? JSON.parse(cachedData) : null;
  } catch (err) {
    console.error(`Failed to get cache for key ${key}:`, err);
    return null;
  }
}

async function setCachedData(key, data, expiry = maxCacheAge) {
  try {
    await redisClient.setEx(key, expiry, JSON.stringify(data));
  } catch (err) {
    console.error(`Failed to set cache for key ${key}:`, err);
  }
}

// Setup Full-Text Search Index - ปรับเป็นฟังก์ชัน Safe
async function setupIndex() {
  if (!hasRediSearch) return false;
  
  try {
    await redisClient.sendCommand([
      "FT.CREATE", "chatlog_idx", "ON", "HASH", "PREFIX", "1", "chat:",
      "SCHEMA", "user_id", "TEXT", "message", "TEXT", "answer", "TEXT", "category", "TAG", "timestamp", "NUMERIC", "SORTABLE"
    ]);
    console.log("RED :: Full-Text Search Index Created.");
    return true;
  } catch (err) {
    console.warn("RED :: Index might already exist or RediSearch not available");
    return false;
  }
}

// Setup Vector Index for Semantic Search - ปรับเป็นฟังก์ชัน Safe
async function setupVectorIndex() {
  if (!hasRediSearch) return false;
  
  try {
    await redisClient.sendCommand([
      "FT.CREATE", "vector_idx", "ON", "HASH", "PREFIX", "1", "vec:",
      "SCHEMA", "vector", "VECTOR", "FLAT", "6", "DIM", "1536", "DISTANCE_METRIC", "COSINE"
    ]);
    console.log("RED :: Vector Index Created.");
    return true;
  } catch (err) {
    console.warn("RED :: Vector Index might already exist or RediSearch not available");
    return false;
  }
}

// ปรับปรุงฟังก์ชัน getEmbedding ให้มีประสิทธิภาพสูงขึ้น
async function getEmbedding(text) {
  try {
    if (!text || typeof text !== 'string' || text.trim() === '') {
      console.warn('RED :: Empty or invalid text for embedding');
      return null;
    }

    // จำกัดความยาวข้อความให้พอเหมาะกับ embedding model
    const trimmedText = text.length > 8000 ? text.substring(0, 8000) : text;
    
    const response = await openaiClient.embeddings.create({
      input: trimmedText,
      model: "text-embedding-ada-002"
    });
    
    if (response && response.data && response.data.length > 0) {
      console.log(`RED :: Created embedding for text (${trimmedText.length} chars)`);
      return response.data[0].embedding;
    } else {
      console.warn('RED :: Invalid response from OpenAI embedding API');
      return null;
    }
  } catch (error) {
    console.error('RED :: Error creating embedding:', error);
    return null;
  }
}

// เพิ่มฟังก์ชันการค้นหาแบบ semantic ใช้ OpenAI เปรียบเทียบความหมาย
async function semanticSearch(query, candidates, threshold = 0.7) {
  try {
    if (!candidates || candidates.length === 0) {
      return [];
    }

    // แปลงคำถามเป็น embedding
    const queryEmbedding = await getEmbedding(query);
    if (!queryEmbedding) {
      console.warn('RED :: Could not get embedding for query');
      return [];
    }

    const results = [];

    // แบ่งกลุ่มเพื่อประมวลผล (บรรทัดนี้ช่วยลดภาระการเรียก API)
    const batchSize = 20;
    const batches = [];
    for (let i = 0; i < candidates.length; i += batchSize) {
      batches.push(candidates.slice(i, i + batchSize));
    }

    for (const batch of batches) {
      // ทำการสร้าง embedding สำหรับข้อความในแต่ละกลุ่ม
      const embeddingPromises = batch.map(async (item) => {
        if (!item.embedding) {
          item.embedding = await getEmbedding(item.question);
        }
        return item;
      });

      const itemsWithEmbeddings = await Promise.all(embeddingPromises);

      // คำนวณความคล้ายคลึงสำหรับแต่ละข้อความ
      for (const item of itemsWithEmbeddings) {
        if (item.embedding) {
          const similarity = calculateCosineSimilarity(queryEmbedding, item.embedding);
          if (similarity > threshold) {
            results.push({
              ...item,
              score: similarity
            });
          }
        }
      }
    }

    // เรียงผลลัพธ์ตามคะแนนความคล้ายคลึงจากมากไปน้อย
    results.sort((a, b) => b.score - a.score);
    
    return results;
  } catch (error) {
    console.error('RED :: Error in semantic search:', error);
    return [];
  }
}

// ฟังก์ชันคำนวณความคล้ายคลึงแบบ cosine
function calculateCosineSimilarity(vector1, vector2) {
  if (!vector1 || !vector2 || vector1.length !== vector2.length) {
    return 0;
  }

  let dotProduct = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;

  for (let i = 0; i < vector1.length; i++) {
    dotProduct += vector1[i] * vector2[i];
    magnitude1 += vector1[i] * vector1[i];
    magnitude2 += vector2[i] * vector2[i];
  }

  magnitude1 = Math.sqrt(magnitude1);
  magnitude2 = Math.sqrt(magnitude2);

  if (magnitude1 === 0 || magnitude2 === 0) {
    return 0;
  }

  return dotProduct / (magnitude1 * magnitude2);
}

// เพิ่มฟังก์ชันวิเคราะห์ข้อความโดย OpenAI เพื่อเปรียบเทียบความหมาย
async function compareTextMeaningWithAI(query, text) {
  try {
    const systemPrompt = "คุณเป็น AI ที่เชี่ยวชาญในการวิเคราะห์ความคล้ายคลึงของข้อความ";
    
    const response = await openaiClient.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `โปรดวิเคราะห์ว่าข้อความสองข้อความนี้มีความหมายคล้ายกันหรือไม่? ให้ตอบด้วยคะแนนความคล้ายคลึงจาก 0 ถึง 1 เท่านั้น โดย 0 คือไม่เกี่ยวข้องกันเลย และ 1 คือเป็นความหมายเดียวกัน

ข้อความที่ 1: "${query}"

ข้อความที่ 2: "${text}"

คะแนนความคล้ายคลึง (0-1):` }
      ],
      max_tokens: 10,
      temperature: 0.1
    });

    // ดึงคะแนนจากการตอบกลับ
    const content = response.choices?.[0]?.message?.content?.trim() || "0";
    // แปลงเป็นตัวเลข (ถ้ามีตัวเลขในข้อความ)
    const scoreMatch = content.match(/([0-9]\.[0-9]+|[0-9])/);
    const score = scoreMatch ? parseFloat(scoreMatch[0]) : 0;
    
    return score;
  } catch (error) {
    console.error('RED :: Error comparing text meaning with AI:', error);
    return 0;
  }
}

// เพิ่มฟังก์ชันแนะนำคำตอบโดย AI เมื่อไม่พบคำตอบที่ตรงกัน
async function suggestAIAnswer(query, candidates) {
  try {
    if (candidates.length === 0) {
      return null;
    }

    // เตรียมข้อมูลเพื่อส่งให้ AI
    const candidatesText = candidates
      .map((item, index) => `${index + 1}. คำถาม: ${item.question}\nคำตอบ: ${item.answer}`)
      .join('\n\n');

    const systemPrompt = "คุณเป็น AI ผู้เชี่ยวชาญในการให้คำแนะนำที่ดีที่สุด";
    
    const response = await openaiClient.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `คำถามของผู้ใช้คือ: "${query}"

ฉันมีคำถามและคำตอบที่อาจเกี่ยวข้องดังนี้:

${candidatesText}

โปรดเลือกคำตอบที่ดีที่สุดสำหรับคำถามของผู้ใช้ หรือรวมข้อมูลเพื่อสร้างคำตอบที่สมบูรณ์กว่า ตอบเฉพาะคำตอบไม่ต้องมีคำอธิบายเพิ่มเติม` }
      ],
      max_tokens: 500,
      temperature: 0.3
    });

    const answer = response.choices?.[0]?.message?.content?.trim();
    if (answer) {
      return {
        source: 'ai_enhanced',
        message: answer,
        score: 0.99 // คะแนนสูงเพราะเป็นคำตอบจาก AI ที่ปรับแต่งแล้ว
      };
    }
    return null;
  } catch (error) {
    console.error('RED :: Error suggesting AI answer:', error);
    return null;
  }
}

// Save Chat Log - ปรับเพิ่มให้แยกคำถาม-คำตอบและบันทึกตามหมวดหมู่
async function saveChat(userId, message) {
  try {
    // สร้าง ID ใหม่สำหรับการแชทนี้
    const chatId = crypto.randomUUID();
    const timestamp = Date.now();
    
    // แยกคำถามและคำตอบ
    let question = message;
    let answer = '';
    const qa = extractQA(message);
    if (qa.question && qa.answer) {
      question = qa.question;
      answer = qa.answer;
    }
    
    // กำหนดหมวดหมู่
    const category = getCategoryFromText(question);
    
    // บันทึกข้อความพื้นฐาน
    await redisClient.hSet(`chat:${chatId}`, {
      user_id: userId,
      message: message,
      question: question,
      answer: answer,
      category: category,
      timestamp: timestamp
    });
    
    // บันทึกคำสำคัญเพื่อการค้นหา
    const keywords = extractKeywords(question);
    for (const keyword of keywords) {
      await redisClient.sAdd(`keyword:${keyword.toLowerCase()}`, chatId);
    }
    
    // เพิ่มลงในหมวดหมู่ พร้อมคะแนนตามเวลา (ใหม่กว่า = คะแนนสูงกว่า)
    await redisClient.zAdd(`category:${category}`, { score: timestamp, value: chatId });
    
    // ตรวจสอบและลบข้อความเก่าถ้ามีมากเกินไป
    const categoryCount = await redisClient.zCard(`category:${category}`);
    if (categoryCount > maxChatPerCategory) {
      // ลบข้อความเก่าที่สุด
      const oldestChatIds = await redisClient.zRange(`category:${category}`, 0, categoryCount - maxChatPerCategory - 1);
      if (oldestChatIds.length > 0) {
        // ลบออกจาก sorted set
        await redisClient.zRem(`category:${category}`, oldestChatIds);
        
        // ลบข้อมูลทั้งหมดของแชทเก่า
        for (const oldChatId of oldestChatIds) {
          await redisClient.del(`chat:${oldChatId}`);
          // คำสำคัญมากเกินกว่าจะลบทั้งหมด จึงปล่อยไว้เพื่อประหยัด CPU
        }
      }
    }
    
    // บันทึก vector ถ้ามี RediSearch
    if (hasRediSearch) {
      try {
        const vector = await getEmbedding(question);
        if (vector) {
          await redisClient.hSet(`vec:${chatId}`, {
            message: question,
            answer: answer,
            vector: Buffer.from(new Float32Array(vector))
          });
        }
      } catch (error) {
        console.warn('RED :: Failed to save vector:', error.message);
      }
    }
    
    console.log(`RED :: Chat saved (ID: ${chatId}, Category: ${category})`);
    return chatId;
  } catch (error) {
    console.error('RED :: ไม่สามารถบันทึกข้อความได้:', error);
    return null;
  }
}

// ฟังก์ชันดึงคำสำคัญจากข้อความ (เพิ่มประสิทธิภาพ)
function extractKeywords(text) {
  // แยกคำถามและคำตอบ (หากมี)
  const { question } = extractQA(text);
  
  // นำข้อความมาแยกคำ ลบคำที่ไม่มีความสำคัญ
  const words = question.toLowerCase()
    .replace(/[^\u0E00-\u0E7F\w\s]/g, '') // เก็บแค่ตัวอักษรไทย-อังกฤษ-ตัวเลข
    .replace(/[\u0E48-\u0E4E]/g, '') // ลบวรรณยุกต์ไทย
    .split(/\s+/)
    .filter(word => word.length > 2) // เก็บเฉพาะคำที่ยาวกว่า 2 ตัวอักษร
    .filter(word => !['และ', 'หรือ', 'ที่', 'ใน', 'การ', 'เป็น', 'ได้', 'มี', 'จะ', 'ให้', 'ของ', 'กับ', 
                      'แล้ว', 'ไม่', 'ไป', 'มา', 'the', 'and', 'for', 'with', 'this', 'that', 'is', 'are', 
                      'was', 'were', 'have', 'has', 'had', 'not', 'from', 'but'].includes(word));
  
  return [...new Set(words)]; // ตัดคำซ้ำออก
}

// Search Messages by category - ค้นหาตามหมวดหมู่
async function searchChatByCategory(category, limit = 50) {
  try {
    // ใช้ ZRANGE แทน zRevRange และกำหนด REV เพื่อให้เรียงจากมากไปน้อย
    const chatIds = await redisClient.zRange(`category:${category}`, 0, limit - 1, { REV: true });
    
    if (!chatIds || chatIds.length === 0) {
      return [];
    }
    
    const results = [];
    for (const chatId of chatIds) {
      const chatData = await redisClient.hGetAll(`chat:${chatId}`);
      if (chatData && chatData.message) {
        // ตรวจสอบว่ามีการแยกคำถาม-คำตอบหรือไม่
        let question = chatData.message;
        let answer = chatData.answer || '';
        
        // ถ้ายังไม่มีการแยก ให้พยายามแยกโดยใช้รูปแบบ "คำถาม: ... คำตอบ: ..."
        if (!answer && question.includes('คำถาม:') && question.includes('คำตอบ:')) {
          const qa = extractQA(question);
          if (qa.question && qa.answer) {
            question = qa.question;
            answer = qa.answer;
          }
        }
        
        results.push({
          id: chatId,
          question: question,
          answer: answer,
          category: chatData.category || category,
          user_id: chatData.user_id,
          timestamp: parseInt(chatData.timestamp) || 0
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error(`RED :: Error searching chats by category ${category}:`, error);
    return [];
  }
}

// Search Messages - ปรับให้ค้นหาตามหมวดหมู่ก่อน
async function searchChat(query) {
  // กำหนดหมวดหมู่ของคำถาม
  const category = getCategoryFromText(query);
  
  // ค้นหาจากแชทในหมวดหมู่เดียวกันก่อน
  const categoryChats = await searchChatByCategory(category, 50);
  
  // ถ้ามี RediSearch ให้ใช้การค้นหาแบบ full-text
  if (hasRediSearch) {
    try {
      const result = await redisClient.sendCommand([
        "FT.SEARCH", "chatlog_idx", `%${query}%`, "LIMIT", "0", "10"
      ]);
      // นำผลลัพธ์ที่ได้จาก RediSearch มารวมกับผลการค้นหาจากหมวดหมู่
      // แปลงผลลัพธ์ให้อยู่ในรูปแบบเดียวกัน
      if (Array.isArray(result) && result.length > 1) {
        for (let i = 2; i < result.length; i += 2) {
          const chatId = result[i];
          const chatData = result[i + 1];
          
          if (chatData && chatData.length > 1) {
            // แปลงข้อมูลให้อยู่ในรูปแบบ object
            const chatObj = {};
            for (let j = 0; j < chatData.length; j += 2) {
              chatObj[chatData[j]] = chatData[j + 1];
            }
            
            // เพิ่มลงในผลลัพธ์หากยังไม่มี
            if (!categoryChats.some(c => c.id === chatId)) {
              categoryChats.push({
                id: chatId,
                question: chatObj.message,
                answer: chatObj.answer,
                user_id: chatObj.user_id,
                category: chatObj.category,
                timestamp: parseInt(chatObj.timestamp)
              });
            }
          }
        }
      }
      
      return categoryChats;
    } catch (err) {
      console.error("RED :: Search Error with FT.SEARCH:", err);
    }
  }
  
  // ถ้าไม่มี RediSearch หรือการค้นหาล้มเหลว ใช้การค้นหาแบบพื้นฐาน
  return searchChatWithoutRedisearch(query, categoryChats);
}

// วิธีค้นหาแบบพื้นฐานโดยไม่ใช้ RediSearch
async function searchChatWithoutRedisearch(query, existingResults = []) {
  try {
    // สร้าง Set เพื่อเก็บ ID ที่มีอยู่แล้ว
    const existingIds = new Set(existingResults.map(item => item.id));
    
    // สกัดคำสำคัญจากคำถาม
    const keywords = extractKeywords(query);
    
    // ใช้ Sets เพื่อหาคำตอบที่มีคำสำคัญทั้งหมด
    const chatIdSets = [];
    const results = [...existingResults]; // เริ่มด้วยผลลัพธ์ที่มีอยู่แล้ว
    
    // ค้นหาแต่ละคีย์เวิร์ด
    for (const keyword of keywords) {
      const chatIds = await redisClient.sMembers(`keyword:${keyword.toLowerCase()}`);
      if (chatIds.length > 0) {
        chatIdSets.push(new Set(chatIds));
      }
    }
    
    // ถ้าไม่พบคีย์เวิร์ดใดเลย
    if (chatIdSets.length === 0) {
      return existingResults;
    }
    
    // หา intersection ของชุด chatIds ทั้งหมด (ต้องมีทุกคีย์เวิร์ด)
    let commonChatIds = [...chatIdSets[0]];
    for (let i = 1; i < chatIdSets.length; i++) {
      commonChatIds = commonChatIds.filter(id => chatIdSets[i].has(id));
    }
    
    // รวบรวมข้อมูลจาก chat ids ที่พบ
    for (const chatId of commonChatIds) {
      // ข้ามถ้ามีอยู่แล้วในผลลัพธ์
      if (existingIds.has(chatId)) continue;
      
      const chatData = await redisClient.hGetAll(`chat:${chatId}`);
      if (chatData && chatData.message) {
        results.push({
          id: chatId,
          question: chatData.message,
          answer: chatData.answer || '',
          user_id: chatData.user_id,
          category: chatData.category,
          timestamp: parseInt(chatData.timestamp)
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error('RED :: Error in basic search:', error);
    return existingResults;
  }
}

// ปรับปรุงฟังก์ชัน searchSimilarChat ให้ใช้การค้นหาแบบซับซ้อน
async function searchSimilarChat(query) {
  console.log(`RED :: Searching for similar chat to: "${query.substring(0, 50)}..."`);
  
  // 1. ค้นหาตามหมวดหมู่ก่อน
  const category = getCategoryFromText(query);
  let candidates = await searchChatByCategory(category, 30);
  
  // 2. ใช้ vector search ถ้ามี RediSearch
  let vectorResults = [];
  if (hasRediSearch) {
    try {
      const queryVector = await getEmbedding(query);
      
      if (queryVector) {
        try {
          const redisResults = await redisClient.sendCommand([
            "FT.SEARCH", "vector_idx", "*=>[KNN 10 @vector $vec AS score]", 
            "PARAMS", "2", "vec", Buffer.from(new Float32Array(queryVector)),
            "RETURN", "3", "message", "answer", "score",
            "SORTBY", "score", "DESC"
          ]);
          
          if (Array.isArray(redisResults) && redisResults.length > 1) {
            for (let i = 2; i < redisResults.length; i += 2) {
              const vecId = redisResults[i].replace('vec:', '');
              const data = redisResults[i + 1];
              
              const item = {};
              for (let j = 0; j < data.length; j += 2) {
                item[data[j]] = data[j + 1];
              }
              
              const score = parseFloat(item.score);
              if (score > 0.7) {
                const chatData = await redisClient.hGetAll(`chat:${vecId}`);
                if (chatData) {
                  vectorResults.push({
                    id: vecId,
                    question: item.message || chatData.question || "",
                    answer: item.answer || chatData.answer || "",
                    score: score,
                    user_id: chatData.user_id,
                    category: chatData.category
                  });
                }
              }
            }
          }
        } catch (error) {
          console.warn('RED :: Error in vector search command:', error.message);
        }
      }
    } catch (error) {
      console.warn('RED :: Vector search failed:', error.message);
    }
  }
  
  // รวมผลลัพธ์จากทั้งสองแหล่ง
  candidates = [...candidates, ...vectorResults];
  
  // 3. ถ้ามีผลลัพธ์น้อยเกินไป ใช้การค้นหาพื้นฐาน
  if (candidates.length < 5) {
    const basicResults = await searchChatWithoutRedisearch(query);
    candidates = [...candidates, ...basicResults];
  }
  
  // 4. ใช้การค้นหาแบบ semantic เพื่อหาความคล้ายคลึงที่แท้จริง
  let semanticResults = [];
  if (candidates.length > 0) {
    semanticResults = await semanticSearch(query, candidates, 0.7);
  }
  
  // 5. ถ้าไม่พบผลลัพธ์ที่มีความคล้ายคลึงสูงพอ ใช้ AI วิเคราะห์
  if (semanticResults.length === 0 && candidates.length > 0) {
    console.log('RED :: No high similarity results, analyzing top candidates with AI');
    
    // เลือกผู้สมัครที่ดีที่สุด 3 อันดับแรก
    const topCandidates = candidates.slice(0, 3);
    
    // วิเคราะห์ความคล้ายคลึงกับ AI
    for (const candidate of topCandidates) {
      const aiSimilarity = await compareTextMeaningWithAI(query, candidate.question);
      if (aiSimilarity > 0.7) {
        semanticResults.push({
          ...candidate,
          score: aiSimilarity
        });
      }
    }
    
    // เรียงผลลัพธ์ตามคะแนน
    semanticResults.sort((a, b) => b.score - a.score);
  }
  
  // 6. ถ้ายังไม่พบผลลัพธ์ที่เหมาะสม แต่มีผู้สมัครบางคน ให้ AI แนะนำ
  if (semanticResults.length === 0 && candidates.length > 0) {
    console.log('RED :: Creating enhanced AI response based on existing content');
    const aiSuggestion = await suggestAIAnswer(query, candidates.slice(0, 5));
    
    if (aiSuggestion) {
      return [0.95, query, aiSuggestion];
    }
  }
  
  // 7. ถ้าพบผลลัพธ์ที่มีความคล้ายคลึงสูง ส่งกลับผลลัพธ์แรก
  if (semanticResults.length > 0 && semanticResults[0].score > 0.8) {
    console.log(`RED :: Found similar message with score ${semanticResults[0].score}`);
    return [
      semanticResults[0].score,
      semanticResults[0].question,
      {
        score: semanticResults[0].score,
        message: semanticResults[0].answer || "ไม่พบคำตอบสำหรับคำถามนี้"
      }
    ];
  }
  
  // 8. ถ้าไม่พบข้อความที่คล้ายกันพอ
  console.log('RED :: No similar message found with acceptable score');
  return [];
}

// Export Middleware
module.exports = {
  redisClient,
  getCachedData,
  setCachedData,
  setupIndex,
  setupVectorIndex,
  saveChat,
  searchChat,
  searchSimilarChat,
  searchChatByCategory,
  checkRediSearch,
  TextSimilarity,
  getCategoryFromText,
  compareTextMeaningWithAI,
  semanticSearch
};
