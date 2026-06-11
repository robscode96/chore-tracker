/* Chore Tracker frontend — talks to the Express API backed by Postgres.
 * Chores are shared by the whole household: anyone can toggle any chore,
 * and a completed chore shows who did it. Daily/weekly/monthly resets
 * happen server-side via period keys.
 */

const FREQUENCIES = [
  { id: "daily", label: "Daily", emoji: "☀️", resetNote: "resets every day" },
  { id: "weekly", label: "Weekly", emoji: "📅", resetNote: "resets every Monday" },
  { id: "monthly", label: "Monthly", emoji: "🗓️", resetNote: "resets on the 1st" },
];

const AVATAR_COLORS = [
  "#5b6cf9", "#00a8a8", "#e58b1a", "#e25563",
  "#8e44ad", "#2eb872", "#d63f87", "#3b7dd8",
];

let me = null;
let chores = [];

/* ---------- API helpers ---------- */

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...options,
  });
  if (res.status === 401) {
    showLogin();
    throw new Error("Not logged in");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ---------- Views ---------- */

function showLogin() {
  document.getElementById("login-view").hidden = false;
  document.getElementById("app-view").hidden = true;
  document.getElementById("login-username").focus();
}

async function showApp() {
  document.getElementById("login-view").hidden = true;
  document.getElementById("app-view").hidden = false;

  document.getElementById("me-name").textContent = me.username;
  const avatar = document.getElementById("me-avatar");
  avatar.textContent = me.username.slice(0, 2).toUpperCase();
  avatar.style.background = colorFor(me.username);

  document.getElementById("today-label").textContent =
    new Date().toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

  await refreshChores();
}

function colorFor(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/* ---------- Chores ---------- */

async function refreshChores() {
  const data = await api("/api/chores");
  chores = data.chores;
  renderChores();
}

function renderChores() {
  renderProgress();

  const main = document.getElementById("chore-sections");
  main.innerHTML = "";

  if (chores.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<div class="big">🧹</div>
      <strong>No chores yet</strong>
      <p>Add one above to get started.</p>`;
    main.appendChild(empty);
    return;
  }

  for (const freq of FREQUENCIES) {
    const group = chores.filter((c) => c.freq === freq.id);
    if (group.length === 0) continue;

    const section = document.createElement("section");
    section.className = `section ${freq.id}`;

    const done = group.filter((c) => c.done).length;
    const header = document.createElement("div");
    header.className = "section-header";
    header.innerHTML = `
      <span class="section-title">
        <span class="section-dot"></span>${freq.emoji} ${freq.label}
      </span>
      <span class="section-meta">${done}/${group.length} done · ${freq.resetNote}</span>`;
    section.appendChild(header);

    const list = document.createElement("ul");
    list.className = "chore-list";
    for (const chore of group) list.appendChild(renderChore(chore));
    section.appendChild(list);
    main.appendChild(section);
  }
}

function renderProgress() {
  const done = chores.filter((c) => c.done).length;
  const pct = chores.length ? Math.round((done / chores.length) * 100) : 0;
  const ring = document.getElementById("ring-fill");
  const circumference = 2 * Math.PI * 19;
  ring.style.strokeDasharray = circumference;
  ring.style.strokeDashoffset = circumference * (1 - pct / 100);
  document.getElementById("progress-text").textContent = `${pct}%`;
}

function renderChore(chore) {
  const li = document.createElement("li");
  li.className = "chore-item" + (chore.done ? " done" : "");

  const toggle = document.createElement("label");
  toggle.className = "toggle";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = chore.done;
  checkbox.addEventListener("change", () => toggleChore(chore));
  const checkmark = document.createElement("span");
  checkmark.className = "checkmark";
  toggle.append(checkbox, checkmark);

  const label = document.createElement("span");
  label.className = "chore-label";
  label.textContent = chore.name;
  label.addEventListener("click", () => toggleChore(chore));

  li.append(toggle, label);

  if (chore.done && chore.completedBy) {
    const badge = document.createElement("span");
    badge.className = "done-by";
    badge.style.background = colorFor(chore.completedBy);
    badge.textContent = chore.completedBy;
    badge.title = `Done by ${chore.completedBy}`;
    li.appendChild(badge);
  }

  const del = document.createElement("button");
  del.className = "delete-btn";
  del.title = "Remove chore";
  del.textContent = "✕";
  del.addEventListener("click", async () => {
    if (!confirm(`Remove "${chore.name}" for everyone?`)) return;
    await api(`/api/chores/${chore.id}`, { method: "DELETE" });
    await refreshChores();
  });
  li.appendChild(del);

  return li;
}

async function toggleChore(chore) {
  // Optimistic update so the checkbox feels instant.
  chore.done = !chore.done;
  chore.completedBy = chore.done ? me.username : null;
  renderChores();
  try {
    await api(`/api/chores/${chore.id}/toggle`, { method: "POST" });
  } finally {
    await refreshChores().catch(() => {});
  }
}

/* ---------- Wiring ---------- */

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("login-error");
  errorEl.hidden = true;
  try {
    me = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: document.getElementById("login-username").value,
        password: document.getElementById("login-password").value,
      }),
    });
    document.getElementById("login-password").value = "";
    await showApp();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  me = null;
  showLogin();
});

document.getElementById("add-chore-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("chore-name");
  const name = input.value.trim();
  if (!name) return;
  await api("/api/chores", {
    method: "POST",
    body: JSON.stringify({ name, freq: document.getElementById("chore-freq").value }),
  });
  input.value = "";
  input.focus();
  await refreshChores();
});

// Keep the board fresh: other household members may toggle chores, and
// periods roll over at midnight. Refresh on focus and every 60s.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && me) refreshChores().catch(() => {});
});
setInterval(() => {
  if (me && !document.hidden) refreshChores().catch(() => {});
}, 60 * 1000);

// On load, restore the session if the cookie is still valid.
(async () => {
  try {
    const data = await api("/api/me");
    if (data.user) {
      me = data.user;
      await showApp();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
})();
