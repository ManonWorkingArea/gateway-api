const axios = require('axios');
 
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // กรุณาเปลี่ยนเป็น API key ของคุณ

/**
 * Generates a custom AI message based on the given prompt.
 * @param {string} prompt - The input prompt for AI to process.
 * @returns {Promise<string>} - The generated response from AI or a default error message.
 */
const conversation = async (prompt) => {
    const headers = {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
    };

    const body = JSON.stringify({
        model: "gpt-3.5-turbo",
        temperature: 0.5,  // ปรับให้ AI ตอบธรรมชาติมากขึ้น
        top_p: 0.8,        // เพิ่มโอกาสเลือกคำตอบที่หลากหลาย
        max_tokens: 150,   // ปรับให้ตอบได้ครบ ไม่ตัดกลางคัน
        messages: [
            { 
                role: "system", 
                content: `"เจ้าหน้าที่ เว็บไซต์ fti.academy ตอบสั้น กระชับ แก้ปัญหาเว็บไซต์ ไม่ต้องสวัสดี ไม่ต้อง'ครับ/ค่ะ' ทุกข้อความ
                📌 ถามอุปกรณ์
                📸 ให้แคปหน้าจอ
                🌐 ใช้ Chrome
                📞 LINE@doacert เมื่อผู้ใช้ขอ"
                ` 
            },
            { role: "user", content: prompt }
        ],
    });
    

    try {
        const response = await axios.post(OPENAI_API_URL, body, { headers });
        if (response.status === 200) {
            const generatedText = response.data?.choices[0]?.message?.content;
            return generatedText || "ขออภัย ไม่สามารถสร้างข้อความตอบกลับได้ในขณะนี้.";
        } else {
            console.error("Error generating message:", response.data);
            return "ขออภัย ไม่สามารถสร้างข้อความตอบกลับได้ในขณะนี้.";
        }
    } catch (error) {
        console.error("Network error generating message:", error.message);
        return "ขออภัย ไม่สามารถสร้างข้อความตอบกลับได้ในขณะนี้.";
    }
};

module.exports = { conversation };
