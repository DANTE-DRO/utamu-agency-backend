/**
 * ================================================================
 *  UTAMU AGENCY - BACKEND SERVER
 *  Professional Member & Application Management System
 *  Author: Utamu Agency
 *  Stack:  Node.js + Express + SQLite (persistent) + Multer
 * ================================================================
 */

const express   = require('express');
const cors      = require('cors');
const multer    = require('multer');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const Database  = require('better-sqlite3');
const path      = require('path');
const fs        = require('fs');
const archiver  = require('archiver');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 10000;

/* ---------- CONFIG ---------- */
const JWT_SECRET     = process.env.JWT_SECRET     || 'utamu_secret_change_me';
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'utamugency@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '11monari72dan';

/* ---------- PATHS (persistent on Render disk if mounted at /data) ---------- */
const DATA_DIR    = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH     = path.join(DATA_DIR, 'utamu.db');

if (!fs.existsSync(DATA_DIR))    fs.mkdirSync(DATA_DIR,    { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

/* ---------- MIDDLEWARE ---------- */
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));

/* ---------- DATABASE ---------- */
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  reset_token   TEXT,
  reset_expires INTEGER,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS applications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT,
  official_name   TEXT,
  email           TEXT,
  mpesa_number    TEXT,
  whatsapp_number TEXT,
  county          TEXT,
  category        TEXT,
  profile_picture TEXT,
  classy_photos   TEXT,
  other_photos    TEXT,
  videos          TEXT,
  agreed_share    INTEGER,
  confirmed_18    INTEGER,
  status          TEXT DEFAULT 'pending',
  notes           TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_credentials (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

/* Seed admin row once */
const adminRow = db.prepare('SELECT * FROM admin_credentials WHERE id = 1').get();
if (!adminRow) {
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  db.prepare('INSERT INTO admin_credentials (id, email, password_hash) VALUES (1, ?, ?)')
    .run(ADMIN_EMAIL, hash);
  console.log('✔ Admin account initialised:', ADMIN_EMAIL);
}

/* ---------- MULTER (file upload) ---------- */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, Date.now() + '-' + Math.round(Math.random()*1e9) + '-' + safe);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100 MB per file
});

/* ---------- AUTH HELPERS ---------- */
function signUserToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: 'member' }, JWT_SECRET, { expiresIn: '7d' });
}
function signAdminToken() {
  return jwt.sign({ role: 'admin', email: ADMIN_EMAIL }, JWT_SECRET, { expiresIn: '7d' });
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

/* ================================================================
                          API ROUTES
================================================================ */

app.get('/', (_, res) => {
  res.json({
    service: 'Utamu Agency Backend',
    status:  'online',
    version: '1.0.0',
    endpoints: {
      auth:        ['POST /api/signup', 'POST /api/login', 'POST /api/forgot-password', 'POST /api/reset-password'],
      application: ['POST /api/apply'],
      admin:       ['POST /api/admin/login', 'GET /api/admin/applications', 'GET /api/admin/users',
                    'PUT /api/admin/application/:id', 'DELETE /api/admin/application/:id',
                    'POST /api/admin/change-password', 'GET /api/admin/export/:id', 'GET /api/admin/export-all']
    }
  });
});

app.get('/api/health', (_, res) => res.json({ status: 'healthy', time: new Date().toISOString() }));

/* ---------- USER SIGNUP ---------- */
app.post('/api/signup', (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ error: 'All fields are required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'
    ).run(username.trim(), email.trim().toLowerCase(), hash);

    const user = db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(info.lastInsertRowid);
    const token = signUserToken(user);
    res.json({ success: true, message: 'Account created', token, user });
  } catch (e) {
    if (e.message.includes('UNIQUE'))
      return res.status(409).json({ error: 'Username or email already exists' });
    res.status(500).json({ error: e.message });
  }
});

/* ---------- USER LOGIN ---------- */
app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });

    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?')
                   .get(username.trim(), username.trim().toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signUserToken(user);
    res.json({
      success: true,
      token,
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------- FORGOT PASSWORD ---------- */
app.post('/api/forgot-password', (req, res) => {
  try {
    const { email } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
    if (!user) return res.json({ success: true, message: 'If that email exists, instructions were sent.' });

    const token = Math.random().toString(36).substring(2, 10).toUpperCase();
    const expires = Date.now() + 1000*60*30; // 30 min
    db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?')
      .run(token, expires, user.id);

    // In production, send via email. For demo, we return the token so user can copy/paste.
    res.json({
      success: true,
      message: 'Reset code generated. Use it within 30 minutes.',
      resetCode: token   // remove this in production once email service is wired
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- RESET PASSWORD ---------- */
app.post('/api/reset-password', (req, res) => {
  try {
    const { email, resetCode, newPassword } = req.body;
    if (!email || !resetCode || !newPassword)
      return res.status(400).json({ error: 'All fields are required' });
    if (newPassword.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
    if (!user || user.reset_token !== resetCode)
      return res.status(400).json({ error: 'Invalid reset code' });
    if (Date.now() > user.reset_expires)
      return res.status(400).json({ error: 'Reset code expired' });

    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?')
      .run(hash, user.id);

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- APPLY NOW (Mombasa Hookup Weekends etc.) ---------- */
app.post('/api/apply',
  upload.fields([
    { name: 'profile_picture', maxCount: 1 },
    { name: 'classy_photos',   maxCount: 2 },
    { name: 'other_photos',    maxCount: 3 },
    { name: 'videos',          maxCount: 3 }
  ]),
  (req, res) => {
    try {
      const b = req.body;
      const f = req.files || {};

      const profile_picture = f.profile_picture ? f.profile_picture[0].filename : null;
      const classy_photos   = (f.classy_photos || []).map(x => x.filename);
      const other_photos    = (f.other_photos  || []).map(x => x.filename);
      const videos          = (f.videos        || []).map(x => x.filename);

      const info = db.prepare(`
        INSERT INTO applications
        (username, official_name, email, mpesa_number, whatsapp_number, county, category,
         profile_picture, classy_photos, other_photos, videos,
         agreed_share, confirmed_18)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        b.username,
        b.official_name,
        b.email,
        b.mpesa_number,
        b.whatsapp_number,
        b.county,
        b.category || 'Mombasa Hookup Weekends',
        profile_picture,
        JSON.stringify(classy_photos),
        JSON.stringify(other_photos),
        JSON.stringify(videos),
        b.agreed_share === 'true' ? 1 : 0,
        b.confirmed_18 === 'true' ? 1 : 0
      );

      res.json({
        success: true,
        message: 'Application submitted successfully',
        application_id: info.lastInsertRowid
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  }
);

/* ================================================================
                       ADMIN ROUTES
================================================================ */

/* ---------- ADMIN LOGIN ---------- */
app.post('/api/admin/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = db.prepare('SELECT * FROM admin_credentials WHERE id = 1').get();
    if (!admin) return res.status(500).json({ error: 'Admin not configured' });

    if (email.trim().toLowerCase() !== admin.email.toLowerCase())
      return res.status(401).json({ error: 'Invalid admin credentials' });

    const ok = bcrypt.compareSync(password, admin.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid admin credentials' });

    const token = signAdminToken();
    res.json({ success: true, token, email: admin.email });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- ADMIN CHANGE PASSWORD ---------- */
app.post('/api/admin/change-password', requireAdmin, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const admin = db.prepare('SELECT * FROM admin_credentials WHERE id = 1').get();
    const ok = bcrypt.compareSync(currentPassword, admin.password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password incorrect' });
    if (!newPassword || newPassword.length < 6)
      return res.status(400).json({ error: 'New password must be at least 6 chars' });

    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE admin_credentials SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1')
      .run(hash);
    res.json({ success: true, message: 'Admin password updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- ADMIN: LIST APPLICATIONS ---------- */
app.get('/api/admin/applications', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM applications ORDER BY created_at DESC').all();
  const parsed = rows.map(r => ({
    ...r,
    classy_photos: safeParse(r.classy_photos),
    other_photos:  safeParse(r.other_photos),
    videos:        safeParse(r.videos)
  }));
  res.json({ success: true, count: parsed.length, applications: parsed });
});

/* ---------- ADMIN: LIST USERS ---------- */
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, email, created_at FROM users ORDER BY created_at DESC').all();
  res.json({ success: true, count: users.length, users });
});

/* ---------- ADMIN: UPDATE APPLICATION (status, notes) ---------- */
app.put('/api/admin/application/:id', requireAdmin, (req, res) => {
  const { status, notes } = req.body;
  db.prepare('UPDATE applications SET status = COALESCE(?, status), notes = COALESCE(?, notes) WHERE id = ?')
    .run(status, notes, req.params.id);
  res.json({ success: true });
});

/* ---------- ADMIN: DELETE APPLICATION ---------- */
app.delete('/api/admin/application/:id', requireAdmin, (req, res) => {
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (app) {
    [app.profile_picture, ...safeParse(app.classy_photos),
     ...safeParse(app.other_photos), ...safeParse(app.videos)]
       .filter(Boolean).forEach(fn => {
         const p = path.join(UPLOADS_DIR, fn);
         if (fs.existsSync(p)) fs.unlinkSync(p);
       });
  }
  db.prepare('DELETE FROM applications WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/* ---------- ADMIN: EXPORT APPLICATION AS ZIP ---------- */
app.get('/api/admin/export/:id', requireAdmin, (req, res) => {
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Not found' });

  res.attachment(`application-${app.id}-${app.username}.zip`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);

  const meta = {
    ...app,
    classy_photos: safeParse(app.classy_photos),
    other_photos:  safeParse(app.other_photos),
    videos:        safeParse(app.videos)
  };
  archive.append(JSON.stringify(meta, null, 2), { name: 'application.json' });

  [app.profile_picture, ...safeParse(app.classy_photos),
   ...safeParse(app.other_photos), ...safeParse(app.videos)]
     .filter(Boolean).forEach(fn => {
       const p = path.join(UPLOADS_DIR, fn);
       if (fs.existsSync(p)) archive.file(p, { name: fn });
     });
  archive.finalize();
});

/* ---------- ADMIN: EXPORT ALL DATA ---------- */
app.get('/api/admin/export-all', requireAdmin, (req, res) => {
  const apps = db.prepare('SELECT * FROM applications ORDER BY created_at DESC').all();
  const users = db.prepare('SELECT id, username, email, created_at FROM users').all();

  res.attachment(`utamu-export-${Date.now()}.zip`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);
  archive.append(JSON.stringify({ applications: apps, users }, null, 2), { name: 'export.json' });

  // CSV
  const headers = ['id','username','official_name','email','mpesa_number','whatsapp_number','county','category','status','created_at'];
  const csv = [headers.join(',')].concat(
    apps.map(a => headers.map(h => `"${(a[h]||'').toString().replace(/"/g,'""')}"`).join(','))
  ).join('\n');
  archive.append(csv, { name: 'applications.csv' });

  // Append all media files
  apps.forEach(app => {
    [app.profile_picture, ...safeParse(app.classy_photos),
     ...safeParse(app.other_photos), ...safeParse(app.videos)]
       .filter(Boolean).forEach(fn => {
         const p = path.join(UPLOADS_DIR, fn);
         if (fs.existsSync(p)) archive.file(p, { name: `media/${app.id}/${fn}` });
       });
  });
  archive.finalize();
});

/* ---------- UTIL ---------- */
function safeParse(s) {
  try { return JSON.parse(s) || []; } catch { return []; }
}

/* ---------- START ---------- */
app.listen(PORT, () => {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   UTAMU AGENCY BACKEND IS RUNNING          ║');
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║   Port:        ${PORT.toString().padEnd(28)}║`);
  console.log(`║   Data dir:    ${DATA_DIR.padEnd(28)}║`);
  console.log(`║   Admin email: ${ADMIN_EMAIL.padEnd(28)}║`);
  console.log('╚════════════════════════════════════════════╝');
});
