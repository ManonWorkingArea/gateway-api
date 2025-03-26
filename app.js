const { redisMiddleware } = require('./routes/middleware/redis');

// ใช้งาน Redis middleware แบบเปิดใช้งานทั้งหมด
app.use(redisMiddleware());

// หรือกำหนดค่าเพิ่มเติม
app.use(redisMiddleware({
  enabled: true,
  defaultExpiry: 600, // 10 นาที
  prefix: 'myapp'
})); 