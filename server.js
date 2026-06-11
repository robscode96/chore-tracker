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
      return res.status(403).json({ error: "Admins only" });
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
      `SELECT ch.id, ch.name, ch.freq, ch.days, ch.time_of_day,
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
        timeOfDay: r.time_of_day,
        done: r.completed_by_id !== null || r.completed_at !== null,
        completedBy: r.completed_by,
        completedAt: r.completed_at,
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

    const timeOfDay = ["any", "morning", "evening"].includes(req.body?.timeOfDay)
      ? req.body.timeOfDay
      : "any";

    const { rows } = await pool.query(
      `INSERT INTO chores (name, freq, days, time_of_day) VALUES ($1, $2, $3, $4)
       RETURNING id, name, freq, days, time_of_day AS "timeOfDay"`,
      [name, freq, days, timeOfDay]
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

// Admin can change who gets credit for the current period's completion
// (e.g. Robert marking a chore as done by Karen).
app.patch("/api/chores/:id/completion", requireAdmin, async (req, res, next) => {
  try {
    const userId = Number(req.body?.userId);
    const { rows: userRows } = await pool.query("SELECT id FROM users WHERE id = $1", [userId]);
    if (!userRows[0]) return res.status(400).json({ error: "No such member" });

    const { rows: choreRows } = await pool.query("SELECT id, freq FROM chores WHERE id = $1", [
      req.params.id,
    ]);
    if (!choreRows[0]) return res.status(404).json({ error: "Chore not found" });

    const key = currentPeriodKey(choreRows[0].freq);
    const upd = await pool.query(
      "UPDATE completions SET user_id = $1 WHERE chore_id = $2 AND period_key = $3",
      [userId, choreRows[0].id, key]
    );
    if (upd.rowCount === 0) {
      return res.status(409).json({ error: "That chore isn't checked off right now" });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---------- Stats (admin only) ---------- */

app.get("/api/stats", requireAdmin, async (req, res, next) => {
  try {
    const [leaderQ, topQ, dowQ, choresQ, compsQ] = await Promise.all([
      pool.query(
        `SELECT u.id, u.username,
                COUNT(c.chore_id)::int AS total,
                COUNT(c.chore_id) FILTER (WHERE c.completed_at > now() - interval '30 days')::int AS last30,
                COUNT(c.chore_id) FILTER (WHERE c.completed_at >= date_trunc('week', now()))::int AS "thisWeek"
         FROM users u
         LEFT JOIN completions c ON c.user_id = u.id
         GROUP BY u.id, u.username
         ORDER BY total DESC, u.id`
      ),
      pool.query(
        `SELECT ch.name, COUNT(*)::int AS count
         FROM completions c JOIN chores ch ON ch.id = c.chore_id
         GROUP BY ch.id, ch.name
         ORDER BY count DESC, ch.name
         LIMIT 5`
      ),
      pool.query(
        `SELECT EXTRACT(DOW FROM c.completed_at)::int AS dow, COUNT(*)::int AS count
         FROM completions c
         GROUP BY 1 ORDER BY 2 DESC LIMIT 1`
      ),
      pool.query("SELECT id, name, freq, days, created_at FROM chores"),
      pool.query("SELECT chore_id, period_key FROM completions"),
    ]);

    const doneKeys = new Map(); // chore_id -> Set of period keys
    for (const row of compsQ.rows) {
      if (!doneKeys.has(row.chore_id)) doneKeys.set(row.chore_id, new Set());
      doneKeys.get(row.chore_id).add(row.period_key);
    }

    const today = new Date();
    const todayKey = dateKey(today);

    // On-time rates over the last 30 days, counting only fully elapsed
    // periods (today / the current week / the current month aren't held
    // against anyone while they're still in progress).
    const monthStartKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const thisWeekKey = currentPeriodKey("weekly", today);
    const choreRates = [];
    let overallDone = 0;
    let overallExpected = 0;

    for (const chore of choresQ.rows) {
      const createdKey = dateKey(new Date(chore.created_at));
      const expected = new Set();
      const d = new Date(today);
      d.setDate(d.getDate() - 29);
      for (; dateKey(d) <= todayKey; d.setDate(d.getDate() + 1)) {
        const dKey = dateKey(d);
        if (dKey < createdKey) continue;
        if (chore.freq === "daily" || chore.freq === "days") {
          if (dKey >= todayKey) continue; // today still in progress
          if (chore.freq === "days" && !(chore.days || []).includes(d.getDay())) continue;
          expected.add(dKey);
        } else if (chore.freq === "weekly") {
          const key = currentPeriodKey("weekly", d);
          if (key !== thisWeekKey) expected.add(key);
        } else {
          const key = currentPeriodKey("monthly", d);
          if (key !== monthStartKey) expected.add(key);
        }
      }
      if (expected.size === 0) continue;
      const done = [...expected].filter((k) => doneKeys.get(chore.id)?.has(k)).length;
      overallDone += done;
      overallExpected += expected.size;
      choreRates.push({
        name: chore.name,
        freq: chore.freq,
        done,
        expected: expected.size,
        pct: Math.round((done / expected.size) * 100),
      });
    }
    choreRates.sort((a, b) => b.pct - a.pct || b.expected - a.expected);

    // Streak: consecutive days where every due daily/day-specific chore got
    // done. Today joins the streak once it's fully done; an unfinished today
    // doesn't break yesterday's streak.
    const dailies = choresQ.rows
      .filter((c) => c.freq === "daily" || c.freq === "days")
      .map((c) => ({ ...c, createdKey: dateKey(new Date(c.created_at)) }));
    let streak = 0;
    if (dailies.length > 0) {
      const earliestKey = dailies.reduce(
        (min, c) => (c.createdKey < min ? c.createdKey : min),
        dailies[0].createdKey
      );
      const dueOn = (d, key) =>
        dailies.filter(
          (c) =>
            c.createdKey <= key &&
            (c.freq === "daily" || (c.days || []).includes(d.getDay()))
        );
      const allDone = (d, key) =>
        dueOn(d, key).every((c) => doneKeys.get(c.id)?.has(key));

      const todayDue = dueOn(today, todayKey);
      if (todayDue.length > 0 && allDone(today, todayKey)) streak++;

      const d = new Date(today);
      for (let i = 0; i < 365; i++) {
        d.setDate(d.getDate() - 1);
        const key = dateKey(d);
        if (key < earliestKey) break;
        const due = dueOn(d, key);
        if (due.length === 0) continue;
        if (!allDone(d, key)) break;
        streak++;
      }
    }

    res.json({
      leaderboard: leaderQ.rows,
      topChores: topQ.rows,
      busiestDay: dowQ.rows[0] || null,
      streak,
      choreRates,
      overall: {
        done: overallDone,
        expected: overallExpected,
        pct: overallExpected ? Math.round((overallDone / overallExpected) * 100) : null,
      },
      totals: {
        completions: compsQ.rows.length,
        chores: choresQ.rows.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

/* ---------- Household management (admin only) ---------- */

app.get("/api/users", requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, is_admin AS "isAdmin" FROM users ORDER BY id'
    );
    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

app.post("/api/users", requireAdmin, async (req, res, next) => {
  try {
    const username = String(req.body?.username || "").trim().slice(0, 24);
    const password = String(req.body?.password || "");
    if (!username) return res.status(400).json({ error: "Name required" });
    if (!password) return res.status(400).json({ error: "Password required" });
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, false)
       RETURNING id, username, is_admin AS "isAdmin"`,
      [username, bcrypt.hashSync(password, 10)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "That name is already taken" });
    }
    next(err);
  }
});

app.patch("/api/users/:id", requireAdmin, async (req, res, next) => {
  try {
    const targetId = Number(req.params.id);

    if (typeof req.body?.isAdmin === "boolean") {
      if (targetId === req.session.userId && req.body.isAdmin === false) {
        return res.status(400).json({ error: "You can't remove your own admin access" });
      }
      await pool.query("UPDATE users SET is_admin = $1 WHERE id = $2", [
        req.body.isAdmin,
        targetId,
      ]);
    }

    if (req.body?.password !== undefined) {
      const password = String(req.body.password);
      if (!password) return res.status(400).json({ error: "Password can't be empty" });
      await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
        bcrypt.hashSync(password, 10),
        targetId,
      ]);
    }

    const { rows } = await pool.query(
      'SELECT id, username, is_admin AS "isAdmin" FROM users WHERE id = $1',
      [targetId]
    );
    if (!rows[0]) return res.status(404).json({ error: "User not found" });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

app.delete("/api/users/:id", requireAdmin, async (req, res, next) => {
  try {
    const targetId = Number(req.params.id);
    if (targetId === req.session.userId) {
      return res.status(400).json({ error: "You can't remove yourself" });
    }
    const { rowCount } = await pool.query("DELETE FROM users WHERE id = $1", [targetId]);
    if (rowCount === 0) return res.status(404).json({ error: "User not found" });
    res.json({ ok: true });
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
