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
  ['users', 'account_group', 'INTEGER']
];
let schemaReady = null;
function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
      const cols = new Set((await env.DB.prepare('PRAGMA table_info(users)').all()).results.map((c) => c.name));
      const missing = ADDED_COLUMNS.filter(([, c]) => !cols.has(c));
      if (missing.length) await env.DB.batch(missing.map(([t, c, def]) => env.DB.prepare(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`)));
      await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS users_invite_link ON users(invite_link)').run();
      await env.DB.prepare('CREATE INDEX IF NOT EXISTS users_invited_by ON users(invited_by)').run();
      // Public wall on each profile (migrations/0003_wall.sql)
      await env.DB.batch([
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS wall (id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
        env.DB.prepare('CREATE INDEX IF NOT EXISTS wall_owner ON wall(owner_id, created_at)'),
        // Uploaded profile photos and headers (migrations/0004_images.sql)
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY,
          owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
      ]);
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
function eventShape(e) {
  return {
    id: e.id, title: e.title, subtitle: e.subtitle, starts_at: e.starts_at, ends_at: e.ends_at,
    venue: e.venue, city: e.city, entry: e.entry, price_cents: e.price_cents, currency: e.currency,
    commission_pct: e.commission_pct, capacity: e.capacity, lineup: e.lineup, about: e.about, color: e.color,
    going: e.going || 0,
    host: { handle: e.host_handle, name: e.host_name, color: e.host_color, kind: e.host_kind, avatar: e.host_avatar || '' }
  };
}
const EVENT_SELECT = `SELECT e.*, u.handle AS host_handle, u.name AS host_name, u.color AS host_color, u.kind AS host_kind, u.avatar AS host_avatar,
  (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id) AS going
  FROM events e JOIN users u ON u.id = e.host_id`;

async function eventsByIds(env, ids, me) {
  if (!ids.length) return {};
  const rows = (await env.DB.prepare(`${EVENT_SELECT} WHERE e.id IN (${placeholders(ids.length)})`).bind(...ids).all()).results;
  const out = {};
  for (const r of rows) out[r.id] = eventShape(r);
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

async function userByHandle(env, handle) {
  return env.DB.prepare('SELECT * FROM users WHERE handle = ?').bind(String(handle).toLowerCase()).first();
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
    if (!me) return json({ user: null, needs_invite: (await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n > 0 });
    return json({ user: { ...publicUser(me), email: me.email, is_admin: !!me.is_admin } });
  }
  if (path === '/api/signup' && method === 'POST') return signup(request, env, url);
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
      const kind = ['member', 'promoter', 'artist'].includes(b.kind) ? b.kind : 'promoter';
      if (!HANDLE_RE.test(handle)) fail(400, 'Handles use 2 to 24 lowercase letters, digits or underscores.');
      if (RESERVED.has(handle)) fail(400, 'That handle is reserved. Pick another one.');
      let email = str(b.email, 120).toLowerCase();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Enter a valid email address, or leave it empty.');
      if (await env.DB.prepare('SELECT 1 FROM users WHERE handle = ? OR (? != \'\' AND email = ?)').bind(handle, email, email).first()) fail(409, 'That handle or email is already taken.');
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
    const kind = ['member', 'promoter', 'artist'].includes(b.kind) ? b.kind : me.kind;
    let avatar = me.avatar;
    if (typeof b.avatar === 'string' && (b.avatar === '' || PRESET_RE.test(b.avatar))) {
      await dropImage(env, me, me.avatar);
      avatar = b.avatar;
    }
    let banner = me.banner;
    if (b.banner === '') { await dropImage(env, me, me.banner); banner = ''; }
    await env.DB.prepare('UPDATE users SET name = ?, bio = ?, city = ?, color = ?, kind = ?, avatar = ?, banner = ? WHERE id = ?')
      .bind(name, bio, city, color, kind, avatar, banner, me.id).run();
    return json({ user: publicUser({ ...me, name, bio, city, color, kind, avatar, banner }) });
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
      `${EVENT_SELECT} JOIN rsvps r ON r.event_id = e.id AND r.user_id = ? ORDER BY e.starts_at`
    ).bind(me.id).all()).results;
    return json({ events: rows.map(eventShape) });
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
      `${EVENT_SELECT} WHERE e.starts_at >= strftime('%Y-%m-%dT%H:%M', 'now', '-12 hours') ORDER BY e.starts_at LIMIT 30`
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
      const counts = await env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM follows WHERE followee_id = ?1) AS followers,
                (SELECT COUNT(*) FROM follows WHERE follower_id = ?1) AS following`
      ).bind(u.id).first();
      const isFollowing = me ? !!(await env.DB.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').bind(me.id, u.id).first()) : false;
      const events = (await env.DB.prepare(
        `${EVENT_SELECT} WHERE e.host_id = ? AND e.starts_at >= strftime('%Y-%m-%dT%H:%M', 'now', '-12 hours') ORDER BY e.starts_at`
      ).bind(u.id).all()).results.map(eventShape);
      const top = (await env.DB.prepare(
        `SELECT u.* FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ? ORDER BY f.created_at LIMIT 8`
      ).bind(u.id).all()).results.map(publicUser);
      const rows = (await env.DB.prepare(
        `SELECT * FROM (
           SELECT p.id, p.text, p.event_id, p.created_at, p.author_id, NULL AS by_id, p.created_at AS at FROM posts p WHERE p.author_id = ?1
           UNION ALL
           SELECT p.id, p.text, p.event_id, p.created_at, p.author_id, r.user_id AS by_id, r.created_at AS at
             FROM reposts r JOIN posts p ON p.id = r.post_id WHERE r.user_id = ?1
         ) ORDER BY at DESC LIMIT 40`
      ).bind(u.id).all()).results;
      return json({
        user: publicUser(u), followers: counts.followers, following: counts.following,
        is_following: isFollowing, is_me: !!me && me.id === u.id,
        events, top8: top, posts: await hydratePosts(env, rows, me)
      });
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
    const b = await body(request);
    const title = str(b.title, 80);
    const starts = str(b.starts_at, 25);
    if (!title) fail(400, 'Give the night a name.');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(starts)) fail(400, 'Pick a start date and time.');
    const entry = b.entry === 'ticket' ? 'ticket' : 'guestlist';
    const price = entry === 'ticket' ? Math.max(0, Math.round(Number(b.price) * 100) || 0) : 0;
    const commission = entry === 'ticket' ? Math.min(50, Math.max(0, Math.round(Number(b.commission_pct) || 0))) : 0;
    const currency = ['EUR', 'GBP', 'USD', 'MXN'].includes(b.currency) ? b.currency : 'EUR';
    const color = COLOR_RE.test(b.color || '') ? b.color : me.color;
    const id = randomCode(8);
    await env.DB.prepare(
      `INSERT INTO events (id, host_id, title, subtitle, starts_at, ends_at, venue, city, entry, price_cents, currency, commission_pct, capacity, lineup, about, color)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, me.id, title, str(b.subtitle, 60), starts, str(b.ends_at, 25), str(b.venue, 80), str(b.city, 60),
      entry, price, currency, commission, Math.max(0, Math.round(Number(b.capacity) || 0)),
      str(b.lineup, 200), str(b.about, 1000), color
    ).run();
    const announce = str(b.announce, 500) || `${title}${b.subtitle ? ' — ' + str(b.subtitle, 60) : ''}. RSVP is open.`;
    await env.DB.prepare('INSERT INTO posts (author_id, text, event_id) VALUES (?, ?, ?)').bind(me.id, announce, id).run();
    return json({ id }, 201);
  }
  if (seg[0] === 'events' && seg[1]) {
    const ev = await env.DB.prepare(`${EVENT_SELECT} WHERE e.id = ?`).bind(seg[1]).first();
    if (!ev) fail(404, 'That event does not exist.');
    const isHost = !!me && (me.id === ev.host_id || !!me.is_admin);

    if (seg.length === 2 && method === 'GET') {
      const out = eventShape(ev);
      out.is_host = isHost;
      if (me) {
        out.is_going = !!(await env.DB.prepare('SELECT 1 FROM rsvps WHERE event_id = ? AND user_id = ?').bind(ev.id, me.id).first());
        out.friends = (await env.DB.prepare(
          `SELECT u.* FROM rsvps r JOIN users u ON u.id = r.user_id
           WHERE r.event_id = ? AND r.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?) LIMIT 6`
        ).bind(ev.id, me.id).all()).results.map(publicUser);
      } else out.friends = [];
      return json({ event: out });
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
      if (ev.capacity > 0 && ev.going >= ev.capacity) fail(409, 'This night is full.');
      let referrerId = null;
      if (b.ref) {
        const r = await userByHandle(env, b.ref);
        if (r && r.id !== me.id) referrerId = r.id;
      }
      await env.DB.prepare('INSERT OR IGNORE INTO rsvps (event_id, user_id, referrer_id) VALUES (?, ?, ?)').bind(ev.id, me.id, referrerId).run();
      return json({ going: true });
    }
    if (seg[2] === 'guests' && method === 'GET') {
      if (!isHost) fail(403, 'Only the host can see the guestlist.');
      const guests = (await env.DB.prepare(
        `SELECT u.handle, u.name, u.color, u.avatar, r.created_at, ref.handle AS ref_handle, ref.name AS ref_name
         FROM rsvps r JOIN users u ON u.id = r.user_id LEFT JOIN users ref ON ref.id = r.referrer_id
         WHERE r.event_id = ? ORDER BY r.created_at`
      ).bind(ev.id).all()).results;
      const byRef = {};
      for (const g of guests) if (g.ref_handle) byRef[g.ref_handle] = (byRef[g.ref_handle] || 0) + 1;
      const referrers = Object.entries(byRef).map(([handle, n]) => ({
        handle, referred: n,
        owed_cents: ev.entry === 'ticket' ? Math.round((n * ev.price_cents * ev.commission_pct) / 100) : 0
      })).sort((a, b) => b.referred - a.referred);
      return json({ guests, referrers });
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
  const kind = ['member', 'promoter', 'artist'].includes(b.kind) ? b.kind : 'member';
  if (!HANDLE_RE.test(handle)) fail(400, 'Handles use 2 to 24 lowercase letters, digits or underscores.');
  if (RESERVED.has(handle)) fail(400, 'That handle is reserved. Pick another one.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Enter a valid email address.');
  if (password.length < 8) fail(400, 'Use at least 8 characters for your password.');

  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  const first = n === 0;
  let invite = null;   // single-use admin code
  let inviter = null;  // owner of a personal invite link
  if (!first) {
    const code = str(b.invite, 40).toLowerCase();
    inviter = code ? await env.DB.prepare('SELECT * FROM users WHERE invite_link = ?').bind(code).first() : null;
    if (inviter) {
      const s = await inviteStats(env, inviter);
      if (!s.unlimited && s.remaining <= 0) fail(403, `@${inviter.handle}'s invite link has been used ${s.quota} times already. Ask them for a new invite.`);
    } else {
      invite = code ? await env.DB.prepare('SELECT * FROM invites WHERE code = ? AND used_by IS NULL').bind(code).first() : null;
      if (!invite) fail(403, 'rsvp.fm is invite-only for now. That invite link is not valid or was already used.');
    }
  }
  if (await env.DB.prepare('SELECT 1 FROM users WHERE handle = ? OR email = ?').bind(handle, email).first()) {
    fail(409, 'That handle or email is already taken.');
  }
  const palette = ['#E23B2E', '#2F55D4', '#E8A80C', '#1E8C6E', '#9B59D0', '#D23C7A', '#1FA4B4'];
  const color = COLOR_RE.test(b.color || '') ? b.color : palette[Math.floor(Math.random() * palette.length)];
  const invitedBy = inviter ? inviter.id : (invite ? invite.created_by : null);
  const user = await env.DB.prepare(
    `INSERT INTO users (handle, email, password_hash, name, kind, color, is_admin, featured, invite_link, invite_quota, invited_by, avatar)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
  ).bind(handle, email, await hashPassword(password), name, kind, color, first ? 1 : 0, first ? 1 : 0,
    randomCode(8), DEFAULT_QUOTA, invitedBy, PRESETS[Math.floor(Math.random() * PRESETS.length)]).first();

  const stmts = [];
  if (invite) stmts.push(env.DB.prepare(`UPDATE invites SET used_by = ?, used_at = datetime('now') WHERE code = ?`).bind(user.id, invite.code));
  // follow whoever invited you, and they follow you back
  if (invitedBy) {
    stmts.push(env.DB.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)').bind(user.id, invitedBy));
    stmts.push(env.DB.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)').bind(invitedBy, user.id));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ user: publicUser(user) }, 201, { 'set-cookie': await startSession(env, user.id, url) });
}
