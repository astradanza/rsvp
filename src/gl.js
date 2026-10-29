// rsvp.fm guestlist — a second, separate product served on its own subdomain (list.rsvp.fm).
// Organizers (promoters, labels, artists) have a themed page (list.rsvp.fm/handle), public or private,
// and create events with a guestlist. Guests RSVP with their full name, email and an optional +1/+2/+3,
// can opt in to the organizer's next invitations and keep a guest account to receive them here.
// Own tables (gl_*), own sessions, own static app (public/gl/).

const SESSION_DAYS = 60;
const KINDS = ['promoter', 'label', 'artist'];
const THEMES = ['terminal', 'phosphor', 'amber', 'graphite', 'solarized', 'nocturne'];
const DEFAULT_THEME = 'terminal';
const RESERVED = new Set(['api', 'e', 'new', 'login', 'signup', 'logout', 'account', 'community', 'me', 'img', 'app', 'style', 'favicon',
  'admin', 'settings', 'help', 'about', 'terms', 'privacy', 'www', 'list', 'rsvp', 'events', 'event', 'invite', 'join', 'guest', 'guests']);
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,29}$/;

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
const slugify = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

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
async function addColumns(env, table, cols) {
  const have = new Set((await env.DB.prepare(`PRAGMA table_info(${table})`).all()).results.map((c) => c.name));
  for (const [name, def] of cols) if (!have.has(name)) await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`).run();
}
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
      UNIQUE (event_id, email))`),
    // An organizer's community: everyone who RSVP'd, asked for an invitation or asked to be kept posted.
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS gl_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES gl_orgs(id) ON DELETE CASCADE,
      email TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'member',
      consent INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (org_id, email))`),
    // Guest accounts: a password to receive the next invitations here
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS gl_people (id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS gl_psessions (token TEXT PRIMARY KEY,
      person_id INTEGER NOT NULL REFERENCES gl_people(id) ON DELETE CASCADE, expires_at TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS gl_images (id TEXT PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES gl_orgs(id) ON DELETE CASCADE, mime TEXT NOT NULL, data BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
  ]);
  await addColumns(env, 'gl_orgs', [
    ['handle', 'TEXT'], ['bio', "TEXT NOT NULL DEFAULT ''"], ['logo', "TEXT NOT NULL DEFAULT ''"],
    ['theme', "TEXT NOT NULL DEFAULT 'creme'"], ['visibility', "TEXT NOT NULL DEFAULT 'public'"], ['invite_token', 'TEXT']
  ]);
  await addColumns(env, 'gl_guests', [['consent', 'INTEGER NOT NULL DEFAULT 0']]);
  await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS gl_orgs_handle ON gl_orgs(handle)').run();
  // guests who RSVP'd before communities existed join their organizer's community (no email consent)
  if (!(await env.DB.prepare('SELECT 1 FROM gl_contacts LIMIT 1').first())) {
    await env.DB.prepare(`INSERT OR IGNORE INTO gl_contacts (org_id, email, name, status, consent, source)
      SELECT e.org_id, g.email, g.name, 'member', 0, 'rsvp · ' || substr(e.title, 1, 60) FROM gl_guests g JOIN gl_events e ON e.id = g.event_id`).run();
  }
  // give older accounts a handle and an invitation link
  const missing = (await env.DB.prepare('SELECT id, name FROM gl_orgs WHERE handle IS NULL OR invite_token IS NULL').all()).results;
  for (const o of missing) {
    await env.DB.prepare('UPDATE gl_orgs SET handle = COALESCE(handle, ?), invite_token = COALESCE(invite_token, ?) WHERE id = ?')
      .bind(await freeHandle(env, o.name), code(12), o.id).run();
  }
  ready = true;
}
async function freeHandle(env, name) {
  let base = slugify(name);
  if (base.length < 2 || RESERVED.has(base)) base = 'page';
  let h = base;
  for (let i = 2; await env.DB.prepare('SELECT 1 FROM gl_orgs WHERE handle = ?').bind(h).first(); i++) h = base + '-' + i;
  return h;
}

// ---------- sessions ----------
function cookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}
const makeCookie = (name, t, url, maxAge) => `${name}=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${url.protocol === 'https:' ? '; Secure' : ''}`;
async function currentOrg(request, env) {
  const t = cookie(request, 'gsid');
  if (!t) return null;
  return env.DB.prepare(`SELECT o.* FROM gl_sessions s JOIN gl_orgs o ON o.id = s.org_id WHERE s.token = ? AND s.expires_at > datetime('now')`).bind(t).first();
}
async function currentPerson(request, env) {
  const t = cookie(request, 'psid');
  if (!t) return null;
  return env.DB.prepare(`SELECT p.* FROM gl_psessions s JOIN gl_people p ON p.id = s.person_id WHERE s.token = ? AND s.expires_at > datetime('now')`).bind(t).first();
}
async function startSession(env, orgId, url) {
  const t = token();
  await env.DB.prepare(`INSERT INTO gl_sessions (token, org_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`).bind(t, orgId).run();
  return makeCookie('gsid', t, url, SESSION_DAYS * 86400);
}
async function startPersonSession(env, personId, url) {
  const t = token();
  await env.DB.prepare(`INSERT INTO gl_psessions (token, person_id, expires_at) VALUES (?, ?, datetime('now', '+365 days'))`).bind(t, personId).run();
  return makeCookie('psid', t, url, 365 * 86400);
}

// ---------- shapes ----------
const orgShape = (o) => ({
  name: o.name, kind: o.kind, email: o.email, handle: o.handle, bio: o.bio || '', logo: o.logo || '',
  theme: THEMES.includes(o.theme) ? o.theme : DEFAULT_THEME, visibility: o.visibility || 'public', invite_token: o.invite_token
});
const publicOrg = (o) => ({ name: o.name, kind: o.kind, handle: o.handle, bio: o.bio || '', logo: o.logo || '', theme: THEMES.includes(o.theme) ? o.theme : DEFAULT_THEME, visibility: o.visibility || 'public' });
const personShape = (p) => ({ name: p.name, email: p.email });

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
const guestShape = (g) => ({ id: g.id, name: g.name, email: g.email, plus: g.plus, status: g.status, consent: !!g.consent, created_at: g.created_at, updated_at: g.updated_at });
const UPCOMING = `(e.starts_at = '' OR e.starts_at >= strftime('%Y-%m-%dT%H:%M', 'now', '-1 day'))`;

async function ownEvent(env, org, id) {
  const e = await env.DB.prepare('SELECT * FROM gl_events WHERE id = ?').bind(String(id)).first();
  if (!e || e.org_id !== org.id) fail(404, 'That event does not exist.');
  return e;
}
// Add someone to an organizer's community. A member stays a member; consent only goes up unless they say no.
async function upsertContact(env, orgId, { email, name, status, consent, source, note }) {
  const prev = await env.DB.prepare('SELECT * FROM gl_contacts WHERE org_id = ? AND email = ?').bind(orgId, email).first();
  if (!prev) {
    await env.DB.prepare('INSERT INTO gl_contacts (org_id, email, name, status, consent, source, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(orgId, email, name || '', status, consent ? 1 : 0, source || '', note || '').run();
    return status;
  }
  const next = prev.status === 'member' ? 'member' : status === 'member' ? 'member' : prev.status === 'declined' && status === 'requested' ? 'declined' : status;
  await env.DB.prepare(`UPDATE gl_contacts SET name = COALESCE(NULLIF(?, ''), name), status = ?, consent = ?, note = CASE WHEN ? != '' THEN ? ELSE note END, updated_at = datetime('now') WHERE id = ?`)
    .bind(name || '', next, consent === undefined ? prev.consent : consent ? 1 : 0, note || '', note || '', prev.id).run();
  return next;
}
async function memberOf(env, orgId, email) {
  if (!email) return null;
  const c = await env.DB.prepare('SELECT status FROM gl_contacts WHERE org_id = ? AND email = ?').bind(orgId, email).first();
  return c ? c.status : null;
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
  const person = await currentPerson(request, env);
  const need = () => { if (!org) fail(401, 'Log in first.'); return org; };

  if (path === '/api/session' && method === 'GET') return json({ org: org ? orgShape(org) : null, person: person ? personShape(person) : null });

  // --- organizer accounts ---
  if (path === '/api/signup' && method === 'POST') {
    const b = await body(request);
    const name = str(b.name, 80);
    const email = str(b.email, 160).toLowerCase();
    const password = String(b.password || '');
    if (!name) fail(400, 'Enter the name guests will see: your label, your collective, your artist name.');
    if (!EMAIL_RE.test(email)) fail(400, 'Enter a valid email address.');
    if (password.length < 8) fail(400, 'Use at least 8 characters for your password.');
    if (await env.DB.prepare('SELECT 1 FROM gl_orgs WHERE email = ?').bind(email).first()) fail(409, 'An account already uses this email. Log in instead.');
    const o = await env.DB.prepare('INSERT INTO gl_orgs (email, password_hash, name, kind, handle, invite_token) VALUES (?, ?, ?, ?, ?, ?) RETURNING *')
      .bind(email, await hashPassword(password), name, KINDS.includes(b.kind) ? b.kind : 'promoter', await freeHandle(env, name), code(12)).first();
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
    return json({ ok: true }, 200, { 'set-cookie': makeCookie('gsid', '', url, 0) });
  }
  if (path === '/api/me' && method === 'PATCH') {
    need();
    const b = await body(request);
    const name = str(b.name, 80) || org.name;
    const kind = KINDS.includes(b.kind) ? b.kind : org.kind;
    const bio = typeof b.bio === 'string' ? b.bio.replace(/\r\n/g, '\n').trim().slice(0, 600) : org.bio;
    const theme = THEMES.includes(b.theme) ? b.theme : THEMES.includes(org.theme) ? org.theme : DEFAULT_THEME;
    const visibility = b.visibility === 'private' ? 'private' : b.visibility === 'public' ? 'public' : org.visibility;
    let handle = org.handle;
    if (typeof b.handle === 'string' && b.handle.trim().toLowerCase().replace(/^@/, '') !== org.handle) {
      handle = b.handle.trim().toLowerCase().replace(/^@/, '');
      if (!HANDLE_RE.test(handle)) fail(400, 'Your address uses 2 to 30 lowercase letters, digits, - or _.');
      if (RESERVED.has(handle)) fail(400, 'That address is reserved. Pick another one.');
      if (await env.DB.prepare('SELECT 1 FROM gl_orgs WHERE handle = ? AND id != ?').bind(handle, org.id).first()) fail(409, 'That address is taken.');
      if (await env.DB.prepare('SELECT 1 FROM gl_events WHERE id = ?').bind(handle).first()) fail(409, 'That address is taken.');
    }
    await env.DB.prepare('UPDATE gl_orgs SET name = ?, kind = ?, bio = ?, theme = ?, visibility = ?, handle = ? WHERE id = ?')
      .bind(name, kind, bio, theme, visibility, handle, org.id).run();
    return json({ org: orgShape({ ...org, name, kind, bio, theme, visibility, handle }) });
  }
  if (path === '/api/me/logo' && method === 'POST') {
    need();
    const b = await body(request);
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data || ''));
    if (!m) fail(400, 'Upload a PNG, JPEG or WebP image.');
    const bytes = unb64(m[2]);
    if (bytes.length > 900000) fail(413, 'This image is too large. Try a smaller one.');
    const id = code(16);
    await env.DB.prepare('INSERT INTO gl_images (id, org_id, mime, data) VALUES (?, ?, ?, ?)').bind(id, org.id, m[1], bytes).run();
    if (org.logo) await env.DB.prepare('DELETE FROM gl_images WHERE id = ? AND org_id = ?').bind(org.logo.split('/').pop(), org.id).run();
    const logo = '/api/img/' + id;
    await env.DB.prepare('UPDATE gl_orgs SET logo = ? WHERE id = ?').bind(logo, org.id).run();
    return json({ logo });
  }
  if (path === '/api/me/logo' && method === 'DELETE') {
    need();
    if (org.logo) await env.DB.prepare('DELETE FROM gl_images WHERE id = ? AND org_id = ?').bind(org.logo.split('/').pop(), org.id).run();
    await env.DB.prepare("UPDATE gl_orgs SET logo = '' WHERE id = ?").bind(org.id).run();
    return json({ logo: '' });
  }
  if (path === '/api/me/invite-link' && method === 'POST') {
    need();
    const t = code(12);
    await env.DB.prepare('UPDATE gl_orgs SET invite_token = ? WHERE id = ?').bind(t, org.id).run();
    return json({ invite_token: t });
  }
  if (seg[0] === 'img' && seg[1] && method === 'GET') {
    const img = await env.DB.prepare('SELECT mime, data FROM gl_images WHERE id = ?').bind(seg[1]).first();
    if (!img) return new Response('Not found', { status: 404 });
    return new Response(new Uint8Array(img.data), { headers: { 'content-type': img.mime, 'cache-control': 'public, max-age=31536000, immutable' } });
  }

  // --- organizer: community ---
  if (path === '/api/community' && method === 'GET') {
    need();
    const rows = (await env.DB.prepare(
      `SELECT c.*, EXISTS(SELECT 1 FROM gl_people p WHERE p.email = c.email) AS has_account FROM gl_contacts c WHERE c.org_id = ?
       ORDER BY CASE c.status WHEN 'requested' THEN 0 ELSE 1 END, c.created_at DESC`
    ).bind(org.id).all()).results;
    return json({ contacts: rows.map((c) => ({ id: c.id, email: c.email, name: c.name, status: c.status, consent: !!c.consent, source: c.source, note: c.note, has_account: !!c.has_account, created_at: c.created_at })) });
  }
  if (seg[0] === 'community' && seg[1] && method === 'PATCH') {
    need();
    const b = await body(request);
    const status = ['member', 'declined', 'requested'].includes(b.status) ? b.status : null;
    if (!status) fail(400, 'Unknown status.');
    const r = await env.DB.prepare(`UPDATE gl_contacts SET status = ?, updated_at = datetime('now') WHERE id = ? AND org_id = ?`).bind(status, Number(seg[1]), org.id).run();
    if (!r.meta.changes) fail(404, 'That person is gone.');
    return json({ status });
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
       ORDER BY CASE WHEN ${UPCOMING} THEN 0 ELSE 1 END, e.starts_at, e.created_at DESC`
    ).bind(org.id).all()).results;
    return json({ events: rows.map((e) => ({ ...eventShape(e), requests: e.requests, confirmed: e.confirmed, people: e.people })) });
  }
  if (path === '/api/events' && method === 'POST') {
    need();
    const f = eventFields(await body(request));
    let id = code(8);
    while (await env.DB.prepare('SELECT 1 FROM gl_orgs WHERE handle = ?').bind(id).first()) id = code(8);
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
      const guests = (await env.DB.prepare('SELECT * FROM gl_guests WHERE event_id = ? ORDER BY created_at, id').bind(e.id).all()).results;
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

  // --- guest accounts ---
  if (path === '/api/people/signup' && method === 'POST') {
    // From an RSVP (event + guest token) or an invitation request: the email is the one they gave.
    const b = await body(request);
    const password = String(b.password || '');
    if (password.length < 8) fail(400, 'Use at least 8 characters for your password.');
    let email = str(b.email, 160).toLowerCase(), name = str(b.name, 100);
    if (b.event && b.t) {
      const g = await env.DB.prepare('SELECT * FROM gl_guests WHERE event_id = ? AND token = ?').bind(String(b.event), String(b.t)).first();
      if (!g) fail(403, 'This link is not valid anymore.');
      email = g.email; name = g.name;
      const ev = await env.DB.prepare('SELECT org_id FROM gl_events WHERE id = ?').bind(g.event_id).first();
      await upsertContact(env, ev.org_id, { email, name, status: 'member', consent: true, source: 'account' });
    }
    if (!EMAIL_RE.test(email)) fail(400, 'Enter a valid email address.');
    if (name.length < 2) fail(400, 'Enter your full name.');
    if (await env.DB.prepare('SELECT 1 FROM gl_people WHERE email = ?').bind(email).first()) fail(409, 'You already have a password for ' + email + '. Log in instead.');
    const p = await env.DB.prepare('INSERT INTO gl_people (email, name, password_hash) VALUES (?, ?, ?) RETURNING *').bind(email, name, await hashPassword(password)).first();
    return json({ person: personShape(p) }, 201, { 'set-cookie': await startPersonSession(env, p.id, url) });
  }
  if (path === '/api/people/login' && method === 'POST') {
    const b = await body(request);
    const p = await env.DB.prepare('SELECT * FROM gl_people WHERE email = ?').bind(str(b.email, 160).toLowerCase()).first();
    if (!p || !(await verifyPassword(String(b.password || ''), p.password_hash))) fail(401, 'Wrong email or password.');
    return json({ person: personShape(p) }, 200, { 'set-cookie': await startPersonSession(env, p.id, url) });
  }
  if (path === '/api/people/logout' && method === 'POST') {
    const t = cookie(request, 'psid');
    if (t) await env.DB.prepare('DELETE FROM gl_psessions WHERE token = ?').bind(t).run();
    return json({ ok: true }, 200, { 'set-cookie': makeCookie('psid', '', url, 0) });
  }
  if (path === '/api/people/me' && method === 'GET') {
    if (!person) fail(401, 'Log in first.');
    // Upcoming events of the pages they belong to, and their own RSVPs
    const events = (await env.DB.prepare(
      `SELECT e.*, o.name AS org_name, o.handle AS org_handle, o.logo AS org_logo, g.status AS my_status, g.plus AS my_plus
       FROM gl_events e JOIN gl_orgs o ON o.id = e.org_id
       LEFT JOIN gl_guests g ON g.event_id = e.id AND g.email = ?1
       WHERE ${UPCOMING} AND (g.id IS NOT NULL OR (e.open = 1 AND e.org_id IN (SELECT org_id FROM gl_contacts WHERE email = ?1 AND status = 'member')))
       ORDER BY CASE WHEN e.starts_at = '' THEN 1 ELSE 0 END, e.starts_at LIMIT 60`
    ).bind(person.email).all()).results;
    const pages = (await env.DB.prepare(
      `SELECT o.*, c.status AS my_status FROM gl_contacts c JOIN gl_orgs o ON o.id = c.org_id WHERE c.email = ? AND c.status != 'declined' ORDER BY o.name`
    ).bind(person.email).all()).results;
    return json({
      person: personShape(person),
      events: events.map((e) => ({ ...eventShape(e), auto_confirm: undefined, host: { name: e.org_name, handle: e.org_handle, logo: e.org_logo || '' }, my_status: e.my_status || '', my_plus: e.my_plus || 0 })),
      pages: pages.map((o) => ({ ...publicOrg(o), my_status: o.my_status }))
    });
  }

  // --- public: an organizer's page ---
  if (seg[0] === 'o' && seg[1]) {
    const o = await env.DB.prepare('SELECT * FROM gl_orgs WHERE handle = ?').bind(String(seg[1]).toLowerCase()).first();
    if (!o) fail(404, 'This page does not exist.');
    if (seg.length === 2 && method === 'GET') {
      const inviteOk = !!url.searchParams.get('i') && url.searchParams.get('i') === o.invite_token;
      let mine = person ? await memberOf(env, o.id, person.email) : null;
      if (inviteOk && person && mine !== 'member') { await upsertContact(env, o.id, { email: person.email, name: person.name, status: 'member', consent: true, source: 'invitation link' }); mine = 'member'; }
      const isOwner = !!org && org.id === o.id;
      const access = o.visibility === 'public' || inviteOk || isOwner || mine === 'member';
      const events = access ? (await env.DB.prepare(`SELECT * FROM gl_events e WHERE e.org_id = ? AND ${UPCOMING} ORDER BY CASE WHEN e.starts_at = '' THEN 1 ELSE 0 END, e.starts_at`).bind(o.id).all()).results.map(eventShape) : [];
      return json({ org: publicOrg(o), access, invited: inviteOk, is_owner: isOwner, my_status: mine, events });
    }
    // Keep me posted (public page or invitation link) / Request an invitation (private page)
    if (seg[2] === 'join' && method === 'POST') {
      const b = await body(request);
      const inviteOk = !!b.i && b.i === o.invite_token;
      const email = person ? person.email : str(b.email, 160).toLowerCase();
      const name = person ? person.name : str(b.name, 100);
      if (name.length < 2) fail(400, 'Enter your full name.');
      if (!EMAIL_RE.test(email)) fail(400, 'Enter a valid email address.');
      const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM gl_contacts WHERE org_id = ? AND created_at > datetime('now', '-1 minute')`).bind(o.id).first();
      if (n > 60) fail(429, 'Too many requests right now. Try again in a minute.');
      const open = o.visibility === 'public' || inviteOk;
      const status = await upsertContact(env, o.id, {
        email, name, status: open ? 'member' : 'requested', consent: true,
        source: open ? (inviteOk ? 'invitation link' : 'page') : 'request', note: str(b.note, 300)
      });
      const headers = {};
      let created = null;
      if (!person && b.password) {
        if (String(b.password).length < 8) fail(400, 'Use at least 8 characters for your password.');
        if (!(await env.DB.prepare('SELECT 1 FROM gl_people WHERE email = ?').bind(email).first())) {
          created = await env.DB.prepare('INSERT INTO gl_people (email, name, password_hash) VALUES (?, ?, ?) RETURNING *').bind(email, name, await hashPassword(String(b.password))).first();
          headers['set-cookie'] = await startPersonSession(env, created.id, url);
        }
      }
      return json({ status, person: created ? personShape(created) : null }, 200, headers);
    }
  }

  // --- public: an event page ---
  if (seg[0] === 'p' && seg[1]) {
    const e = await env.DB.prepare('SELECT e.*, o.name AS org_name, o.kind AS org_kind, o.handle AS org_handle, o.logo AS org_logo, o.theme AS org_theme, o.visibility AS org_visibility FROM gl_events e JOIN gl_orgs o ON o.id = e.org_id WHERE e.id = ?').bind(String(seg[1])).first();
    if (!e) fail(404, 'This guestlist does not exist.');
    const shape = { ...eventShape(e), host: { name: e.org_name, kind: e.org_kind, handle: e.org_handle, logo: e.org_logo || '', theme: THEMES.includes(e.org_theme) ? e.org_theme : DEFAULT_THEME, visibility: e.org_visibility } };
    delete shape.auto_confirm;
    if (seg.length === 2 && method === 'GET') {
      const t = url.searchParams.get('t');
      let mine = t ? await env.DB.prepare('SELECT * FROM gl_guests WHERE event_id = ? AND token = ?').bind(e.id, t).first() : null;
      if (!mine && person) mine = await env.DB.prepare('SELECT * FROM gl_guests WHERE event_id = ? AND email = ?').bind(e.id, person.email).first();
      return json({
        event: shape,
        mine: mine ? { name: mine.name, email: mine.email, plus: mine.plus, status: mine.status, consent: !!mine.consent, has_account: !!person || !!(await env.DB.prepare('SELECT 1 FROM gl_people WHERE email = ?').bind(mine.email).first()) } : null,
        person: person ? personShape(person) : null
      });
    }
    // After the RSVP: join the organizer's page (their next invitations by email), optionally with a password.
    if (seg[2] === 'keep' && method === 'POST') {
      const b = await body(request);
      let g = b.t ? await env.DB.prepare('SELECT * FROM gl_guests WHERE event_id = ? AND token = ?').bind(e.id, String(b.t)).first() : null;
      if (!g && person) g = await env.DB.prepare('SELECT * FROM gl_guests WHERE event_id = ? AND email = ?').bind(e.id, person.email).first();
      if (!g) fail(403, 'RSVP first.');
      await env.DB.prepare('UPDATE gl_guests SET consent = 1 WHERE id = ?').bind(g.id).run();
      await upsertContact(env, e.org_id, { email: g.email, name: g.name, status: 'member', consent: true, source: 'rsvp · ' + e.title.slice(0, 60) });
      const headers = {};
      let created = null;
      if (!person && b.password) {
        if (String(b.password).length < 8) fail(400, 'Use at least 8 characters for your password.');
        if (await env.DB.prepare('SELECT 1 FROM gl_people WHERE email = ?').bind(g.email).first()) fail(409, 'You already have a password for ' + g.email + '. Log in instead.');
        created = await env.DB.prepare('INSERT INTO gl_people (email, name, password_hash) VALUES (?, ?, ?) RETURNING *').bind(g.email, g.name, await hashPassword(String(b.password))).first();
        headers['set-cookie'] = await startPersonSession(env, created.id, url);
      }
      return json({ ok: true, person: created ? personShape(created) : null }, 200, headers);
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
      // Whoever RSVPs through the event link joins the organizer's community. Emails only once they choose to join the page, after the RSVP.
      await upsertContact(env, e.org_id, { email, name, status: 'member', source: 'rsvp · ' + e.title.slice(0, 60) });
      if (prev) {
        const status = prev.status === 'declined' ? prev.status : prev.status === 'confirmed' && plus <= prev.plus ? 'confirmed' : fresh;
        await env.DB.prepare(`UPDATE gl_guests SET name = ?, plus = ?, status = ?, updated_at = datetime('now') WHERE id = ?`).bind(name, plus, status, prev.id).run();
        return json({ status, token: prev.token });
      }
      const t = token();
      await env.DB.prepare('INSERT INTO gl_guests (event_id, name, email, plus, status, token) VALUES (?, ?, ?, ?, ?, ?)').bind(e.id, name, email, plus, fresh, t).run();
      return json({ status: fresh, token: t }, 201);
    }
  }
  // An address: an event id or an organizer's handle
  if (seg[0] === 'resolve' && seg[1] && method === 'GET') {
    const s = String(seg[1]).toLowerCase();
    if (await env.DB.prepare('SELECT 1 FROM gl_events WHERE id = ?').bind(s).first()) return json({ type: 'event' });
    if (await env.DB.prepare('SELECT 1 FROM gl_orgs WHERE handle = ?').bind(s).first()) return json({ type: 'org' });
    fail(404, 'Nothing here.');
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
