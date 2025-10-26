const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// Function to process document using APYHub API
const processDocumentWithAPYHub = async (documentUrl) => {
  console.debug('เริ่มประมวลผลเอกสารด้วย APYHub:', documentUrl);
  const apyToken = "APY0Cf99TYvtbYlAVMpOR3WuN9kB7t0oEU7VkNVMBA7IWObVngg799MiMr9O1Jtq";
  const body = JSON.stringify({
    url: documentUrl,
    requested_service: "apyhub",
  });
  console.debug('ส่งคำขอไปยัง APYHub ด้วย payload:', body);

  try {
    console.debug('กำลังเรียก API APYHub...');
    const response = await fetch("https://api.apyhub.com/ai/document/extract/invoice/url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apy-token": apyToken,
      },
      body,
    });

    const data = await response.json();
    console.debug('ได้รับการตอบกลับจาก APYHub:', data);
    
    if (response.ok) {
      console.debug('ประมวลผลเอกสารสำเร็จ');
      return data;
    } else {
      console.error("เกิดข้อผิดพลาดในการประมวลผลเอกสารกับ APYHub:", data);
      throw new Error("ไม่สามารถประมวลผลเอกสารกับ APYHub ได้");
    }
  } catch (error) {
    console.error("เกิดข้อผิดพลาดในการเชื่อมต่อ:", error);
    throw error;
  }
};

// Define /ai POST endpoint
router.post('/', async (req, res) => {
  console.debug('ได้รับคำขอ POST ที่ /ai endpoint:', req.body);
  const { documentUrl } = req.body;

  if (!documentUrl) {
    console.debug('ไม่พบ documentUrl ในคำขอ');
    return res.status(400).json({
      error: "ต้องระบุฟิลด์ 'documentUrl'",
    });
  }

  try {
    console.debug('กำลังเริ่มประมวลผลเอกสาร...');
    const result = await processDocumentWithAPYHub(documentUrl);
    console.debug('ประมวลผลเอกสารเสร็จสิ้น:', result);

    res.status(200).json({ result });
  } catch (error) {
    console.error("เกิดข้อผิดพลาดที่ /ai endpoint:", error);
    res.status(500).json({ error: "เกิดข้อผิดพลาดในการประมวลผลเอกสาร" });
  }
});

module.exports = router;
