const dotenv = require('dotenv');
dotenv.config();

const axios = require('axios');

const AGENT_ENDPOINT = process.env.AGENT_ENDPOINT;
const AGENT_ACCESS_KEY = process.env.AGENT_ACCESS_KEY;

if (!AGENT_ENDPOINT || !AGENT_ACCESS_KEY) {
    console.error("Error: AGENT_ENDPOINT or AGENT_ACCESS_KEY is not set in environment variables.");
    process.exit(1);
}

/**
 * Generates a custom AI message based on the given prompt.
 * @param {string} prompt - The input prompt for AI to process.
 * @returns {Promise<string>} - The generated response from AI or a default error message.
 */
const conversation = async (prompt) => {
    try {
        const response = await axios.post(`${AGENT_ENDPOINT}/api/v1/chat/completions`, {
            messages: [{ role: "user", content: prompt }],
            stream: false,
            include_functions_info: false,
            include_retrieval_info: false,
            include_guardrails_info: false
        }, {
            headers: {
                "Authorization": `Bearer ${AGENT_ACCESS_KEY}`,
                "Content-Type": "application/json"
            }
        });

        if (response.status === 200 && response.data?.choices?.length > 0) {
            return response.data.choices[0].message?.content || "ขออภัย ไม่สามารถสร้างข้อความตอบกลับได้ในขณะนี้.";
        } else {
            console.error("Unexpected API response:", response.data);
            return "ขออภัย ไม่สามารถสร้างข้อความตอบกลับได้ในขณะนี้.";
        }
    } catch (error) {
        console.error("Network error:", error.response?.status, error.response?.data || error.message);
        return "ขออภัย ไม่สามารถสร้างข้อความตอบกลับได้ในขณะนี้.";
    }
};

module.exports = { conversation };
