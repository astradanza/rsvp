// rsvp.fm — Cloudflare Worker: JSON API under /api, static app for everything else.
import { SCHEMA } from './schema.js';

// Create the tables on first use (idempotent), so a plain `wrangler deploy` is enough.
// Columns added after launch: added here if missing (mirrors migrations/0002_invite_links.sql).
const ADDED_COLUMNS = [
  ['users', 'invite_link', 'TEXT'],
  ['users', 'invite_quota', 'INTEGER NOT NULL DEFAULT 10'],
  ['users', 'invited_by', 'INTEGER'],
  ['users', 'ambassador', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'avatar', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'banner', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'claim_token', 'TEXT'],
  ['users', 'account_group', 'INTEGER'],
  ['users', 'notif_seen_at', "TEXT NOT NULL DEFAULT ''"],
  ['events', 'ticket_url', "TEXT NOT NULL DEFAULT ''"],
  ['events', 'image', "TEXT NOT NULL DEFAULT ''"],
  ['events', 'caption', "TEXT NOT NULL DEFAULT ''"],
  ['events', 'visibility', "TEXT NOT NULL DEFAULT 'public'"],
  ['events', 'allow_requests', 'INTEGER NOT NULL DEFAULT 0'],
  ['events', 'gl_token', "TEXT NOT NULL DEFAULT ''"],
  // Two lists per event: the guestlist and friends & family tickets, each with its own link and request switch.
  ['events', 'gl_on', 'INTEGER NOT NULL DEFAULT 1'],
  ['events', 'ff_on', 'INTEGER NOT NULL DEFAULT 0'],
  ['events', 'ff_requests', 'INTEGER NOT NULL DEFAULT 0'],
  ['events', 'ff_token', "TEXT NOT NULL DEFAULT ''"],
  ['rsvps', 'list', "TEXT NOT NULL DEFAULT 'gl'"],
  ['rsvps', 'checked_in_at', "TEXT NOT NULL DEFAULT ''"],
  // Favorite artists, labels and clubs shown on a profile
  ['follows', 'favorite', 'INTEGER NOT NULL DEFAULT 0']
];
// Columns on tables that ensureSchema creates itself, added after those tables exist.
const LATE_COLUMNS = [
  ['guest_requests', 'list', "TEXT NOT NULL DEFAULT 'gl'"],
  ['guest_requests', 'checked_in_at', "TEXT NOT NULL DEFAULT ''"]
];
async function addMissingColumns(env, list) {
  const cols = {};
  for (const t of new Set(list.map(([t]) => t))) {
    cols[t] = new Set((await env.DB.prepare(`PRAGMA table_info(${t})`).all()).results.map((c) => c.name));
  }
  const missing = list.filter(([t, c]) => !cols[t].has(c));
  if (missing.length) await env.DB.batch(missing.map(([t, c, def]) => env.DB.prepare(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`)));
}
let schemaReady = null;
function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
      await addMissingColumns(env, ADDED_COLUMNS);
      await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS users_invite_link ON users(invite_link)').run();
      await env.DB.prepare('CREATE INDEX IF NOT EXISTS users_invited_by ON users(invited_by)').run();
      // Public wall on each profile (migrations/0003_wall.sql)
      await env.DB.batch([
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS wall (id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
        env.DB.prepare('CREATE INDEX IF NOT EXISTS wall_owner ON wall(owner_id, created_at)'),
        // Guestlist requests from people without an account (migrations/0008_simple_events.sql)
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS guest_requests (id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          name TEXT NOT NULL, email TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
        env.DB.prepare('CREATE INDEX IF NOT EXISTS guest_requests_event ON guest_requests(event_id, status)'),
        // Old handles keep redirecting to their owner after a rename (migrations/0006_handle_history.sql)
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS handle_history (handle TEXT PRIMARY KEY COLLATE NOCASE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          changed_at TEXT NOT NULL DEFAULT (datetime('now')))`),
        // Uploaded profile photos and headers (migrations/0004_images.sql)
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY,
          owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
      ]);
      await addMissingColumns(env, LATE_COLUMNS);
    })().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

const SESSION_DAYS = 30;
const DEFAULT_QUOTA = 10;      // sign-ups per personal invite link
const AMBASSADOR_QUOTA = 50;
const LOW_INVITES = 2;         // admins are alerted when a member has this many left or fewer
const RESERVED = new Set([
  'api', 'e', 'new', 'login', 'signup', 'logout', 'discover', 'settings', 'feed', 'about', 'admin',
  'assets', 'static', 'invite', 'invites', 'me', 'help', 'terms', 'privacy', 'rsvp', 'www', 'app',
  'event', 'events', 'post', 'posts', 'search', 'home', 'index', 'favicon', 'robots', 'root', 'support', 'claim', 'avatars', 'img'
]);
const HANDLE_RE = /^[a-z0-9_]{2,24}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const PRESET_RE = /^\/avatars\/(0[1-9]|1[0-6])\.webp$/;
const PRESETS = Array.from({ length: 16 }, (_, i) => `/avatars/${String(i + 1).padStart(2, '0')}.webp`);

// Remove a previously uploaded image when it is replaced (preset avatars are static files, nothing to delete).
async function dropImage(env, me, url) {
  const m = /^\/api\/img\/([a-z0-9]+)$/.exec(url || '');
  if (m) await env.DB.prepare('DELETE FROM images WHERE id = ? AND owner_id = ?').bind(m[1], me.id).run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
    return env.ASSETS.fetch(request);
  }
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });
}

async function body(request) {
  const ct = request.headers.get('content-type') || '';
  if (!ct.includes('application/json')) fail(415, 'Send JSON.');
  try { return await request.json(); } catch { fail(400, 'Invalid JSON.'); }
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const placeholders = (n) => Array.from({ length: n }, () => '?').join(',');

function randomToken(bytes = 32) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomCode(len) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const a = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(a, (x) => alphabet[x % alphabet.length]).join('');
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
  const iterations = 100000;
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(await pbkdf2(password, salt, iterations))}`;
}
async function verifyPassword(password, stored) {
  const [scheme, it, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2') return false;
  const got = new Uint8Array(await pbkdf2(password, unb64(salt), Number(it)));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

// ---------- sessions ----------
function cookieValue(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}
function sessionCookie(token, url, maxAge) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
async function currentUser(request, env) {
  const token = cookieValue(request, 'sid');
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now')`
  ).bind(token).first();
}
async function startSession(env, userId, url) {
  const token = randomToken();
  await env.DB.prepare(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`
  ).bind(token, userId).run();
  return sessionCookie(token, url, SESSION_DAYS * 86400);
}

// ---------- shapes ----------
function publicUser(u) {
  return {
    handle: u.handle, name: u.name, kind: u.kind, bio: u.bio, city: u.city, color: u.color,
    featured: !!u.featured, ambassador: !!u.ambassador, avatar: u.avatar || '', banner: u.banner || ''
  };
}

// Each member has one personal invite link, valid for `invite_quota` sign-ups. Admins have no limit.
async function inviteLinkFor(env, u) {
  if (u.invite_link) return u.invite_link;
  const code = randomCode(8);
  await env.DB.prepare('UPDATE users SET invite_link = ? WHERE id = ? AND invite_link IS NULL').bind(code, u.id).run();
  const row = await env.DB.prepare('SELECT invite_link FROM users WHERE id = ?').bind(u.id).first();
  return row.invite_link;
}
async function inviteStats(env, u) {
  const { used } = await env.DB.prepare('SELECT COUNT(*) AS used FROM users WHERE invited_by = ?').bind(u.id).first();
  const unlimited = !!u.is_admin;
  const quota = u.invite_quota == null ? DEFAULT_QUOTA : u.invite_quota;
  return { used, quota, unlimited, remaining: unlimited ? null : Math.max(0, quota - used) };
}
// Events are an image and a caption. Older events (title, venue, line-up…) get a caption built from their fields.
function captionOf(e) {
  if (e.caption) return e.caption;
  const head = [e.title, e.subtitle].filter(Boolean).join(' — ');
  const where = [e.venue, e.city].filter(Boolean).join(', ');
  return [head, where, e.about, e.lineup ? 'Line-up:\n' + e.lineup : ''].filter(Boolean).join('\n\n');
}
function eventShape(e) {
  return {
    id: e.id, title: e.title, subtitle: e.subtitle, starts_at: e.starts_at, ends_at: e.ends_at,
    venue: e.venue, city: e.city, entry: e.entry, price_cents: e.price_cents, currency: e.currency,
    commission_pct: e.commission_pct, capacity: e.capacity, lineup: e.lineup, about: e.about, color: e.color,
    ticket_url: e.ticket_url || '',
    image: e.image || '', caption: captionOf(e), visibility: e.visibility || 'public', allow_requests: !!e.allow_requests,
    gl_on: e.gl_on == null ? true : !!e.gl_on, ff_on: !!e.ff_on, ff_requests: !!e.ff_requests,
    host: { handle: e.host_handle, name: e.host_name, color: e.host_color, kind: e.host_kind, avatar: e.host_avatar || '' }
  };
}
const EVENT_SELECT = `SELECT e.*, u.handle AS host_handle, u.name AS host_name, u.color AS host_color, u.kind AS host_kind, u.avatar AS host_avatar,
  (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id) AS going
  FROM events e JOIN users u ON u.id = e.host_id`;
// Upcoming = dated in the future (or last 12 hours), or undated and posted in the last 30 days.
const UPCOMING = `(e.starts_at >= strftime('%Y-%m-%dT%H:%M', 'now', '-12 hours')
  OR (e.ends_at LIKE '____-__-__T%' AND e.ends_at >= strftime('%Y-%m-%dT%H:%M', 'now'))
  OR (e.starts_at = '' AND e.created_at >= datetime('now', '-30 days')))`;
const UPCOMING_ORDER = `CASE WHEN e.starts_at = '' THEN 1 ELSE 0 END, e.starts_at, e.created_at DESC`;

async function eventsByIds(env, ids, me) {
  if (!ids.length) return {};
  const rows = (await env.DB.prepare(`${EVENT_SELECT} WHERE e.id IN (${placeholders(ids.length)})`).bind(...ids).all()).results;
  const out = {};
  for (const r of rows) if (r.visibility !== 'private' || (me && me.id === r.host_id)) out[r.id] = eventShape(r);
  if (me) {
    const mine = (await env.DB.prepare(
      `SELECT event_id FROM rsvps WHERE user_id = ? AND event_id IN (${placeholders(ids.length)})`
    ).bind(me.id, ...ids).all()).results;
    for (const m of mine) if (out[m.event_id]) out[m.event_id].is_going = true;
  }
  return out;
}

// rows: { id, text, event_id, created_at, author_id, by_id, at }
async function hydratePosts(env, rows, me) {
  if (!rows.length) return [];
  const userIds = [...new Set(rows.flatMap((r) => [r.author_id, r.by_id]).filter(Boolean))];
  const users = (await env.DB.prepare(`SELECT * FROM users WHERE id IN (${placeholders(userIds.length)})`).bind(...userIds).all()).results;
  const byId = Object.fromEntries(users.map((u) => [u.id, publicUser(u)]));
  const events = await eventsByIds(env, [...new Set(rows.map((r) => r.event_id).filter(Boolean))], me);
  const postIds = [...new Set(rows.map((r) => r.id))];
  const counts = Object.fromEntries((await env.DB.prepare(
    `SELECT post_id, COUNT(*) AS n FROM reposts WHERE post_id IN (${placeholders(postIds.length)}) GROUP BY post_id`
  ).bind(...postIds).all()).results.map((r) => [r.post_id, r.n]));
  let mine = new Set();
  if (me) {
    mine = new Set((await env.DB.prepare(
      `SELECT post_id FROM reposts WHERE user_id = ? AND post_id IN (${placeholders(postIds.length)})`
    ).bind(me.id, ...postIds).all()).results.map((r) => r.post_id));
  }
  return rows.map((r) => ({
    id: r.id, text: r.text, created_at: r.created_at, at: r.at,
    author: byId[r.author_id],
    reposted_by: r.by_id ? byId[r.by_id] : null,
    event: r.event_id ? events[r.event_id] || null : null,
    reposts: counts[r.id] || 0,
    i_reposted: mine.has(r.id),
    mine: !!me && me.id === r.author_id
  }));
}

// The simple event form: an image, a caption, an optional date, public or private, requests on or off.
async function simpleEventFields(env, me, b) {
  const caption = (typeof b.caption === 'string' ? b.caption : '').replace(/\r\n/g, '\n').trim().slice(0, 2000);
  if (!caption) fail(400, 'Write a caption.');
  const starts = str(b.starts_at, 25);
  if (starts && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(starts)) fail(400, 'Pick a valid date and time, or leave it empty.');
  const ends = str(b.ends_at, 25);
  if (ends && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(ends)) fail(400, 'Pick a valid end date and time, or leave it empty.');
  if (ends && !starts) fail(400, 'Add a start date before the end.');
  if (ends && ends.slice(0, 16) <= starts.slice(0, 16)) fail(400, 'The end must be after the start.');
  let image = str(b.image, 80);
  if (image) {
    const m = /^\/api\/img\/([a-z0-9]+)$/.exec(image);
    if (!m || !(await env.DB.prepare('SELECT 1 FROM images WHERE id = ? AND owner_id = ?').bind(m[1], me.id).first())) image = '';
  }
  return {
    caption, image, starts_at: starts ? starts.slice(0, 16) : '', ends_at: ends ? ends.slice(0, 16) : '',
    title: caption.split('\n')[0].slice(0, 80),
    visibility: b.visibility === 'private' ? 'private' : 'public',
    gl_on: b.gl_on ? 1 : 0,
    allow_requests: b.gl_on && b.allow_requests ? 1 : 0,
    ff_on: b.ff_on ? 1 : 0,
    ff_requests: b.ff_on && b.ff_requests ? 1 : 0
  };
}

// Validate an event form (create and edit share it).
function eventFields(b, fallbackColor) {
  const title = str(b.title, 80);
  const starts = str(b.starts_at, 25);
  if (!title) fail(400, 'Give the night a name.');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(starts)) fail(400, 'Pick a start date and time.');
  const entry = b.entry === 'ticket' ? 'ticket' : 'guestlist';
  const ticketUrl = str(b.ticket_url, 300);
  if (ticketUrl && !/^https:\/\/[^\s]+$/.test(ticketUrl)) fail(400, 'The ticket link must start with https://');
  return {
    title, subtitle: str(b.subtitle, 60), starts_at: starts, ends_at: str(b.ends_at, 25),
    venue: str(b.venue, 80), city: str(b.city, 60), entry,
    price_cents: entry === 'ticket' ? Math.max(0, Math.round(Number(b.price) * 100) || 0) : 0,
    currency: ['EUR', 'GBP', 'USD', 'MXN'].includes(b.currency) ? b.currency : 'EUR',
    commission_pct: entry === 'ticket' ? Math.min(50, Math.max(0, Math.round(Number(b.commission_pct) || 0))) : 0,
    capacity: Math.max(0, Math.round(Number(b.capacity) || 0)),
    lineup: (typeof b.lineup === 'string' ? b.lineup : '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join('\n').slice(0, 1000),
    about: str(b.about, 2000),
    color: COLOR_RE.test(b.color || '') ? b.color : fallbackColor,
    ticket_url: entry === 'ticket' ? ticketUrl : ''
  };
}
// Line-up text: one artist per line (older events used " · " or commas on one line).
function lineupNames(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  const parts = t.includes('\n') ? t.split(/\n/) : t.split(/\s*[·,]\s*/);
  return parts.map((s) => s.trim()).filter(Boolean).slice(0, 60);
}

// Notifications are read straight from what happened (follows, reposts, wall, invites, lists, requests);
// nothing is stored except when the person last opened the page.
async function notificationsFor(env, me) {
  const q = (sql, ...args) => env.DB.prepare(sql).bind(...args).all().then((r) => r.results);
  const U = 'u.handle, u.name, u.color, u.avatar, u.kind';
  const [follows, reposts, wall, joined, guests, requests, answered] = await Promise.all([
    q(`SELECT f.created_at AS at, ${U} FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = ? ORDER BY f.created_at DESC LIMIT 40`, me.id),
    q(`SELECT r.created_at AS at, p.id AS post_id, substr(p.text, 1, 80) AS text, ${U} FROM reposts r JOIN posts p ON p.id = r.post_id JOIN users u ON u.id = r.user_id
       WHERE p.author_id = ? ORDER BY r.created_at DESC LIMIT 40`, me.id),
    q(`SELECT w.created_at AS at, substr(w.text, 1, 80) AS text, ${U} FROM wall w JOIN users u ON u.id = w.author_id WHERE w.owner_id = ? AND w.author_id != ? ORDER BY w.created_at DESC LIMIT 40`, me.id, me.id),
    q(`SELECT u.created_at AS at, ${U} FROM users u WHERE u.invited_by = ? ORDER BY u.created_at DESC LIMIT 40`, me.id),
    q(`SELECT r.created_at AS at, r.list, e.id AS event_id, e.title, ${U} FROM rsvps r JOIN events e ON e.id = r.event_id JOIN users u ON u.id = r.user_id
       WHERE e.host_id = ? AND r.user_id != ? ORDER BY r.created_at DESC LIMIT 60`, me.id, me.id),
    q(`SELECT g.created_at AS at, g.list, g.name AS req_name, e.id AS event_id, e.title FROM guest_requests g JOIN events e ON e.id = g.event_id
       WHERE e.host_id = ? AND g.status = 'pending' ORDER BY g.created_at DESC LIMIT 40`, me.id),
    q(`SELECT g.created_at AS at, g.list, e.id AS event_id, e.title FROM guest_requests g JOIN events e ON e.id = g.event_id
       WHERE g.email = ? AND g.status = 'approved' ORDER BY g.created_at DESC LIMIT 20`, me.email)
  ]);
  const who = (r) => ({ handle: r.handle, name: r.name, color: r.color, avatar: r.avatar || '', kind: r.kind });
  const listWord = (l) => (l === 'ff' ? 'took a friends & family ticket for' : l === 'gl' ? 'joined the guestlist for' : 'is going to');
  const items = [
    ...follows.map((r) => ({ at: r.at, actor: who(r), text: 'followed you', link: '/' + r.handle })),
    ...reposts.map((r) => ({ at: r.at, actor: who(r), text: 'reposted: ' + r.text, link: '/' + me.handle })),
    ...wall.map((r) => ({ at: r.at, actor: who(r), text: 'wrote on your wall: ' + r.text, link: '/' + me.handle })),
    ...joined.map((r) => ({ at: r.at, actor: who(r), text: 'joined rsvp.fm with your invite link', link: '/' + r.handle })),
    ...guests.map((r) => ({ at: r.at, actor: who(r), text: listWord(r.list) + ' ' + r.title, link: '/e/' + r.event_id })),
    ...requests.map((r) => ({ at: r.at, actor: null, name: r.req_name, text: 'asks for ' + (r.list === 'ff' ? 'a friends & family ticket' : 'the guestlist') + ' · ' + r.title, link: '/e/' + r.event_id, action: true })),
    ...answered.map((r) => ({ at: r.at, actor: null, name: 'Your request', text: 'was accepted · ' + r.title, link: '/e/' + r.event_id }))
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 80);
  return items;
}

async function userByHandle(env, handle) {
  const h = String(handle).toLowerCase().replace(/^@/, '');
  const u = await env.DB.prepare('SELECT * FROM users WHERE handle = ?').bind(h).first();
  if (u) return u;
  // a renamed account is still found by its old handle (old links and referral links keep working)
  return env.DB.prepare('SELECT u.* FROM handle_history hh JOIN users u ON u.id = hh.user_id WHERE hh.handle = ?').bind(h).first();
}
function requireUser(me) { if (!me) fail(401, 'Log in to do that.'); return me; }

// ---------- API ----------
async function api(request, env, url) {
  const method = request.method;
  const path = url.pathname.replace(/\/+$/, '');
  const seg = path.split('/').slice(2); // after /api
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) fail(403, 'Cross-site request refused.');
  }
  const me = await currentUser(request, env);

  // --- auth ---
  if (path === '/api/session' && method === 'GET') {
    if (!me) return json({ user: null, needs_invite: false });
    const latest = (await notificationsFor(env, me))[0];
    return json({ user: { ...publicUser(me), email: me.email, is_admin: !!me.is_admin }, unread: !!latest && latest.at > (me.notif_seen_at || '') });
  }
  if (path === '/api/signup' && method === 'POST') return signup(request, env, url);
  // Who sent this invite link (landing page of rsvp.fm/i/code)
  if (seg[0] === 'invite' && seg[1] && method === 'GET') {
    const inviter = await env.DB.prepare('SELECT * FROM users WHERE invite_link = ?').bind(String(seg[1]).toLowerCase()).first();
    if (inviter) {
      const st = await inviteStats(env, inviter);
      return json({ inviter: publicUser(inviter), valid: st.unlimited || st.remaining > 0 });
    }
    const code = await env.DB.prepare('SELECT i.*, u.handle, u.name, u.kind, u.bio, u.city, u.color, u.featured, u.ambassador, u.avatar, u.banner FROM invites i JOIN users u ON u.id = i.created_by WHERE i.code = ?').bind(String(seg[1]).toLowerCase()).first();
    if (code) return json({ inviter: publicUser(code), valid: !code.used_by });
    fail(404, 'This invitation link does not exist.');
  }
  if (path === '/api/login' && method === 'POST') {
    const b = await body(request);
    const id = str(b.login, 120).toLowerCase().replace(/^@/, '');
    const u = await env.DB.prepare('SELECT * FROM users WHERE email = ? OR handle = ?').bind(id, id).first();
    if (!u || !(await verifyPassword(String(b.password || ''), u.password_hash))) fail(401, 'Wrong handle, email or password.');
    return json({ user: publicUser(u) }, 200, { 'set-cookie': await startSession(env, u.id, url) });
  }
  if (path === '/api/logout' && method === 'POST') {
    const token = cookieValue(request, 'sid');
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', url, 0) });
  }

  // --- claim a page an admin created (set its password) ---
  if (seg[0] === 'claim' && seg[1]) {
    const u = await env.DB.prepare('SELECT * FROM users WHERE claim_token = ?').bind(seg[1]).first();
    if (!u) fail(404, 'This activation link is not valid or was already used.');
    if (method === 'GET') return json({ user: publicUser(u), email: u.email });
    if (method === 'POST') {
      const b = await body(request);
      const password = String(b.password || '');
      if (password.length < 8) fail(400, 'Use at least 8 characters for your password.');
      await env.DB.prepare('UPDATE users SET password_hash = ?, claim_token = NULL, account_group = NULL WHERE id = ?').bind(await hashPassword(password), u.id).run();
      return json({ user: publicUser(u) }, 200, { 'set-cookie': await startSession(env, u.id, url) });
    }
  }

  // --- linked accounts (switch between pages like on Instagram) ---
  if (seg[0] === 'accounts') {
    requireUser(me);
    if (seg.length === 1 && method === 'GET') {
      const rows = me.account_group
        ? (await env.DB.prepare('SELECT * FROM users WHERE account_group = ? ORDER BY id').bind(me.account_group).all()).results
        : [me];
      return json({ accounts: rows.map((u) => ({ ...publicUser(u), current: u.id === me.id })) });
    }
    // Create a page (a label, a brand, a project, or a page for someone else).
    if (seg.length === 1 && method === 'POST') {
      const b = await body(request);
      const handle = str(b.handle, 24).toLowerCase().replace(/^@/, '');
      const name = str(b.name, 60) || handle;
      const kind = ['member', 'promoter', 'artist', 'club'].includes(b.kind) ? b.kind : 'promoter';
      if (!HANDLE_RE.test(handle)) fail(400, 'Handles use 2 to 24 lowercase letters, digits or underscores.');
      if (RESERVED.has(handle)) fail(400, 'That handle is reserved. Pick another one.');
      let email = str(b.email, 120).toLowerCase();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Enter a valid email address, or leave it empty.');
      if (await env.DB.prepare('SELECT 1 FROM users WHERE handle = ? OR (? != \'\' AND email = ?) UNION SELECT 1 FROM handle_history WHERE handle = ?').bind(handle, email, email, handle).first()) fail(409, 'That handle or email is already taken.');
      if (!email) email = `${handle}.${randomCode(6)}@pages.rsvp.fm`; // placeholder: the page is reached by switching, not by email
      const stats = await inviteStats(env, me);
      if (!stats.unlimited && stats.remaining <= 0) fail(403, 'You have used all your invites, and each new page uses one. Ask us for more.');
      const password = typeof b.password === 'string' ? b.password : '';
      if (password && password.length < 8) fail(400, 'Use at least 8 characters for the password, or leave it empty.');
      const handOver = !!b.hand_over; // created for someone else: give them an activation link
      const token = handOver && !password ? randomToken(24) : null;
      const hash = password ? await hashPassword(password) : '!';
      const group = me.account_group || me.id;
      const palette = ['#E23B2E', '#2F55D4', '#E8A80C', '#1E8C6E', '#9B59D0', '#D23C7A', '#1FA4B4'];
      const u = await env.DB.prepare(
        `INSERT INTO users (handle, email, password_hash, name, kind, color, invite_link, invite_quota, invited_by, avatar, claim_token, account_group)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
      ).bind(handle, email, hash, name, kind, palette[Math.floor(Math.random() * palette.length)], randomCode(8), DEFAULT_QUOTA, me.id,
        PRESETS[Math.floor(Math.random() * PRESETS.length)], token, group).first();
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET account_group = ? WHERE id = ? AND account_group IS NULL').bind(group, me.id),
        env.DB.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)').bind(u.id, me.id),
        env.DB.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)').bind(me.id, u.id)
      ]);
      return json({ user: publicUser(u), claim: token }, 201);
    }
    if (seg[1] === 'switch' && method === 'POST') {
      const b = await body(request);
      const u = await userByHandle(env, b.handle || '');
      if (!u || !me.account_group || u.account_group !== me.account_group) fail(403, 'That account is not linked to yours.');
      const token = cookieValue(request, 'sid');
      if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
      return json({ user: publicUser(u) }, 200, { 'set-cookie': await startSession(env, u.id, url) });
    }
    // Link an existing account you can log in to.
    if (seg[1] === 'link' && method === 'POST') {
      const b = await body(request);
      const id = str(b.login, 120).toLowerCase().replace(/^@/, '');
      const u = await env.DB.prepare('SELECT * FROM users WHERE email = ? OR handle = ?').bind(id, id).first();
      if (!u || !(await verifyPassword(String(b.password || ''), u.password_hash))) fail(401, 'Wrong handle, email or password.');
      if (u.id === me.id) fail(400, 'You are already on this account.');
      const group = me.account_group || me.id;
      await env.DB.prepare(
        'UPDATE users SET account_group = ?1 WHERE id = ?2 OR id = ?3 OR (?4 IS NOT NULL AND account_group = ?4)'
      ).bind(group, me.id, u.id, u.account_group).run();
      const token = cookieValue(request, 'sid');
      if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
      return json({ user: publicUser(u) }, 200, { 'set-cookie': await startSession(env, u.id, url) });
    }
    if (seg[1] === 'unlink' && method === 'POST') {
      await env.DB.prepare('UPDATE users SET account_group = NULL WHERE id = ?').bind(me.id).run();
      return json({ ok: true });
    }
  }

  // --- me ---
  if (path === '/api/me' && method === 'PATCH') {
    requireUser(me);
    const b = await body(request);
    const name = str(b.name, 60) || me.name;
    const bio = typeof b.bio === 'string' ? str(b.bio, 280) : me.bio;
    const city = typeof b.city === 'string' ? str(b.city, 60) : me.city;
    const color = COLOR_RE.test(b.color || '') ? b.color : me.color;
    const kind = ['member', 'promoter', 'artist', 'club'].includes(b.kind) ? b.kind : me.kind;
    let avatar = me.avatar;
    if (typeof b.avatar === 'string' && (b.avatar === '' || PRESET_RE.test(b.avatar))) {
      await dropImage(env, me, me.avatar);
      avatar = b.avatar;
    }
    let banner = me.banner;
    if (b.banner === '') { await dropImage(env, me, me.banner); banner = ''; }
    let handle = me.handle;
    if (typeof b.handle === 'string' && b.handle.trim().toLowerCase().replace(/^@/, '') !== me.handle) {
      const h = b.handle.trim().toLowerCase().replace(/^@/, '');
      if (!HANDLE_RE.test(h)) fail(400, 'Handles use 2 to 24 lowercase letters, digits or underscores.');
      if (RESERVED.has(h)) fail(400, 'That handle is reserved. Pick another one.');
      const taken = await env.DB.prepare(
        `SELECT 1 FROM users WHERE handle = ?1 AND id != ?2
         UNION SELECT 1 FROM handle_history WHERE handle = ?1 AND user_id != ?2`
      ).bind(h, me.id).first();
      if (taken) fail(409, 'That handle is already taken.');
      const recent = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM handle_history WHERE user_id = ? AND changed_at > datetime('now', '-1 day')`
      ).bind(me.id).first();
      if (recent.n >= 3) fail(429, 'You changed your handle several times today. Try again tomorrow.');
      await env.DB.batch([
        env.DB.prepare('DELETE FROM handle_history WHERE handle = ? AND user_id = ?').bind(h, me.id),
        env.DB.prepare(`INSERT OR REPLACE INTO handle_history (handle, user_id, changed_at) VALUES (?, ?, datetime('now'))`).bind(me.handle, me.id)
      ]);
      handle = h;
    }
    await env.DB.prepare('UPDATE users SET handle = ?, name = ?, bio = ?, city = ?, color = ?, kind = ?, avatar = ?, banner = ? WHERE id = ?')
      .bind(handle, name, bio, city, color, kind, avatar, banner, me.id).run();
    return json({ user: publicUser({ ...me, handle, name, bio, city, color, kind, avatar, banner }) });
  }
  // Event images: uploaded first, then attached to the event.
  if (path === '/api/images' && method === 'POST') {
    requireUser(me);
    const b = await body(request);
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(typeof b.data === 'string' ? b.data : '');
    if (!m) fail(400, 'Send a JPEG, PNG or WebP image.');
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    if (bytes.length > 1400 * 1024) fail(413, 'That image is too large. Try a smaller one.');
    const id = randomCode(16);
    await env.DB.prepare('INSERT INTO images (id, owner_id, kind, mime, data) VALUES (?, ?, ?, ?, ?)').bind(id, me.id, 'event', m[1], bytes).run();
    return json({ url: '/api/img/' + id }, 201);
  }
  if (path === '/api/me/image' && method === 'POST') {
    requireUser(me);
    const b = await body(request);
    const kind = b.kind === 'banner' ? 'banner' : 'avatar';
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(typeof b.data === 'string' ? b.data : '');
    if (!m) fail(400, 'Send a JPEG, PNG or WebP image.');
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    if (bytes.length > 900 * 1024) fail(413, 'That image is too large. Try a smaller one.');
    const id = randomCode(16);
    await env.DB.prepare('INSERT INTO images (id, owner_id, kind, mime, data) VALUES (?, ?, ?, ?, ?)').bind(id, me.id, kind, m[1], bytes).run();
    await dropImage(env, me, me[kind]);
    const url = '/api/img/' + id;
    await env.DB.prepare(`UPDATE users SET ${kind} = ? WHERE id = ?`).bind(url, me.id).run();
    return json({ url }, 201);
  }
  if (path === '/api/me/invites' && method === 'GET') {
    requireUser(me);
    const link = await inviteLinkFor(env, me);
    const stats = await inviteStats(env, me);
    const joined = (await env.DB.prepare(
      `SELECT handle, name, color, avatar, created_at FROM users WHERE invited_by = ? ORDER BY created_at DESC`
    ).bind(me.id).all()).results;
    return json({ link, ...stats, joined });
  }
  if (path === '/api/me/invites/regenerate' && method === 'POST') {
    requireUser(me);
    const code = randomCode(8);
    await env.DB.prepare('UPDATE users SET invite_link = ? WHERE id = ?').bind(code, me.id).run();
    return json({ link: code });
  }
  if (path === '/api/me/referrals' && method === 'GET') {
    requireUser(me);
    const rows = (await env.DB.prepare(
      `SELECT e.id, e.title, e.subtitle, e.entry, e.price_cents, e.currency, e.commission_pct, COUNT(r.user_id) AS referred
       FROM rsvps r JOIN events e ON e.id = r.event_id WHERE r.referrer_id = ? GROUP BY e.id ORDER BY MAX(r.created_at) DESC`
    ).bind(me.id).all()).results;
    const items = rows.map((r) => ({
      ...r,
      earned_cents: r.entry === 'ticket' ? Math.round((r.referred * r.price_cents * r.commission_pct) / 100) : 0
    }));
    return json({ items, total_cents: items.reduce((s, i) => s + i.earned_cents, 0), total_referred: items.reduce((s, i) => s + i.referred, 0) });
  }
  if (path === '/api/me/nights' && method === 'GET') {
    requireUser(me);
    const rows = (await env.DB.prepare(
      `${EVENT_SELECT} JOIN rsvps r ON r.event_id = e.id AND r.user_id = ? WHERE ${UPCOMING} ORDER BY ${UPCOMING_ORDER}`
    ).bind(me.id).all()).results;
    return json({ events: rows.map(eventShape) });
  }

  // --- search: pages by name or handle, public upcoming events by caption ---
  if (path === '/api/search' && method === 'GET') {
    const term = (url.searchParams.get('q') || '').trim().replace(/^@/, '').slice(0, 60);
    if (term.length < 1) return json({ users: [], events: [] });
    const like = '%' + term.replace(/[%_]/g, (c) => '\\' + c) + '%';
    const users = (await env.DB.prepare(
      `SELECT u.* FROM users u WHERE (u.handle LIKE ?1 ESCAPE '\\' OR u.name LIKE ?1 ESCAPE '\\' OR u.city LIKE ?1 ESCAPE '\\')
       ORDER BY CASE WHEN u.handle = ?2 THEN 0 WHEN u.handle LIKE ?3 ESCAPE '\\' THEN 1 ELSE 2 END, u.kind != 'member' DESC, u.name LIMIT 25`
    ).bind(like, term.toLowerCase(), term.toLowerCase().replace(/[%_]/g, (c) => '\\' + c) + '%').all()).results;
    const followed = me ? new Set((await env.DB.prepare('SELECT followee_id FROM follows WHERE follower_id = ?').bind(me.id).all()).results.map((r) => r.followee_id)) : new Set();
    const events = (await env.DB.prepare(
      `${EVENT_SELECT} WHERE e.visibility = 'public' AND ${UPCOMING} AND (e.caption LIKE ?1 ESCAPE '\\' OR e.title LIKE ?1 ESCAPE '\\') ORDER BY ${UPCOMING_ORDER} LIMIT 10`
    ).bind(like).all()).results.map(eventShape);
    return json({
      users: users.map((u) => ({ ...publicUser(u), is_following: followed.has(u.id), is_me: !!me && me.id === u.id })),
      events
    });
  }

  // --- suggestions: people followed by the people you follow, then pages of artists and labels ---
  if (path === '/api/suggestions' && method === 'GET') {
    requireUser(me);
    const fof = (await env.DB.prepare(
      `SELECT u.*, COUNT(*) AS n, GROUP_CONCAT(v.name, '|') AS via FROM follows f1
         JOIN follows f2 ON f2.follower_id = f1.followee_id
         JOIN users u ON u.id = f2.followee_id
         JOIN users v ON v.id = f1.followee_id
       WHERE f1.follower_id = ?1 AND u.id != ?1
         AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ?1)
         AND (u.account_group IS NULL OR u.account_group != ?2)
       GROUP BY u.id ORDER BY n DESC, u.kind != 'member' DESC LIMIT 12`
    ).bind(me.id, me.account_group || -1).all()).results;
    const out = fof.map((u) => ({ ...publicUser(u), reason: 'Followed by ' + String(u.via || '').split('|').slice(0, 2).join(' and ') }));
    if (out.length < 12) {
      const seen = new Set(fof.map((u) => u.id));
      const more = (await env.DB.prepare(
        `SELECT u.* FROM users u WHERE u.id != ?1 AND u.kind != 'member'
           AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ?1)
           AND (u.account_group IS NULL OR u.account_group != ?2)
         ORDER BY u.featured DESC, (SELECT COUNT(*) FROM events e WHERE e.host_id = u.id) DESC, u.created_at DESC LIMIT 24`
      ).bind(me.id, me.account_group || -1).all()).results.filter((u) => !seen.has(u.id));
      for (const u of more) { if (out.length >= 12) break; out.push({ ...publicUser(u), reason: u.kind === 'artist' ? 'Artist' : u.kind === 'club' ? 'Club' : 'Label / Promoter' }); }
    }
    return json({ users: out });
  }

  // --- notifications ---
  if (path === '/api/notifications' && method === 'GET') {
    requireUser(me);
    const items = await notificationsFor(env, me);
    const seen = me.notif_seen_at || '';
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await env.DB.prepare('UPDATE users SET notif_seen_at = ? WHERE id = ?').bind(now, me.id).run();
    return json({ items: items.map((i) => ({ ...i, unread: i.at > seen })) });
  }

  // --- invitations: upcoming events you're on a list for, plus public events announced by pages you follow ---
  if (path === '/api/invitations' && method === 'GET') {
    requireUser(me);
    const rows = (await env.DB.prepare(
      `${EVENT_SELECT}
       LEFT JOIN rsvps mine ON mine.event_id = e.id AND mine.user_id = ?1
       WHERE ${UPCOMING} AND (mine.user_id IS NOT NULL OR e.host_id = ?1
         OR (e.visibility = 'public' AND e.host_id IN (SELECT followee_id FROM follows WHERE follower_id = ?1)))
       ORDER BY ${UPCOMING_ORDER} LIMIT 60`
    ).bind(me.id).all()).results;
    // the same SELECT can't expose mine.list next to e.*, so look the lists up separately
    const lists = new Map((await env.DB.prepare('SELECT event_id, list FROM rsvps WHERE user_id = ?').bind(me.id).all()).results.map((r) => [r.event_id, r.list || 'gl']));
    return json({
      events: rows.map((e) => ({ ...eventShape(e), my_list: lists.get(e.id) || '', is_host: e.host_id === me.id }))
    });
  }

  // --- feed ---
  if (path === '/api/feed' && method === 'GET') {
    requireUser(me);
    const before = url.searchParams.get('before') || '9999';
    const rows = (await env.DB.prepare(
      `WITH net AS (SELECT followee_id AS uid FROM follows WHERE follower_id = ?1 UNION SELECT ?1)
       SELECT * FROM (
         SELECT p.id, p.text, p.event_id, p.created_at, p.author_id, NULL AS by_id, p.created_at AS at
           FROM posts p WHERE p.author_id IN (SELECT uid FROM net)
         UNION ALL
         SELECT p.id, p.text, p.event_id, p.created_at, p.author_id, r.user_id AS by_id, r.created_at AS at
           FROM reposts r JOIN posts p ON p.id = r.post_id
           WHERE r.user_id IN (SELECT uid FROM net) AND p.author_id NOT IN (SELECT uid FROM net)
       ) WHERE at < ?2 ORDER BY at DESC LIMIT 40`
    ).bind(me.id, before).all()).results;
    // a post reposted by several people you follow appears once, at its latest repost
    const seen = new Set();
    const unique = rows.filter((r) => (seen.has(r.id) ? false : seen.add(r.id)));
    return json({ items: await hydratePosts(env, unique, me) });
  }

  // --- discover ---
  if (path === '/api/discover' && method === 'GET') {
    const meId = me ? me.id : -1;
    const notFollowed = `u.id != ?1 AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ?1)`;
    let picks = (await env.DB.prepare(
      `SELECT u.* FROM users u WHERE u.featured = 1 AND ${notFollowed} ORDER BY random() LIMIT 8`
    ).bind(meId).all()).results;
    if (picks.length < 4) {
      const more = (await env.DB.prepare(
        `SELECT u.*, (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS n FROM users u
         WHERE u.featured = 0 AND u.kind != 'member' AND ${notFollowed} ORDER BY n DESC LIMIT 8`
      ).bind(meId).all()).results;
      picks = picks.concat(more).slice(0, 8);
    }
    const events = (await env.DB.prepare(
      `${EVENT_SELECT} WHERE e.visibility = 'public' AND ${UPCOMING} ORDER BY ${UPCOMING_ORDER} LIMIT 30`
    ).all()).results.map(eventShape);
    const newcomers = (await env.DB.prepare(
      `SELECT u.* FROM users u WHERE ${notFollowed} ORDER BY u.created_at DESC LIMIT 8`
    ).bind(meId).all()).results;
    return json({ picks: picks.map(publicUser), events, newcomers: newcomers.map(publicUser) });
  }

  // --- users ---
  if (seg[0] === 'users' && seg[1]) {
    const u = await userByHandle(env, seg[1]);
    if (!u) fail(404, 'No one has that handle.');
    if (seg.length === 2 && method === 'GET') {
      const isFollowing = me ? !!(await env.DB.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').bind(me.id, u.id).first()) : false;
      const events = (await env.DB.prepare(
        `${EVENT_SELECT} WHERE e.host_id = ?1 AND (e.visibility = 'public' OR ?1 = ?2) AND ${UPCOMING} ORDER BY ${UPCOMING_ORDER}`
      ).bind(u.id, me ? me.id : -1).all()).results.map(eventShape);
      const isMe = !!me && me.id === u.id;
      // Who they follow, grouped on the page by kind; favorites first. No counts anywhere.
      const following = (await env.DB.prepare(
        `SELECT u.*, f.favorite FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ? ORDER BY f.favorite DESC, f.created_at DESC LIMIT 120`
      ).bind(u.id).all()).results.map((x) => ({ ...publicUser(x), favorite: !!x.favorite }));
      const past = (await env.DB.prepare(
        `${EVENT_SELECT} WHERE e.host_id = ?1 AND (e.visibility = 'public' OR ?1 = ?2) AND e.starts_at != '' AND NOT ${UPCOMING} ORDER BY e.starts_at DESC LIMIT 24`
      ).bind(u.id, me ? me.id : -1).all()).results.map(eventShape);
      const attended = (await env.DB.prepare(
        `${EVENT_SELECT} JOIN rsvps r ON r.event_id = e.id AND r.user_id = ?1
         WHERE (e.visibility = 'public' OR ?2) AND e.starts_at != '' AND NOT ${UPCOMING} ORDER BY e.starts_at DESC LIMIT 24`
      ).bind(u.id, isMe ? 1 : 0).all()).results.map(eventShape);
      const fav = me && !isMe ? await env.DB.prepare('SELECT favorite FROM follows WHERE follower_id = ? AND followee_id = ?').bind(me.id, u.id).first() : null;
      const rows = (await env.DB.prepare(
        `SELECT * FROM (
           SELECT p.id, p.text, p.event_id, p.created_at, p.author_id, NULL AS by_id, p.created_at AS at FROM posts p WHERE p.author_id = ?1
           UNION ALL
           SELECT p.id, p.text, p.event_id, p.created_at, p.author_id, r.user_id AS by_id, r.created_at AS at
             FROM reposts r JOIN posts p ON p.id = r.post_id WHERE r.user_id = ?1
         ) ORDER BY at DESC LIMIT 40`
      ).bind(u.id).all()).results;
      return json({
        user: publicUser(u),
        is_following: isFollowing, is_me: !!me && me.id === u.id,
        is_favorite: !!(fav && fav.favorite),
        events, past, attended, following, posts: await hydratePosts(env, rows, me)
      });
    }
    if (seg[2] === 'favorite') {
      requireUser(me);
      if (me.id === u.id) fail(400, "You can't favorite yourself.");
      if (method === 'POST') {
        await env.DB.prepare('INSERT INTO follows (follower_id, followee_id, favorite) VALUES (?, ?, 1) ON CONFLICT(follower_id, followee_id) DO UPDATE SET favorite = 1').bind(me.id, u.id).run();
      } else if (method === 'DELETE') {
        await env.DB.prepare('UPDATE follows SET favorite = 0 WHERE follower_id = ? AND followee_id = ?').bind(me.id, u.id).run();
      } else fail(405, 'Method not allowed.');
      return json({ favorite: method === 'POST' });
    }
    if (seg[2] === 'follow') {
      requireUser(me);
      if (me.id === u.id) fail(400, "You can't follow yourself.");
      if (method === 'POST') await env.DB.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)').bind(me.id, u.id).run();
      else if (method === 'DELETE') await env.DB.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').bind(me.id, u.id).run();
      else fail(405, 'Method not allowed.');
      return json({ following: method === 'POST' });
    }
  }

  // --- images ---
  if (seg[0] === 'img' && seg[1] && method === 'GET') {
    const img = await env.DB.prepare('SELECT mime, data FROM images WHERE id = ?').bind(seg[1]).first();
    if (!img) return new Response('Not found', { status: 404 });
    return new Response(new Uint8Array(img.data), {
      headers: { 'content-type': img.mime, 'cache-control': 'public, max-age=31536000, immutable' }
    });
  }

  // --- wall ---
  if (seg[0] === 'wall' && seg[1]) {
    const u = await userByHandle(env, seg[1]);
    if (!u) fail(404, 'No one has that handle.');
    if (seg.length === 2 && method === 'GET') {
      const rows = (await env.DB.prepare(
        `SELECT w.id, w.text, w.created_at, w.author_id, a.handle, a.name, a.color, a.kind, a.avatar
         FROM wall w JOIN users a ON a.id = w.author_id WHERE w.owner_id = ? ORDER BY w.created_at DESC, w.id DESC LIMIT 100`
      ).bind(u.id).all()).results;
      return json({
        items: rows.map((r) => ({
          id: r.id, text: r.text, created_at: r.created_at,
          author: { handle: r.handle, name: r.name, color: r.color, kind: r.kind, avatar: r.avatar },
          can_delete: !!me && (me.id === r.author_id || me.id === u.id || !!me.is_admin)
        }))
      });
    }
    if (seg.length === 2 && method === 'POST') {
      requireUser(me);
      const b = await body(request);
      const text = str(b.text, 500);
      if (!text) fail(400, 'Write something first.');
      const recent = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM wall WHERE author_id = ? AND created_at > datetime('now', '-1 minute')`
      ).bind(me.id).first();
      if (recent.n >= 5) fail(429, 'Slow down a little, then try again.');
      await env.DB.prepare('INSERT INTO wall (owner_id, author_id, text) VALUES (?, ?, ?)').bind(u.id, me.id, text).run();
      return json({ ok: true }, 201);
    }
    if (seg.length === 3 && method === 'DELETE') {
      requireUser(me);
      const w = await env.DB.prepare('SELECT * FROM wall WHERE id = ? AND owner_id = ?').bind(Number(seg[2]), u.id).first();
      if (!w) fail(404, 'That message is gone.');
      if (me.id !== w.author_id && me.id !== u.id && !me.is_admin) fail(403, 'Only the author or the page owner can delete this.');
      await env.DB.prepare('DELETE FROM wall WHERE id = ?').bind(w.id).run();
      return json({ ok: true });
    }
  }

  // --- posts ---
  if (path === '/api/posts' && method === 'POST') {
    requireUser(me);
    const b = await body(request);
    const text = str(b.text, 500);
    if (!text) fail(400, 'Write something first.');
    let eventId = null;
    if (b.event_id) {
      const e = await env.DB.prepare('SELECT id FROM events WHERE id = ?').bind(String(b.event_id)).first();
      if (!e) fail(400, 'That event does not exist.');
      eventId = e.id;
    }
    const r = await env.DB.prepare('INSERT INTO posts (author_id, text, event_id) VALUES (?, ?, ?) RETURNING id, created_at')
      .bind(me.id, text, eventId).first();
    return json({ id: r.id }, 201);
  }
  if (seg[0] === 'posts' && seg[1]) {
    requireUser(me);
    const post = await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(Number(seg[1])).first();
    if (!post) fail(404, 'That post is gone.');
    if (seg.length === 2 && method === 'DELETE') {
      if (post.author_id !== me.id && !me.is_admin) fail(403, 'You can only delete your own posts.');
      await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(post.id).run();
      return json({ ok: true });
    }
    if (seg[2] === 'repost') {
      if (post.author_id === me.id) fail(400, 'You already posted this.');
      if (method === 'POST') await env.DB.prepare('INSERT OR IGNORE INTO reposts (post_id, user_id) VALUES (?, ?)').bind(post.id, me.id).run();
      else if (method === 'DELETE') await env.DB.prepare('DELETE FROM reposts WHERE post_id = ? AND user_id = ?').bind(post.id, me.id).run();
      else fail(405, 'Method not allowed.');
      return json({ reposted: method === 'POST' });
    }
  }

  // --- events ---
  if (path === '/api/events' && method === 'POST') {
    requireUser(me);
    if (me.kind === 'member' && !me.is_admin) fail(403, 'Switch your page to Label / Promoter or Artist in Settings to create events.');
    const f = await simpleEventFields(env, me, await body(request));
    const id = randomCode(8);
    await env.DB.prepare(
      `INSERT INTO events (id, host_id, title, starts_at, ends_at, color, image, caption, visibility, allow_requests, gl_token, gl_on, ff_on, ff_requests, ff_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, me.id, f.title, f.starts_at, f.ends_at, me.color, f.image, f.caption, f.visibility, f.allow_requests, randomCode(12),
      f.gl_on, f.ff_on, f.ff_requests, randomCode(12)).run();
    // Public nights are announced to followers; private ones only travel by their guestlist link.
    if (f.visibility === 'public') {
      await env.DB.prepare('INSERT INTO posts (author_id, text, event_id) VALUES (?, ?, ?)').bind(me.id, f.caption.slice(0, 500), id).run();
    }
    return json({ id }, 201);
  }
  if (seg[0] === 'events' && seg[1]) {
    const ev = await env.DB.prepare(`${EVENT_SELECT} WHERE e.id = ?`).bind(seg[1]).first();
    if (!ev) fail(404, 'That event does not exist.');
    const isHost = !!me && (me.id === ev.host_id || !!me.is_admin);
    const key = url.searchParams.get('k') || '';
    // A link opens one list: the guestlist link or the friends & family link.
    const keyList = key && key === ev.gl_token ? 'gl' : key && key === ev.ff_token ? 'ff' : '';
    const hasKey = !!keyList;
    const myRow = me ? await env.DB.prepare('SELECT list FROM rsvps WHERE event_id = ? AND user_id = ?').bind(ev.id, me.id).first() : null;
    const onList = !!myRow;
    // A private night is only visible to its host, its guests, and people holding the guestlist link.
    if (ev.visibility === 'private' && !isHost && !hasKey && !onList && method === 'GET') fail(404, 'That event does not exist.');

    if (seg.length === 2 && method === 'GET') {
      const out = eventShape(ev);
      out.is_host = isHost;
      out.key_list = keyList;
      out.my_list = myRow ? myRow.list : '';
      if (me) out.my_request = await env.DB.prepare(`SELECT list, status FROM guest_requests WHERE event_id = ? AND email = ? AND status != 'declined'`).bind(ev.id, me.email).first() || null;
      if (isHost) {
        if (!ev.gl_token) { ev.gl_token = randomCode(12); await env.DB.prepare('UPDATE events SET gl_token = ? WHERE id = ?').bind(ev.gl_token, ev.id).run(); }
        if (!ev.ff_token) { ev.ff_token = randomCode(12); await env.DB.prepare('UPDATE events SET ff_token = ? WHERE id = ?').bind(ev.ff_token, ev.id).run(); }
        out.gl_token = ev.gl_token;
        out.ff_token = ev.ff_token;
      }
      // Line-up as a list; names that match a page on rsvp.fm link to it.
      const names = lineupNames(ev.lineup);
      const cands = names.map((n) => n.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]/g, ''));
      const found = cands.filter(Boolean).length
        ? (await env.DB.prepare(`SELECT * FROM users WHERE handle IN (${placeholders(cands.filter(Boolean).length)})`).bind(...cands.filter(Boolean)).all()).results
        : [];
      const byHandle = Object.fromEntries(found.map((u) => [u.handle.toLowerCase(), publicUser(u)]));
      out.lineup_list = names.map((n, i) => ({ name: n.replace(/^@/, ''), user: byHandle[cands[i]] || null }));
      if (me) {
        out.is_going = !!(await env.DB.prepare('SELECT 1 FROM rsvps WHERE event_id = ? AND user_id = ?').bind(ev.id, me.id).first());
        out.friends = (await env.DB.prepare(
          `SELECT u.* FROM rsvps r JOIN users u ON u.id = r.user_id
           WHERE r.event_id = ? AND r.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?) LIMIT 6`
        ).bind(ev.id, me.id).all()).results.map(publicUser);
      } else out.friends = [];
      return json({ event: out });
    }
    if (seg.length === 2 && method === 'PATCH') {
      if (!isHost) fail(403, 'Only the host can edit this event.');
      const f = await simpleEventFields(env, me, await body(request));
      await env.DB.prepare(
        `UPDATE events SET title = ?, subtitle = '', starts_at = ?, ends_at = ?, image = ?, caption = ?, visibility = ?, allow_requests = ?,
         gl_on = ?, ff_on = ?, ff_requests = ?, venue = '', city = '', lineup = '', about = '' WHERE id = ?`
      ).bind(f.title, f.starts_at, f.ends_at, f.image, f.caption, f.visibility, f.allow_requests, f.gl_on, f.ff_on, f.ff_requests, ev.id).run();
      if (!ev.gl_token) await env.DB.prepare('UPDATE events SET gl_token = ? WHERE id = ?').bind(randomCode(12), ev.id).run();
      if (!ev.ff_token) await env.DB.prepare('UPDATE events SET ff_token = ? WHERE id = ?').bind(randomCode(12), ev.id).run();
      return json({ id: ev.id });
    }
    if (seg.length === 2 && method === 'DELETE') {
      if (!isHost) fail(403, 'Only the host can delete this event.');
      await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(ev.id).run();
      return json({ ok: true });
    }
    if (seg[2] === 'rsvp') {
      requireUser(me);
      if (method === 'DELETE') {
        await env.DB.prepare('DELETE FROM rsvps WHERE event_id = ? AND user_id = ?').bind(ev.id, me.id).run();
        return json({ going: false });
      }
      if (method !== 'POST') fail(405, 'Method not allowed.');
      const b = await body(request);
      // Friends & family: only with its link. Guestlist: open on public events, link needed on private ones.
      // "going" = simply attending (own ticket, door…); "gl" = guestlist; "ff" = friends & family ticket.
      const list = b.list === 'ff' ? 'ff' : b.list === 'gl' ? 'gl' : 'going';
      const bk = b.k || '';
      if (list === 'going') {
        if (ev.visibility === 'private' && !isHost && bk !== ev.gl_token && bk !== ev.ff_token) fail(403, 'This event is private. Ask the host for the link.');
      } else if (list === 'ff') {
        if (!ev.ff_on) fail(403, 'This event has no friends & family tickets.');
        if (!isHost && bk !== ev.ff_token) fail(403, 'Friends & family tickets are sent by the host. You can request one instead.');
      } else {
        if (!ev.gl_on) fail(403, 'This event has no guestlist.');
        if (ev.visibility === 'private' && !isHost && bk !== ev.gl_token && bk !== ev.ff_token) fail(403, 'This guestlist is private. Ask the host for the link.');
      }
      if (ev.capacity > 0 && ev.going >= ev.capacity) fail(409, 'This night is full.');
      let referrerId = null;
      if (b.ref) {
        const r = await userByHandle(env, b.ref);
        if (r && r.id !== me.id) referrerId = r.id;
      }
      await env.DB.prepare(
        `INSERT INTO rsvps (event_id, user_id, referrer_id, list) VALUES (?, ?, ?, ?)
         ON CONFLICT(event_id, user_id) DO UPDATE SET list = CASE
           WHEN excluded.list = 'ff' OR rsvps.list = 'ff' THEN 'ff'
           WHEN excluded.list = 'gl' OR rsvps.list = 'gl' THEN 'gl' ELSE 'going' END`
      ).bind(ev.id, me.id, referrerId, list).run();
      // Joining through the host's link means you follow the host.
      if ((bk && (bk === ev.gl_token || bk === ev.ff_token)) || list !== 'going') {
        if (me.id !== ev.host_id) await env.DB.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)').bind(me.id, ev.host_id).run();
      }
      return json({ going: true });
    }
    // Someone without an account asks to be on the guestlist; the host approves.
    if (seg[2] === 'request' && method === 'POST') {
      const b = await body(request);
      const list = b.list === 'ff' ? 'ff' : 'gl';
      if (list === 'ff' ? !(ev.ff_on && ev.ff_requests) : !(ev.gl_on && ev.allow_requests)) {
        fail(403, list === 'ff' ? 'This event does not take friends & family requests.' : 'This guestlist does not take requests.');
      }
      if (ev.visibility === 'private' && !isHost && !(b.k && (b.k === ev.gl_token || b.k === ev.ff_token))) fail(403, 'This event is private. Ask the host for the link.');
      const name = me ? me.name + ' (@' + me.handle + ')' : str(b.name, 80);
      const email = me ? me.email : str(b.email, 120).toLowerCase();
      if (!name) fail(400, 'Tell the host your name.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Enter a valid email address.');
      const dup = await env.DB.prepare('SELECT id FROM guest_requests WHERE event_id = ? AND email = ? AND list = ?').bind(ev.id, email, list).first();
      if (dup) return json({ ok: true, already: true });
      const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM guest_requests WHERE event_id = ? AND created_at > datetime('now', '-1 minute')`).bind(ev.id).first();
      if (n > 20) fail(429, 'Too many requests right now. Try again in a minute.');
      await env.DB.prepare('INSERT INTO guest_requests (event_id, name, email, note, list) VALUES (?, ?, ?, ?, ?)').bind(ev.id, name, email, str(b.note, 300), list).run();
      return json({ ok: true }, 201);
    }
    if (seg[2] === 'requests' && seg[3] && method === 'POST') {
      if (!isHost) fail(403, 'Only the host can answer requests.');
      const b = await body(request);
      const status = b.status === 'approved' ? 'approved' : b.status === 'declined' ? 'declined' : 'pending';
      await env.DB.prepare('UPDATE guest_requests SET status = ? WHERE id = ? AND event_id = ?').bind(status, Number(seg[3]), ev.id).run();
      if (status === 'approved') {
        const rq = await env.DB.prepare('SELECT * FROM guest_requests WHERE id = ?').bind(Number(seg[3])).first();
        const member = rq ? await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(rq.email).first() : null;
        if (member) {
          await env.DB.prepare(
            `INSERT INTO rsvps (event_id, user_id, list) VALUES (?, ?, ?) ON CONFLICT(event_id, user_id) DO UPDATE SET list = excluded.list`
          ).bind(ev.id, member.id, rq.list).run();
          await env.DB.prepare('DELETE FROM guest_requests WHERE id = ?').bind(rq.id).run();
        }
      }
      return json({ ok: true, status });
    }
    // Door check-in: the host (or anyone they are logged in as) ticks people off the list.
    if (seg[2] === 'checkin' && method === 'POST') {
      if (!isHost) fail(403, 'Only the host can check people in.');
      const b = await body(request);
      const at = b.on === false ? '' : new Date().toISOString().slice(0, 16).replace('T', ' ');
      if (b.kind === 'request') {
        await env.DB.prepare(`UPDATE guest_requests SET checked_in_at = ? WHERE id = ? AND event_id = ? AND status = 'approved'`).bind(at, Number(b.id), ev.id).run();
      } else {
        const u = await userByHandle(env, b.handle || '');
        if (!u) fail(404, 'No one has that handle.');
        await env.DB.prepare('UPDATE rsvps SET checked_in_at = ? WHERE event_id = ? AND user_id = ?').bind(at, ev.id, u.id).run();
      }
      return json({ checked_in_at: at });
    }
    if (seg[2] === 'guests' && method === 'GET') {
      if (!isHost) fail(403, 'Only the host can see the guestlist.');
      const requests = (await env.DB.prepare(
        `SELECT id, name, email, note, status, list, checked_in_at, created_at FROM guest_requests WHERE event_id = ? AND status != 'declined' ORDER BY created_at`
      ).bind(ev.id).all()).results;
      const guests = (await env.DB.prepare(
        `SELECT u.handle, u.name, u.color, u.avatar, r.list, r.checked_in_at, r.created_at, ref.handle AS ref_handle, ref.name AS ref_name
         FROM rsvps r JOIN users u ON u.id = r.user_id LEFT JOIN users ref ON ref.id = r.referrer_id
         WHERE r.event_id = ? ORDER BY r.created_at`
      ).bind(ev.id).all()).results;
      const byRef = {};
      for (const g of guests) if (g.ref_handle) byRef[g.ref_handle] = (byRef[g.ref_handle] || 0) + 1;
      const referrers = Object.entries(byRef).map(([handle, n]) => ({
        handle, referred: n,
        owed_cents: ev.entry === 'ticket' ? Math.round((n * ev.price_cents * ev.commission_pct) / 100) : 0
      })).sort((a, b) => b.referred - a.referred);
      return json({ guests, referrers, requests });
    }
  }

  // --- admin ---
  if (seg[0] === 'admin') {
    requireUser(me);
    if (!me.is_admin) fail(403, 'Admins only.');
    if (seg[1] === 'invites' && method === 'POST') {
      const b = await body(request);
      const n = Math.min(50, Math.max(1, Number(b.count) || 5));
      const codes = Array.from({ length: n }, () => randomCode(10));
      await env.DB.batch(codes.map((c) => env.DB.prepare('INSERT INTO invites (code, created_by) VALUES (?, ?)').bind(c, me.id)));
      return json({ codes }, 201);
    }
    if (seg[1] === 'feature' && method === 'POST') {
      const b = await body(request);
      const u = await userByHandle(env, b.handle || '');
      if (!u) fail(404, 'No one has that handle.');
      await env.DB.prepare('UPDATE users SET featured = ? WHERE id = ?').bind(b.featured ? 1 : 0, u.id).run();
      return json({ ok: true });
    }
    // Members running low on invites (candidates to become ambassadors) and current ambassadors.
    if (seg[1] === 'ambassadors' && method === 'GET') {
      const rows = (await env.DB.prepare(
        `SELECT u.*, (SELECT COUNT(*) FROM users x WHERE x.invited_by = u.id) AS used
         FROM users u WHERE u.is_admin = 0`
      ).all()).results;
      const shape = (u) => ({ ...publicUser(u), email: u.email, used: u.used, quota: u.invite_quota, remaining: Math.max(0, u.invite_quota - u.used) });
      const low = rows.filter((u) => !u.ambassador && u.used > 0 && u.invite_quota - u.used <= LOW_INVITES).map(shape)
        .sort((a, b) => a.remaining - b.remaining || b.used - a.used);
      const ambassadors = rows.filter((u) => u.ambassador).map(shape).sort((a, b) => b.used - a.used);
      return json({ low, ambassadors, threshold: LOW_INVITES });
    }
    if (seg[1] === 'ambassador' && method === 'POST') {
      const b = await body(request);
      const u = await userByHandle(env, b.handle || '');
      if (!u) fail(404, 'No one has that handle.');
      const on = b.ambassador !== false;
      const quota = on ? Math.max(u.invite_quota, Math.min(1000, Number(b.quota) || AMBASSADOR_QUOTA)) : u.invite_quota;
      await env.DB.prepare('UPDATE users SET ambassador = ?, invite_quota = ? WHERE id = ?').bind(on ? 1 : 0, quota, u.id).run();
      return json({ ok: true, quota });
    }
    if (seg[1] === 'quota' && method === 'POST') {
      const b = await body(request);
      const u = await userByHandle(env, b.handle || '');
      if (!u) fail(404, 'No one has that handle.');
      const add = Math.min(500, Math.max(1, Number(b.add) || 10));
      await env.DB.prepare('UPDATE users SET invite_quota = invite_quota + ? WHERE id = ?').bind(add, u.id).run();
      return json({ ok: true });
    }
  }

  fail(404, 'Not found.');
}

async function signup(request, env, url) {
  const b = await body(request);
  const handle = str(b.handle, 24).toLowerCase().replace(/^@/, '');
  const email = str(b.email, 120).toLowerCase();
  const password = String(b.password || '');
  const name = str(b.name, 60) || handle;
  const kind = ['member', 'promoter', 'artist', 'club'].includes(b.kind) ? b.kind : 'member';
  if (!HANDLE_RE.test(handle)) fail(400, 'Handles use 2 to 24 lowercase letters, digits or underscores.');
  if (RESERVED.has(handle)) fail(400, 'That handle is reserved. Pick another one.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Enter a valid email address.');
  if (password.length < 8) fail(400, 'Use at least 8 characters for your password.');

  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  const first = n === 0;
  let invite = null;   // single-use admin code
  let inviter = null;  // owner of a personal invite link
  let evInvite = null; // an event's guestlist or friends & family link
  if (!first) {
    // Sign-up is by invitation: a personal invite link, a single-use code, or an event's list link.
    const code = str(b.invite, 40).toLowerCase();
    if (code) {
      inviter = await env.DB.prepare('SELECT * FROM users WHERE invite_link = ?').bind(code).first();
      if (inviter) {
        const s = await inviteStats(env, inviter);
        if (!s.unlimited && s.remaining <= 0) fail(403, 'This invitation link has been used up. Ask for a new one.');
      } else {
        invite = await env.DB.prepare('SELECT * FROM invites WHERE code = ? AND used_by IS NULL').bind(code).first();
        if (!invite) fail(403, 'This invitation is not valid anymore.');
      }
    } else if (b.event && b.k) {
      const ev = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(String(b.event)).first();
      const k = String(b.k);
      const list = ev && ev.gl_token && k === ev.gl_token && ev.gl_on ? 'gl' : ev && ev.ff_token && k === ev.ff_token && ev.ff_on ? 'ff' : '';
      if (!list) fail(403, 'This invitation is not valid anymore.');
      evInvite = { ev, list };
      inviter = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(ev.host_id).first();
    } else {
      fail(403, 'rsvp.fm is invitation only. Ask an artist, a club, a label or a friend for their link.');
    }
  }
  if (await env.DB.prepare('SELECT 1 FROM users WHERE handle = ? OR email = ? UNION SELECT 1 FROM handle_history WHERE handle = ?').bind(handle, email, handle).first()) {
    fail(409, 'That handle or email is already taken.');
  }
  const palette = ['#E23B2E', '#2F55D4', '#E8A80C', '#1E8C6E', '#9B59D0', '#D23C7A', '#1FA4B4'];
  const color = COLOR_RE.test(b.color || '') ? b.color : palette[Math.floor(Math.random() * palette.length)];
  const invitedBy = inviter ? inviter.id : (invite ? invite.created_by : null);
  const inviterRow = inviter || (invite ? await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(invite.created_by).first() : null);
  const user = await env.DB.prepare(
    `INSERT INTO users (handle, email, password_hash, name, kind, color, is_admin, featured, invite_link, invite_quota, invited_by, avatar)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
  ).bind(handle, email, await hashPassword(password), name, kind, color, first ? 1 : 0, first ? 1 : 0,
    randomCode(8), DEFAULT_QUOTA, invitedBy, PRESETS[Math.floor(Math.random() * PRESETS.length)]).first();

  const stmts = [];
  if (invite) stmts.push(env.DB.prepare(`UPDATE invites SET used_by = ?, used_at = datetime('now') WHERE code = ?`).bind(user.id, invite.code));
  // You follow whoever invited you. A friend (guest account) follows you back; artists, labels and clubs don't have to.
  if (invitedBy) {
    stmts.push(env.DB.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)').bind(user.id, invitedBy));
    if (inviterRow && inviterRow.kind === 'member') stmts.push(env.DB.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)').bind(invitedBy, user.id));
  }
  // Invited through an event's link: you're on that list.
  if (evInvite) {
    stmts.push(env.DB.prepare(
      `INSERT INTO rsvps (event_id, user_id, list) VALUES (?, ?, ?)
       ON CONFLICT(event_id, user_id) DO UPDATE SET list = CASE WHEN excluded.list = 'ff' OR rsvps.list = 'ff' THEN 'ff' ELSE 'gl' END`
    ).bind(evInvite.ev.id, user.id, evInvite.list));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ user: publicUser(user) }, 201, { 'set-cookie': await startSession(env, user.id, url) });
}
