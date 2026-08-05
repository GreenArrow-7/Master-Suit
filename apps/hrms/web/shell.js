/* Manath Homes HRMS — shared shell and API layer.
   Every signed-in page includes this and calls Shell.mount("<page-key>"). */

const $ = id => document.getElementById(id);
const el = sel => document.querySelector(sel);
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

function say(text, kind = "", target = "msg") {
  const node = $(target);
  if (!node) return;
  node.textContent = text;
  node.className = "msg " + kind;
}

function deviceId() {
  let id = localStorage.getItem("device_id");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("device_id", id); }
  return id;
}

const initials = name => (name || "?").split(/\s+/).slice(0, 2)
  .map(w => w[0] || "").join("").toUpperCase();

/* --------------------------------------------------------------------------
   Responses
   A 500 returns plain text, not JSON. Parsing blindly produced
   "Unexpected token 'I'..." which hid the real fault, so always read text first.
   -------------------------------------------------------------------------- */
async function handleResponse(r) {
  const raw = await r.text();
  let d = null;
  try { d = raw ? JSON.parse(raw) : null; } catch { d = null; }

  if (r.ok) return d ?? {};

  if (d === null) {
    if (r.status >= 500) {
      throw new Error(`Server error (${r.status}). The full reason is printed in ` +
                      "the terminal running the server.");
    }
    throw new Error(raw.slice(0, 200) || `Request failed (${r.status}).`);
  }

  const det = d.detail;
  if (Array.isArray(det)) throw new Error(det[0]?.msg || "Check the form and try again.");
  if (det && typeof det === "object") {
    throw new Error(`${det.message} ${(det.outstanding || []).join(" · ")}`);
  }
  throw new Error(det || d.message || `Request failed (${r.status}).`);
}

async function refreshToken() {
  const rt = localStorage.getItem("refresh");
  if (!rt) return false;
  const r = await fetch("/api/auth/refresh", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: rt })
  });
  if (!r.ok) return false;
  const d = await r.json();
  localStorage.setItem("token", d.access_token);
  localStorage.setItem("refresh", d.refresh_token);
  return true;
}

async function api(path, opts = {}, retried = false) {
  const r = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...auth(), ...(opts.headers || {}) }
  });

  if (r.status === 401 && !retried) {
    if (await refreshToken()) return api(path, opts, true);
    localStorage.clear();
    location.href = "login.html";
    throw new Error("Signed out.");
  }
  if (r.status === 403) {
    const d = await r.json().catch(() => ({}));
    const detail = String(d.detail || "");
    if (detail.includes("new password")) { location.href = "password.html"; throw new Error(detail); }
    throw new Error(detail || "You don't have access to this.");
  }
  return handleResponse(r);
}

/* --------------------------------------------------------------------------
   Offline punch queue
   -------------------------------------------------------------------------- */
const QKEY = "punch_queue";
const readQueue = () => JSON.parse(localStorage.getItem(QKEY) || "[]");
const writeQueue = q => localStorage.setItem(QKEY, JSON.stringify(q));
function queue(item) {
  const q = readQueue();
  q.push({ ...item, body: { ...item.body, synced_offline: true } });
  writeQueue(q);
}
async function flushQueue() {
  const q = readQueue();
  if (!q.length) return 0;
  const left = []; let sent = 0;
  for (const item of q) {
    try { await api(item.path, { method: "POST", body: JSON.stringify(item.body) }); sent++; }
    catch (e) {
      if (String(e.message).includes("too old")) continue;
      left.push(item);
    }
  }
  writeQueue(left);
  return sent;
}

/* --------------------------------------------------------------------------
   Icons
   -------------------------------------------------------------------------- */
const I = {
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="3.2"/><path d="M22 20v-2a4 4 0 0 0-3-3.8"/><path d="M16 4.2a4 4 0 0 1 0 5.6"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3l7 3v6c0 4.4-3 7.9-7 9-4-1.1-7-4.6-7-9V6z"/><path d="M9.5 12l1.8 1.8L15 10"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/></svg>',
  badge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.3"/><path d="M5.5 17c.7-1.6 2-2.4 3.5-2.4s2.8.8 3.5 2.4M15 9h4M15 13h4"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M15 17l5-5-5-5M20 12H9M11 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/></svg>',
};

/* --------------------------------------------------------------------------
   Shell
   -------------------------------------------------------------------------- */
const NAV = [
  { label: "Daily", items: [
    { key: "checkin", href: "checkin.html", text: "Check in", icon: "clock" },
    { key: "attendance", href: "attendance.html", text: "Attendance", icon: "clock" },
    { key: "leave", href: "leave.html", text: "Leave", icon: "calendar" },
  ]},
  { label: "People", roles: ["manager", "hr", "admin"], items: [
    { key: "people", href: "people.html", text: "Joining & leaving", icon: "badge",
      roles: ["manager", "hr", "admin"] },
    { key: "users", href: "users.html", text: "Users", icon: "users", roles: ["hr", "admin"] },
  ]},
  { label: "Administration", roles: ["manager", "hr", "admin"], items: [
    { key: "locations", href: "locations.html", text: "Attendance locations", icon: "clock",
      roles: ["manager", "hr", "admin"] },
    { key: "roles", href: "roles.html", text: "Roles & permissions", icon: "shield",
      roles: ["hr", "admin"] },
  ]},
  { label: "Account", items: [
    { key: "security", href: "security.html", text: "Security", icon: "shield" },
  ]},
];

const TITLES = {
  checkin: "Check in", attendance: "Attendance", leave: "Leave",
  people: "Joining & leaving",
  users: "Users", security: "Security",
  locations: "Attendance locations", roles: "Roles & permissions",
};

const Shell = {
  me: null,

  async mount(pageKey) {
    try {
      this.me = await api("/api/auth/me");
    } catch (e) {
      if (!String(e.message).includes("Signed out")) location.href = "login.html";
      return null;
    }
    this.render(pageKey);
    wrapTablesForMobile();
    return this.me;
  },

  render(pageKey) {
    const role = this.me.role;
    const groups = NAV.map(g => {
      if (g.roles && !g.roles.includes(role)) return "";
      const items = g.items
        .filter(i => !i.roles || i.roles.includes(role))
        .map(i => `<a href="${i.href}" class="${i.key === pageKey ? "on" : ""}">
            ${I[i.icon]}<span>${i.text}</span></a>`).join("");
      if (!items) return "";
      return `<div class="nav-group"><div class="nav-label">${g.label}</div>${items}</div>`;
    }).join("");

    const sidebar = `
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-brand">
          <div class="mark">M</div>
          <div>
            <div class="name">Manath Homes</div>
            <div class="sub">HRMS</div>
          </div>
        </div>
        <nav class="nav">${groups}</nav>
        <div class="sidebar-foot">
          <div class="avatar">${initials(this.me.full_name)}</div>
          <div class="who">
            <b>${this.me.full_name}</b>
            <span>${role}</span>
          </div>
          <button class="btn-signout" id="signout" type="button">${I.logout}<span>Sign out</span></button>
        </div>
      </aside>`;

    const topbar = `
      <header class="topbar">
        <button class="icon-btn menu-btn" id="menuBtn" style="color:var(--muted)">${I.menu}</button>
        <div class="crumb">Manath Homes · <b>${TITLES[pageKey] || ""}</b></div>
        <div class="spacer"></div>
        <div id="topbarSlot"></div>
      </header>`;

    document.body.insertAdjacentHTML("afterbegin",
      `<div class="app">${sidebar}<div class="main">${topbar}
        <div class="content" id="shellContent"></div></div></div>`);

    // Move the page's own markup into the shell.
    const page = $("page");
    if (page) $("shellContent").appendChild(page);

    $("signout").onclick = async () => {
      try { await api("/api/auth/logout", { method: "POST" }); } catch {}
      localStorage.clear();
      location.href = "login.html";
    };
    const mb = $("menuBtn");
    const sb = $("sidebar");
    if (mb) mb.onclick = e => { e.stopPropagation(); sb.classList.toggle("open"); };
    // Tap the dimmed area or any nav link to close the drawer on a phone.
    if (sb) {
      document.addEventListener("click", e => {
        if (!sb.classList.contains("open")) return;
        if (sb.contains(e.target) && !e.target.closest("a")) return;
        if (e.target === mb || mb?.contains(e.target)) return;
        sb.classList.remove("open");
      });
    }
  },

  /* Slide-over panel ------------------------------------------------------ */
  panel(id) {
    const p = $(id), scrim = $("scrim");
    return {
      open() { scrim.classList.add("on"); p.classList.add("on");
               const f = p.querySelector("input,select,textarea"); if (f) setTimeout(() => f.focus(), 180); },
      close() { scrim.classList.remove("on"); p.classList.remove("on"); },
    };
  },
};

/* Escape closes any open panel. */
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  document.querySelectorAll(".panel.on").forEach(p => p.classList.remove("on"));
  const s = $("scrim"); if (s) s.classList.remove("on");
});

function generatePassword() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ", a = "abcdefghijkmnopqrstuvwxyz",
        n = "23456789", s = "!@#$%&*";
  const pick = set => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  let out = "";
  for (let i = 0; i < 5; i++) out += pick(A) + pick(a) + pick(n);
  return out.slice(0, 14) + pick(s) + pick(n);
}


/* ---- mobile: keep tables from blowing out the page width ----------------
   Pages inject tables after mount and re-render them on every data refresh, so
   a one-shot wrap misses most of them. A MutationObserver wraps any <table>
   that appears (unless it is already wrapped or is decorative) in a
   horizontally scrollable container. Idempotent and cheap. */
function wrapTablesForMobile(root) {
  const scope = root || document.getElementById("page") || document.body;
  scope.querySelectorAll("table").forEach(t => {
    if (t.closest(".table-scroll") || t.dataset.noWrap) return;
    const box = document.createElement("div");
    box.className = "table-scroll";
    t.parentNode.insertBefore(box, t);
    box.appendChild(t);
  });
}

(function observeTables() {
  const start = () => {
    const target = document.getElementById("page") || document.body;
    wrapTablesForMobile(target);
    new MutationObserver(muts => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.tagName === "TABLE" || n.querySelector?.("table"))
            wrapTablesForMobile(n.parentNode || target);
        }
      }
    }).observe(target, { childList: true, subtree: true });
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else start();
})();