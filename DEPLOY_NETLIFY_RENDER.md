Netlify (frontend) + Render (backend) quick deploy

Overview
- Frontend: Netlify serves the static site from repo root (index.html).
- Backend: Render runs the Flask service in `backend/` and exposes `/api/exposure`.
- Netlify `_redirects` proxies `/api/*` to the Render service so frontend can keep calling `/api/exposure`.

Files added:
- `backend/requirements.txt` — Python deps
- `backend/Procfile` — start command for Render/Heroku-style hosts
- `_redirects` — Netlify proxy rule (update backend host)
- `firebase.json` and `.firebaserc` (optional earlier)

Steps
1) Push repo to GitHub.

2) Deploy backend on Render
- Create a new Web Service on Render and point it to the `backend/` folder of your repo.
- Build command: (Render autodetects Python) or leave default.
- Start command: `gunicorn main:app --bind 0.0.0.0:$PORT` (Procfile included).
- Ensure the service is public (allow unauthenticated) or configure auth.
- Note the service URL — e.g. `https://aqi-backend.onrender.com`.

3) Update `_redirects`
- Replace `https://aqi-backend.onrender.com` with your Render service URL.

4) Deploy frontend to Netlify
- Create new Site -> Import from Git -> choose repo
- Set build command: none (static)
- Publish directory: `.` (repo root)
- Ensure `_redirects` is present in repo root so Netlify proxies `/api/*` to the backend.

5) Verify
- Open Netlify site, plan a route; frontend will call `/api/exposure` which Netlify proxies to Render.
- If you prefer direct calls, set `USE_BACKEND = false` and change client to call the full backend URL.

Notes
- Keep `USE_BACKEND = true` in `script.js` for deployed setup.
- Render free tier and Netlify free tier both impose limits; the backend has caching to reduce Open-Meteo calls.
- If you want, I can add a GitHub Action to auto-deploy to Netlify and Render on push.
