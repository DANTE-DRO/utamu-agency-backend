# Elite Fitness — Backend

Node.js + Express + SQLite backend with built-in admin panel.

## 🚀 Deploy to Render.com

1. Push this `backend/` folder to a GitHub repository.
2. Go to [render.com](https://render.com) → **New +** → **Web Service**.
3. Connect your repo.
4. Configure:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free (or paid for always-on)
5. **CRITICAL — Add a Persistent Disk** (so data survives restarts/deploys):
   - In your service → **Disks** → **Add Disk**
   - **Name**: `fitness-data`
   - **Mount Path**: `/var/data`
   - **Size**: 1 GB (more than enough)
6. (Optional) Environment Variables:
   - `ADMIN_PASSWORD` → `11kenya72` (default already set)
7. Click **Deploy**.

Your URL will be: `https://utamu-agency-backend.onrender.com`

## 🔐 Admin Panel
- URL: `https://utamu-agency-backend.onrender.com/admin`
- Password: `11kenya72`

## 📡 API Endpoints
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST   | /api/submit | – | Public form submission |
| POST   | /api/admin/login | – | Get admin token |
| GET    | /api/admin/entries | ✓ | List all entries |
| DELETE | /api/admin/entries/:id | ✓ | Delete one |
| DELETE | /api/admin/entries | ✓ | Delete all |
| GET    | /api/admin/export | ✓ | Download CSV |
| POST   | /api/admin/logout | ✓ | Invalidate token |

## 💾 Data Persistence
- Uses **SQLite** stored at `/var/data/fitness.db`
- With the Render Disk attached, data **persists across restarts, deploys, and logouts**
- Without a Disk, data will be **lost on every deploy** — make sure to add it!

## 🧪 Local Test
```bash
npm install
npm start
# open http://localhost:10000/admin
```
