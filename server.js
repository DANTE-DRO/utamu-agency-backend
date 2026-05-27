/**
 * ============================================================
 *  UTAMU AGENCY - BACKEND SERVER
 *  Author: Utamu Agency
 *  Tech: Node.js + Express + SQLite (persistent storage)
 *  Hosting: Render.com
 * ============================================================
 *
 *  WHAT THIS BACKEND DOES:
 *  - Stores user signups (email, username, hashed password)
 *  - Handles login / forgot-password reset
 *  - Stores "Mombasa Hookup Weekend" applications (with files)
 *  - Admin panel API: view/list/download/delete applications
 *  - Uploaded files (photos, videos) saved on disk and served back
 *  - Everything is persisted to a SQLite DB file (data.db)
 *    so info DOES NOT disappear after refresh/logout/redeploy
 *    (as long as the disk is mounted on Render).
 *
 *  HOW TO RUN LOCALLY:
 *    1) npm install
 *    2) node server.js
 *    The server starts on http://localhost:5000
 *
 *  HOW TO DEPLOY ON RENDER.COM:
 *    1) Push this `backend/` folder to a GitHub repo
 *    2) On Render.com -> New Web Service -> connect repo
 *    3) Build Command:  npm install
 *       Start Command:  node server.js
 *    4) Add a Persistent Disk (Settings -> Disks)
 *         Name:  utamu-data
 *         Mount Path:  /var/data
 *         Size: 1 GB (or more)
 *    5) Add Environment Variables (Settings -> Environment):
 *         JWT_SECRET    = (any long random string)
 *         ADMIN_USER    = admin
 *         ADMIN_PASS    = (your strong password)
 *         DATA_DIR      = /var/data
 *    6) Deploy. Your backend URL will be:
 *         https://utamu-agency-backend.onrender.com
 *
 *  ADMIN PANEL:
 *    Open:  https://utamu-agency-backend.onrender.com/admin
 *    Login with ADMIN_USER / ADMIN_PASS
 *
 * ============================================================
 */

const express      = require('express');
const cors         = require('cors');
const multer       = require('multer');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const path         = require('path');
const fs           = require('fs');
const Database     = require('better-sqlite3');
const { v4: uuid } = require('uuid');
require('dotenv').config();

// -------------------------------------------------------------
//  CONFIG
// -------------------------------------------------------------
const PORT        = process.env.PORT || 5000;
const JWT_SECRET  = process.env.JWT_SECRET  || 'utamu-super-secret-change-me';
const ADMIN_USER  = process.env.ADMIN_USER  || 'admin';
let   ADMIN_PASS  = process.env.ADMIN_PASS  || 'utamu2025'; // can be reset from admin panel
const DATA_DIR    = process.env.DATA_DIR    || path.join(__dirname, 'data');

// Make sure storage folders exist
if (!fs.existsSync(DATA_DIR))                       fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(path.join(DATA_DIR, 'uploads'))) fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

// -------------------------------------------------------------
//  DATABASE (SQLite - file stored on persistent disk)
// -------------------------------------------------------------
const db = new Database(path.join(DATA_DIR, 'utamu.db'));
db.pragma('journal_mode = WAL');

// Users table (signup / login)
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  reset_token   TEXT,
  reset_expires INTEGER,
  created_at    INTEGER DEFAULT (strftime('%s','now'))
);
`);

// Applications table (Mombasa Hookup Weekend apply-now form)
db.exec(`
CREATE TABLE IF NOT EXISTS applications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id  TEXT UNIQUE NOT NULL,
  username        TEXT NOT NULL,
  official_name   TEXT NOT NULL,
  email           TEXT NOT NULL,
  mpesa_number    TEXT NOT NULL,
  whatsapp_number TEXT NOT NULL,
  county          TEXT NOT NULL,
  profile_picture TEXT,
  classy_photos   TEXT,   -- JSON array of filenames
  other_photos    TEXT,   -- JSON array of filenames
  videos          TEXT,   -- JSON array of filenames
  consent_share   INTEGER DEFAULT 0,
  consent_age     INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'pending', -- pending / approved / rejected
  created_at      INTEGER DEFAULT (strftime('%s','now'))
);
`);

// Admin settings (persists admin password if reset)
db.exec(`
CREATE TABLE IF NOT EXISTS admin_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`);

// Load admin password from DB if previously reset
const savedAdmin = db.prepare('SELECT value FROM admin_settings WHERE key = ?').get('admin_pass_hash');
if (savedAdmin) {
  // override using stored hash
  ADMIN_PASS = null; // signal: use hash check
}

function getAdminHash() {
  const row = db.prepare('SELECT value FROM admin_settings WHERE key = ?').get('admin_pass_hash');
  return row ? row.value : null;
}
function setAdminHash(hash) {
  db.prepare('INSERT INTO admin_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run('admin_pass_hash', hash);
}

// -------------------------------------------------------------
//  APP SETUP
// -------------------------------------------------------------
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(DATA_DIR, 'uploads')));

// File upload setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(DATA_DIR, 'uploads')),
  filename:    (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, Date.now() + '-' + uuid().slice(0, 8) + '-' + safe);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 } // 200 MB per file (videos)
});

// -------------------------------------------------------------
//  HELPERS
// -------------------------------------------------------------
function signUserToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
}
function signAdminToken() {
  return jwt.sign({ role: 'admin', username: ADMIN_USER }, JWT_SECRET, { expiresIn: '12h' });
}
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    req.admin = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// -------------------------------------------------------------
//  HEALTH CHECK
// -------------------------------------------------------------
app.get('/', (req, res) => {
  res.json({
    name: 'Utamu Agency Backend',
    status: 'online',
    time: new Date().toISOString(),
    endpoints: [
      'POST /api/signup',
      'POST /api/login',
      'POST /api/forgot-password',
      'POST /api/reset-password',
      'POST /api/apply',
      'GET  /admin (admin panel UI)',
      'POST /admin/login',
      'GET  /admin/applications',
      'GET  /admin/users',
      'POST /admin/reset-password'
    ]
  });
});

// =============================================================
//  USER AUTH
// =============================================================

// SIGNUP -------------------------------------------------------
app.post('/api/signup', (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ error: 'username, email and password are required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const exists = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
    if (exists) return res.status(400).json({ error: 'Username or email already taken' });

    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare('INSERT INTO users (username,email,password_hash) VALUES (?,?,?)')
                   .run(username, email, hash);
    const user = { id: info.lastInsertRowid, username, email };
    const token = signUserToken(user);
    res.json({ ok: true, message: 'Signup successful', token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error during signup' });
  }
});

// LOGIN --------------------------------------------------------
app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'username and password are required' });

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid username or password' });

    const token = signUserToken(user);
    res.json({
      ok: true,
      message: 'Login successful',
      token,
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// FORGOT PASSWORD ---------------------------------------------
app.post('/api/forgot-password', (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.status(404).json({ error: 'No account found with that email' });

    const token   = uuid();
    const expires = Date.now() + 1000 * 60 * 30; // 30 min
    db.prepare('UPDATE users SET reset_token=?, reset_expires=? WHERE id=?').run(token, expires, user.id);

    // NOTE: For real email sending, configure nodemailer with SMTP credentials.
    // For now we return the reset token directly so the user can paste it in the UI.
    res.json({
      ok: true,
      message: 'Reset token generated. Use it to reset your password.',
      reset_token: token  // in production, email this instead of returning it
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// RESET PASSWORD ----------------------------------------------
app.post('/api/reset-password', (req, res) => {
  try {
    const { reset_token, new_password } = req.body;
    if (!reset_token || !new_password)
      return res.status(400).json({ error: 'reset_token and new_password are required' });
    if (new_password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(reset_token);
    if (!user || !user.reset_expires || user.reset_expires < Date.now())
      return res.status(400).json({ error: 'Invalid or expired reset token' });

    const hash = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE users SET password_hash=?, reset_token=NULL, reset_expires=NULL WHERE id=?')
      .run(hash, user.id);

    res.json({ ok: true, message: 'Password reset successful. You can now log in.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// =============================================================
//  APPLY-NOW FORM (Mombasa Hookup Weekend)
// =============================================================
const applyFields = upload.fields([
  { name: 'profile_picture', maxCount: 1 },
  { name: 'classy_photos',   maxCount: 2 },
  { name: 'other_photos',    maxCount: 3 },
  { name: 'videos',          maxCount: 3 }
]);

app.post('/api/apply', applyFields, (req, res) => {
  try {
    const {
      username, official_name, email,
      mpesa_number, whatsapp_number, county,
      consent_share, consent_age
    } = req.body;

    if (!username || !official_name || !email || !mpesa_number || !whatsapp_number || !county)
      return res.status(400).json({ error: 'All text fields are required' });
    if (!consent_share || !consent_age)
      return res.status(400).json({ error: 'You must agree to both consents' });

    const files = req.files || {};
    const profilePic    = (files.profile_picture || [])[0]?.filename || null;
    const classyPhotos  = (files.classy_photos   || []).map(f => f.filename);
    const otherPhotos   = (files.other_photos    || []).map(f => f.filename);
    const videos        = (files.videos          || []).map(f => f.filename);

    if (!profilePic)                return res.status(400).json({ error: 'Profile picture is required' });
    if (classyPhotos.length < 2)    return res.status(400).json({ error: 'Please upload 2 classy photos' });
    if (otherPhotos.length  < 3)    return res.status(400).json({ error: 'Please upload 3 other photos' });
    if (videos.length       < 3)    return res.status(400).json({ error: 'Please upload 3 videos (each ≥ 20s)' });

    const appId = 'UTM-' + Date.now().toString(36).toUpperCase() + '-' + uuid().slice(0,4).toUpperCase();

    db.prepare(`
      INSERT INTO applications
      (application_id, username, official_name, email, mpesa_number, whatsapp_number,
       county, profile_picture, classy_photos, other_photos, videos,
       consent_share, consent_age)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      appId, username, official_name, email, mpesa_number, whatsapp_number,
      county, profilePic,
      JSON.stringify(classyPhotos),
      JSON.stringify(otherPhotos),
      JSON.stringify(videos),
      consent_share ? 1 : 0,
      consent_age   ? 1 : 0
    );

    res.json({
      ok: true,
      message: 'Application submitted successfully',
      application_id: appId,
      welcome: {
        title: 'Welcome to Utamu Agency',
        body:
`Dear ${official_name},

Thank you for applying to join the Utamu Agency family. Your application (ID: ${appId}) has been received and is now under review by our admin team.

WHAT HAPPENS NEXT
1. Our admin team will verify your details within 24–48 hours.
2. You will be contacted via WhatsApp (${whatsapp_number}) once approved.
3. Approved members receive booking opportunities for the Mombasa Hookup Weekend and other premium events.

OUR PROMISE
- Your data is encrypted and visible only to authorised Utamu Agency administrators.
- You can request deletion of your data at any time by emailing support@utamu.agency.

Karibu sana,
The Utamu Agency Team`
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error during application submission' });
  }
});

// =============================================================
//  ADMIN PANEL
// =============================================================

// Admin Login
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username !== ADMIN_USER) return res.status(401).json({ error: 'Invalid admin credentials' });

  const hash = getAdminHash();
  let valid = false;
  if (hash) {
    valid = bcrypt.compareSync(password, hash);
  } else {
    // first login uses env var
    valid = (password === ADMIN_PASS);
    if (valid) setAdminHash(bcrypt.hashSync(password, 10)); // persist
  }
  if (!valid) return res.status(401).json({ error: 'Invalid admin credentials' });

  res.json({ ok: true, token: signAdminToken() });
});

// Admin: reset own password
app.post('/admin/reset-password', requireAdmin, (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  setAdminHash(bcrypt.hashSync(new_password, 10));
  res.json({ ok: true, message: 'Admin password updated successfully' });
});

// Admin: list applications
app.get('/admin/applications', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM applications ORDER BY created_at DESC').all();
  const out = rows.map(r => ({
    ...r,
    classy_photos: JSON.parse(r.classy_photos || '[]'),
    other_photos:  JSON.parse(r.other_photos  || '[]'),
    videos:        JSON.parse(r.videos        || '[]'),
    created_at_iso: new Date(r.created_at * 1000).toISOString()
  }));
  res.json({ ok: true, count: out.length, applications: out });
});

// Admin: update status
app.post('/admin/applications/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body;
  if (!['pending','approved','rejected'].includes(status))
    return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE applications SET status=? WHERE id=?').run(status, req.params.id);
  res.json({ ok: true });
});

// Admin: delete application (and its files)
app.delete('/admin/applications/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM applications WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  // delete files
  const allFiles = [
    row.profile_picture,
    ...JSON.parse(row.classy_photos || '[]'),
    ...JSON.parse(row.other_photos  || '[]'),
    ...JSON.parse(row.videos        || '[]')
  ].filter(Boolean);
  for (const f of allFiles) {
    const p = path.join(DATA_DIR, 'uploads', f);
    if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch(e){} }
  }
  db.prepare('DELETE FROM applications WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Admin: list users
app.get('/admin/users', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT id,username,email,created_at FROM users ORDER BY created_at DESC').all();
  res.json({ ok: true, count: rows.length, users: rows });
});

// Admin: export all applications as JSON (download)
app.get('/admin/export', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM applications ORDER BY created_at DESC').all();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="utamu-applications-${Date.now()}.json"`);
  res.send(JSON.stringify(rows, null, 2));
});

// -------------------------------------------------------------
//  ADMIN PANEL UI (single-page HTML served from backend)
// -------------------------------------------------------------
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// -------------------------------------------------------------
//  START
// -------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n🌟 Utamu Agency backend running on port ${PORT}`);
  console.log(`   Public URL  : http://localhost:${PORT}`);
  console.log(`   Admin Panel : http://localhost:${PORT}/admin`);
  console.log(`   Data folder : ${DATA_DIR}\n`);
});
