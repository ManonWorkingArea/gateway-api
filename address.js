const express = require('express');
const { authenticateClient, safeObjectId, errorHandler } = require('./routes/middleware/mongoMiddleware');
const { redisClient } = require('./routes/middleware/redis');
const router = express.Router();

// Middleware to authenticate client
router.use(authenticateClient);

// Helper function to get database collections
const getDbCollections = async (client, collections) => {
    const db = client.db('thailand');
    return collections.reduce((acc, col) => (acc[col] = db.collection(col), acc), {});
};

const CACHE_EXPIRATION = 60 * 60 * 24 * 30; // 30 days

router.get('/provinces', async (req, res) => {
    const cacheKey = 'province:all';

    try {
        const cachedProvinces = await redisClient.get(cacheKey);

        if (cachedProvinces) {
            console.log('DAT :: Redis');
            return res.status(200).json({ success: true, data: JSON.parse(cachedProvinces), cache: true });
        }

        const { client } = req;
        const { province } = await getDbCollections(client, ['province']);

        const provinces = await province.find({})
            .project({ _id: 1, id: 1, name_th: 1, name_en: 1 })
            .sort({ name_th: 1 })  // เรียงลำดับจาก ก-ฮ
            .toArray();

        await redisClient.setEx(cacheKey, CACHE_EXPIRATION, JSON.stringify(provinces));
        res.status(200).json({ success: true, data: provinces, cache: false });
    } catch (error) {
        console.error('Error fetching provinces:', error);
        res.status(500).json({ error: 'An error occurred while fetching provinces.' });
    }
});

router.get('/amphure/:province_id', async (req, res) => {
    const { province_id } = req.params;
    const cacheKey = `amphure:${province_id}`;

    try {
        const cachedAmphures = await redisClient.get(cacheKey);

        if (cachedAmphures) {
            console.log('DAT :: Redis');
            return res.status(200).json({ success: true, data: JSON.parse(cachedAmphures), cache: true });
        }

        const { client } = req;
        const { amphure } = await getDbCollections(client, ['amphure']);

        const amphures = await amphure
            .find({ province_id: parseInt(province_id) })
            .project({ _id: 1, id: 1, name_th: 1, name_en: 1, province_id: 1 })
            .sort({ name_th: 1 })  // เรียงลำดับจาก ก-ฮ
            .toArray();

        await redisClient.setEx(cacheKey, CACHE_EXPIRATION, JSON.stringify(amphures));
        res.status(200).json({ success: true, data: amphures, cache: false });
    } catch (error) {
        console.error('Error fetching amphures:', error);
        res.status(500).json({ error: 'An error occurred while fetching amphures.' });
    }
});

router.get('/tambon/:amphure_id', async (req, res) => {
    const { amphure_id } = req.params;
    const cacheKey = `tambon:${amphure_id}`;

    try {
        const cachedTambons = await redisClient.get(cacheKey);

        if (cachedTambons) {
            console.log('DAT :: Redis');
            return res.status(200).json({ success: true, data: JSON.parse(cachedTambons), cache: true });
        }

        const { client } = req;
        const { tambon } = await getDbCollections(client, ['tambon']);

        const tambons = await tambon
            .find({ amphure_id: parseInt(amphure_id) })
            .project({ _id: 1, id: 1, name_th: 1, name_en: 1, amphure_id: 1, zip_code: 1 })
            .sort({ name_th: 1 })  // เรียงลำดับจาก ก-ฮ
            .toArray();

        await redisClient.setEx(cacheKey, CACHE_EXPIRATION, JSON.stringify(tambons));
        res.status(200).json({ success: true, data: tambons, cache: false });
    } catch (error) {
        console.error('Error fetching tambons:', error);
        res.status(500).json({ error: 'An error occurred while fetching tambons.' });
    }
});

module.exports = router;
