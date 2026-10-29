// rsvp.fm guestlist — a second, separate product served on its own subdomain (list.rsvp.fm).
// Organizers (promoters, labels, artists) have a themed page (list.rsvp.fm/handle), public or private,
// and create events with a guestlist. Guests RSVP with their full name, email and an optional +1/+2/+3,
// can opt in to the organizer's next invitations and keep a guest account to receive them here.
// Own tables (gl_*), own sessions, own static app (public/gl/).

import { mailEnabled, mailRsvp, mailConfirmed, sendDigests, prefsFor } from './gl-mail.js';
import { migrateV1 } from './gl-migrate.js';
import { vapidKeys, validSubscription, pushTo } from './gl-push.js';

const SESSION_DAYS = 60;
const KINDS = ['promoter', 'label', 'artist', 'club'];
const THEMES = ['minimal', 'terminal', 'phosphor', 'amber', 'graphite', 'solarized', 'nocturne'];
const DEFAULT_THEME = 'minimal';
// Fonts allowed in a custom theme (the app loads them from Google Fonts)
const FONTS = ['Helvetica', 'Share Tech Mono', 'JetBrains Mono', 'IBM Plex Mono', 'Space Mono', 'Fira Code', 'Source Code Pro', 'DM Mono', 'Instrument Serif', 'Cormorant Garamond',
  'EB Garamond', 'Playfair Display', 'Fraunces', 'Bodoni Moda', 'Libre Caslon Text', 'Inter', 'Jost', 'Space Grotesk', 'Syne', 'Archivo'];
const HEX_RE = /^#[0-9a-f]{6}$/i;
function customOf(o) {
  try {
    const c = JSON.parse(o.custom_theme || o.org_custom_theme || 'null');
    if (c && HEX_RE.test(c.paper) && HEX_RE.test(c.ink) && HEX_RE.test(c.accent) && FONTS.includes(c.display) && FONTS.includes(c.text)) return c;
  } catch { /* none */ }
  return null;
}
function themeOf(theme, custom) { return theme === 'custom' && custom ? 'custom' : THEMES.includes(theme) ? theme : DEFAULT_THEME; }
const RESERVED = new Set(['api', 'e', 'i', 'new', 'login', 'signup', 'logout', 'account', 'community', 'me', 'img', 'app', 'style', 'favicon', 'prefs',
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
    // Emails sent (and failed), used to never send the same invitation twice
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS gl_mail_log (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, email TEXT NOT NULL,
      event_id TEXT, org_id INTEGER, status TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS gl_mail_log_email ON gl_mail_log(email, event_id, kind)'),
    // Email preferences per address: daily, weekly or never; the token signs the unsubscribe link
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS gl_prefs (email TEXT PRIMARY KEY, token TEXT NOT NULL, digest TEXT NOT NULL DEFAULT 'daily',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS gl_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)'),
    // Unique links: "you've been invited to register N names on the guestlist", one use each
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS gl_invites (code TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES gl_events(id) ON DELETE CASCADE,
      slots INTEGER NOT NULL DEFAULT 1, label TEXT NOT NULL DEFAULT '', guest_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS gl_invites_event ON gl_invites(event_id)'),
    // Push subscriptions (one per device), by email
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS gl_push (endpoint TEXT PRIMARY KEY, email TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS gl_push_email ON gl_push(email)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS gl_images (id TEXT PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES gl_orgs(id) ON DELETE CASCADE, mime TEXT NOT NULL, data BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
  ]);
  await addColumns(env, 'gl_orgs', [
    ['handle', 'TEXT'], ['bio', "TEXT NOT NULL DEFAULT ''"], ['logo', "TEXT NOT NULL DEFAULT ''"],
    ['theme', "TEXT NOT NULL DEFAULT 'creme'"], ['visibility', "TEXT NOT NULL DEFAULT 'public'"], ['invite_token', 'TEXT'],
    ['custom_theme', "TEXT NOT NULL DEFAULT ''"], ['v1_user_id', 'INTEGER']
  ]);
  await addColumns(env, 'gl_guests', [['consent', 'INTEGER NOT NULL DEFAULT 0'], ['names', "TEXT NOT NULL DEFAULT ''"], ['invite_code', 'TEXT']]);
  await addColumns(env, 'gl_events', [['listed', 'INTEGER NOT NULL DEFAULT 1'], ['slug', 'TEXT']]);
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
  // accounts, events and lists of the first rsvp.fm, once
  await migrateV1(env, { freeHandle, code, token, reserved: RESERVED, handleRe: HANDLE_RE });
  // every event gets a readable address: rsvp.fm/<handle>/<slug>
  const noSlug = (await env.DB.prepare('SELECT id, org_id, title FROM gl_events WHERE slug IS NULL').all()).results;
  for (const e of noSlug) await env.DB.prepare('UPDATE gl_events SET slug = ? WHERE id = ?').bind(await freeSlug(env, e.org_id, e.title, e.id), e.id).run();
  await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS gl_events_slug ON gl_events(org_id, slug)').run();
  ready = true;
}
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
async function freeSlug(env, orgId, title, selfId) {
  let base = slugify(title).slice(0, 50) || 'event';
  let s = base;
  for (let i = 2; await env.DB.prepare('SELECT 1 FROM gl_events WHERE org_id = ? AND slug = ? AND id != ?').bind(orgId, s, selfId || '').first(); i++) s = base + '-' + i;
  return s;
}
// the slug the organizer typed, or one made from the title
async function eventSlug(env, orgId, b, title, selfId) {
  const want = str(b.slug, 60).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!want) return freeSlug(env, orgId, title, selfId);
  if (!SLUG_RE.test(want)) fail(400, 'The link uses lowercase letters, digits and dashes.');
  if (await env.DB.prepare('SELECT 1 FROM gl_events WHERE org_id = ? AND slug = ? AND id != ?').bind(orgId, want, selfId || '').first()) fail(409, 'You already use this link for another event.');
  return want;
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
  theme: themeOf(o.theme, customOf(o)), custom: customOf(o), visibility: o.visibility || 'public', invite_token: o.invite_token
});
const publicOrg = (o) => ({ name: o.name, kind: o.kind, handle: o.handle, bio: o.bio || '', logo: o.logo || '', theme: themeOf(o.theme, customOf(o)), custom: customOf(o), visibility: o.visibility || 'public' });
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
    open: b.open === false || b.open === 0 || b.open === '0' ? 0 : 1,
    listed: b.listed === false || b.listed === 0 || b.listed === '0' ? 0 : 1
  };
}
const eventShape = (e) => ({
  id: e.id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, venue: e.venue, city: e.city, details: e.details,
  slug: e.slug || '', plus_max: e.plus_max, auto_confirm: !!e.auto_confirm, open: !!e.open, listed: e.listed == null ? true : !!e.listed, created_at: e.created_at
});
const guestShape = (g) => ({ id: g.id, name: g.name, email: g.email, plus: g.plus, names: namesOf(g), invite_code: g.invite_code || '', status: g.status, consent: !!g.consent, created_at: g.created_at, updated_at: g.updated_at });
// Extra names registered through a unique link (one per line)
const namesOf = (g) => String(g.names || '').split('\n').map((x) => x.trim()).filter(Boolean);
const UPCOMING = `(e.starts_at = '' OR e.starts_at >= strftime('%Y-%m-%dT%H:%M', 'now', '-1 day'))`;

// "You're on the list": by email and on their devices
async function notifyConfirmed(env, event, org, guest) {
  await mailConfirmed(env, { event, org, guest });
  const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(event.starts_at || '');
  await pushTo(env, guest.email, { title: "You're on the list", body: event.title + (m ? ` · ${+m[2]}/${+m[1]} ${m[3]}` : ''), url: (event.slug && org.handle ? '/' + org.handle + '/' + event.slug : '/' + event.id) + '?t=' + encodeURIComponent(guest.token), tag: 'confirm-' + event.id });
}

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
async function api(request, env, url, ctx) {
  // run work after the response when possible (emails)
  const later = (p) => { if (ctx && ctx.waitUntil) ctx.waitUntil(p.catch((e) => console.error(e))); else return p; };
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

  if (path === '/api/session' && method === 'GET') return json({ org: org ? orgShape(org) : null, person: person ? personShape(person) : null, mail: mailEnabled(env) });

  // --- push notifications ---
  if (path === '/api/push/key' && method === 'GET') return json({ key: (await vapidKeys(env)).publicKey });
  if (path === '/api/push/subscribe' && method === 'POST') {
    const b = await body(request);
    const sub = b.subscription || {};
    if (!validSubscription(sub)) fail(400, 'This browser sent an unusable subscription.');
    // whose device: the guest account, or the guest of an RSVP (event + token)
    let email = person ? person.email : '';
    if (!email && b.event && b.t) {
      const g = await env.DB.prepare('SELECT email FROM gl_guests WHERE event_id = ? AND token = ?').bind(String(b.event), String(b.t)).first();
      if (g) email = g.email;
    }
    if (!email) fail(401, 'Log in first.');
    await env.DB.prepare(`INSERT INTO gl_push (endpoint, email, p256dh, auth) VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET email = excluded.email, p256dh = excluded.p256dh, auth = excluded.auth`).bind(sub.endpoint, email, sub.keys.p256dh, sub.keys.auth).run();
    await later(pushTo(env, email, { title: 'Notifications on', body: 'New invitations from the pages you joined will show up here.', url: '/me', tag: 'welcome' }));
    return json({ ok: true });
  }
  if (path === '/api/push/unsubscribe' && method === 'POST') {
    const b = await body(request);
    await env.DB.prepare('DELETE FROM gl_push WHERE endpoint = ?').bind(String(b.endpoint || '')).run();
    return json({ ok: true });
  }

  // --- email preferences (link in every invitation email, or the guest's own session) ---
  if (path === '/api/prefs') {
    let email = person ? person.email : '';
    const e = str(url.searchParams.get('e'), 160).toLowerCase(), k = url.searchParams.get('k') || '';
    if (e && k) {
      const p = await env.DB.prepare('SELECT * FROM gl_prefs WHERE email = ? AND token = ?').bind(e, k).first();
      if (!p) fail(403, 'This link is not valid anymore.');
      email = p.email;
    }
    if (!email) fail(401, 'Log in first.');
    const p = await prefsFor(env, email);
    if (method === 'POST') {
      const b = await body(request);
      const digest = ['daily', 'weekly', 'never'].includes(b.digest) ? b.digest : p.digest;
      await env.DB.prepare("UPDATE gl_prefs SET digest = ?, updated_at = datetime('now') WHERE email = ?").bind(digest, email).run();
      return json({ email, digest });
    }
    return json({ email, digest: p.digest });
  }

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
  // One login for everyone: an organizer (email or handle) first, then a guest account.
  if (path === '/api/login' && method === 'POST') {
    const b = await body(request);
    const id = str(b.email || b.login, 160).toLowerCase().replace(/^@/, '');
    const password = String(b.password || '');
    const o = await env.DB.prepare('SELECT * FROM gl_orgs WHERE email = ? OR handle = ?').bind(id, id).first();
    if (o && await verifyPassword(password, o.password_hash)) return json({ org: orgShape(o) }, 200, { 'set-cookie': await startSession(env, o.id, url) });
    const p = await env.DB.prepare('SELECT * FROM gl_people WHERE email = ?').bind(id).first();
    if (p && await verifyPassword(password, p.password_hash)) return json({ person: personShape(p) }, 200, { 'set-cookie': await startPersonSession(env, p.id, url) });
    fail(401, 'Wrong email or password.');
  }
  // Old personal invite links (rsvp.fm/i/code) lead to the page of whoever sent them
  if (seg[0] === 'invite' && seg[1] && method === 'GET') {
    const r = await env.DB.prepare(`SELECT o.handle FROM users u JOIN gl_orgs o ON o.v1_user_id = u.id WHERE u.invite_link = ?`).bind(String(seg[1]).toLowerCase()).first().catch(() => null);
    return json({ handle: r ? r.handle : null });
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
    let custom = org.custom_theme || '';
    if (b.custom && typeof b.custom === 'object') {
      const c = { paper: String(b.custom.paper || ''), ink: String(b.custom.ink || ''), accent: String(b.custom.accent || ''), display: String(b.custom.display || ''), text: String(b.custom.text || '') };
      if (!HEX_RE.test(c.paper) || !HEX_RE.test(c.ink) || !HEX_RE.test(c.accent)) fail(400, 'Pick valid colors.');
      if (!FONTS.includes(c.display) || !FONTS.includes(c.text)) fail(400, 'Pick fonts from the list.');
      custom = JSON.stringify(c);
    }
    const theme = b.theme === 'custom' && custom ? 'custom' : THEMES.includes(b.theme) ? b.theme : themeOf(org.theme, customOf(org));
    const visibility = b.visibility === 'private' ? 'private' : b.visibility === 'public' ? 'public' : org.visibility;
    let handle = org.handle;
    if (typeof b.handle === 'string' && b.handle.trim().toLowerCase().replace(/^@/, '') !== org.handle) {
      handle = b.handle.trim().toLowerCase().replace(/^@/, '');
      if (!HANDLE_RE.test(handle)) fail(400, 'Your address uses 2 to 30 lowercase letters, digits, - or _.');
      if (RESERVED.has(handle)) fail(400, 'That address is reserved. Pick another one.');
      if (await env.DB.prepare('SELECT 1 FROM gl_orgs WHERE handle = ? AND id != ?').bind(handle, org.id).first()) fail(409, 'That address is taken.');
      if (await env.DB.prepare('SELECT 1 FROM gl_events WHERE id = ?').bind(handle).first()) fail(409, 'That address is taken.');
    }
    await env.DB.prepare('UPDATE gl_orgs SET name = ?, kind = ?, bio = ?, theme = ?, visibility = ?, handle = ?, custom_theme = ? WHERE id = ?')
      .bind(name, kind, bio, theme, visibility, handle, custom, org.id).run();
    return json({ org: orgShape({ ...org, name, kind, bio, theme, visibility, handle, custom_theme: custom }) });
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
    const b = await body(request);
    const f = eventFields(b);
    let id = code(8);
    while (await env.DB.prepare('SELECT 1 FROM gl_orgs WHERE handle = ?').bind(id).first()) id = code(8);
    const slug = await eventSlug(env, org.id, b, f.title, id);
    await env.DB.prepare(
      `INSERT INTO gl_events (id, org_id, title, starts_at, ends_at, venue, city, details, plus_max, auto_confirm, open, listed, slug)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, org.id, f.title, f.starts_at, f.ends_at, f.venue, f.city, f.details, f.plus_max, f.auto_confirm, f.open, f.listed, slug).run();
    return json({ id, slug }, 201);
  }
  if (seg[0] === 'events' && seg[1]) {
    need();
    const e = await ownEvent(env, org, seg[1]);
    if (seg.length === 2 && method === 'GET') {
      const guests = (await env.DB.prepare('SELECT * FROM gl_guests WHERE event_id = ? ORDER BY created_at, id').bind(e.id).all()).results;
      const invites = (await env.DB.prepare(`SELECT i.*, g.name AS guest_name, g.names AS guest_names FROM gl_invites i LEFT JOIN gl_guests g ON g.id = i.guest_id
        WHERE i.event_id = ? ORDER BY i.created_at DESC`).bind(e.id).all()).results;
      return json({ event: eventShape(e), guests: guests.map(guestShape),
        invites: invites.map((i) => ({ code: i.code, slots: i.slots, label: i.label, used: !!i.guest_id, guest_name: i.guest_name || '', names: namesOf({ names: i.guest_names }), created_at: i.created_at })) });
    }
    if (seg.length === 2 && method === 'PATCH') {
      const b = await body(request);
      const f = eventFields(b);
      const slug = b.slug === undefined ? e.slug : await eventSlug(env, org.id, b, f.title, e.id);
      await env.DB.prepare(
        `UPDATE gl_events SET title = ?, starts_at = ?, ends_at = ?, venue = ?, city = ?, details = ?, plus_max = ?, auto_confirm = ?, open = ?, listed = ?, slug = ? WHERE id = ?`
      ).bind(f.title, f.starts_at, f.ends_at, f.venue, f.city, f.details, f.plus_max, f.auto_confirm, f.open, f.listed, slug, e.id).run();
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
    if (seg[2] === 'invites' && !seg[3] && method === 'POST') {
      const b = await body(request);
      const slots = Math.max(1, Math.min(20, Math.round(Number(b.slots) || 1)));
      const c = code(10);
      await env.DB.prepare('INSERT INTO gl_invites (code, event_id, slots, label) VALUES (?, ?, ?, ?)').bind(c, e.id, slots, str(b.label, 80)).run();
      return json({ code: c, slots }, 201);
    }
    if (seg[2] === 'invites' && seg[3] && method === 'DELETE') {
      const r = await env.DB.prepare('DELETE FROM gl_invites WHERE code = ? AND event_id = ? AND guest_id IS NULL').bind(seg[3], e.id).run();
      if (!r.meta.changes) fail(409, 'This link has already been used: remove the guest from the list instead.');
      return json({ ok: true });
    }
    if (seg[2] === 'confirm-all' && method === 'POST') {
      const waiting = (await env.DB.prepare(`SELECT * FROM gl_guests WHERE event_id = ? AND status = 'requested'`).bind(e.id).all()).results;
      const r = await env.DB.prepare(`UPDATE gl_guests SET status = 'confirmed', updated_at = datetime('now') WHERE event_id = ? AND status = 'requested'`).bind(e.id).run();
      if (waiting.length) await later((async () => { for (const g of waiting) await notifyConfirmed(env, e, org, g); })());
      return json({ confirmed: r.meta.changes || 0, emailed: mailEnabled(env) });
    }
    if (seg[2] === 'guests' && seg[3]) {
      const g = await env.DB.prepare('SELECT * FROM gl_guests WHERE id = ? AND event_id = ?').bind(Number(seg[3]), e.id).first();
      if (!g) fail(404, 'That guest is gone.');
      if (method === 'PATCH') {
        const b = await body(request);
        const status = ['requested', 'confirmed', 'declined'].includes(b.status) ? b.status : g.status;
        await env.DB.prepare(`UPDATE gl_guests SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(status, g.id).run();
        if (status === 'confirmed' && g.status !== 'confirmed') await later(notifyConfirmed(env, e, org, g));
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
       WHERE ${UPCOMING} AND (g.id IS NOT NULL OR (e.open = 1 AND e.listed = 1 AND e.org_id IN (SELECT org_id FROM gl_contacts WHERE email = ?1 AND status = 'member')))
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
      const events = access ? (await env.DB.prepare(`SELECT * FROM gl_events e WHERE e.org_id = ? AND (e.listed = 1 OR ${isOwner ? 1 : 0}) AND ${UPCOMING} ORDER BY CASE WHEN e.starts_at = '' THEN 1 ELSE 0 END, e.starts_at`).bind(o.id).all()).results.map(eventShape) : [];
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
    const e = await env.DB.prepare('SELECT e.*, o.name AS org_name, o.kind AS org_kind, o.handle AS org_handle, o.logo AS org_logo, o.theme AS org_theme, o.custom_theme AS org_custom_theme, o.visibility AS org_visibility FROM gl_events e JOIN gl_orgs o ON o.id = e.org_id WHERE e.id = ?').bind(String(seg[1])).first();
    if (!e) fail(404, 'This guestlist does not exist.');
    const shape = { ...eventShape(e), host: { name: e.org_name, kind: e.org_kind, handle: e.org_handle, logo: e.org_logo || '', theme: themeOf(e.org_theme, customOf(e)), custom: customOf(e), visibility: e.org_visibility } };
    delete shape.auto_confirm;
    if (seg.length === 2 && method === 'GET') {
      const t = url.searchParams.get('t');
      let mine = t ? await env.DB.prepare('SELECT * FROM gl_guests WHERE event_id = ? AND token = ?').bind(e.id, t).first() : null;
      if (!mine && person) mine = await env.DB.prepare('SELECT * FROM gl_guests WHERE event_id = ? AND email = ?').bind(e.id, person.email).first();
      // A unique link: how many names it may register, and whether it was used (by this browser or someone else)
      let invite = null;
      const ic = url.searchParams.get('inv');
      if (ic) {
        const iv = await env.DB.prepare('SELECT * FROM gl_invites WHERE code = ? AND event_id = ?').bind(ic, e.id).first();
        if (!iv) fail(404, 'This invitation link does not exist anymore.');
        const owner = iv.guest_id ? await env.DB.prepare('SELECT * FROM gl_guests WHERE id = ?').bind(iv.guest_id).first() : null;
        if (owner && (!mine || mine.id !== owner.id) && t && owner.token === t) mine = owner;
        invite = { code: iv.code, slots: iv.slots, used: !!iv.guest_id, mine: !!owner && !!mine && owner.id === mine.id };
      }
      return json({
        event: shape, invite,
        mine: mine ? { name: mine.name, email: mine.email, plus: mine.plus, names: namesOf(mine), invite_code: mine.invite_code || '', status: mine.status, consent: !!mine.consent, has_account: !!person || !!(await env.DB.prepare('SELECT 1 FROM gl_people WHERE email = ?').bind(mine.email).first()) } : null,
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
      const b = await body(request);
      // Through a unique link: N names, confirmed right away, even when the public list is closed.
      if (b.inv) {
        const iv = await env.DB.prepare('SELECT * FROM gl_invites WHERE code = ? AND event_id = ?').bind(String(b.inv), e.id).first();
        if (!iv) fail(404, 'This invitation link does not exist anymore.');
        const name = str(b.name, 100);
        const email = str(b.email, 160).toLowerCase();
        if (name.length < 2) fail(400, 'Enter your full name.');
        if (!EMAIL_RE.test(email)) fail(400, 'Enter a valid email address.');
        const names = (Array.isArray(b.names) ? b.names : []).map((x) => str(x, 100)).filter(Boolean).slice(0, iv.slots - 1);
        let g = iv.guest_id ? await env.DB.prepare('SELECT * FROM gl_guests WHERE id = ?').bind(iv.guest_id).first() : null;
        if (g && !(b.t && b.t === g.token) && !(person && person.email === g.email)) fail(409, 'This invitation link has already been used.');
        if (g && g.email !== email && await env.DB.prepare('SELECT 1 FROM gl_guests WHERE event_id = ? AND email = ? AND id != ?').bind(e.id, email, g.id).first()) fail(409, 'That email is already on the list.');
        if (!g) g = await env.DB.prepare('SELECT * FROM gl_guests WHERE event_id = ? AND email = ?').bind(e.id, email).first();
        await upsertContact(env, e.org_id, { email, name, status: 'member', source: 'invitation · ' + e.title.slice(0, 60) });
        let t;
        if (g) {
          t = g.token;
          await env.DB.prepare(`UPDATE gl_guests SET name = ?, email = ?, plus = ?, names = ?, invite_code = ?, status = 'confirmed', updated_at = datetime('now') WHERE id = ?`)
            .bind(name, email, names.length, names.join('\n'), iv.code, g.id).run();
        } else {
          t = token();
          g = await env.DB.prepare(`INSERT INTO gl_guests (event_id, name, email, plus, names, invite_code, status, token) VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?) RETURNING *`)
            .bind(e.id, name, email, names.length, names.join('\n'), iv.code, t).first();
          await later(mailRsvp(env, { event: e, org: { id: e.org_id, name: e.org_name, handle: e.org_handle }, guest: { name, email, plus: names.length, status: 'confirmed', token: t } }));
        }
        await env.DB.prepare('UPDATE gl_invites SET guest_id = ? WHERE code = ?').bind(g.id, iv.code).run();
        return json({ status: 'confirmed', token: t });
      }
      if (!e.open) fail(403, 'This guestlist is closed.');
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
      await later(mailRsvp(env, { event: e, org: { id: e.org_id, name: e.org_name, handle: e.org_handle }, guest: { name, email, plus, status: fresh, token: t } }));
      return json({ status: fresh, token: t }, 201);
    }
  }
  // An address: an event id or an organizer's handle
  // rsvp.fm/<handle>/<slug>: the event's readable address
  if (seg[0] === 'resolve' && seg[1] && seg[2] && method === 'GET') {
    const r = await env.DB.prepare('SELECT e.id FROM gl_events e JOIN gl_orgs o ON o.id = e.org_id WHERE o.handle = ? AND e.slug = ?').bind(String(seg[1]).toLowerCase(), String(seg[2]).toLowerCase()).first();
    if (!r) fail(404, 'This event does not exist.');
    return json({ type: 'event', id: r.id });
  }
  if (seg[0] === 'resolve' && seg[1] && method === 'GET') {
    const s = String(seg[1]).toLowerCase();
    if (await env.DB.prepare('SELECT 1 FROM gl_events WHERE id = ?').bind(s).first()) return json({ type: 'event' });
    if (await env.DB.prepare('SELECT 1 FROM gl_orgs WHERE handle = ?').bind(s).first()) return json({ type: 'org' });
    fail(404, 'Nothing here.');
  }
  fail(404, 'Not found.');
}

// rsvp.fm and list.rsvp.fm serve the guestlist; old.rsvp.fm keeps the first version readable.
export function isGuestlistHost(hostname) {
  return !/^old\./i.test(hostname);
}

// Daily (cron): email guests their pending invitations
export async function guestlistDaily(env) {
  await ensureSchema(env);
  const r = await sendDigests(env);
  console.log('guestlist digest', JSON.stringify(r));
  return r;
}

export async function handleGuestlist(request, env, url, ctx) {
  // One-click unsubscribe from mail apps (List-Unsubscribe-Post)
  if (url.pathname === '/prefs' && request.method === 'POST') {
    await ensureSchema(env);
    const e = String(url.searchParams.get('e') || '').toLowerCase(), k = url.searchParams.get('k') || '';
    const r = await env.DB.prepare("UPDATE gl_prefs SET digest = 'never', updated_at = datetime('now') WHERE email = ? AND token = ?").bind(e, k).run();
    return new Response(r.meta.changes ? 'Unsubscribed.' : 'Link not valid.', { status: r.meta.changes ? 200 : 403 });
  }
  if (url.pathname.startsWith('/api/')) {
    try {
      await ensureSchema(env);
      return await api(request, env, url, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Something went wrong on our side. Try again.' }, 500);
    }
  }
  // Static files live in public/gl/; every other path is the app.
  if (/^\/avatars\/\d+\.webp$/.test(url.pathname)) return env.ASSETS.fetch(request);
  const file = /^\/(app\.js|style\.css|favicon\.svg|sw\.js|manifest\.webmanifest|icon-192\.png|icon-512\.png|apple-touch-icon\.png|badge-72\.png)$/.exec(url.pathname);
  const target = new URL(file ? '/gl/' + file[1] : '/gl/', url);
  const res = await env.ASSETS.fetch(new Request(target, request));
  if (file) return res;
  return new Response(res.body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
}
