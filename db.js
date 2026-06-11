const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway's internal network doesn't need SSL; set PGSSL=true if you
  // connect through the public proxy instead.
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
});

const SEED_USERS = [
  { username: "Robert", password: "1" },
  { username: "Karen", password: "2" },
  { username: "Samantha", password: "3" },
];

const SEED_CHORES = [
  { name: "Make the beds", freq: "daily" },
  { name: "Do the dishes", freq: "daily" },
  { name: "Take out the trash", freq: "weekly" },
  { name: "Vacuum the house", freq: "weekly" },
  { name: "Clean the fridge", freq: "monthly" },
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
      freq TEXT NOT NULL CHECK (freq IN ('daily', 'weekly', 'monthly')),
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

  const { rows: existingUsers } = await pool.query("SELECT COUNT(*)::int AS n FROM users");
  if (existingUsers[0].n === 0) {
    for (const u of SEED_USERS) {
      await pool.query(
        "INSERT INTO users (username, password_hash) VALUES ($1, $2)",
        [u.username, bcrypt.hashSync(u.password, 10)]
      );
    }
    console.log("Seeded users:", SEED_USERS.map((u) => u.username).join(", "));
  }

  const { rows: existingChores } = await pool.query("SELECT COUNT(*)::int AS n FROM chores");
  if (existingChores[0].n === 0) {
    for (const c of SEED_CHORES) {
      await pool.query("INSERT INTO chores (name, freq) VALUES ($1, $2)", [c.name, c.freq]);
    }
    console.log("Seeded sample chores");
  }
}

module.exports = { pool, init };
