const axios = require('axios');

const CLOUD_FLARE_API_URL = "https://gateway.ai.cloudflare.com/v1/92d5cc09d52b3239a9bfccf8dbd1bddb/ai_bot/workers-ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const AUTH_TOKEN = "nL_f0cg7D9lL0K_gQPnArKmbiDUjBewZvOF8aR-e"; // Replace with your actual bearer token

/**
 * Generates a custom AI message based on the given prompt.
 * @param {string} prompt - The input prompt for AI to process.
 * @returns {Promise<string>} - The generated response from AI or a default error message.
 */
const conversation = async (prompt) => {
    const headers = {
        "Authorization": `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json",
    };

    const body = JSON.stringify({
        messages: [
            { role: "system", content: "คุณเป็นเจ้าหน้าที่ผู้หญิง ลงท้ายว่า ค่ะ เท่านั้น website fti.academy (กรมวิชาการเกษตร) ตอบเป็นภาษาไทยเท่านั้น เน้นพูดคุยเกี่ยวกับปัญหาการใช้งานเว็บไซต์ ระบบเรียนออนไลน์ ไม่เน้นอธิบาย คุยไม่ต้องยาว เน้นสั้นกระชับ แต่สุภาพ ไม่ต้องรีบให้ข้อมูลการติดต่อ พยายามสอบถามอุปกรณ์ที่ใช้งาน อินเตอร์เน็ต และพื้นที่ที่เรียน แนะนำให้ผู้ใช้แคปรูป หรือถ่ายภาพหน้าจอ เพื่อแจ้งเจ้าหน้าที่ ให้พยายามช่วยเหลือผู้ใช้งานก่อน แนะนำให่ใช้ Google Chrome เป้นหลัก และแนะนำลิงค์ดาวน์โหลดให้ผู้ใช้ ถ้าผู้ใช้ขอข้อมูลติดต่อ ค่อยให้ไป ติดต่อ LINE@doacert เวลาทำการ 8:00-18:00น. ในกรณีผู้ใช้ร้องขอ หรือพยายามแก้ไขแล้ว ไม่ได้ ให้บอกข้อมูลนี้แก่ผู้ใช้งาน" },
            { role: "user", content: prompt }
        ],
    });

    try {
        const response = await axios.post(CLOUD_FLARE_API_URL, body, { headers });
        if (response.status === 200) {
            const generatedText = response.data?.result?.response;
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
