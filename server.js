const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS - Fixed for Netlify
app.use(cors({
  origin: ['https://utamuagency.netlify.app', 'http://localhost:3000', '*'],
  credentials: true
}));

app.options('*', cors());

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Folders
const uploadDir = 'uploads';
const dataDir = 'data';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Multer for files (including nude photos & videos)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({ 
  storage, 
  limits: { fileSize: 100 * 1024 * 1024 } 
});

const applicationsFile = path.join(dataDir, 'applications.json');
if (!fs.existsSync(applicationsFile)) {
  fs.writeFileSync(applicationsFile, JSON.stringify([], null, 2));
}

// Routes
app.get('/', (req, res) => res.json({ status: "ok", message: "Utamu Backend Running" }));

app.post('/api/signup', (req, res) => {
  res.json({ success: true, message: "Account created" });
});

app.post('/api/login', (req, res) => {
  res.json({ 
    success: true, 
    token: "fake-jwt-" + Date.now(),
    user: { username: req.body.username || "user" }
  });
});

// Apply Route - Saves everything
app.post('/api/apply', upload.fields([
  { name: 'profilePicture', maxCount: 1 },
  { name: 'classyPhotos', maxCount: 2 },
  { name: 'nudePhotos', maxCount: 3 },
  { name: 'nudeVideos', maxCount: 3 }
]), (req, res) => {
  try {
    const application = {
      id: 'APP-' + Date.now(),
      timestamp: new Date().toISOString(),
      formData: req.body,
      files: {
        profilePicture: req.files.profilePicture ? req.files.profilePicture[0].filename : null,
        classyPhotos: req.files.classyPhotos ? req.files.classyPhotos.map(f => f.filename) : [],
        nudePhotos: req.files.nudePhotos ? req.files.nudePhotos.map(f => f.filename) : [],
        nudeVideos: req.files.nudeVideos ? req.files.nudeVideos.map(f => f.filename) : []
      }
    };

    let apps = JSON.parse(fs.readFileSync(applicationsFile));
    apps.unshift(application);
    fs.writeFileSync(applicationsFile, JSON.stringify(apps, null, 2));

    res.json({
      success: true,
      applicationId: application.id,
      message: "Application submitted successfully",
      welcomeLetterUrl: /api/welcome/${application.id}
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve Nude Photos & Videos
app.use('/uploads', express.static('uploads'));

// View All Applications (including file links)
app.get('/api/applications', (req, res) => {
  const apps = JSON.parse(fs.readFileSync(applicationsFile));
  res.json(apps);
});

app.get('/api/welcome/:id', (req, res) => {
  res.send(<h2>Welcome to Utamu Agency</h2><p>Application ID: ${req.params.id}<br>Your application is under review.</p>);
});

app.listen(PORT, () => console.log(🚀 Server running on port ${PORT}));