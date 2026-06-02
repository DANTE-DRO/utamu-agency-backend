// ELITE FITNESS — Backend API
// Node.js + Express + SQLite (persistent on Render via /var/data disk or local file)
// Endpoints:
//   POST /api/submit         - public form submission
//   POST /api/admin/login    - admin password login (returns token)
//   GET  /api/admin/entries  - list all entries (auth)
//   DELETE /api/admin/entries/:id - delete one (auth)
//   DELETE /api/admin/entries    - delete all (auth)
//   GET  /api/admin/export   - CSV export (auth)
//   GET  /admin              - admin panel UI

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 10000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '11kenya72';

// ----- DATABASE (persistent) -----
// On Render, attach a Disk and mount it at /var/data for persistence across deploys/restarts.
// Falls back to local ./data folder during development.
const DATA_DIR = fs.existsSync('/var/data') ? '/var/data' : path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'fitness.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  residency TEXT NOT NULL,
  goal TEXT NOT NULL,
  level TEXT NOT NULL,
  weight TEXT NOT NULL,
  frequency TEXT NOT NULL,
  injuries TEXT NOT NULL,
  experience TEXT NOT NULL,
  timeline TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL
);
`);

// ----- APP -----
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));

// ----- HELPERS -----
function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim() || req.query.token;
  if (!token) return res.status(401).json({ success:false, message:'No token' });
  const row = db.prepare('SELECT token FROM tokens WHERE token = ?').get(token);
  if (!row) return res.status(401).json({ success:false, message:'Invalid token' });
  next();
}

function sanitize(s){ return String(s == null ? '' : s).trim().slice(0, 500); }

// ----- ROUTES -----
app.get('/', (req,res) => {
  res.send(`
    <html><head><title>Elite Fitness API</title>
    <style>body{font-family:sans-serif;background:#000;color:#d4af37;padding:40px;text-align:center}
    a{color:#d4af37}</style></head>
    <body>
      <h1>👑 Elite Fitness API</h1>
      <p>Backend is running.</p>
      <p><a href="/admin">→ Admin Panel</a></p>
      <p style="color:#888;font-size:.8rem">DB: ${DB_PATH}</p>
    </body></html>
  `);
});

app.get('/api/health', (req,res) => res.json({ ok:true, time:new Date().toISOString() }));

// Public form submit
app.post('/api/submit', (req, res) => {
  try {
    const fields = ['name','email','phone','residency','goal','level','weight','frequency','injuries','experience','timeline'];
    const data = {};
    for (const f of fields) {
      data[f] = sanitize(req.body[f]);
      if (!data[f]) return res.status(400).json({ success:false, message:`Field ${f} required` });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email))
      return res.status(400).json({ success:false, message:'Invalid email' });

    const createdAt = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO entries (name,email,phone,residency,goal,level,weight,frequency,injuries,experience,timeline,createdAt)
      VALUES (@name,@email,@phone,@residency,@goal,@level,@weight,@frequency,@injuries,@experience,@timeline,@createdAt)
    `);
    const result = stmt.run({ ...data, createdAt });
    const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(result.lastInsertRowid);
    res.json({ success:true, entry });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false, message:'Server error' });
  }
});

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ success:false, message:'Wrong password' });
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO tokens (token,createdAt) VALUES (?,?)').run(token, new Date().toISOString());
  res.json({ success:true, token });
});

// Admin: list entries
app.get('/api/admin/entries', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM entries ORDER BY id DESC').all();
  res.json({ success:true, entries: rows });
});

// Admin: delete one
app.delete('/api/admin/entries/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = db.prepare('DELETE FROM entries WHERE id = ?').run(id);
  res.json({ success:true, deleted:r.changes });
});

// Admin: delete all
app.delete('/api/admin/entries', requireAuth, (req, res) => {
  const r = db.prepare('DELETE FROM entries').run();
  res.json({ success:true, deleted:r.changes });
});

// Admin: CSV export
app.get('/api/admin/export', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM entries ORDER BY id DESC').all();
  const headers = ['id','name','email','phone','residency','goal','level','weight','frequency','injuries','experience','timeline','createdAt'];
  const escape = (v) => `"${String(v==null?'':v).replace(/"/g,'""')}"`;
  const csv = [headers.join(',')]
    .concat(rows.map(r => headers.map(h => escape(r[h])).join(',')))
    .join('\n');
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition','attachment; filename="elite-fitness-entries.csv"');
  res.send(csv);
});

// Admin: logout
app.post('/api/admin/logout', requireAuth, (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  db.prepare('DELETE FROM tokens WHERE token = ?').run(token);
  res.json({ success:true });
});

// ----- ADMIN PANEL UI -----
app.get('/admin', (req, res) => {
  res.send(ADMIN_HTML);
});

// ----- HTML for admin -----
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Elite Fitness — Admin Panel</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
<style>
:root{--gold:#d4af37;--gold-light:#f4d97a;--gold-deep:#a8862a;--black:#000;--black-soft:#0a0a0a;--black-card:#111;--black-border:#1c1c1c;--text:#f5f5f5;--text-dim:#a0a0a0}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#000;color:var(--text);min-height:100vh}
::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track{background:#000}::-webkit-scrollbar-thumb{background:linear-gradient(var(--gold),var(--gold-deep));border-radius:5px}

/* LOGIN */
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem;
  background:radial-gradient(circle at 30% 50%,rgba(212,175,55,.1),transparent 60%),#000}
.login-card{background:linear-gradient(135deg,var(--black-card),var(--black-soft));
  border:1px solid var(--gold);border-radius:20px;padding:3rem;max-width:430px;width:100%;
  box-shadow:0 20px 80px rgba(212,175,55,.2);text-align:center}
.crown{width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,var(--gold-light),var(--gold-deep));
  display:flex;align-items:center;justify-content:center;font-size:2rem;color:#000;margin:0 auto 1.5rem}
.login-card h1{font-family:'Cinzel',serif;color:var(--gold);font-size:1.8rem;letter-spacing:3px;margin-bottom:.5rem}
.login-card p{color:var(--text-dim);font-size:.9rem;margin-bottom:2rem}
.login-card input{width:100%;padding:1rem;background:rgba(0,0,0,.5);border:1px solid var(--black-border);
  border-radius:10px;color:#fff;font-size:1rem;margin-bottom:1rem;transition:.3s}
.login-card input:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(212,175,55,.15)}
.btn-gold{width:100%;padding:1rem;background:linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-deep));
  color:#000;font-weight:700;border:none;border-radius:50px;cursor:pointer;letter-spacing:2px;text-transform:uppercase;
  font-size:.95rem;transition:.3s;box-shadow:0 10px 30px rgba(212,175,55,.3);font-family:'Inter',sans-serif}
.btn-gold:hover{transform:translateY(-2px);box-shadow:0 15px 40px rgba(212,175,55,.5)}
.btn-gold:disabled{opacity:.5;cursor:not-allowed}
.alert{padding:.8rem;border-radius:8px;margin-bottom:1rem;font-size:.85rem;display:none}
.alert.error{background:rgba(220,53,69,.15);color:#ff6b7a;border:1px solid #dc3545;display:block}

/* PANEL */
.dashboard{display:none}
.dashboard.active{display:block}
.topbar{background:linear-gradient(135deg,#000,#0a0a0a);padding:1.2rem 2rem;
  border-bottom:1px solid rgba(212,175,55,.2);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;
  position:sticky;top:0;z-index:100;backdrop-filter:blur(10px)}
.topbar .brand{font-family:'Cinzel',serif;font-size:1.4rem;letter-spacing:3px;
  background:linear-gradient(135deg,var(--gold-light),var(--gold));-webkit-background-clip:text;-webkit-text-fill-color:transparent;
  display:flex;align-items:center;gap:.7rem}
.topbar .brand i{color:var(--gold);-webkit-text-fill-color:var(--gold)}
.topbar-actions{display:flex;gap:.7rem;flex-wrap:wrap}
.btn-sm{padding:.6rem 1.2rem;border-radius:30px;border:1px solid var(--gold);
  background:transparent;color:var(--gold);cursor:pointer;font-size:.8rem;letter-spacing:1px;text-transform:uppercase;
  transition:.3s;font-family:'Inter',sans-serif;display:inline-flex;align-items:center;gap:.4rem}
.btn-sm:hover{background:var(--gold);color:#000}
.btn-sm.danger{border-color:#dc3545;color:#ff6b7a}
.btn-sm.danger:hover{background:#dc3545;color:#fff}

.container{padding:2rem;max-width:1500px;margin:0 auto}
.stats-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1.5rem;margin-bottom:2rem}
.stat-box{background:linear-gradient(135deg,var(--black-card),var(--black-soft));border:1px solid var(--black-border);
  border-radius:15px;padding:1.5rem;transition:.3s;position:relative;overflow:hidden}
.stat-box::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;
  background:linear-gradient(90deg,var(--gold-light),var(--gold-deep))}
.stat-box:hover{transform:translateY(-3px);border-color:var(--gold);box-shadow:0 10px 30px rgba(212,175,55,.15)}
.stat-box .icon{width:50px;height:50px;border-radius:12px;background:linear-gradient(135deg,var(--gold-light),var(--gold-deep));
  display:flex;align-items:center;justify-content:center;color:#000;font-size:1.4rem;margin-bottom:1rem}
.stat-box .num{font-family:'Cinzel',serif;font-size:2rem;color:var(--gold);font-weight:800}
.stat-box .lbl{color:var(--text-dim);font-size:.8rem;text-transform:uppercase;letter-spacing:2px;margin-top:.3rem}

.toolbar{display:flex;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap;align-items:center}
.search-box{flex:1;min-width:250px;position:relative}
.search-box i{position:absolute;left:1rem;top:50%;transform:translateY(-50%);color:var(--gold)}
.search-box input{width:100%;padding:.8rem 1rem .8rem 2.8rem;background:var(--black-card);
  border:1px solid var(--black-border);border-radius:50px;color:#fff;font-size:.9rem;transition:.3s}
.search-box input:focus{outline:none;border-color:var(--gold)}

.table-wrap{background:linear-gradient(135deg,var(--black-card),var(--black-soft));
  border:1px solid var(--black-border);border-radius:15px;overflow:hidden}
.table-scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;min-width:1200px}
thead{background:linear-gradient(135deg,#0a0a0a,#000)}
thead th{padding:1rem;text-align:left;color:var(--gold);font-size:.75rem;
  text-transform:uppercase;letter-spacing:2px;border-bottom:1px solid rgba(212,175,55,.2);white-space:nowrap;font-weight:600}
tbody tr{transition:.2s;border-bottom:1px solid rgba(255,255,255,.04)}
tbody tr:hover{background:rgba(212,175,55,.05)}
tbody td{padding:1rem;font-size:.85rem;vertical-align:top}
.pill{display:inline-block;padding:.25rem .7rem;background:rgba(212,175,55,.1);
  color:var(--gold);border-radius:20px;font-size:.75rem;border:1px solid rgba(212,175,55,.3);white-space:nowrap}
.del-btn{background:rgba(220,53,69,.15);color:#ff6b7a;border:1px solid #dc3545;
  padding:.4rem .7rem;border-radius:8px;cursor:pointer;font-size:.75rem;transition:.3s}
.del-btn:hover{background:#dc3545;color:#fff}
.empty{padding:4rem 2rem;text-align:center;color:var(--text-dim)}
.empty i{font-size:3rem;color:var(--gold);opacity:.4;margin-bottom:1rem;display:block}

.detail-modal{position:fixed;inset:0;background:rgba(0,0,0,.9);backdrop-filter:blur(10px);
  display:none;align-items:center;justify-content:center;z-index:1000;padding:2rem}
.detail-modal.active{display:flex}
.detail-box{background:linear-gradient(135deg,var(--black-card),var(--black-soft));
  border:1px solid var(--gold);border-radius:20px;max-width:600px;width:100%;padding:2.5rem;
  max-height:90vh;overflow-y:auto}
.detail-box h2{font-family:'Cinzel',serif;color:var(--gold);margin-bottom:1.5rem;text-align:center;letter-spacing:2px}
.detail-row{display:grid;grid-template-columns:140px 1fr;gap:1rem;padding:.7rem 0;border-bottom:1px solid var(--black-border)}
.detail-row .k{color:var(--text-dim);text-transform:uppercase;font-size:.75rem;letter-spacing:1.5px}
.detail-row .v{color:#fff;font-weight:500;word-break:break-word}
.close-x{float:right;width:35px;height:35px;border-radius:50%;background:transparent;
  border:1px solid var(--gold);color:var(--gold);cursor:pointer;font-size:1rem;transition:.3s}
.close-x:hover{background:var(--gold);color:#000;transform:rotate(90deg)}

@media(max-width:768px){
  .topbar{flex-direction:column;align-items:stretch}
  .container{padding:1rem}
}
</style>
</head>
<body>

<!-- LOGIN -->
<div class="login-wrap" id="loginWrap">
  <div class="login-card">
    <div class="crown"><i class="fas fa-crown"></i></div>
    <h1>ADMIN PANEL</h1>
    <p>Elite Fitness — Secure access only</p>
    <div class="alert" id="loginAlert"></div>
    <input type="password" id="passwordInput" placeholder="Enter admin password" autocomplete="off"/>
    <button class="btn-gold" id="loginBtn" onclick="login()">
      <i class="fas fa-lock-open"></i> &nbsp;Unlock
    </button>
  </div>
</div>

<!-- DASHBOARD -->
<div class="dashboard" id="dashboard">
  <div class="topbar">
    <div class="brand"><i class="fas fa-crown"></i> ELITE FITNESS — ADMIN</div>
    <div class="topbar-actions">
      <button class="btn-sm" onclick="loadEntries()"><i class="fas fa-rotate"></i> Refresh</button>
      <button class="btn-sm" onclick="exportCSV()"><i class="fas fa-download"></i> Export CSV</button>
      <button class="btn-sm danger" onclick="deleteAll()"><i class="fas fa-trash"></i> Delete All</button>
      <button class="btn-sm" onclick="logout()"><i class="fas fa-sign-out-alt"></i> Logout</button>
    </div>
  </div>

  <div class="container">
    <div class="stats-row">
      <div class="stat-box"><div class="icon"><i class="fas fa-users"></i></div><div class="num" id="statTotal">0</div><div class="lbl">Total Entries</div></div>
      <div class="stat-box"><div class="icon"><i class="fas fa-dumbbell"></i></div><div class="num" id="statMuscle">0</div><div class="lbl">Build Muscle</div></div>
      <div class="stat-box"><div class="icon"><i class="fas fa-fire"></i></div><div class="num" id="statLose">0</div><div class="lbl">Lose Weight</div></div>
      <div class="stat-box"><div class="icon"><i class="fas fa-heart"></i></div><div class="num" id="statFit">0</div><div class="lbl">Stay Fit</div></div>
    </div>

    <div class="toolbar">
      <div class="search-box">
        <i class="fas fa-search"></i>
        <input id="searchInput" placeholder="Search by name, email, phone, goal..." oninput="renderTable()"/>
      </div>
    </div>

    <div class="table-wrap">
      <div class="table-scroll">
        <table>
          <thead><tr>
            <th>ID</th><th>Name</th><th>Email</th><th>Phone</th><th>Residency</th>
            <th>Goal</th><th>Level</th><th>Weight</th><th>Days/Wk</th>
            <th>Submitted</th><th>Actions</th>
          </tr></thead>
          <tbody id="tableBody"></tbody>
        </table>
      </div>
      <div class="empty" id="emptyState" style="display:none">
        <i class="fas fa-inbox"></i>
        <p>No entries yet. Submissions from the website will appear here.</p>
      </div>
    </div>
  </div>
</div>

<!-- DETAIL MODAL -->
<div class="detail-modal" id="detailModal">
  <div class="detail-box">
    <button class="close-x" onclick="closeDetail()"><i class="fas fa-times"></i></button>
    <h2 style="clear:both">Application Detail</h2>
    <div id="detailContent"></div>
  </div>
</div>

<script>
let TOKEN = localStorage.getItem('ef_token') || '';
let ENTRIES = [];

function show(el){el.style.display='block'}
function hide(el){el.style.display='none'}

window.addEventListener('DOMContentLoaded',()=>{
  if(TOKEN) verifyAndLoad();
  document.getElementById('passwordInput').addEventListener('keypress',e=>{if(e.key==='Enter') login();});
});

async function verifyAndLoad(){
  // try loading entries; if 401, drop token
  try{
    const r = await fetch('/api/admin/entries',{headers:{Authorization:'Bearer '+TOKEN}});
    if(r.status===401){ localStorage.removeItem('ef_token'); TOKEN=''; return; }
    const j = await r.json();
    if(!j.success) throw new Error();
    ENTRIES = j.entries;
    hide(document.getElementById('loginWrap'));
    document.getElementById('dashboard').classList.add('active');
    renderTable();
  }catch(e){
    localStorage.removeItem('ef_token'); TOKEN='';
  }
}

async function login(){
  const pw = document.getElementById('passwordInput').value.trim();
  const alertBox = document.getElementById('loginAlert');
  const btn = document.getElementById('loginBtn');
  alertBox.className='alert';alertBox.textContent='';
  if(!pw){alertBox.className='alert error';alertBox.textContent='Please enter password';return;}
  btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> &nbsp;Verifying...';
  try{
    const r = await fetch('/api/admin/login',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({password:pw})
    });
    const j = await r.json();
    if(!r.ok || !j.success) throw new Error(j.message||'Login failed');
    TOKEN = j.token;
    localStorage.setItem('ef_token', TOKEN);
    await verifyAndLoad();
  }catch(e){
    alertBox.className='alert error';
    alertBox.textContent = e.message;
  }finally{
    btn.disabled=false; btn.innerHTML='<i class="fas fa-lock-open"></i> &nbsp;Unlock';
  }
}

async function loadEntries(){
  try{
    const r = await fetch('/api/admin/entries',{headers:{Authorization:'Bearer '+TOKEN}});
    const j = await r.json();
    if(!j.success) throw new Error();
    ENTRIES = j.entries;
    renderTable();
  }catch(e){alert('Failed to load entries');}
}

function renderTable(){
  const q = document.getElementById('searchInput').value.toLowerCase();
  const filtered = ENTRIES.filter(e => !q || JSON.stringify(e).toLowerCase().includes(q));
  const tbody = document.getElementById('tableBody');
  const empty = document.getElementById('emptyState');
  tbody.innerHTML='';
  if(filtered.length===0){show(empty);} else {hide(empty);}
  filtered.forEach(e=>{
    const tr = document.createElement('tr');
    tr.style.cursor='pointer';
    tr.innerHTML = \`
      <td><span class="pill">#\${e.id}</span></td>
      <td><b>\${escapeHtml(e.name)}</b></td>
      <td>\${escapeHtml(e.email)}</td>
      <td>\${escapeHtml(e.phone)}</td>
      <td>\${escapeHtml(e.residency)}</td>
      <td><span class="pill">\${escapeHtml(e.goal)}</span></td>
      <td>\${escapeHtml(e.level)}</td>
      <td>\${escapeHtml(e.weight)} kg</td>
      <td>\${escapeHtml(e.frequency)}</td>
      <td>\${new Date(e.createdAt).toLocaleDateString()} <br><small style="color:#888">\${new Date(e.createdAt).toLocaleTimeString()}</small></td>
      <td>
        <button class="del-btn" onclick="event.stopPropagation();deleteEntry(\${e.id})"><i class="fas fa-trash"></i></button>
      </td>\`;
    tr.addEventListener('click',()=>showDetail(e));
    tbody.appendChild(tr);
  });
  // stats
  document.getElementById('statTotal').textContent = ENTRIES.length;
  document.getElementById('statMuscle').textContent = ENTRIES.filter(e=>e.goal==='Build Muscle').length;
  document.getElementById('statLose').textContent = ENTRIES.filter(e=>e.goal==='Lose Weight').length;
  document.getElementById('statFit').textContent = ENTRIES.filter(e=>e.goal==='Stay Fit').length;
}

function escapeHtml(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])}

function showDetail(e){
  const labels = {
    id:'ID',name:'Full Name',email:'Email',phone:'Phone',residency:'Residency',
    goal:'Fitness Goal',level:'Fitness Level',weight:'Weight (kg)',
    frequency:'Workout Frequency',injuries:'Injuries',
    experience:'Fitness Experience',timeline:'Goal Timeline',createdAt:'Submitted At'
  };
  const c = document.getElementById('detailContent');
  c.innerHTML = Object.keys(labels).map(k=>{
    let v = e[k]||'-';
    if(k==='createdAt') v = new Date(v).toLocaleString();
    return \`<div class="detail-row"><div class="k">\${labels[k]}</div><div class="v">\${escapeHtml(v)}</div></div>\`;
  }).join('');
  document.getElementById('detailModal').classList.add('active');
}
function closeDetail(){document.getElementById('detailModal').classList.remove('active');}

async function deleteEntry(id){
  if(!confirm('Delete entry #'+id+'?')) return;
  try{
    const r = await fetch('/api/admin/entries/'+id,{method:'DELETE',headers:{Authorization:'Bearer '+TOKEN}});
    const j = await r.json();
    if(!j.success) throw new Error();
    ENTRIES = ENTRIES.filter(e=>e.id!==id);
    renderTable();
  }catch(e){alert('Delete failed');}
}

async function deleteAll(){
  if(!confirm('PERMANENTLY delete ALL entries? This cannot be undone.')) return;
  if(!confirm('Are you ABSOLUTELY sure? All client applications will be lost.')) return;
  try{
    const r = await fetch('/api/admin/entries',{method:'DELETE',headers:{Authorization:'Bearer '+TOKEN}});
    const j = await r.json();
    if(!j.success) throw new Error();
    ENTRIES = [];
    renderTable();
  }catch(e){alert('Delete failed');}
}

function exportCSV(){
  window.location = '/api/admin/export?token='+encodeURIComponent(TOKEN);
}

async function logout(){
  try{ await fetch('/api/admin/logout',{method:'POST',headers:{Authorization:'Bearer '+TOKEN}}); }catch(e){}
  localStorage.removeItem('ef_token');
  TOKEN=''; ENTRIES=[];
  document.getElementById('dashboard').classList.remove('active');
  show(document.getElementById('loginWrap'));
  document.getElementById('passwordInput').value='';
}
</script>
</body>
</html>`;

// ----- START -----
app.listen(PORT, () => {
  console.log('====================================');
  console.log('🏋️  ELITE FITNESS BACKEND RUNNING');
  console.log('Port:', PORT);
  console.log('DB:  ', DB_PATH);
  console.log('Admin: /admin');
  console.log('====================================');
});
