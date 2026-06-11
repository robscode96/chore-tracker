/* Chore Tracker — multi-user chores with daily/weekly/monthly auto-reset.
 *
 * Completions are stored with the period key they were completed in
 * (e.g. "2026-06-11" for daily). A chore counts as done only if its stored
 * key matches the *current* period key, so resets happen automatically when
 * the day / week / month rolls over — no timers or cleanup required.
 */

const STORAGE_KEY = "chore-tracker-v1";

const FREQUENCIES = [
  { id: "daily", label: "Daily", emoji: "☀️", resetNote: "resets every day" },
  { id: "weekly", label: "Weekly", emoji: "📅", resetNote: "resets every Monday" },
  { id: "monthly", label: "Monthly", emoji: "🗓️", resetNote: "resets on the 1st" },
];

const AVATAR_COLORS = [
  "#5b6cf9", "#00a8a8", "#e58b1a", "#e25563",
  "#8e44ad", "#2eb872", "#d63f87", "#3b7dd8",
];

let state = loadState();

/* ---------- Period keys (local time) ---------- */

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function currentPeriodKey(freq, now = new Date()) {
  if (freq === "daily") return dateKey(now);
  if (freq === "weekly") {
    // Key is the date of this week's Monday.
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    return "wk-" + dateKey(monday);
  }
  // monthly
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function isDone(chore) {
  return state.completions[chore.id] === currentPeriodKey(chore.freq);
}

/* ---------- State ---------- */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.users)) return parsed;
    }
  } catch (e) {
    console.warn("Could not load saved data, starting fresh.", e);
  }
  return seedState();
}

function seedState() {
  const userId = uid();
  return {
    users: [{ id: userId, name: "Me", color: AVATAR_COLORS[0] }],
    activeUserId: userId,
    chores: [
      { id: uid(), userId, name: "Make the bed", freq: "daily" },
      { id: uid(), userId, name: "Do the dishes", freq: "daily" },
      { id: uid(), userId, name: "Take out the trash", freq: "weekly" },
      { id: uid(), userId, name: "Vacuum the house", freq: "weekly" },
      { id: uid(), userId, name: "Clean the fridge", freq: "monthly" },
    ],
    completions: {},
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function activeUser() {
  return state.users.find((u) => u.id === state.activeUserId) || state.users[0];
}

/* ---------- Actions ---------- */

function addUser() {
  const name = prompt("Name of the new user:");
  if (!name || !name.trim()) return;
  const user = {
    id: uid(),
    name: name.trim().slice(0, 24),
    color: AVATAR_COLORS[state.users.length % AVATAR_COLORS.length],
  };
  state.users.push(user);
  state.activeUserId = user.id;
  saveState();
  render();
}

function removeCurrentUser() {
  const user = activeUser();
  if (!user) return;
  if (state.users.length === 1) {
    alert("You can't remove the last user.");
    return;
  }
  if (!confirm(`Remove ${user.name} and all of their chores?`)) return;
  state.chores = state.chores.filter((c) => {
    if (c.userId !== user.id) return true;
    delete state.completions[c.id];
    return false;
  });
  state.users = state.users.filter((u) => u.id !== user.id);
  state.activeUserId = state.users[0].id;
  saveState();
  render();
}

function addChore(name, freq) {
  state.chores.push({ id: uid(), userId: state.activeUserId, name, freq });
  saveState();
  render();
}

function removeChore(choreId) {
  state.chores = state.chores.filter((c) => c.id !== choreId);
  delete state.completions[choreId];
  saveState();
  render();
}

function toggleChore(chore) {
  if (isDone(chore)) {
    delete state.completions[chore.id];
  } else {
    state.completions[chore.id] = currentPeriodKey(chore.freq);
  }
  saveState();
  render();
}

function switchUser(userId) {
  state.activeUserId = userId;
  saveState();
  render();
}

/* ---------- Rendering ---------- */

function render() {
  renderHeader();
  renderUserTabs();
  renderSections();
}

function renderHeader() {
  document.getElementById("today-label").textContent =
    new Date().toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

  const chores = state.chores.filter((c) => c.userId === activeUser()?.id);
  const done = chores.filter(isDone).length;
  const pct = chores.length ? Math.round((done / chores.length) * 100) : 0;

  const ring = document.getElementById("ring-fill");
  const circumference = 2 * Math.PI * 19;
  ring.style.strokeDasharray = circumference;
  ring.style.strokeDashoffset = circumference * (1 - pct / 100);
  document.getElementById("progress-text").textContent = `${pct}%`;
}

function renderUserTabs() {
  const container = document.getElementById("user-tabs");
  container.innerHTML = "";
  for (const user of state.users) {
    const tab = document.createElement("button");
    tab.className = "user-tab" + (user.id === state.activeUserId ? " active" : "");
    tab.addEventListener("click", () => switchUser(user.id));

    const avatar = document.createElement("span");
    avatar.className = "user-avatar";
    avatar.style.background = user.color;
    avatar.textContent = user.name.slice(0, 2).toUpperCase();

    tab.append(avatar, document.createTextNode(user.name));
    container.appendChild(tab);
  }
}

function renderSections() {
  const main = document.getElementById("chore-sections");
  main.innerHTML = "";
  const user = activeUser();
  const userChores = state.chores.filter((c) => c.userId === user?.id);

  if (userChores.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<div class="big">🧹</div>
      <strong>No chores yet for ${escapeHtml(user?.name ?? "this user")}</strong>
      <p>Add one above to get started.</p>`;
    main.appendChild(empty);
    return;
  }

  for (const freq of FREQUENCIES) {
    const chores = userChores.filter((c) => c.freq === freq.id);
    if (chores.length === 0) continue;

    const section = document.createElement("section");
    section.className = `section ${freq.id}`;

    const done = chores.filter(isDone).length;
    const header = document.createElement("div");
    header.className = "section-header";
    header.innerHTML = `
      <span class="section-title">
        <span class="section-dot"></span>${freq.emoji} ${freq.label}
      </span>
      <span class="section-meta">${done}/${chores.length} done · ${freq.resetNote}</span>`;
    section.appendChild(header);

    const list = document.createElement("ul");
    list.className = "chore-list";
    for (const chore of chores) list.appendChild(renderChore(chore));
    section.appendChild(list);
    main.appendChild(section);
  }
}

function renderChore(chore) {
  const li = document.createElement("li");
  li.className = "chore-item" + (isDone(chore) ? " done" : "");

  const toggle = document.createElement("label");
  toggle.className = "toggle";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = isDone(chore);
  checkbox.addEventListener("change", () => toggleChore(chore));
  const checkmark = document.createElement("span");
  checkmark.className = "checkmark";
  toggle.append(checkbox, checkmark);

  const label = document.createElement("span");
  label.className = "chore-label";
  label.textContent = chore.name;
  label.addEventListener("click", () => toggleChore(chore));

  const del = document.createElement("button");
  del.className = "delete-btn";
  del.title = "Remove chore";
  del.textContent = "✕";
  del.addEventListener("click", () => {
    if (confirm(`Remove "${chore.name}"?`)) removeChore(chore.id);
  });

  li.append(toggle, label, del);
  return li;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/* ---------- Wiring ---------- */

document.getElementById("add-chore-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("chore-name");
  const name = input.value.trim();
  if (!name) return;
  addChore(name, document.getElementById("chore-freq").value);
  input.value = "";
  input.focus();
});

document.getElementById("add-user-btn").addEventListener("click", addUser);
document.getElementById("remove-user-btn").addEventListener("click", removeCurrentUser);

// Re-render when a period rolls over while the app is open (e.g. midnight),
// or when the tab regains focus after being left open for a long time.
let lastDayKey = dateKey(new Date());
setInterval(() => {
  const nowKey = dateKey(new Date());
  if (nowKey !== lastDayKey) {
    lastDayKey = nowKey;
    render();
  }
}, 30 * 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) render();
});

render();
