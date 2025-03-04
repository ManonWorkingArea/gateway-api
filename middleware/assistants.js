
const axios = require('axios');

const OPENAI_API_BASE = "https://api.openai.com/v1";
const OPENAI_API_KEY = "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"; // กรุณาเปลี่ยนเป็น API key ของคุณ

// ID ของ Assistant ที่สร้างไว้แล้ว (คุณต้องสร้าง Assistant ก่อนในแดชบอร์ด OpenAI)
const ASSISTANT_ID = "asst_ZX761oDybQHKwKxHL9zvdghL"; // เปลี่ยนเป็น ID ของ Assistant ของคุณ

const headers = {
    "Authorization": `Bearer ${OPENAI_API_KEY}`,
    "Content-Type": "application/json",
    "OpenAI-Beta": "assistants=v2"
};

/**
 * Fetches assistant response via OpenAI Assistants API with improved speed.
 * @param {string} prompt - The user's input message.
 * @returns {Promise<string>} - The AI-generated response.
 */
const conversation = async (prompt) => {
    try {
        // 1. Create a new thread
        const threadResponse = await axios.post(`${OPENAI_API_BASE}/threads`, {}, { headers });
        const threadId = threadResponse.data.id;

        // 2. Send message to the thread
        await axios.post(`${OPENAI_API_BASE}/threads/${threadId}/messages`, {
            role: "user",
            content: prompt
        }, { headers });

        // 3. Run Assistant on the thread
        const runResponse = await axios.post(`${OPENAI_API_BASE}/threads/${threadId}/runs`, {
            assistant_id: ASSISTANT_ID
        }, { headers });

        const runId = runResponse.data.id;

        // 4. Wait for Assistant to complete using Exponential Backoff
        let runStatus = "queued";
        let delay = 500; // Start with 500ms delay
        const maxDelay = 5000; // Max delay per request (5 seconds)
        const maxRetries = 10; // Prevent infinite loops

        for (let i = 0; i < maxRetries; i++) {
            await new Promise(resolve => setTimeout(resolve, delay));

            const statusResponse = await axios.get(`${OPENAI_API_BASE}/threads/${threadId}/runs/${runId}`, { headers });
            runStatus = statusResponse.data.status;

            if (runStatus === "completed") break;

            // Increase delay exponentially, but limit to `maxDelay`
            delay = Math.min(delay * 2, maxDelay);
        }

        if (runStatus !== "completed") {
            console.error("Run failed or took too long:", runStatus);
            return "Sorry, the assistant is taking too long to respond.";
        }

        // 5. Fetch the latest assistant message
        const messagesResponse = await axios.get(`${OPENAI_API_BASE}/threads/${threadId}/messages`, { headers });

        // Get the last assistant message directly
        const assistantMessages = messagesResponse.data.data
            .filter(msg => msg.role === "assistant");

        if (assistantMessages.length > 0) {
            return assistantMessages[assistantMessages.length - 1].content[0].text.value;
        }

        return "No response from assistant.";
    } catch (error) {
        console.error("Error:", error.message);
        return "An error occurred while generating a response.";
    }
};

module.exports = { conversation };