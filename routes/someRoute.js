router.get('/data/:id', async (req, res) => {
  try {
    const cacheKey = `data:${req.params.id}`;
    
    // ดึงข้อมูลจาก cache
    const cachedData = await req.getCachedData(cacheKey);
    if (cachedData) {
      return res.json(cachedData);
    }

    // ถ้าไม่มีใน cache ดึงข้อมูลจาก database
    const data = await someDatabase.getData(req.params.id);
    
    // บันทึกลง cache
    await req.setCachedData(cacheKey, data, 300); // หมดอายุใน 5 นาที
    
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ล้าง cache เมื่อมีการอัพเดทข้อมูล
router.post('/data/:id', async (req, res) => {
  try {
    await someDatabase.updateData(req.params.id, req.body);
    // ล้าง cache ที่เกี่ยวข้อง
    await req.clearCache(`data:${req.params.id}`);
    // หรือล้างทั้งหมดที่ขึ้นต้นด้วย data:
    await req.clearCache('data:*');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}); 