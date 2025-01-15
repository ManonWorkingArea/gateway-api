const redis = require('redis');

const redisClient = redis.createClient({
  url: 'redis://default:e3PHPsEo92tMA5mNmWmgV8O6cn4tlblB@redis-19867.fcrce171.ap-south-1-1.ec2.redns.redis-cloud.com:19867',
  socket: {
    tls: true,
    connectTimeout: 10000,  // 10 seconds timeout for connection
    keepAlive: 5000,        // Send keepalive packets every 5 seconds
    reconnectStrategy: (retries) => {
      const delay = Math.min(50 * 2 ** retries + Math.random() * 100, 3000);
      console.warn(`Reconnecting to Redis... Attempt ${retries}, retrying in ${delay}ms`);
      return delay;
    }
  }
});

redisClient.on('connect', () => console.log('RED :: Success.'));
redisClient.on('ready', () => console.log('RED :: Ready.'));
redisClient.on('error', (err) => console.error('RED :: Error:', err));
redisClient.on('end', () => console.warn('RED :: Closed.'));
redisClient.on('reconnecting', () => console.warn('RED :: Reconnecting...'));

(async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    console.error('Failed to connect to Redis:', err);
  }
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
