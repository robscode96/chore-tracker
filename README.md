# 🏠 Chore Tracker

A shared household chore app. Everyone in the house sees the same chore
board, anyone can check off any chore, and the app shows who did it. Chores
reset automatically: daily at midnight, weekly on Monday, monthly on the 1st.

**Stack:** Node.js (Express) + PostgreSQL, deployed on Railway from GitHub.

## Features

- **Shared chores** — no per-person assignments. When someone checks off a
  chore it's done for the whole household for that period, with a badge
  showing who did it.
- **Daily / weekly / monthly** — chores are grouped by frequency with a
  per-section "x/y done" counter and an overall progress ring.
- **Automatic resets** — each completion is stamped with its period key
  (e.g. `2026-06-11` for daily, the week's Monday for weekly, `2026-06` for
  monthly). When the period rolls over, old completions simply stop counting.
- **Login** — simple username/password accounts stored in Postgres
  (passwords are bcrypt-hashed). Sessions last 30 days.
- **Add / remove chores** — anyone who's signed in can add or remove chores
  for the household.

## Local development

```sh
npm install
export DATABASE_URL=postgres://user:pass@localhost:5432/choretracker
npm start
# visit http://localhost:3000
```

Tables are created and seed data inserted automatically on first boot
(three users and a few sample chores).

## Deploying to Railway

1. Push this repo to GitHub.
2. In Railway, create a new project → **Deploy from GitHub repo** and pick
   this repo. Railway detects Node and runs `npm start`.
3. In the same project, **Add service → Database → PostgreSQL**.
4. On the app service, add a variable reference so the app can reach the
   database: `DATABASE_URL` → `${{Postgres.DATABASE_URL}}`.
5. Recommended variables:
   - `SESSION_SECRET` — any long random string (signs the session cookie).
   - `TZ` — your timezone, e.g. `America/New_York`, so daily/weekly/monthly
     resets happen at *your* midnight rather than UTC.
6. Generate a domain (service → Settings → Networking) and you're live.

If you connect to the database through Railway's public proxy instead of the
internal network, also set `PGSSL=true`.

## API

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/login` | `{username, password}` → session cookie |
| POST | `/api/logout` | Clear session |
| GET | `/api/me` | Current user (or `null`) |
| GET | `/api/chores` | All chores with done status for the current period |
| POST | `/api/chores` | `{name, freq}` — add a chore |
| DELETE | `/api/chores/:id` | Remove a chore |
| POST | `/api/chores/:id/toggle` | Toggle completion for the current period |
