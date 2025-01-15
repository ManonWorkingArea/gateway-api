const redis = require('redis');

const redisClient = redis.createClient({
  url: 'redis://default:e3PHPsEo92tMA5mNmWmgV8O6cn4tlblB@redis-19867.fcrce171.ap-south-1-1.ec2.redns.redis-cloud.com:19867',
  socket: {
    tls: true,
    reconnectStrategy: retries => Math.min(retries * 100, 3000)
  }
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));

(async () => {
  await redisClient.connect();
})();

const maxCacheAge = 60 * 60; // 1 hour in seconds

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

module.exports = {
  redisClient,
  getCachedData,
  setCachedData
};
