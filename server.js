/* =====================================================================
   UTAMU AGENCY — BACKEND SERVER
   Beginner-friendly Node.js + Express backend
   Features:
     - User signup / login (passwords hashed with bcrypt, JWT tokens)
     - "Apply Now" form submission with file uploads
       (profile pic, classy photos, nude photos, nude videos)
     - Auto-generated personalized PDF welcome letter
     - Simple admin panel to view all applications (HTML page)
     - All data stored in JSON files (no database setup needed)
   ===================================================================== */

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

/* ----------- CONFIG ----------- */
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production-utamu-2024';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'utamu_admin_2024'; // CHANGE THIS!

/* ----------- DATA DIRECTORIES ----------- */
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const APPLICATIONS_FILE = path.join(DATA_DIR, 'applications.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(APPLICATIONS_FILE)) fs.writeFileSync(APPLICATIONS_FILE, '[]');

/* ----------- HELPERS ----------- */
function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return []; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function genId() {
  return 'UTM-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
}

/* ----------- MIDDLEWARE ----------- */
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve uploaded files (admin only - we'll protect them)
app.use('/uploads', (req, res, next) => {
  // simple protection: requires ?key=ADMIN_PASSWORD in URL
  if (req.query.key !== ADMIN_PASSWORD) {
    return res.status(403).send('Forbidden: admin key required');
  }
  next();
}, express.static(UPLOADS_DIR));

// Serve welcome letters publicly (they need a valid app ID though)
app.use('/letters', express.static(path.join(DATA_DIR, 'letters')));

/* ----------- MULTER (file upload) ----------- */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Each application gets its own folder
    const appId = req.appId || (req.appId = genId());
    const dir = path.join(UPLOADS_DIR, appId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ts = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${file.fieldname}_${ts}_${safeName}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 } // 200MB per file (for videos)
});

/* ----------- AUTH MIDDLEWARE ----------- */
function authRequired(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Login required' });
  }
  try {
    const token = auth.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired. Please login again.' });
  }
}

/* =====================================================================
   ROUTES
   ===================================================================== */

// Health
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Utamu Agency Backend',
    version: '1.0.0',
    endpoints: {
      signup: 'POST /api/signup',
      login: 'POST /api/login',
      apply: 'POST /api/apply (auth required)',
      admin: 'GET /admin (password protected)'
    }
  });
});

/* ----------- SIGNUP ----------- */
app.post('/api/signup', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    if (!email || !username || !password) {
      return res.status(400).json({ error: 'Email, username, and password are all required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    const users = readJSON(USERS_FILE);
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
      return res.status(400).json({ error: 'Username already taken.' });
    }
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
      return res.status(400).json({ error: 'Email already registered.' });
    }
    const hash = await bcrypt.hash(password, 10);
    const newUser = {
      id: genId(),
      email: email.trim(),
      username: username.trim(),
      passwordHash: hash,
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    writeJSON(USERS_FILE, users);
    res.json({ message: 'Account created successfully', userId: newUser.id });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error during signup.' });
  }
});

/* ----------- LOGIN ----------- */
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required.' });
    }
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

/* ----------- APPLY NOW ----------- */
app.post('/api/apply',
  authRequired,
  upload.fields([
    { name: 'profilePicture', maxCount: 1 },
    { name: 'classyPhotos', maxCount: 2 },
    { name: 'nudePhotos', maxCount: 3 },
    { name: 'nudeVideos', maxCount: 3 }
  ]),
  async (req, res) => {
    try {
      const appId = req.appId; // assigned in multer storage
      const { username, officialName, mpesaNumber, whatsappNumber, email, consent } = req.body;

      if (!username || !officialName || !mpesaNumber || !whatsappNumber || !email) {
        return res.status(400).json({ error: 'All text fields are required.' });
      }
      if (consent !== 'true') {
        return res.status(400).json({ error: 'You must accept the consent checkbox.' });
      }
      if (!req.files.profilePicture) return res.status(400).json({ error: 'Profile picture is required.' });
      if (!req.files.classyPhotos || req.files.classyPhotos.length !== 2)
        return res.status(400).json({ error: 'Exactly 2 classy photos required.' });
      if (!req.files.nudePhotos || req.files.nudePhotos.length !== 3)
        return res.status(400).json({ error: 'Exactly 3 nude photos required.' });
      if (!req.files.nudeVideos || req.files.nudeVideos.length !== 3)
        return res.status(400).json({ error: 'Exactly 3 nude videos required.' });

      const filesInfo = {
        profilePicture: req.files.profilePicture[0].filename,
        classyPhotos: req.files.classyPhotos.map(f => f.filename),
        nudePhotos: req.files.nudePhotos.map(f => f.filename),
        nudeVideos: req.files.nudeVideos.map(f => f.filename)
      };

      const application = {
        id: appId,
        submittedBy: req.user.username,
        username,
        officialName,
        mpesaNumber,
        whatsappNumber,
        email,
        consentAccepted: true,
        files: filesInfo,
        submittedAt: new Date().toISOString(),
        status: 'pending'
      };

      const apps = readJSON(APPLICATIONS_FILE);
      apps.push(application);
      writeJSON(APPLICATIONS_FILE, apps);

      // Generate welcome letter PDF
      const lettersDir = path.join(DATA_DIR, 'letters');
      if (!fs.existsSync(lettersDir)) fs.mkdirSync(lettersDir, { recursive: true });
      const letterPath = path.join(lettersDir, `${appId}.pdf`);
      await generateWelcomeLetter(letterPath, application);

      res.json({
        message: 'Application submitted successfully',
        applicationId: appId,
        welcomeLetterUrl: `/letters/${appId}.pdf`
      });

    } catch (err) {
      console.error('Apply error:', err);
      res.status(500).json({ error: 'Server error during submission: ' + err.message });
    }
  }
);

/* ----------- WELCOME LETTER PDF ----------- */
function generateWelcomeLetter(filePath, app) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // Background
      doc.rect(0, 0, doc.page.width, doc.page.height).fill('#0a0a0a');

      // Gold border
      doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40)
         .lineWidth(2).stroke('#d4af37');
      doc.rect(28, 28, doc.page.width - 56, doc.page.height - 56)
         .lineWidth(0.5).stroke('#d4af37');

      // Crown / Logo
      doc.fillColor('#d4af37').fontSize(28).font('Helvetica-Bold')
         .text('♛  UTAMU  ♛', 0, 70, { align: 'center' });
      doc.fontSize(10).fillColor('#d4af37')
         .text('L U X U R Y   A G E N C Y', 0, 105, { align: 'center', characterSpacing: 4 });

      // Divider
      doc.moveTo(150, 135).lineTo(doc.page.width - 150, 135).lineWidth(1).stroke('#d4af37');

      // Title
      doc.moveDown(2);
      doc.fillColor('#d4af37').fontSize(22).font('Helvetica-Bold')
         .text('WELCOME TO UTAMU AGENCY', { align: 'center' });
      doc.moveDown(0.5);
      doc.fillColor('#888').fontSize(11).font('Helvetica-Oblique')
         .text('Official Joining Letter', { align: 'center' });
      doc.moveDown(2);

      // Personalized greeting
      doc.fillColor('#ffffff').fontSize(13).font('Helvetica')
         .text(`Dear ${app.officialName},`, 60);
      doc.moveDown(1);

      const bodyText = `We are delighted to welcome you to UTAMU AGENCY — Kenya's premier luxury companionship network. Your application has been successfully received and is now under review by our admin team.

Your unique applicant ID is: ${app.id}

What happens next:

1. Our admin team will review your profile within 24 hours.

2. You will be contacted via WhatsApp (${app.whatsappNumber}) for a brief video interview.

3. Once approved, you will be added to the active companion roster.

4. Your first booking opportunities will be sent via WhatsApp.

5. All payments will be sent to your M-Pesa number: ${app.mpesaNumber}

Please remember our core values:
   •  Discretion is non-negotiable
   •  Safety always comes first
   •  Professional conduct at all times
   •  Honesty with the agency builds long-term success

Your information is strictly confidential and will be used solely for client bookings. We never share your data with third parties.

For any urgent questions, contact our concierge team via WhatsApp at +254 700 000 000.

Welcome aboard. The journey to elite companionship begins now.`;

      doc.fillColor('#dddddd').fontSize(11).font('Helvetica')
         .text(bodyText, 60, doc.y, { width: doc.page.width - 120, align: 'left', lineGap: 4 });

      doc.moveDown(2);
      doc.fillColor('#d4af37').fontSize(12).font('Helvetica-Oblique')
         .text('— The Utamu Management Team', 60);

      // Footer
      doc.fillColor('#888').fontSize(9).font('Helvetica')
         .text(`Issued on ${new Date(app.submittedAt).toDateString()}  |  Confidential — For ${app.officialName} Only`,
               60, doc.page.height - 80, { width: doc.page.width - 120, align: 'center' });

      doc.fillColor('#d4af37').fontSize(8)
         .text('UTAMU AGENCY · MOMBASA · DUBAI · NAIROBI (COMING SOON)',
               60, doc.page.height - 60, { width: doc.page.width - 120, align: 'center', characterSpacing: 2 });

      doc.end();
      stream.on('finish', resolve);
      stream.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}

/* =====================================================================
   ADMIN PANEL (password-protected)
   Visit: /admin?key=YOUR_ADMIN_PASSWORD
   ===================================================================== */
app.get('/admin', (req, res) => {
  if (req.query.key !== ADMIN_PASSWORD) {
    return res.status(403).send(`
      <html><body style="background:#000;color:#d4af37;font-family:sans-serif;text-align:center;padding:50px;">
        <h1>🔒 Admin Login</h1>
        <form>
          <input type="password" name="key" placeholder="Admin password"
                 style="padding:12px;border-radius:6px;border:1px solid #d4af37;background:#1a1a1a;color:#fff;font-size:1rem;"/>
          <button type="submit" style="padding:12px 25px;background:#d4af37;color:#000;border:none;border-radius:6px;font-weight:600;cursor:pointer;margin-left:10px;">Enter</button>
        </form>
      </body></html>
    `);
  }
  const apps = readJSON(APPLICATIONS_FILE);
  const users = readJSON(USERS_FILE);

  let rows = apps.map(a => `
    <tr>
      <td>${a.id}</td>
      <td>${a.officialName}<br/><small style="color:#888">@${a.username}</small></td>
      <td>${a.email}<br/>${a.whatsappNumber}</td>
      <td>${a.mpesaNumber}</td>
      <td>${new Date(a.submittedAt).toLocaleString()}</td>
      <td>
        <a href="/uploads/${a.id}/${a.files.profilePicture}?key=${ADMIN_PASSWORD}" target="_blank" class="btn">Profile Pic</a>
        ${a.files.classyPhotos.map((f,i)=>`<a href="/uploads/${a.id}/${f}?key=${ADMIN_PASSWORD}" target="_blank" class="btn">Classy ${i+1}</a>`).join('')}
        ${a.files.nudePhotos.map((f,i)=>`<a href="/uploads/${a.id}/${f}?key=${ADMIN_PASSWORD}" target="_blank" class="btn nsfw">Nude ${i+1}</a>`).join('')}
        ${a.files.nudeVideos.map((f,i)=>`<a href="/uploads/${a.id}/${f}?key=${ADMIN_PASSWORD}" target="_blank" class="btn nsfw">Video ${i+1}</a>`).join('')}
        <a href="/letters/${a.id}.pdf" target="_blank" class="btn gold">PDF</a>
      </td>
      <td><a href="/admin/delete?id=${a.id}&key=${ADMIN_PASSWORD}" class="btn danger" onclick="return confirm('Delete this application?')">Delete</a></td>
    </tr>
  `).join('');

  res.send(`
    <!DOCTYPE html>
    <html><head><title>Utamu Admin</title>
    <style>
      body{background:#0a0a0a;color:#fff;font-family:sans-serif;margin:0;padding:20px;}
      h1{color:#d4af37;text-align:center;letter-spacing:4px;}
      .stats{display:flex;gap:20px;justify-content:center;margin:20px 0;}
      .stat{background:#1a1a1a;border:1px solid #d4af37;border-radius:10px;padding:15px 25px;text-align:center;}
      .stat .num{color:#d4af37;font-size:2rem;font-weight:bold;}
      .stat .lbl{color:#888;font-size:.8rem;letter-spacing:2px;text-transform:uppercase;}
      table{width:100%;border-collapse:collapse;background:#1a1a1a;border-radius:10px;overflow:hidden;}
      th{background:#d4af37;color:#000;padding:12px;text-align:left;}
      td{padding:12px;border-bottom:1px solid #333;font-size:.9rem;vertical-align:top;}
      .btn{display:inline-block;padding:4px 8px;background:#333;color:#d4af37;text-decoration:none;border-radius:4px;font-size:.75rem;margin:2px;border:1px solid #d4af37;}
      .btn.gold{background:#d4af37;color:#000;}
      .btn.danger{background:#ff4757;color:#fff;border-color:#ff4757;}
      .btn.nsfw{border-color:#ff4757;color:#ff4757;}
      .btn:hover{opacity:.8;}
      .top-bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;}
      .logout{color:#d4af37;text-decoration:none;border:1px solid #d4af37;padding:8px 15px;border-radius:6px;}
    </style></head>
    <body>
      <div class="top-bar">
        <div></div>
        <h1>♛ UTAMU ADMIN PANEL ♛</h1>
        <a href="/admin" class="logout">Logout</a>
      </div>
      <div class="stats">
        <div class="stat"><div class="num">${apps.length}</div><div class="lbl">Applications</div></div>
        <div class="stat"><div class="num">${users.length}</div><div class="lbl">Users</div></div>
        <div class="stat"><div class="num">${apps.filter(a=>a.status==='pending').length}</div><div class="lbl">Pending</div></div>
      </div>
      <table>
        <thead><tr>
          <th>App ID</th><th>Name</th><th>Contact</th><th>M-Pesa</th><th>Submitted</th><th>Files</th><th>Action</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:40px;color:#888;">No applications yet</td></tr>'}</tbody>
      </table>
      <p style="text-align:center;color:#888;margin-top:30px;font-size:.85rem;">
        Utamu Agency Admin · ${new Date().toLocaleString()} · 
        <a href="/admin/export?key=${ADMIN_PASSWORD}" style="color:#d4af37;">Export JSON</a>
      </p>
    </body></html>
  `);
});

// Delete application
app.get('/admin/delete', (req, res) => {
  if (req.query.key !== ADMIN_PASSWORD) return res.status(403).send('Forbidden');
  const apps = readJSON(APPLICATIONS_FILE);
  const filtered = apps.filter(a => a.id !== req.query.id);
  writeJSON(APPLICATIONS_FILE, filtered);
  // Delete files
  const dir = path.join(UPLOADS_DIR, req.query.id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  const letter = path.join(DATA_DIR, 'letters', `${req.query.id}.pdf`);
  if (fs.existsSync(letter)) fs.unlinkSync(letter);
  res.redirect('/admin?key=' + ADMIN_PASSWORD);
});

// Export all data as JSON
app.get('/admin/export', (req, res) => {
  if (req.query.key !== ADMIN_PASSWORD) return res.status(403).send('Forbidden');
  res.json({
    exportedAt: new Date().toISOString(),
    users: readJSON(USERS_FILE),
    applications: readJSON(APPLICATIONS_FILE)
  });
});

/* ----------- START SERVER ----------- */
app.listen(PORT, () => {
  console.log('==============================================');
  console.log('  ♛  UTAMU AGENCY BACKEND  ♛');
  console.log('==============================================');
  console.log(`  Server running on port ${PORT}`);
  console.log(`  Local URL:   http://localhost:${PORT}`);
  console.log(`  Admin panel: http://localhost:${PORT}/admin?key=${ADMIN_PASSWORD}`);
  console.log('==============================================');
});
