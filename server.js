/* =========================================================
   UTAMU AGENCY — PRODUCTION BACKEND
   Node.js + Express + JSON Storage + File Uploads + Admin Panel
   Deploy: Render.com (Web Service, Node 18+)
   ========================================================= */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const PDFDocument = require('pdfkit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

/* ========== CONFIG ========== */
const JWT_SECRET = process.env.JWT_SECRET || 'utamu_super_secret_key_change_me_2026';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '11monari72dan';

/* ========== STORAGE PATHS ==========
   On Render free tier, the filesystem is EPHEMERAL (resets on redeploy).
   For persistent storage, attach a Render Disk and mount it at /var/data
   then set env: DATA_DIR=/var/data
========================================================= */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const APPS_FILE = path.join(DATA_DIR, 'applications.json');

[DATA_DIR, UPLOADS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(APPS_FILE)) fs.writeFileSync(APPS_FILE, '[]');

const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; } };
const writeJSON = (f, data) => fs.writeFileSync(f, JSON.stringify(data, null, 2));

/* ========== MIDDLEWARE ========== */
app.use(cors({ origin: '*', credentials: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded files publicly (so the welcome letter download link works)
app.use('/uploads', express.static(UPLOADS_DIR));

/* ========== MULTER (file uploads) ========== */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const appId = req.applicationId || 'temp';
    const dir = path.join(UPLOADS_DIR, appId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${file.fieldname}_${Date.now()}_${safe}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100 MB per file (videos)
});

// Assign an application ID BEFORE multer saves files (so they go in the right folder)
function assignAppId(req, res, next) {
  req.applicationId = 'APP-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  next();
}

/* ========== AUTH MIDDLEWARE ========== */
function authUser(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function authAdmin(req, res, next) {
  const pass = req.headers['x-admin-password'] || req.query.password || req.body?.password;
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized — wrong admin password' });
  next();
}

/* ========== ROUTES ========== */

app.get('/', (req, res) => {
  res.json({
    name: 'Utamu Agency API',
    status: 'online',
    version: '1.0.0',
    endpoints: {
      signup: 'POST /api/signup',
      login: 'POST /api/login',
      apply: 'POST /api/apply (multipart/form-data, Bearer token)',
      admin_login: 'GET /admin (browser)',
      admin_api: 'GET /api/admin/applications (x-admin-password header)'
    }
  });
});

app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

/* ---------- SIGNUP ---------- */
app.post('/api/signup', async (req, res) => {
  try {
    const { email, username, password } = req.body || {};
    if (!email || !username || !password)
      return res.status(400).json({ error: 'Email, username and password are required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const users = readJSON(USERS_FILE);
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase()))
      return res.status(400).json({ error: 'Username already taken' });
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase()))
      return res.status(400).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);
    const user = {
      id: 'USR-' + Date.now(),
      email: email.trim(),
      username: username.trim(),
      password: hash,
      createdAt: new Date().toISOString()
    };
    users.push(user);
    writeJSON(USERS_FILE, users);

    res.json({ success: true, message: 'Account created successfully' });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error during signup' });
  }
});

/* ---------- LOGIN ---------- */
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid username or password' });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      success: true,
      token,
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

/* ---------- APPLY (multipart form with files) ---------- */
const applyUpload = upload.fields([
  { name: 'profilePicture', maxCount: 1 },
  { name: 'classyPhotos', maxCount: 2 },
  { name: 'nudePhotos', maxCount: 3 },
  { name: 'nudeVideos', maxCount: 3 }
]);

app.post('/api/apply', authUser, assignAppId, applyUpload, async (req, res) => {
  try {
    const body = req.body || {};
    const files = req.files || {};

    const application = {
      id: req.applicationId,
      submittedAt: new Date().toISOString(),
      submittedBy: req.user.username,
      userId: req.user.id,
      personal: {
        username: body.username || req.user.username,
        officialName: body.officialName || '',
        mpesa: body.mpesa || '',
        whatsapp: body.whatsapp || '',
        email: body.email || ''
      },
      consent: body.consent === 'true' || body.consent === true,
      files: {
        profilePicture: (files.profilePicture || []).map(f => fileMeta(f, req.applicationId)),
        classyPhotos: (files.classyPhotos || []).map(f => fileMeta(f, req.applicationId)),
        nudePhotos: (files.nudePhotos || []).map(f => fileMeta(f, req.applicationId)),
        nudeVideos: (files.nudeVideos || []).map(f => fileMeta(f, req.applicationId))
      },
      status: 'pending'
    };

    // Generate welcome PDF
    const pdfPath = path.join(UPLOADS_DIR, req.applicationId, 'welcome-letter.pdf');
    await generateWelcomePDF(pdfPath, application);
    application.welcomeLetterUrl = `/uploads/${req.applicationId}/welcome-letter.pdf`;

    // Save application
    const apps = readJSON(APPS_FILE);
    apps.push(application);
    writeJSON(APPS_FILE, apps);

    res.json({
      success: true,
      applicationId: application.id,
      welcomeLetterUrl: application.welcomeLetterUrl,
      message: 'Application submitted successfully'
    });
  } catch (err) {
    console.error('Apply error:', err);
    res.status(500).json({ error: 'Failed to submit application: ' + err.message });
  }
});

function fileMeta(f, appId) {
  return {
    originalName: f.originalname,
    storedName: f.filename,
    size: f.size,
    mimetype: f.mimetype,
    url: `/uploads/${appId}/${f.filename}`
  };
}

/* ---------- WELCOME PDF GENERATOR ---------- */
function generateWelcomePDF(filePath, app) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 60, left: 60, right: 60 } });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // Gold accent header
      doc.rect(0, 0, doc.page.width, 8).fill('#d4af37');
      doc.fillColor('#000').moveDown(2);

      doc.font('Helvetica-Bold').fontSize(28).fillColor('#d4af37').text('UTAMU AGENCY', { align: 'center' });
      doc.fontSize(10).fillColor('#666').text('LUXURY COMPANIONSHIP · PREMIUM EXPERIENCES', { align: 'center', characterSpacing: 3 });
      doc.moveDown(2);

      doc.fontSize(20).fillColor('#000').font('Helvetica-Bold').text('Welcome to the Elite Circle', { align: 'center' });
      doc.moveDown(1.5);

      doc.fontSize(11).font('Helvetica').fillColor('#222');
      doc.text(`Dear ${app.personal.officialName || app.personal.username},`, { align: 'left' });
      doc.moveDown();
      doc.text(
        'Thank you for applying to join Utamu Agency — Kenya\'s premier luxury companionship network. ' +
        'Your application has been received and securely stored in our private database. ' +
        'Our admin team will personally review your submission and reach out via WhatsApp within 24 hours.',
        { align: 'justify', lineGap: 4 }
      );
      doc.moveDown();
      doc.text(
        'What happens next: We verify your details, schedule a private interview, and onboard you into our ' +
        'vetted client booking system. Successful applicants enjoy industry-leading earnings, full safety ' +
        'support, and a clear path to international (Dubai) opportunities.',
        { align: 'justify', lineGap: 4 }
      );
      doc.moveDown(2);

      // Application details box
      doc.rect(60, doc.y, doc.page.width - 120, 130).strokeColor('#d4af37').lineWidth(1.5).stroke();
      const boxY = doc.y + 12;
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#d4af37').text('APPLICATION DETAILS', 75, boxY);
      doc.fontSize(10).font('Helvetica').fillColor('#000');
      doc.text(`Application ID: ${app.id}`, 75, boxY + 22);
      doc.text(`Submitted: ${new Date(app.submittedAt).toLocaleString()}`, 75, boxY + 38);
      doc.text(`Username: ${app.personal.username}`, 75, boxY + 54);
      doc.text(`Name: ${app.personal.officialName}`, 75, boxY + 70);
      doc.text(`WhatsApp: ${app.personal.whatsapp}`, 75, boxY + 86);
      doc.text(`Email: ${app.personal.email}`, 75, boxY + 102);

      doc.y = boxY + 140;
      doc.moveDown(2);
      doc.fontSize(10).fillColor('#666').font('Helvetica-Oblique').text(
        'This document is confidential. All applicant data is encrypted and used solely by Utamu Agency for client booking purposes. We never share your data with third parties.',
        { align: 'center', lineGap: 3 }
      );

      doc.moveDown(2);
      doc.fontSize(11).fillColor('#d4af37').font('Helvetica-Bold').text('— Utamu Agency Team', { align: 'right' });
      doc.fontSize(9).fillColor('#888').font('Helvetica').text('WhatsApp: +254 700 000 000', { align: 'right' });

      // Gold footer line
      doc.rect(0, doc.page.height - 8, doc.page.width, 8).fill('#d4af37');

      doc.end();
      stream.on('finish', resolve);
      stream.on('error', reject);
    } catch (e) { reject(e); }
  });
}

/* ============================================================
   ADMIN PANEL (browser UI at /admin)
   ============================================================ */
app.get('/admin', (req, res) => {
  res.send(adminLoginPage());
});

app.post('/admin', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.send(adminLoginPage('Wrong password. Try again.'));
  }
  res.send(adminDashboardPage());
});

/* Admin API: list applications */
app.get('/api/admin/applications', authAdmin, (req, res) => {
  const apps = readJSON(APPS_FILE);
  res.json({ count: apps.length, applications: apps.slice().reverse() });
});

/* Admin API: list users */
app.get('/api/admin/users', authAdmin, (req, res) => {
  const users = readJSON(USERS_FILE).map(u => ({ id: u.id, username: u.username, email: u.email, createdAt: u.createdAt }));
  res.json({ count: users.length, users });
});

/* Admin API: download a specific file (with password gate) */
app.get('/api/admin/file/:appId/:filename', authAdmin, (req, res) => {
  const { appId, filename } = req.params;
  const filePath = path.join(UPLOADS_DIR, appId, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.download(filePath);
});

/* Admin API: download all files for an application as zip-like listing */
app.get('/api/admin/application/:id', authAdmin, (req, res) => {
  const apps = readJSON(APPS_FILE);
  const app = apps.find(a => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });
  res.json(app);
});

/* Admin API: delete application */
app.delete('/api/admin/application/:id', authAdmin, (req, res) => {
  let apps = readJSON(APPS_FILE);
  const target = apps.find(a => a.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Not found' });
  apps = apps.filter(a => a.id !== req.params.id);
  writeJSON(APPS_FILE, apps);
  // Remove files folder
  const folder = path.join(UPLOADS_DIR, req.params.id);
  if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });
  res.json({ success: true });
});

/* ========== ADMIN HTML PAGES ========== */
function adminLoginPage(error = '') {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Utamu Admin Login</title>
<style>
body{margin:0;font-family:'Segoe UI',sans-serif;background:#0a0a0a;color:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh;}
.box{background:#1a1a1a;border:1px solid #d4af37;border-radius:16px;padding:50px 40px;width:100%;max-width:400px;text-align:center;box-shadow:0 20px 60px rgba(212,175,55,.2);}
h1{font-family:Georgia,serif;color:#d4af37;letter-spacing:6px;margin:0 0 10px;}
p{color:#888;font-size:.85rem;letter-spacing:2px;margin-bottom:30px;}
input{width:100%;padding:14px;background:rgba(255,255,255,.05);border:1px solid rgba(212,175,55,.3);border-radius:8px;color:#fff;font-size:1rem;outline:none;}
input:focus{border-color:#d4af37;}
button{width:100%;margin-top:20px;padding:14px;background:linear-gradient(135deg,#d4af37,#a8861f);color:#000;border:none;border-radius:8px;font-weight:700;letter-spacing:2px;cursor:pointer;text-transform:uppercase;}
button:hover{opacity:.9;}
.err{background:rgba(255,71,87,.15);border:1px solid #ff4757;color:#ff4757;padding:10px;border-radius:8px;margin-bottom:15px;font-size:.85rem;}
.hint{margin-top:20px;color:#666;font-size:.75rem;}
</style></head><body>
<form class="box" method="POST" action="/admin">
<h1>UTAMU</h1><p>ADMIN PORTAL</p>
${error ? `<div class="err">${error}</div>` : ''}
<input type="password" name="password" placeholder="Admin Password" required autofocus>
<button type="submit">Access Dashboard</button>
<div class="hint">Authorized personnel only.</div>
</form></body></html>`;
}

function adminDashboardPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Utamu Admin Dashboard</title>
<style>
*{box-sizing:border-box;}body{margin:0;font-family:'Segoe UI',sans-serif;background:#0a0a0a;color:#f5f5f5;}
header{background:#141414;border-bottom:2px solid #d4af37;padding:20px 30px;display:flex;justify-content:space-between;align-items:center;}
header h1{font-family:Georgia,serif;color:#d4af37;margin:0;letter-spacing:4px;font-size:1.5rem;}
.logout{background:transparent;border:1px solid #d4af37;color:#d4af37;padding:8px 18px;border-radius:6px;cursor:pointer;text-decoration:none;font-size:.85rem;}
.logout:hover{background:#d4af37;color:#000;}
.container{padding:30px;}
.tabs{display:flex;gap:10px;margin-bottom:25px;}
.tab{padding:10px 20px;background:#1a1a1a;border:1px solid rgba(212,175,55,.3);color:#fff;border-radius:6px;cursor:pointer;}
.tab.active{background:#d4af37;color:#000;border-color:#d4af37;}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin-bottom:25px;}
.stat{background:#1a1a1a;border:1px solid rgba(212,175,55,.2);border-radius:10px;padding:20px;}
.stat .num{font-size:2rem;color:#d4af37;font-weight:700;}
.stat .lbl{color:#888;font-size:.85rem;letter-spacing:1px;text-transform:uppercase;}
.card{background:#1a1a1a;border:1px solid rgba(212,175,55,.2);border-radius:10px;padding:20px;margin-bottom:15px;}
.card h3{color:#d4af37;margin:0 0 10px;}
.row{display:flex;flex-wrap:wrap;gap:20px;color:#ddd;font-size:.9rem;margin-bottom:10px;}
.row span b{color:#d4af37;}
.files{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}
.files a{padding:6px 12px;background:rgba(212,175,55,.1);border:1px solid #d4af37;color:#d4af37;text-decoration:none;border-radius:6px;font-size:.8rem;}
.files a:hover{background:#d4af37;color:#000;}
.empty{text-align:center;padding:60px;color:#666;}
.del{background:transparent;border:1px solid #ff4757;color:#ff4757;padding:5px 12px;border-radius:5px;cursor:pointer;font-size:.75rem;margin-left:10px;}
.del:hover{background:#ff4757;color:#fff;}
.section{display:none;}.section.active{display:block;}
table{width:100%;border-collapse:collapse;background:#1a1a1a;border-radius:10px;overflow:hidden;}
th,td{padding:12px;text-align:left;border-bottom:1px solid rgba(212,175,55,.1);}
th{background:rgba(212,175,55,.1);color:#d4af37;}
</style></head><body>
<header>
<h1>UTAMU · ADMIN DASHBOARD</h1>
<a class="logout" href="/admin">Logout</a>
</header>
<div class="container">
<div class="tabs">
<div class="tab active" onclick="showTab('apps',this)">Applications</div>
<div class="tab" onclick="showTab('users',this)">Users</div>
</div>

<div id="apps" class="section active">
<div class="stats" id="appStats"></div>
<div id="appsList"></div>
</div>

<div id="users" class="section">
<div class="stats" id="userStats"></div>
<div id="usersList"></div>
</div>
</div>

<script>
const PASS = ${JSON.stringify(ADMIN_PASSWORD)};
const headers = {'x-admin-password': PASS};

function showTab(id, el){
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  el.classList.add('active');
  if(id==='users') loadUsers();
}

async function loadApps(){
  const r = await fetch('/api/admin/applications',{headers});
  const j = await r.json();
  document.getElementById('appStats').innerHTML = 
    '<div class="stat"><div class="num">'+j.count+'</div><div class="lbl">Total Applications</div></div>';
  const list = document.getElementById('appsList');
  if(!j.count) return list.innerHTML = '<div class="empty">No applications yet.</div>';
  list.innerHTML = j.applications.map(a => renderApp(a)).join('');
}

function renderApp(a){
  const allFiles = [
    ...(a.files.profilePicture||[]).map(f=>({...f,cat:'Profile'})),
    ...(a.files.classyPhotos||[]).map(f=>({...f,cat:'Classy'})),
    ...(a.files.nudePhotos||[]).map(f=>({...f,cat:'Nude Photo'})),
    ...(a.files.nudeVideos||[]).map(f=>({...f,cat:'Nude Video'})),
  ];
  return '<div class="card"><h3>'+a.id+
    ' <button class="del" onclick="delApp(\\''+a.id+'\\')">Delete</button></h3>'+
    '<div class="row">'+
    '<span><b>Name:</b> '+escapeHtml(a.personal.officialName||'-')+'</span>'+
    '<span><b>Username:</b> '+escapeHtml(a.personal.username||'-')+'</span>'+
    '<span><b>Submitted by:</b> '+escapeHtml(a.submittedBy||'-')+'</span>'+
    '<span><b>Date:</b> '+new Date(a.submittedAt).toLocaleString()+'</span>'+
    '</div>'+
    '<div class="row">'+
    '<span><b>M-Pesa:</b> '+escapeHtml(a.personal.mpesa||'-')+'</span>'+
    '<span><b>WhatsApp:</b> '+escapeHtml(a.personal.whatsapp||'-')+'</span>'+
    '<span><b>Email:</b> '+escapeHtml(a.personal.email||'-')+'</span>'+
    '<span><b>Consent:</b> '+(a.consent?'✓ Yes':'✗ No')+'</span>'+
    '</div>'+
    '<div><b style="color:#d4af37">Files ('+allFiles.length+'):</b></div>'+
    '<div class="files">'+
    allFiles.map(f=>'<a href="/api/admin/file/'+a.id+'/'+encodeURIComponent(f.storedName)+'?password='+encodeURIComponent(PASS)+'" target="_blank">'+f.cat+': '+escapeHtml(f.originalName)+' ('+formatSize(f.size)+')</a>').join('')+
    '<a href="/uploads/'+a.id+'/welcome-letter.pdf" target="_blank" style="background:rgba(46,213,115,.1);border-color:#2ed573;color:#2ed573;">📄 Welcome Letter PDF</a>'+
    '</div></div>';
}

function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function formatSize(b){if(!b)return '0B';const u=['B','KB','MB','GB'];let i=0;while(b>=1024&&i<u.length-1){b/=1024;i++;}return b.toFixed(1)+u[i];}

async function delApp(id){
  if(!confirm('Delete application '+id+' and all its files?')) return;
  await fetch('/api/admin/application/'+id,{method:'DELETE',headers});
  loadApps();
}

async function loadUsers(){
  const r = await fetch('/api/admin/users',{headers});
  const j = await r.json();
  document.getElementById('userStats').innerHTML = 
    '<div class="stat"><div class="num">'+j.count+'</div><div class="lbl">Total Users</div></div>';
  const list = document.getElementById('usersList');
  if(!j.count) return list.innerHTML = '<div class="empty">No users yet.</div>';
  list.innerHTML = '<table><tr><th>ID</th><th>Username</th><th>Email</th><th>Joined</th></tr>'+
    j.users.map(u=>'<tr><td>'+u.id+'</td><td>'+escapeHtml(u.username)+'</td><td>'+escapeHtml(u.email)+'</td><td>'+new Date(u.createdAt).toLocaleString()+'</td></tr>').join('')+
    '</table>';
}

loadApps();
</script>
</body></html>`;
}

/* ========== ERROR HANDLER ========== */
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'Upload error: ' + err.message });
  }
  res.status(500).json({ error: err.message || 'Internal server error' });
});

/* ========== START ========== */
app.listen(PORT, () => {
  console.log(`✓ Utamu backend running on port ${PORT}`);
  console.log(`✓ Data dir: ${DATA_DIR}`);
  console.log(`✓ Admin URL: http://localhost:${PORT}/admin`);
});
