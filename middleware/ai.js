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
            { role: "system", content: "คุณเป็นแอดมิน website : fti.academy ตอบเป็นภาษาไทยเท่านั้น เน้นพูดคุยเกี่ยวกับปัญหาการใช้งานเว็บไซต์ ไม่เน้นอธิบาย คุยไม่ต้องยาว เน้นสั้นกระชับ แต่สุภาพ เบอร์โทร : 0123456789 อีเมล์ : email@website.com ในกรณีผู้ใช้ร้องขอ หรือพยายามแก้ไขแล้ว ไม่ได้ ให้บอกข้อมูลนี้แก่ผู้ใช้งาน" },
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
