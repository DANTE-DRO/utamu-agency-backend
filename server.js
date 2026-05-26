const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'utamu-super-secret-change-this-on-render';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '11monari72dan';
const FRONTEND_URL = process.env.FRONTEND_URL || '*';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const LETTERS_DIR = path.join(DATA_DIR, 'welcome-letters');

ensureDir(DATA_DIR);
ensureDir(UPLOADS_DIR);
ensureDir(LETTERS_DIR);
ensureDb();

app.disable('x-powered-by');
app.use(morgan('dev'));
app.use(cors({
  origin: FRONTEND_URL === '*' ? true : FRONTEND_URL.split(',').map(v => v.trim()),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Disposition']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/welcome-letters', express.static(LETTERS_DIR, {
  setHeaders: (res, filePath) => {
    res.setHeader('Content-Type', 'application/pdf');
    if (filePath.endsWith('.pdf')) {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
    }
  }
}));
app.use('/public', express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempDir = path.join(UPLOADS_DIR, 'incoming');
    ensureDir(tempDir);
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    const safeName = sanitizeFileName(file.originalname || 'file');
    cb(null, `${Date.now()}-${crypto.randomUUID()}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: {
    files: 20,
    fileSize: 100 * 1024 * 1024
  }
});

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = {
      users: [],
      applications: [],
      fileIndex: []
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
  }
}

function readDb() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDb(data) {
  const temp = `${DB_PATH}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, DB_PATH);
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'user') return res.status(401).json({ error: 'Invalid token' });
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminRequired(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Admin authorization required' });
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'admin') return res.status(401).json({ error: 'Invalid admin token' });
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired admin token' });
  }
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    createdAt: user.createdAt
  };
}

function normalizeFormBody(body = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(body)) {
    normalized[key] = typeof value === 'string' ? value.trim() : value;
  }
  return normalized;
}

function classifyFile(file) {
  const key = (file.fieldname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  const original = (file.originalname || '').toLowerCase();

  if (key.includes('profile')) return 'profilePicture';
  if (key.includes('classy')) return 'classyPhotos';
  if (key.includes('video') || mime.startsWith('video/') || /\.(mp4|mov|avi|mkv|webm)$/i.test(original)) return 'nudeVideos';
  if (key.includes('nude')) return 'nudePhotos';
  if (mime.startsWith('image/')) return 'imageFile';
  if (mime.startsWith('video/')) return 'videoFile';
  return 'otherFile';
}

function buildApplicationSummary(appRecord) {
  return {
    id: appRecord.id,
    applicationId: appRecord.id,
    createdAt: appRecord.createdAt,
    submittedBy: appRecord.submittedBy,
    username: appRecord.form.username || appRecord.form.userName || appRecord.form.submittedBy || '',
    officialName: appRecord.form.officialName || appRecord.form.oneOfficialName || appRecord.form.fullName || '',
    mpesaNumber: appRecord.form.mpesaNumber || appRecord.form.mpesa || '',
    whatsappNumber: appRecord.form.whatsappNumber || appRecord.form.whatsapp || '',
    email: appRecord.form.email || '',
    consent: appRecord.form.consent || '',
    totalFiles: appRecord.files.length,
    welcomeLetterUrl: appRecord.welcomeLetterUrl
  };
}

function csvEscape(value) {
  const str = value == null ? '' : String(value);
  return '"' + str.replace(/"/g, '""') + '"';
}

function saveWelcomeLetter(application) {
  const filename = `Utamu_Welcome_${application.id}.pdf`;
  const absolutePath = path.join(LETTERS_DIR, filename);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const stream = fs.createWriteStream(absolutePath);
  doc.pipe(stream);

  doc.rect(0, 0, doc.page.width, doc.page.height).fill('#0a0a0a');
  doc.fillColor('#d4af37').fontSize(28).text('UTAMU AGENCY', { align: 'center' });
  doc.moveDown(0.2);
  doc.fontSize(12).fillColor('#f5f5f5').text('Luxury Companionship · Premium Experiences', { align: 'center' });
  doc.moveDown(2);
  doc.fontSize(22).fillColor('#d4af37').text('WELCOME LETTER', { align: 'center' });
  doc.moveDown(1.5);
  doc.fontSize(13).fillColor('#f5f5f5');

  const applicantName = application.form.officialName || application.form.oneOfficialName || application.form.fullName || application.form.username || application.submittedBy || 'Applicant';
  const bodyLines = [
    `Dear ${applicantName},`,
    '',
    'Thank you for submitting your application to Utamu Agency.',
    'Your details and uploaded media have been received successfully and stored in the admin portal for internal review.',
    '',
    `Application ID: ${application.id}`,
    `Submitted At: ${new Date(application.createdAt).toLocaleString('en-KE', { hour12: true })}`,
    `Submitted By: ${application.submittedBy || 'guest'}`,
    '',
    'Our admin team will review your application and contact you through the WhatsApp number you provided if you are shortlisted.',
    '',
    'Regards,',
    'Utamu Agency Admin Team'
  ];

  bodyLines.forEach(line => {
    doc.text(line, { align: 'left' });
    doc.moveDown(line === '' ? 0.5 : 0.15);
  });

  doc.moveDown(2);
  doc.fontSize(10).fillColor('#999999').text('Confidential · For applicant use only', { align: 'center' });
  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve({ filename, url: `/welcome-letters/${filename}` }));
    stream.on('error', reject);
  });
}

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'Utamu Agency Backend',
    status: 'running',
    adminUrl: '/admin',
    time: new Date().toISOString()
  });
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/health', (req, res) => {
  const db = readDb();
  res.json({
    ok: true,
    users: db.users.length,
    applications: db.applications.length,
    storage: DATA_DIR,
    time: new Date().toISOString()
  });
});

app.post('/api/signup', async (req, res) => {
  try {
    const { email, username, password } = normalizeFormBody(req.body);
    if (!email || !username || !password) {
      return res.status(400).json({ error: 'Email, username and password are required' });
    }

    const db = readDb();
    const usernameExists = db.users.some(u => u.username.toLowerCase() === username.toLowerCase());
    const emailExists = db.users.some(u => u.email.toLowerCase() === email.toLowerCase());

    if (usernameExists) return res.status(409).json({ error: 'Username already exists' });
    if (emailExists) return res.status(409).json({ error: 'Email already exists' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: crypto.randomUUID(),
      email,
      username,
      passwordHash,
      createdAt: new Date().toISOString()
    };

    db.users.push(user);
    writeDb(db);

    return res.status(201).json({
      message: 'Signup successful',
      user: publicUser(user)
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Server error while signing up' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = normalizeFormBody(req.body);
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const db = readDb();
    const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Invalid username or password' });

    const token = jwt.sign({ type: 'user', id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token, user: publicUser(user) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Server error while logging in' });
  }
});

app.post('/api/apply', authRequired, upload.any(), async (req, res) => {
  try {
    const form = normalizeFormBody(req.body || {});
    const files = Array.isArray(req.files) ? req.files : [];
    if (!form.consent || String(form.consent).toLowerCase() !== 'true') {
      return res.status(400).json({ error: 'Consent is required' });
    }

    const applicationId = `UTA-${Date.now()}`;
    const applicationFolder = path.join(UPLOADS_DIR, applicationId);
    ensureDir(applicationFolder);

    const storedFiles = files.map(file => {
      const finalPath = path.join(applicationFolder, path.basename(file.path));
      fs.renameSync(file.path, finalPath);
      return {
        id: crypto.randomUUID(),
        fieldname: file.fieldname,
        category: classifyFile(file),
        originalName: file.originalname,
        storedName: path.basename(finalPath),
        mimeType: file.mimetype,
        size: file.size,
        relativePath: path.relative(DATA_DIR, finalPath).replace(/\\/g, '/'),
        uploadedAt: new Date().toISOString()
      };
    });

    const application = {
      id: applicationId,
      createdAt: new Date().toISOString(),
      submittedBy: form.submittedBy || req.user.username,
      userId: req.user.id,
      form,
      files: storedFiles,
      welcomeLetterUrl: null
    };

    const welcome = await saveWelcomeLetter(application);
    application.welcomeLetterUrl = welcome.url;

    const db = readDb();
    db.applications.push(application);
    storedFiles.forEach(file => {
      db.fileIndex.push({
        ...file,
        applicationId,
        username: application.submittedBy,
        email: form.email || ''
      });
    });
    writeDb(db);

    return res.status(201).json({
      message: 'Application submitted successfully',
      applicationId,
      welcomeLetterUrl: application.welcomeLetterUrl
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Submission failed' });
  }
});

app.post('/api/admin/login', (req, res) => {
  const { password } = normalizeFormBody(req.body || {});
  if (!password) return res.status(400).json({ error: 'Password is required' });
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid admin password' });

  const token = jwt.sign({ type: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
  return res.json({ token, adminUrl: '/admin' });
});

app.get('/api/admin/applications', adminRequired, (req, res) => {
  const db = readDb();
  const items = [...db.applications]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(buildApplicationSummary);
  res.json({ applications: items });
});

app.get('/api/admin/applications/:id', adminRequired, (req, res) => {
  const db = readDb();
  const application = db.applications.find(app => app.id === req.params.id);
  if (!application) return res.status(404).json({ error: 'Application not found' });
  res.json({ application });
});

app.get('/api/admin/files/:fileId', adminRequired, (req, res) => {
  const db = readDb();
  const file = db.fileIndex.find(f => f.id === req.params.fileId);
  if (!file) return res.status(404).json({ error: 'File not found' });
  const absolutePath = path.join(DATA_DIR, file.relativePath);
  if (!fs.existsSync(absolutePath)) return res.status(404).json({ error: 'Stored file missing on disk' });
  res.download(absolutePath, file.originalName);
});

app.get('/api/admin/export/csv', adminRequired, (req, res) => {
  const db = readDb();
  const headers = [
    'applicationId', 'createdAt', 'submittedBy', 'username', 'officialName', 'mpesaNumber', 'whatsappNumber', 'email', 'consent', 'totalFiles'
  ];

  const rows = db.applications.map(app => {
    const summary = buildApplicationSummary(app);
    return [
      summary.applicationId,
      summary.createdAt,
      summary.submittedBy,
      summary.username,
      summary.officialName,
      summary.mpesaNumber,
      summary.whatsappNumber,
      summary.email,
      summary.consent,
      summary.totalFiles
    ].map(csvEscape).join(',');
  });

  const csv = [headers.map(csvEscape).join(','), ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="utamu-applications.csv"');
  res.send(csv);
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'One of the uploaded files is too large. Maximum size is 100MB per file.' });
    }
    return res.status(400).json({ error: err.message });
  }
  return res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Utamu backend running on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
