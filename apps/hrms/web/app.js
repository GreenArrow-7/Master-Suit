// Shared front-end helpers. Same-origin, so no CORS and no hard-coded host.
const API = "";
const $ = id => document.getElementById(id);
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

function say(text, kind = "") {
  const el = $("msg");
  if (!el) return;
  el.textContent = text;
  el.className = "msg " + kind;
}

function deviceId() {
  let id = localStorage.getItem("device_id");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("device_id", id); }
  return id;
}

// A 500 returns plain text, not JSON. Parsing it blindly produced
// "Unexpected token 'I', \"Internal S\"... is not valid JSON", which hides the
// actual fault. Always read as text first and decide afterwards.
async function handleResponse(r) {
  const raw = await r.text();
  let d = null;
  try { d = raw ? JSON.parse(raw) : null; } catch { d = null; }

  if (r.ok) return d ?? {};

  if (d === null) {
    if (r.status >= 500) {
      throw new Error(
        `Server error (${r.status}). Check the terminal running the server — ` +
        "the full reason is printed there.");
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
  const r = await fetch(API + path, {
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
    if (String(d.detail || "").includes("new password")) {
      location.href = "password.html";
      throw new Error(d.detail);
    }
    throw new Error(d.detail || "You don't have access to this.");
  }

  return handleResponse(r);
}

// --- offline punch queue ---------------------------------------------------
// Punches taken with no signal are held here and replayed on reconnect. The
// server dedupes on client_punch_uid and refuses anything older than 48h.
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
  const left = [];
  let sent = 0;
  for (const item of q) {
    try {
      await api(item.path, { method: "POST", body: JSON.stringify(item.body) });
      sent++;
    } catch (e) {
      if (String(e.message).includes("too old")) continue;  // drop, server refused
      left.push(item);
    }
  }
  writeQueue(left);
  return sent;
}
