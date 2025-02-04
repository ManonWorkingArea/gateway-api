const express = require("express");
const axios = require("axios");

const router = express.Router();

const CLOUDFLARE_ACCOUNT_ID = "92d5cc09d52b3239a9bfccf8dbd1bddb";
const CLOUDFLARE_API_KEY    = "DxRt2DzwTwjIw6KzvtkBA8tqbqyRlN7jlAZNKBRK";
const CLOUDFLARE_API_URL    = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/stream`;

router.post("/copy", async (req, res) => {
    try {
        const { url, meta } = req.body;
        if (!url || !meta?.name) {
            return res.status(400).json({ error: "Missing required fields: url or meta.name" });
        }

        const response = await axios.post(
            CLOUDFLARE_API_URL + '/copy',
            { url, meta },
            {
                headers: {
                    "Authorization": `Bearer ${CLOUDFLARE_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const { result } = response.data;

        res.status(response.status).json({
            uid: result.uid,
            thumbnail: result.thumbnail,
            status: result.status.state,
            created: result.created,
            modified: result.modified,
            uploaded: result.uploaded,
            size: result.size,
            playback:  result.playback.hls,
            success: true
        });

    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.message });
    }
});


// Unified route to list all videos or get a single video by ID
router.get("/stream/:id?", async (req, res) => {
    try {
        const { id } = req.params;
        const url = id ? `${CLOUDFLARE_API_URL}/${id}` : CLOUDFLARE_API_URL;

        const response = await axios.get(url, {
            headers: {
                "Authorization": `Bearer ${CLOUDFLARE_API_KEY}`,
            }
        });

        const { result } = response.data;

        res.status(response.status).json({
            uid: result.uid,
            thumbnail: result.thumbnail,
            status: result.status.state,
            created: result.created,
            modified: result.modified,
            uploaded: result.uploaded,
            size: result.size,
            playback:  result.playback.hls,
            success: true
        });
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.message });
    }
});

// Delete a Cloudflare Stream video by ID
router.delete("/stream/:id", async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: "Video ID is required" });
        }

        const url = `${CLOUDFLARE_API_URL}/${id}`;
        const response = await axios.delete(url, {
            headers: {
                "Authorization": `Bearer ${CLOUDFLARE_API_KEY}`,
            }
        });

        res.status(response.status).json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.message });
    }
});

module.exports = router;
