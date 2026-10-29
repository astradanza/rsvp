// rsvp.fm guestlist — a second, separate product served on its own subdomain (list.rsvp.fm).
// Organizers (promoters, labels, artists) create an event and share its page; guests leave their
// full name, email and, if allowed, a +1/+2/+3, and RSVP. The organizer sees the list, confirms,
// sorts, exports. Own tables (gl_*), own sessions, own static app (public/gl/).

const SESSION_DAYS = 60;
const KINDS = ['promoter', 'label', 'artist'];

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
});
async function body(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) fail(415, 'Send JSON.');
  try { return await request.json(); } catch { fail(400, 'Invalid JSON.'); }
}
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function code(len) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), (x) => alphabet[x % alphabet.length]).join('');
}
function token() {
  const a = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------- passwords (PBKDF2-SHA256) ----------
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$100000$${b64(salt)}$${b64(await pbkdf2(password, salt, 100000))}`;
}
async function verifyPassword(password, stored) {
  const [scheme, it, salt, hash] = String(stored).split('$');
  if (scheme !== 'pbkdf2') return false;
  const got = new Uint8Array(await pbkdf2(password, unb64(salt), Number(it)));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

// ---------- schema ----------
let ready = false;
async function ensureSchema(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS gl_orgs (id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'promoter',
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS gl_sessions (token TEXT PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES gl_orgs(id) ON DELETE CASCADE, expires_at TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS gl_events (id TEXT PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES gl_orgs(id) ON DELETE CASCADE,
      title TEXT NOT NULL, starts_at TEXT NOT NULL DEFAULT '', ends_at TEXT NOT NULL DEFAULT '',
      venue TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '',
      plus_max INTEGER NOT NULL DEFAULT 0, auto_confirm INTEGER NOT NULL DEFAULT 0, open INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS gl_events_org ON gl_events(org_id, created_at)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS gl_guests (id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL REFERENCES gl_events(id) ON DELETE CASCADE,
      name TEXT NOT NULL, email TEXT NOT NULL, plus INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'requested', token TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (event_id, email))`)
  ]);
  ready = true;
}

// ---------- sessions ----------
function cookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}
const sessionCookie = (t, url, maxAge) => `gsid=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${url.protocol === 'https:' ? '; Secure' : ''}`;
async function currentOrg(request, env) {
  const t = cookie(request, 'gsid');
  if (!t) return null;
  return env.DB.prepare(`SELECT o.* FROM gl_sessions s JOIN gl_orgs o ON o.id = s.org_id WHERE s.token = ? AND s.expires_at > datetime('now')`).bind(t).first();
}
async function startSession(env, orgId, url) {
  const t = token();
  await env.DB.prepare(`INSERT INTO gl_sessions (token, org_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`).bind(t, orgId).run();
  return sessionCookie(t, url, SESSION_DAYS * 86400);
}
const orgShape = (o) => ({ name: o.name, kind: o.kind, email: o.email });

// ---------- events ----------
function eventFields(b) {
  const title = str(b.title, 120);
  if (!title) fail(400, 'Give the event a name.');
  const starts = str(b.starts_at, 16);
  if (starts && !DT_RE.test(starts)) fail(400, 'Pick a valid date and time.');
  const ends = str(b.ends_at, 16);
  if (ends && !DT_RE.test(ends)) fail(400, 'Pick a valid end time.');
  if (ends && !starts) fail(400, 'Add a start before the end.');
  if (ends && ends <= starts) fail(400, 'The end must be after the start.');
  return {
    title, starts_at: starts, ends_at: ends,
    venue: str(b.venue, 120), city: str(b.city, 80),
    details: (typeof b.details === 'string' ? b.details : '').replace(/\r\n/g, '\n').trim().slice(0, 4000),
    plus_max: Math.max(0, Math.min(3, Math.round(Number(b.plus_max) || 0))),
    auto_confirm: b.auto_confirm ? 1 : 0,
    open: b.open === false || b.open === 0 || b.open === '0' ? 0 : 1
  };
}
const eventShape = (e) => ({
  id: e.id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, venue: e.venue, city: e.city, details: e.details,
  plus_max: e.plus_max, auto_confirm: !!e.auto_confirm, open: !!e.open, created_at: e.created_at
});
const guestShape = (g) => ({ id: g.id, name: g.name, email: g.email, plus: g.plus, status: g.status, created_at: g.created_at, updated_at: g.updated_at });

async function ownEvent(env, org, id) {
  const e = await env.DB.prepare('SELECT * FROM gl_events WHERE id = ?').bind(String(id)).first();
  if (!e || e.org_id !== org.id) fail(404, 'That event does not exist.');
  return e;
}

// ---------- API ----------
async function api(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  const seg = path.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) fail(403, 'Cross-site request refused.');
  }
  const org = await currentOrg(request, env);
  const need = () => { if (!org) fail(401, 'Log in first.'); return org; };

  if (path === '/api/session' && method === 'GET') return json({ org: org ? orgShape(org) : null });
  if (path === '/api/signup' && method === 'POST') {
    const b = await body(request);
    const name = str(b.name, 80);
    const email = str(b.email, 160).toLowerCase();
    const password = String(b.password || '');
    if (!name) fail(400, 'Enter the name guests will see: your label, your collective, your artist name.');
    if (!EMAIL_RE.test(email)) fail(400, 'Enter a valid email address.');
    if (password.length < 8) fail(400, 'Use at least 8 characters for your password.');
    if (await env.DB.prepare('SELECT 1 FROM gl_orgs WHERE email = ?').bind(email).first()) fail(409, 'An account already uses this email. Log in instead.');
    const o = await env.DB.prepare('INSERT INTO gl_orgs (email, password_hash, name, kind) VALUES (?, ?, ?, ?) RETURNING *')
      .bind(email, await hashPassword(password), name, KINDS.includes(b.kind) ? b.kind : 'promoter').first();
    return json({ org: orgShape(o) }, 201, { 'set-cookie': await startSession(env, o.id, url) });
  }
  if (path === '/api/login' && method === 'POST') {
    const b = await body(request);
    const o = await env.DB.prepare('SELECT * FROM gl_orgs WHERE email = ?').bind(str(b.email, 160).toLowerCase()).first();
    if (!o || !(await verifyPassword(String(b.password || ''), o.password_hash))) fail(401, 'Wrong email or password.');
    return json({ org: orgShape(o) }, 200, { 'set-cookie': await startSession(env, o.id, url) });
  }
  if (path === '/api/logout' && method === 'POST') {
    const t = cookie(request, 'gsid');
    if (t) await env.DB.prepare('DELETE FROM gl_sessions WHERE token = ?').bind(t).run();
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', url, 0) });
  }
  if (path === '/api/me' && method === 'PATCH') {
    need();
    const b = await body(request);
    const name = str(b.name, 80) || org.name;
    const kind = KINDS.includes(b.kind) ? b.kind : org.kind;
    await env.DB.prepare('UPDATE gl_orgs SET name = ?, kind = ? WHERE id = ?').bind(name, kind, org.id).run();
    return json({ org: { ...orgShape(org), name, kind } });
  }

  // --- organizer: events ---
  if (path === '/api/events' && method === 'GET') {
    need();
    const rows = (await env.DB.prepare(
      `SELECT e.*,
         (SELECT COUNT(*) FROM gl_guests g WHERE g.event_id = e.id AND g.status != 'declined') AS requests,
         (SELECT COUNT(*) FROM gl_guests g WHERE g.event_id = e.id AND g.status = 'confirmed') AS confirmed,
         (SELECT COALESCE(SUM(1 + g.plus), 0) FROM gl_guests g WHERE g.event_id = e.id AND g.status != 'declined') AS people
       FROM gl_events e WHERE e.org_id = ?
       ORDER BY CASE WHEN e.starts_at = '' OR e.starts_at >= strftime('%Y-%m-%dT%H:%M', 'now', '-1 day') THEN 0 ELSE 1 END, e.starts_at, e.created_at DESC`
    ).bind(org.id).all()).results;
    return json({ events: rows.map((e) => ({ ...eventShape(e), requests: e.requests, confirmed: e.confirmed, people: e.people })) });
  }
  if (path === '/api/events' && method === 'POST') {
    need();
    const f = eventFields(await body(request));
    const id = code(8);
    await env.DB.prepare(
      `INSERT INTO gl_events (id, org_id, title, starts_at, ends_at, venue, city, details, plus_max, auto_confirm, open)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, org.id, f.title, f.starts_at, f.ends_at, f.venue, f.city, f.details, f.plus_max, f.auto_confirm, f.open).run();
    return json({ id }, 201);
  }
  if (seg[0] === 'events' && seg[1]) {
    need();
    const e = await ownEvent(env, org, seg[1]);
    if (seg.length === 2 && method === 'GET') {
      const guests = (await env.DB.prepare('SELECT * FROM gl_guests WHERE event_id = ? ORDER BY created_at').bind(e.id).all()).results;
      return json({ event: eventShape(e), guests: guests.map(guestShape) });
    }
    if (seg.length === 2 && method === 'PATCH') {
      const f = eventFields(await body(request));
      await env.DB.prepare(
        `UPDATE gl_events SET title = ?, starts_at = ?, ends_at = ?, venue = ?, city = ?, details = ?, plus_max = ?, auto_confirm = ?, open = ? WHERE id = ?`
      ).bind(f.title, f.starts_at, f.ends_at, f.venue, f.city, f.details, f.plus_max, f.auto_confirm, f.open, e.id).run();
      return json({ id: e.id });
    }
    if (seg.length === 2 && method === 'DELETE') {
      await env.DB.prepare('DELETE FROM gl_events WHERE id = ?').bind(e.id).run();
      return json({ ok: true });
    }
    if (seg[2] === 'open' && method === 'POST') {
      const b = await body(request);
      await env.DB.prepare('UPDATE gl_events SET open = ? WHERE id = ?').bind(b.open ? 1 : 0, e.id).run();
      return json({ open: !!b.open });
    }
    if (seg[2] === 'confirm-all' && method === 'POST') {
      const r = await env.DB.prepare(`UPDATE gl_guests SET status = 'confirmed', updated_at = datetime('now') WHERE event_id = ? AND status = 'requested'`).bind(e.id).run();
      return json({ confirmed: r.meta.changes || 0 });
    }
    if (seg[2] === 'guests' && seg[3]) {
      const g = await env.DB.prepare('SELECT * FROM gl_guests WHERE id = ? AND event_id = ?').bind(Number(seg[3]), e.id).first();
      if (!g) fail(404, 'That guest is gone.');
      if (method === 'PATCH') {
        const b = await body(request);
        const status = ['requested', 'confirmed', 'declined'].includes(b.status) ? b.status : g.status;
        await env.DB.prepare(`UPDATE gl_guests SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(status, g.id).run();
        return json({ status });
      }
      if (method === 'DELETE') {
        await env.DB.prepare('DELETE FROM gl_guests WHERE id = ?').bind(g.id).run();
        return json({ ok: true });
      }
    }
  }

  // --- guests: the public page of an event ---
  if (seg[0] === 'p' && seg[1]) {
    const e = await env.DB.prepare('SELECT e.*, o.name AS org_name, o.kind AS org_kind FROM gl_events e JOIN gl_orgs o ON o.id = e.org_id WHERE e.id = ?').bind(String(seg[1])).first();
    if (!e) fail(404, 'This guestlist does not exist.');
    const shape = { ...eventShape(e), host: { name: e.org_name, kind: e.org_kind } };
    delete shape.auto_confirm;
    if (seg.length === 2 && method === 'GET') {
      const t = url.searchParams.get('t');
      const mine = t ? await env.DB.prepare('SELECT * FROM gl_guests WHERE event_id = ? AND token = ?').bind(e.id, t).first() : null;
      return json({ event: shape, mine: mine ? { name: mine.name, email: mine.email, plus: mine.plus, status: mine.status } : null });
    }
    if (seg[2] === 'rsvp' && method === 'POST') {
      if (!e.open) fail(403, 'This guestlist is closed.');
      const b = await body(request);
      const name = str(b.name, 100);
      const email = str(b.email, 160).toLowerCase();
      if (name.length < 2) fail(400, 'Enter your full name.');
      if (!EMAIL_RE.test(email)) fail(400, 'Enter a valid email address.');
      const plus = Math.max(0, Math.min(e.plus_max, Math.round(Number(b.plus) || 0)));
      const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM gl_guests WHERE event_id = ? AND created_at > datetime('now', '-1 minute')`).bind(e.id).first();
      if (n > 60) fail(429, 'Too many requests right now. Try again in a minute.');
      const prev = await env.DB.prepare('SELECT * FROM gl_guests WHERE event_id = ? AND email = ?').bind(e.id, email).first();
      const fresh = e.auto_confirm ? 'confirmed' : 'requested';
      if (prev) {
        // Same email again: update the name and the +, keep a confirmation unless they ask for more people.
        const status = prev.status === 'declined' ? prev.status : prev.status === 'confirmed' && plus <= prev.plus ? 'confirmed' : fresh;
        await env.DB.prepare(`UPDATE gl_guests SET name = ?, plus = ?, status = ?, updated_at = datetime('now') WHERE id = ?`).bind(name, plus, status, prev.id).run();
        return json({ status, token: prev.token });
      }
      const t = token();
      await env.DB.prepare('INSERT INTO gl_guests (event_id, name, email, plus, status, token) VALUES (?, ?, ?, ?, ?, ?)').bind(e.id, name, email, plus, fresh, t).run();
      return json({ status: fresh, token: t }, 201);
    }
  }
  fail(404, 'Not found.');
}

export function isGuestlistHost(hostname) {
  return /^(list|guestlist|gl)\./i.test(hostname);
}

export async function handleGuestlist(request, env, url) {
  if (url.pathname.startsWith('/api/')) {
    try {
      await ensureSchema(env);
      return await api(request, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Something went wrong on our side. Try again.' }, 500);
    }
  }
  // Static files live in public/gl/; every other path is the app.
  const file = /^\/(app\.js|style\.css|favicon\.svg)$/.exec(url.pathname);
  const target = new URL(file ? '/gl/' + file[1] : '/gl/', url);
  const res = await env.ASSETS.fetch(new Request(target, request));
  if (file) return res;
  return new Response(res.body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
}
