# Utamu Agency — Backend

Production backend for the Utamu Agency frontend. Handles signup, login, application submissions (with file uploads), and a built-in admin dashboard.

## Quick Deploy to Render.com

1. Push this folder to a **new GitHub repo** (e.g. `utamu-agency-backend`).
2. On Render: **New → Web Service → Connect Repo**.
3. Settings (auto-detected from `render.yaml`, but verify):
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free (or Starter for production)
4. **Environment Variables** (add in Render dashboard):
   - `ADMIN_PASSWORD` = `11monari72dan`
   - `JWT_SECRET` = (any long random string, e.g. `utamu_secret_2026_abc123xyz`)
   - `DATA_DIR` = `/var/data` *(only if you attach a Disk — see below)*
5. **(Strongly recommended) Add a Persistent Disk:**
   - Render → your service → **Disks → Add Disk**
   - Name: `utamu-data`, Mount Path: `/var/data`, Size: 1 GB
   - Without a disk, all uploaded files and user accounts are wiped on every redeploy.
6. Click **Deploy**. Your URL will be: `https://utamu-agency-backend.onrender.com`

## Admin Dashboard

- URL: `https://utamu-agency-backend.onrender.com/admin`
- Password: `11monari72dan`

From the dashboard you can:
- See every application with name, M-Pesa, WhatsApp, email, consent status
- Download every uploaded file (profile picture, classy photos, nude photos, nude videos, welcome letter PDF)
- View all registered users
- Delete applications (also removes their files)

## How to download submitted files

**Option 1 — Through the admin dashboard (easiest):**
1. Go to `/admin`, enter password `11monari72dan`
2. Each application card lists all uploaded files as clickable links
3. Click any file → it downloads immediately

**Option 2 — Direct URL (requires admin password):**
```
https://utamu-agency-backend.onrender.com/api/admin/file/APP-XXXX/filename?password=11monari72dan
```

**Option 3 — Welcome letter PDF (public, anyone with link):**
```
https://utamu-agency-backend.onrender.com/uploads/APP-XXXX/welcome-letter.pdf
```

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/signup` | Create user `{email, username, password}` |
| POST | `/api/login` | Login → returns JWT `{username, password}` |
| POST | `/api/apply` | Submit application (multipart, Bearer token) |
| GET  | `/api/admin/applications` | List apps (header `x-admin-password`) |
| GET  | `/api/admin/users` | List users (header `x-admin-password`) |
| GET  | `/admin` | Browser admin dashboard |

## Local Development

```bash
npm install
npm start
# → http://localhost:5000
# → http://localhost:5000/admin (password: 11monari72dan)
```

## Frontend Compatibility

Your existing frontend (`API_BASE = 'https://utamu-agency-backend.onrender.com'`) works without **any code changes**. The backend exposes exactly the routes the frontend calls:
- `/api/signup`
- `/api/login`
- `/api/apply` (returns `{ applicationId, welcomeLetterUrl }` — the frontend prepends `API_BASE` to that URL)

## Notes on Render Free Tier

- Free instances **sleep after 15 minutes** of inactivity. The first request after sleep takes ~30 seconds to wake up. Upgrade to Starter ($7/mo) to keep it always-on.
- Free instances have **ephemeral disk** unless you attach a paid disk. For production use, attach the 1 GB disk as shown in `render.yaml` (~$0.25/mo).
