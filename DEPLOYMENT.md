# Deployment

Party Hub has two deployable pieces:

- **Frontend** (static React/Vite build) → **Vercel**
- **Server** (Node + Socket.io, needs a long-lived process for WebSockets) →
  **Render** or **Fly.io**

They talk over WebSockets, so two things must line up:
1. The frontend must know the server URL — set `VITE_SERVER_URL` at build time.
2. The server must allow the frontend's origin — set `CLIENT_ORIGIN` (CORS allow-list).

> ⚠️ The server keeps rooms **in memory**, so run a **single instance** (no horizontal
> scaling / autoscaling to multiple machines). Multiple instances would each hold
> different rooms and players could land on the wrong one. This is plenty for private
> 2-player rooms; add Redis-backed shared state only if you ever need to scale out.

---

## 1. Deploy the server first

You need the server URL before building the frontend, so start here.

### Option A — Render (simplest)

The repo includes [`render.yaml`](render.yaml).

1. Push the repo to GitHub.
2. In Render: **New +** → **Blueprint** → pick your repo. It reads `render.yaml`.
3. It builds with `pnpm install` + builds the shared package, then starts the server
   with `pnpm --filter @party-hub/server run start`. Health check: `/health`.
4. After the first deploy you'll have a URL like
   `https://party-hub-server.onrender.com`. **Copy it.**
5. Set the `CLIENT_ORIGIN` env var (in the Render dashboard) to your Vercel URL once
   you have it (step 2 below) — e.g. `https://party-hub.vercel.app` — and redeploy.

> Render's free tier sleeps on inactivity; the first request after idle takes a few
> seconds to wake. Fine for casual play.

### Option B — Fly.io

The repo includes [`fly.toml`](fly.toml) and a [`Dockerfile`](Dockerfile).

```bash
fly launch --no-deploy        # once — creates the app from fly.toml
fly secrets set CLIENT_ORIGIN=https://party-hub.vercel.app
fly deploy
```

Your server will be at `https://party-hub-server.fly.dev` (or your app name).
`min_machines_running = 0` lets it scale to zero when idle; bump to `1` to avoid
cold starts.

---

## 2. Deploy the frontend to Vercel

The repo includes [`vercel.json`](vercel.json) (monorepo build + SPA rewrite so deep
links like `/room/ABC123` serve the app).

1. In Vercel: **Add New… → Project** → import the repo.
2. Vercel picks up `vercel.json` automatically. Leave the framework as **Vite**.
3. Add an **Environment Variable**:
   - `VITE_SERVER_URL` = your server URL from step 1
     (e.g. `https://party-hub-server.onrender.com`)
4. **Deploy.** You'll get a URL like `https://party-hub.vercel.app`.

> `VITE_*` vars are inlined **at build time**. If you change `VITE_SERVER_URL`, you must
> **redeploy** the frontend for it to take effect.

---

## 3. Close the loop (CORS)

Go back to the server and make sure `CLIENT_ORIGIN` includes your final Vercel URL
(comma-separate multiple origins, e.g. a custom domain + the `*.vercel.app` URL), then
redeploy the server. Without this the browser will refuse the WebSocket connection.

---

## 4. Verify the deploy

- Server health: `curl https://<your-server>/health` → `{"ok":true,"rooms":0}`
- Open the Vercel URL, create a room, and open the shared link on **another device /
  network**. You should be able to complete a match. Refresh mid-game — your board
  should come right back.
- Optional: point the E2E smoke test at prod:
  `SERVER_URL=https://<your-server> pnpm --filter @party-hub/server run e2e`

---

## Environment variables

### Frontend (`packages/frontend/.env.example`)
| Var | Purpose |
| --- | --- |
| `VITE_SERVER_URL` | URL of the Socket.io server (build-time). |

### Server (`packages/server/.env.example`)
| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | Listen port (hosts inject this). |
| `CLIENT_ORIGIN` | localhost dev origins | Comma-separated CORS allow-list. |
| `SEAT_GRACE_MS` | `45000` | How long a disconnected player keeps their seat. |
| `ROOM_TTL_MS` | `7200000` | Idle-room lifetime before cleanup. |
| `CLEANUP_INTERVAL_MS` | `300000` | Cleanup sweep interval. |
| `MAX_GUESSES_PER_SEC` | `4` | Per-player guess rate limit. |
| `MAX_ROOM_CREATES_PER_MIN` | `15` | Per-player room-create rate limit. |
| `MAX_JOINS_PER_MIN` | `30` | Per-player join rate limit. |

---

## Local production build (sanity check before deploying)

```bash
pnpm build                      # builds shared, server (typecheck), frontend
pnpm --filter @party-hub/frontend run preview   # serves the built frontend
```
