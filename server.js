const express = require('express');
const multer = require('multer');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/uploads';
const METADATA_FILE = path.join(UPLOADS_DIR, 'metadata.json');
const EVENT_NAME = process.env.EVENT_NAME || 'Our Event';

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const APP_URL = process.env.APP_URL || `http://${getLocalIP()}:${PORT}`;

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function loadMetadata() {
  try {
    return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveMetadata(data) {
  fs.writeFileSync(METADATA_FILE, JSON.stringify(data, null, 2));
}

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/api/config', (req, res) => {
  res.json({ eventName: EVENT_NAME, appUrl: APP_URL });
});

app.post('/api/upload', (req, res) => {
  upload.array('photos', 20)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const metadata = loadMetadata();
    const newPhotos = req.files.map(file => ({
      id: uuidv4(),
      filename: file.filename,
      originalName: file.originalname,
      uploadedAt: new Date().toISOString(),
      size: file.size
    }));
    metadata.push(...newPhotos);
    saveMetadata(metadata);

    res.json({ success: true, count: newPhotos.length });
  });
});

app.get('/api/photos', (req, res) => {
  const metadata = loadMetadata();
  res.json([...metadata].reverse());
});

app.get('/api/qr', async (req, res) => {
  try {
    const qrDataUrl = await qrcode.toDataURL(APP_URL, {
      width: 320,
      margin: 2,
      color: { dark: '#1a1a2e', light: '#ffffff' }
    });
    res.json({ qr: qrDataUrl, url: APP_URL });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

app.delete('/api/photos/:filename', (req, res) => {
  const { filename } = req.params;
  const safeFilename = path.basename(filename);
  const filePath = path.join(UPLOADS_DIR, safeFilename);

  const metadata = loadMetadata();
  const index = metadata.findIndex(p => p.filename === safeFilename);
  if (index === -1) {
    return res.status(404).json({ error: 'Photo not found' });
  }

  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    metadata.splice(index, 1);
    saveMetadata(metadata);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎉 ${EVENT_NAME} — Photo Share`);
  console.log(`\n   App URL : ${APP_URL}`);
  console.log(`   QR Code : ${APP_URL}/api/qr`);
  console.log('\n   Share the URL or QR code with your guests!\n');
});
