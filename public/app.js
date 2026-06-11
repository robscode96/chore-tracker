/* Chore Tracker frontend — talks to the Express API backed by Postgres.
 * Chores are shared by the whole household: anyone can toggle any chore,
 * and a completed chore shows who did it. Resets happen server-side via
 * period keys (daily/day-specific at midnight, weekly on Monday, monthly
 * on the 1st).
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const AVATAR_COLORS = ["#ff6b5e", "#0fa3a3", "#f5a524", "#8b5cf6", "#3b7dd8", "#d63f87"];

const EMOJI_RULES = [
  [/trash|garbage|recycl|bin/i, "🗑️"],
  [/dish|plate|kitchen sink/i, "🍽️"],
  [/vacuum|sweep|mop|floor/i, "🧹"],
  [/bed/i, "🛏️"],
  [/laundry|cloth|fold|iron/i, "🧺"],
  [/plant|water|garden|lawn|mow|weed/i, "🪴"],
  [/dog|walk|pet|cat|litter|feed/i, "🐾"],
  [/fridge|freezer/i, "🧊"],
  [/bathroom|toilet|shower|tub/i, "🚽"],
  [/window|glass/i, "🪟"],
  [/grocery|shop|store/i, "🛒"],
  [/cook|dinner|meal|bake/i, "🍳"],
  [/car|wash car|oil/i, "🚗"],
  [/mail|package|bill/i, "📬"],
  [/dust|wipe|clean/i, "🧽"],
];

function emojiFor(name) {
  for (const [re, emoji] of EMOJI_RULES) if (re.test(name)) return emoji;
  return "✨";
}

let me = null;
let chores = [];
let serverToday = new Date().getDay();
let lastPct = null;
let pickedDays = new Set();

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

  const avatar = document.getElementById("me-avatar");
  avatar.textContent = me.username.slice(0, 2).toUpperCase();
  avatar.style.background = colorFor(me.username);

  const hour = new Date().getHours();
  const part = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
  document.getElementById("greeting").textContent = `${part}, ${me.username}!`;
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
  serverToday = data.today;
  renderChores();
}

function dueToday(chore) {
  return (
    chore.freq === "daily" ||
    (chore.freq === "days" && (chore.days || []).includes(serverToday))
  );
}

function sectionsFor(list) {
  return [
    {
      title: "Today",
      emoji: "☀️",
      tone: "coral",
      note: "resets at midnight",
      chores: list.filter(dueToday),
    },
    {
      title: "This Week",
      emoji: "📅",
      tone: "teal",
      note: "resets Monday",
      chores: list.filter((c) => c.freq === "weekly"),
    },
    {
      title: "This Month",
      emoji: "🗓️",
      tone: "amber",
      note: "resets on the 1st",
      chores: list.filter((c) => c.freq === "monthly"),
    },
    {
      title: "Coming Up",
      emoji: "⏳",
      tone: "lilac",
      note: "not due today",
      muted: true,
      chores: list.filter((c) => c.freq === "days" && !dueToday(c)),
    },
  ];
}

function renderChores() {
  renderProgress();

  const main = document.getElementById("chore-sections");
  main.innerHTML = "";

  if (chores.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<div class="big">🧹</div>
      <strong>Nothing on the board!</strong>
      <p>Add the first chore above.</p>`;
    main.appendChild(empty);
    return;
  }

  for (const sec of sectionsFor(chores)) {
    if (sec.chores.length === 0) continue;

    const section = document.createElement("section");
    section.className = `section tone-${sec.tone}` + (sec.muted ? " muted" : "");

    const done = sec.chores.filter((c) => c.done).length;
    const header = document.createElement("div");
    header.className = "section-header";
    header.innerHTML = `
      <span class="section-title">${sec.emoji} ${sec.title}</span>
      <span class="section-meta">${
        sec.muted ? sec.note : `${done}/${sec.chores.length} · ${sec.note}`
      }</span>`;
    section.appendChild(header);

    const list = document.createElement("ul");
    list.className = "chore-list";
    for (const chore of sec.chores) list.appendChild(renderChore(chore, sec.muted));
    section.appendChild(list);
    main.appendChild(section);
  }
}

function countableChores() {
  return chores.filter((c) => c.freq !== "days" || dueToday(c));
}

function renderProgress() {
  const countable = countableChores();
  const done = countable.filter((c) => c.done).length;
  const pct = countable.length ? Math.round((done / countable.length) * 100) : 0;

  const ring = document.getElementById("ring-fill");
  const circumference = 2 * Math.PI * 18;
  ring.style.strokeDasharray = circumference;
  ring.style.strokeDashoffset = circumference * (1 - pct / 100);
  document.getElementById("progress-text").textContent = `${pct}%`;

  if (pct === 100 && lastPct !== null && lastPct < 100) celebrate();
  lastPct = pct;
}

function renderChore(chore, muted) {
  const li = document.createElement("li");
  li.className = "chore-item" + (chore.done ? " done" : "");

  if (muted) {
    const dot = document.createElement("span");
    dot.className = "sleep-dot";
    dot.textContent = "💤";
    li.appendChild(dot);
  } else {
    const toggle = document.createElement("label");
    toggle.className = "toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = chore.done;
    checkbox.addEventListener("change", () => toggleChore(chore));
    const checkmark = document.createElement("span");
    checkmark.className = "checkmark";
    toggle.append(checkbox, checkmark);
    li.appendChild(toggle);
  }

  const label = document.createElement("span");
  label.className = "chore-label";
  label.textContent = `${emojiFor(chore.name)} ${chore.name}`;
  if (!muted) label.addEventListener("click", () => toggleChore(chore));
  li.appendChild(label);

  if (chore.freq === "days" && chore.days?.length) {
    const days = document.createElement("span");
    days.className = "day-tags";
    days.textContent = chore.days.map((d) => DAY_SHORT[d]).join(" · ");
    li.appendChild(days);
  }

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
  del.type = "button";
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

/* ---------- Confetti ---------- */

function celebrate() {
  const layer = document.getElementById("confetti-layer");
  const bits = ["🎉", "✨", "⭐", "🧹", "💪", "🏆"];
  for (let i = 0; i < 26; i++) {
    const bit = document.createElement("span");
    bit.className = "confetti";
    bit.textContent = bits[Math.floor(Math.random() * bits.length)];
    bit.style.left = Math.random() * 100 + "vw";
    bit.style.animationDelay = Math.random() * 0.6 + "s";
    bit.style.fontSize = 16 + Math.random() * 18 + "px";
    layer.appendChild(bit);
    setTimeout(() => bit.remove(), 3200);
  }
}

/* ---------- Day picker ---------- */

function buildDayPicker() {
  const wrap = document.getElementById("day-chips");
  wrap.innerHTML = "";
  DAY_SHORT.forEach((label, idx) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "day-chip";
    chip.textContent = label;
    chip.addEventListener("click", () => {
      if (pickedDays.has(idx)) pickedDays.delete(idx);
      else pickedDays.add(idx);
      chip.classList.toggle("picked", pickedDays.has(idx));
    });
    wrap.appendChild(chip);
  });
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

document.getElementById("chore-freq").addEventListener("change", (e) => {
  document.getElementById("day-picker").hidden = e.target.value !== "days";
});

document.getElementById("add-chore-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("chore-name");
  const name = input.value.trim();
  if (!name) return;
  const freq = document.getElementById("chore-freq").value;
  if (freq === "days" && pickedDays.size === 0) {
    alert("Pick at least one day for this chore.");
    return;
  }
  await api("/api/chores", {
    method: "POST",
    body: JSON.stringify({ name, freq, days: [...pickedDays] }),
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

buildDayPicker();

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
