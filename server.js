const path = require("path");
const express = require("express");
const cookieSession = require("cookie-session");
const bcrypt = require("bcryptjs");
const { pool, init } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(
  cookieSession({
    name: "chore-session",
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    sameSite: "lax",
    httpOnly: true,
  })
);
app.use(express.static(path.join(__dirname, "public")));

/* ---------- Period keys (server local time; set TZ env var on Railway) ---------- */

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function currentPeriodKey(freq, now = new Date()) {
  // Day-specific chores reset every day, like daily ones: each due date
  // is its own period.
  if (freq === "daily" || freq === "days") return dateKey(now);
  if (freq === "weekly") {
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    return "wk-" + dateKey(monday);
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function currentKeys() {
  const now = new Date();
  return {
    daily: currentPeriodKey("daily", now),
    weekly: currentPeriodKey("weekly", now),
    monthly: currentPeriodKey("monthly", now),
  };
}

/* ---------- Auth ---------- */

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  next();
}

async function requireAdmin(req, res, next) {
  try {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    const { rows } = await pool.query("SELECT is_admin FROM users WHERE id = $1", [
      req.session.userId,
    ]);
    if (!rows[0]?.is_admin) {
      return res.status(403).json({ error: "Only the admin can change the chore list" });
    }
    next();
  } catch (err) {
    next(err);
  }
}

app.post("/api/login", async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || password === undefined) {
      return res.status(400).json({ error: "Username and password required" });
    }
    const { rows } = await pool.query(
      "SELECT id, username, password_hash, is_admin FROM users WHERE LOWER(username) = LOWER($1)",
      [String(username).trim()]
    );
    const user = rows[0];
    if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
      return res.status(401).json({ error: "Wrong username or password" });
    }
    req.session.userId = user.id;
    res.json({ id: user.id, username: user.username, isAdmin: user.is_admin });
  } catch (err) {
    next(err);
  }
});

app.post("/api/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get("/api/me", async (req, res, next) => {
  try {
    if (!req.session.userId) return res.json({ user: null });
    const { rows } = await pool.query(
      "SELECT id, username, is_admin AS \"isAdmin\" FROM users WHERE id = $1",
      [req.session.userId]
    );
    res.json({ user: rows[0] || null });
  } catch (err) {
    next(err);
  }
});

/* ---------- Chores ---------- */

app.get("/api/chores", requireAuth, async (req, res, next) => {
  try {
    const keys = currentKeys();
    const { rows } = await pool.query(
      `SELECT ch.id, ch.name, ch.freq, ch.days,
              comp.user_id AS completed_by_id,
              u.username AS completed_by,
              comp.completed_at
       FROM chores ch
       LEFT JOIN completions comp
         ON comp.chore_id = ch.id
        AND comp.period_key = CASE ch.freq
              WHEN 'daily' THEN $1
              WHEN 'days' THEN $1
              WHEN 'weekly' THEN $2
              ELSE $3
            END
       LEFT JOIN users u ON u.id = comp.user_id
       ORDER BY ch.created_at, ch.id`,
      [keys.daily, keys.weekly, keys.monthly]
    );
    res.json({
      today: new Date().getDay(),
      chores: rows.map((r) => ({
        id: r.id,
        name: r.name,
        freq: r.freq,
        days: r.days,
        done: r.completed_by_id !== null || r.completed_at !== null,
        completedBy: r.completed_by,
      })),
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/chores", requireAdmin, async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim().slice(0, 60);
    const freq = String(req.body?.freq || "");
    if (!name) return res.status(400).json({ error: "Chore name required" });
    if (!["daily", "weekly", "monthly", "days"].includes(freq)) {
      return res.status(400).json({ error: "Invalid frequency" });
    }

    let days = null;
    if (freq === "days") {
      days = [...new Set((req.body?.days || []).map(Number))]
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        .sort();
      if (days.length === 0) {
        return res.status(400).json({ error: "Pick at least one day" });
      }
    }

    const { rows } = await pool.query(
      "INSERT INTO chores (name, freq, days) VALUES ($1, $2, $3) RETURNING id, name, freq, days",
      [name, freq, days]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

app.delete("/api/chores/:id", requireAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM chores WHERE id = $1", [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: "Chore not found" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post("/api/chores/:id/toggle", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT id, freq FROM chores WHERE id = $1", [
      req.params.id,
    ]);
    const chore = rows[0];
    if (!chore) return res.status(404).json({ error: "Chore not found" });

    const key = currentPeriodKey(chore.freq);
    const del = await pool.query(
      "DELETE FROM completions WHERE chore_id = $1 AND period_key = $2",
      [chore.id, key]
    );
    if (del.rowCount === 0) {
      await pool.query(
        `INSERT INTO completions (chore_id, period_key, user_id) VALUES ($1, $2, $3)
         ON CONFLICT (chore_id, period_key) DO NOTHING`,
        [chore.id, key, req.session.userId]
      );
      return res.json({ done: true });
    }
    res.json({ done: false });
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

init()
  .then(() => {
    app.listen(PORT, () => console.log(`Chore Tracker running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
