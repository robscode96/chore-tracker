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
let pickedTime = "any";

const TIME_ORDER = { morning: 0, any: 1, evening: 2 };
const TIME_TAGS = { morning: "☀️ morning", evening: "🌙 evening" };

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
  document.getElementById("admin-view").hidden = true;
  document.getElementById("stats-view").hidden = true;
  document.getElementById("login-username").focus();
}

async function showApp() {
  document.getElementById("login-view").hidden = true;
  document.getElementById("app-view").hidden = false;

  const avatar = document.getElementById("me-avatar");
  avatar.textContent = me.username.slice(0, 2).toUpperCase();
  avatar.style.background = colorFor(me.username);

  // Only the admin can change what's on the board or manage the household.
  document.getElementById("add-chore-form").hidden = !me.isAdmin;
  document.getElementById("admin-btn").hidden = !me.isAdmin;
  document.getElementById("admin-view").hidden = true;
  document.getElementById("stats-view").hidden = true;

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
      chores: list
        .filter(dueToday)
        .slice()
        .sort(
          (a, b) =>
            (TIME_ORDER[a.timeOfDay] ?? 1) - (TIME_ORDER[b.timeOfDay] ?? 1)
        ),
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
      <p>${me?.isAdmin ? "Add the first chore above." : "Enjoy the day off!"}</p>`;
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
  ring.style.stroke = pct === 100 ? "#f5a524" : ""; // gold when everything's done
  document.getElementById("progress-text").textContent = pct === 100 ? "🏆" : `${pct}%`;

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

  // Emoji and text are separate spans so wrapped lines align with the text
  // (hanging indent) instead of sliding under the emoji.
  const label = document.createElement("span");
  label.className = "chore-label";
  const emoji = document.createElement("span");
  emoji.className = "chore-emoji";
  emoji.textContent = emojiFor(chore.name);
  const text = document.createElement("span");
  text.className = "chore-text";
  text.textContent = chore.name;
  label.append(emoji, text);
  if (!muted) label.addEventListener("click", () => toggleChore(chore));
  li.appendChild(label);

  if (TIME_TAGS[chore.timeOfDay]) {
    const time = document.createElement("span");
    time.className = "day-tags time-" + chore.timeOfDay;
    time.textContent = TIME_TAGS[chore.timeOfDay];
    li.appendChild(time);
  }

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
    // Weekly/monthly chores show which day they got done.
    badge.textContent =
      ["weekly", "monthly"].includes(chore.freq) && chore.completedAt
        ? `${chore.completedBy} · ${new Date(chore.completedAt).toLocaleDateString(undefined, { weekday: "short" })}`
        : chore.completedBy;
    if (me?.isAdmin) {
      badge.classList.add("clickable");
      badge.title = "Change who did it";
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        openCreditMenu(badge, chore);
      });
    } else {
      badge.title = `Done by ${chore.completedBy}`;
    }
    li.appendChild(badge);
  }

  if (me?.isAdmin) {
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
  }

  return li;
}

async function toggleChore(chore) {
  // Optimistic update so the checkbox feels instant.
  chore.done = !chore.done;
  chore.completedBy = chore.done ? me.username : null;
  chore.completedAt = chore.done ? new Date().toISOString() : null;
  renderChores();
  try {
    navigator.vibrate?.(15);
  } catch {}
  try {
    await api(`/api/chores/${chore.id}/toggle`, { method: "POST" });
  } finally {
    await refreshChores().catch(() => {});
  }
}

/* ---------- Credit menu (admin: mark done by someone else) ---------- */

let members = [];

async function loadMembers() {
  if (members.length === 0) {
    const data = await api("/api/users");
    members = data.users;
  }
  return members;
}

function closeCreditMenu() {
  document.querySelector(".credit-menu")?.remove();
}

async function openCreditMenu(anchor, chore) {
  closeCreditMenu();
  const crew = await loadMembers();

  const menu = document.createElement("div");
  menu.className = "credit-menu";
  const title = document.createElement("div");
  title.className = "credit-menu-title";
  title.textContent = "Who did it?";
  menu.appendChild(title);

  for (const user of crew) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "credit-option";
    if (user.username === chore.completedBy) btn.classList.add("current");
    const dot = document.createElement("span");
    dot.className = "user-avatar credit-avatar";
    dot.style.background = colorFor(user.username);
    dot.textContent = user.username.slice(0, 2).toUpperCase();
    btn.append(dot, document.createTextNode(user.username));
    btn.addEventListener("click", async () => {
      closeCreditMenu();
      await api(`/api/chores/${chore.id}/completion`, {
        method: "PATCH",
        body: JSON.stringify({ userId: user.id }),
      });
      await refreshChores();
    });
    menu.appendChild(btn);
  }

  const rect = anchor.getBoundingClientRect();
  menu.style.top = rect.bottom + window.scrollY + 6 + "px";
  menu.style.left = Math.max(8, Math.min(rect.left + window.scrollX, window.innerWidth - 188)) + "px";
  document.body.appendChild(menu);
  setTimeout(() => {
    document.addEventListener("click", closeCreditMenu, { once: true });
  }, 0);
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

/* ---------- Admin: household management ---------- */

async function showAdmin() {
  document.getElementById("app-view").hidden = true;
  document.getElementById("admin-view").hidden = false;
  await refreshUsers();
}

function hideAdmin() {
  document.getElementById("admin-view").hidden = true;
  document.getElementById("app-view").hidden = false;
  refreshChores().catch(() => {});
}

async function refreshUsers() {
  const data = await api("/api/users");
  members = data.users; // keep the credit-menu list in sync
  renderUsers(data.users);
}

function renderUsers(users) {
  const list = document.getElementById("user-list");
  list.innerHTML = "";

  for (const user of users) {
    const li = document.createElement("li");
    li.className = "chore-item";
    const isMe = user.id === me.id;

    const avatar = document.createElement("span");
    avatar.className = "user-avatar";
    avatar.style.background = colorFor(user.username);
    avatar.textContent = user.username.slice(0, 2).toUpperCase();

    const label = document.createElement("span");
    label.className = "chore-label member-label";
    label.textContent = user.username + (isMe ? " (you)" : "");

    li.append(avatar, label);

    if (user.isAdmin) {
      const star = document.createElement("span");
      star.className = "admin-pill";
      star.textContent = "⭐ admin";
      li.appendChild(star);
    }

    const actions = document.createElement("span");
    actions.className = "member-actions";

    if (!isMe) {
      const adminBtn = document.createElement("button");
      adminBtn.className = "mini-btn";
      adminBtn.type = "button";
      adminBtn.textContent = user.isAdmin ? "Remove admin" : "Make admin";
      adminBtn.addEventListener("click", async () => {
        await api(`/api/users/${user.id}`, {
          method: "PATCH",
          body: JSON.stringify({ isAdmin: !user.isAdmin }),
        });
        await refreshUsers();
      });
      actions.appendChild(adminBtn);
    }

    const pwBtn = document.createElement("button");
    pwBtn.className = "mini-btn";
    pwBtn.type = "button";
    pwBtn.textContent = "New password";
    pwBtn.addEventListener("click", async () => {
      const password = prompt(`New password for ${user.username}:`);
      if (!password) return;
      await api(`/api/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ password }),
      });
      alert(`Password updated for ${user.username}.`);
    });
    actions.appendChild(pwBtn);

    if (!isMe) {
      const delBtn = document.createElement("button");
      delBtn.className = "mini-btn danger";
      delBtn.type = "button";
      delBtn.textContent = "Remove";
      delBtn.addEventListener("click", async () => {
        if (!confirm(`Remove ${user.username} from the household?`)) return;
        await api(`/api/users/${user.id}`, { method: "DELETE" });
        await refreshUsers();
      });
      actions.appendChild(delBtn);
    }

    li.appendChild(actions);
    list.appendChild(li);
  }
}

/* ---------- Stats ---------- */

async function showStats() {
  document.getElementById("admin-view").hidden = true;
  document.getElementById("stats-view").hidden = false;
  const main = document.getElementById("stats-sections");
  main.innerHTML = '<div class="empty-state"><div class="big">📊</div><p>Crunching the numbers…</p></div>';
  const stats = await api("/api/stats");
  renderStats(stats);
}

function hideStats() {
  document.getElementById("stats-view").hidden = true;
  document.getElementById("admin-view").hidden = false;
}

function statCard(tone, title, meta) {
  const section = document.createElement("section");
  section.className = `section tone-${tone}`;
  const header = document.createElement("div");
  header.className = "section-header";
  header.innerHTML = `<span class="section-title">${title}</span>${
    meta ? `<span class="section-meta">${meta}</span>` : ""
  }`;
  section.appendChild(header);
  const body = document.createElement("div");
  body.className = "stat-body";
  section.appendChild(body);
  return { section, body };
}

function renderStats(stats) {
  const main = document.getElementById("stats-sections");
  main.innerHTML = "";

  // Streak banner
  const streak = document.createElement("div");
  streak.className = "streak-banner";
  if (stats.streak > 0) {
    streak.innerHTML = `<span class="streak-flame">🔥</span>
      <span class="streak-num">${stats.streak}</span>
      <span class="streak-text">day streak of finishing<br>every daily chore!</span>`;
  } else {
    streak.innerHTML = `<span class="streak-flame">🌱</span>
      <span class="streak-text">No streak yet — finish today's<br>list to light the fire!</span>`;
  }
  main.appendChild(streak);

  // Leaderboard
  const medals = ["🥇", "🥈", "🥉"];
  const lb = statCard("teal", "🏆 Leaderboard", "all-time check-offs");
  const maxTotal = Math.max(1, ...stats.leaderboard.map((u) => u.total));
  stats.leaderboard.forEach((user, i) => {
    const row = document.createElement("div");
    row.className = "stat-row";
    row.innerHTML = `
      <span class="stat-rank">${medals[i] || "&nbsp;"}</span>
      <span class="stat-name">${escapeHtml(user.username)}</span>
      <span class="stat-bar-track">
        <span class="stat-bar" style="width:${Math.round((user.total / maxTotal) * 100)}%;background:${colorFor(user.username)}"></span>
      </span>
      <span class="stat-count">${user.total}</span>
      <span class="stat-chip">+${user.thisWeek} this wk</span>`;
    lb.body.appendChild(row);
  });
  main.appendChild(lb.section);

  // On-time rates
  const rate = statCard(
    "coral",
    "🎯 On-time rate",
    stats.overall.pct === null ? "last 30 days" : `${stats.overall.pct}% overall · last 30 days`
  );
  if (stats.choreRates.length === 0) {
    rate.body.innerHTML =
      '<p class="stat-note">Too early to tell — check back once chores have been around a few days!</p>';
  } else {
    for (const c of stats.choreRates) {
      const row = document.createElement("div");
      row.className = "stat-row";
      row.innerHTML = `
        <span class="stat-name stat-name-wide">${escapeHtml(c.name)}</span>
        <span class="stat-bar-track">
          <span class="stat-bar ${c.pct >= 80 ? "good" : c.pct >= 50 ? "ok" : "bad"}" style="width:${c.pct}%"></span>
        </span>
        <span class="stat-count">${c.pct}%</span>
        <span class="stat-chip">${c.done}/${c.expected}</span>`;
      rate.body.appendChild(row);
    }
  }
  main.appendChild(rate.section);

  // Most-done chores
  const top = statCard("amber", "💪 Most done", "hall of fame");
  if (stats.topChores.length === 0) {
    top.body.innerHTML = '<p class="stat-note">Nothing checked off yet!</p>';
  } else {
    stats.topChores.forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "stat-row";
      row.innerHTML = `
        <span class="stat-rank">${i + 1}.</span>
        <span class="stat-name stat-name-wide">${escapeHtml(c.name)}</span>
        <span class="stat-chip">${c.count}×</span>`;
      top.body.appendChild(row);
    });
  }
  main.appendChild(top.section);

  // Fun footer facts
  const facts = document.createElement("p");
  facts.className = "stat-footer";
  const bits = [`${stats.totals.completions} chores checked off all-time`];
  if (stats.busiestDay) {
    bits.push(`busiest day: ${DAY_NAMES[stats.busiestDay.dow]}`);
  }
  facts.textContent = bits.join(" · ");
  main.appendChild(facts);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
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
  // Morning/evening only makes sense for chores that recur within days.
  document.getElementById("time-picker").hidden = !["daily", "days"].includes(e.target.value);
});

document.querySelectorAll(".time-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    pickedTime = chip.dataset.time;
    document.querySelectorAll(".time-chip").forEach((c) => {
      c.classList.toggle("picked", c === chip);
    });
  });
});

document.getElementById("admin-btn").addEventListener("click", () => {
  showAdmin().catch(() => {});
});

document.getElementById("admin-back-btn").addEventListener("click", hideAdmin);

document.getElementById("stats-btn").addEventListener("click", () => {
  showStats().catch(() => {});
});

document.getElementById("stats-back-btn").addEventListener("click", hideStats);

document.getElementById("add-user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("new-user-name");
  const pwInput = document.getElementById("new-user-password");
  const username = nameInput.value.trim();
  const password = pwInput.value;
  if (!username || !password) return;
  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    nameInput.value = "";
    pwInput.value = "";
    await refreshUsers();
  } catch (err) {
    alert(err.message);
  }
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
    body: JSON.stringify({
      name,
      freq,
      days: [...pickedDays],
      timeOfDay: ["daily", "days"].includes(freq) ? pickedTime : "any",
    }),
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
