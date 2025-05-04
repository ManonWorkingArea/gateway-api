const express = require("express");
const multer = require("multer");
const path = require("path");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const router = express.Router();

// S3 Configuration (Using AWS SDK v3)
const S3_BUCKET = "vue-project";
const S3_ENDPOINT = "https://sgp1.digitaloceanspaces.com";
const S3_REGION = "ap-southeast-1";
const S3_KEY = "DO00DU278JRJU8FXGCLK";
const S3_SECRET = "aOqyyASQ5SMk3faWHCoFE7A42IlHPbIJFHic/W4OF5E";

// Create S3 Client
const s3Client = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  credentials: {
    accessKeyId: S3_KEY,
    secretAccessKey: S3_SECRET,
  },
});

// Configure Multer for File Uploads
const upload = multer({ storage: multer.memoryStorage() });

// Function to Generate a Unique Filename
const generateUniqueFileName = (originalName) => {
  const timestamp = Date.now();
  const randomNum = Math.floor(100000 + Math.random() * 900000); // 6-digit random number
  const ext = path.extname(originalName);
  return `temp/${timestamp}-${randomNum}${ext}`;
};

// Upload File Endpoint
router.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  // Determine the base name for the file
  let originalName;
  if (req.query.filename) {
    // Use filename from query parameter but keep the original extension
    const originalExt = path.extname(req.file.originalname);
    originalName = req.query.filename + originalExt;
  } else {
    // Use the original filename from the uploaded file
    originalName = req.file.originalname;
  }

  const fileName = generateUniqueFileName(originalName);
  const params = {
    Bucket: S3_BUCKET,
    Key: fileName,
    Body: req.file.buffer,
    ContentType: req.file.mimetype,
    ACL: "public-read",
  };

  try {
    await s3Client.send(new PutObjectCommand(params));
    const fileUrl = `${S3_ENDPOINT}/${S3_BUCKET}/${fileName}`;
    const fileExt = path.extname(fileName).substring(1); // Get extension without the dot
    res.json({ message: "File uploaded successfully", url: fileUrl, type: fileExt });
  } catch (error) {
    res.status(500).json({ error: "Upload failed", details: error.message });
  }
});

module.exports = router;
