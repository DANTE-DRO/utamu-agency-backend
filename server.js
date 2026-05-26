const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({ storage: storage });

const applicationsFile = path.join('data', 'applications.json');
if (!fs.existsSync('data')) fs.mkdirSync('data');
if (!fs.existsSync(applicationsFile)) {
  fs.writeFileSync(applicationsFile, JSON.stringify([]));
}

// Routes
app.get('/', (req, res) => res.send('✅ Utamu Backend is Running'));

app.post('/api/signup', (req, res) => res.json({ success: true }));
app.post('/api/login', (req, res) => res.json({ success: true, token: 'fake-token', user: { username: req.body.username } }));

app.post('/api/apply', upload.fields([
  { name: 'profilePicture', maxCount: 1 },
  { name: 'classyPhotos', maxCount: 2 },
  { name: 'nudePhotos', maxCount: 3 },
  { name: 'nudeVideos', maxCount: 3 }
]), (req, res) => {
  try {
    const appData = {
      id: 'APP-' + Date.now(),
      date: new Date().toISOString(),
      data: req.body,
      files: Object.keys(req.files).reduce((acc, key) => {
        acc[key] = req.files[key].map(f => f.filename);
        return acc;
      }, {})
    };

    let apps = JSON.parse(fs.readFileSync(applicationsFile));
    apps.unshift(appData);
    fs.writeFileSync(applicationsFile, JSON.stringify(apps, null, 2));

    res.json({ success: true, id: appData.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/uploads', express.static('uploads'));
app.get('/api/applications', (req, res) => {
  const apps = JSON.parse(fs.readFileSync(applicationsFile));
  res.json(apps);
});

app.listen(PORT, () => console.log(Server running on port ${PORT}));