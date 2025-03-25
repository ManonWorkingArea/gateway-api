const express = require("express");
const axios = require("axios");

const router = express.Router();

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_KEY    = process.env.CLOUDFLARE_API_KEY;
const CLOUDFLARE_API_URL    =   `${process.env.CLOUDFLARE_API_URL}/${CLOUDFLARE_ACCOUNT_ID}/stream`;

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

// ฟังก์ชันสำหรับดึง JWK และ Key ID
async function fetchJWK() {
    const response = await axios.post(
        `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/stream/keys`,
        {},
        {
            headers: {
                "Authorization": `Bearer ${CLOUDFLARE_API_KEY}`,
                "Content-Type": "application/json"
            }
        }
    );

    console.log("JWK Response:", response.data);

    if (!response.data.result || !response.data.result.jwk || !response.data.result.id) {
        throw new Error("Invalid JWK response");
    }

    return {
        jwkKey: response.data.result.jwk,
        keyID: response.data.result.id,
    };
}


// Endpoint สำหรับสร้าง signed token
router.post("/generate-signed-token", async (req, res) => {
    try {
        const { videoUID } = req.body;
        if (!videoUID) {
            return res.status(400).json({ error: "Missing required field: videoUID" });
        }

        const { jwkKey, keyID } = await fetchJWK();
        const signedToken = await generateSignedToken(videoUID, jwkKey, keyID);

        const playerUrl = `https://customer-apw77h9sea196rll.cloudflarestream.com/${signedToken}/manifest/video.m3u8`;

        res.status(200).json({ url: playerUrl });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ฟังก์ชันสำหรับสร้าง signed token
async function generateSignedToken(videoUID, jwkKey, keyID, expiresTimeInS = 3600) {
    const encoder = new TextEncoder();
    const expiresIn = Math.floor(Date.now() / 1000) + expiresTimeInS;

    const headers = {
        alg: "RS256",
        kid: keyID,
    };

    const data = {
        sub: videoUID,
        kid: keyID,
        exp: expiresIn,
        accessRules: [
            {
                type: "ip.geoip.country",
                action: "allow",
                country: ["TH"], // เปลี่ยนเป็นประเทศที่ต้องการอนุญาต
            },
            {
                type: "any",
                action: "block",
            },
        ],
    };

    const token = `${objectToBase64url(headers)}.${objectToBase64url(data)}`;
    
    try {
        const jwk = JSON.parse(atob(jwkKey)); // ตรวจสอบว่า jwkKey ถูกต้อง
        const key = await crypto.subtle.importKey(
            "jwk",
            jwk,
            {
                name: "RSASSA-PKCS1-v1_5",
                hash: "SHA-256",
            },
            false,
            ["sign"],
        );

        const signature = await crypto.subtle.sign(
            { name: "RSASSA-PKCS1-v1_5" },
            key,
            encoder.encode(token),
        );

        const signedToken = `${token}.${arrayBufferToBase64Url(signature)}`;
        return signedToken;
    } catch (error) {
        throw new Error("Failed to generate signed token: " + error.message);
    }
}

// ฟังก์ชันช่วยสำหรับแปลง ArrayBuffer เป็น Base64 URL
function arrayBufferToBase64Url(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

// ฟังก์ชันช่วยสำหรับแปลง Object เป็น Base64 URL
function objectToBase64url(payload) {
    return arrayBufferToBase64Url(
        new TextEncoder().encode(JSON.stringify(payload)),
    );
}

module.exports = router;
