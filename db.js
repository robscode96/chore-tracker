const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway's internal network doesn't need SSL; set PGSSL=true if you
  // connect through the public proxy instead.
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
});

const SEED_USERS = [
  { username: "Robert", password: "1", admin: true },
  { username: "Karen", password: "2", admin: false },
  { username: "Samantha", password: "3", admin: false },
];

const SEED_CHORES = [
  { name: "Make the beds", freq: "daily", time: "morning" },
  { name: "Do the dishes", freq: "daily", time: "evening" },
  { name: "Take out the trash", freq: "weekly", time: "any" },
  { name: "Vacuum the house", freq: "weekly", time: "any" },
  { name: "Clean the fridge", freq: "monthly", time: "any" },
];

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chores (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      freq TEXT NOT NULL,
      days INTEGER[],
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS completions (
      chore_id INTEGER NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
      period_key TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (chore_id, period_key)
    );
  `);

  // Migrations for databases created by earlier versions: day-specific
  // chores, the admin flag (Robert manages the board), and morning/evening
  // time slots for chores.
  await pool.query(`
    ALTER TABLE chores ADD COLUMN IF NOT EXISTS days INTEGER[];
    ALTER TABLE chores DROP CONSTRAINT IF EXISTS chores_freq_check;
    ALTER TABLE chores ADD CONSTRAINT chores_freq_check
      CHECK (freq IN ('daily', 'weekly', 'monthly', 'days'));
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
    UPDATE users SET is_admin = true WHERE LOWER(username) = 'robert';
    ALTER TABLE chores ADD COLUMN IF NOT EXISTS time_of_day TEXT NOT NULL DEFAULT 'any';
    ALTER TABLE chores DROP CONSTRAINT IF EXISTS chores_time_check;
    ALTER TABLE chores ADD CONSTRAINT chores_time_check
      CHECK (time_of_day IN ('any', 'morning', 'evening'));
    -- Login matches names case-insensitively, so uniqueness must too.
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username));
  `);

  const { rows: existingUsers } = await pool.query("SELECT COUNT(*)::int AS n FROM users");
  if (existingUsers[0].n === 0) {
    for (const u of SEED_USERS) {
      await pool.query(
        "INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, $3)",
        [u.username, bcrypt.hashSync(u.password, 10), u.admin]
      );
    }
    console.log("Seeded users:", SEED_USERS.map((u) => u.username).join(", "));
  }

  const { rows: existingChores } = await pool.query("SELECT COUNT(*)::int AS n FROM chores");
  if (existingChores[0].n === 0) {
    for (const c of SEED_CHORES) {
      await pool.query("INSERT INTO chores (name, freq, time_of_day) VALUES ($1, $2, $3)", [
        c.name,
        c.freq,
        c.time,
      ]);
    }
    console.log("Seeded sample chores");
  }
}

module.exports = { pool, init };
