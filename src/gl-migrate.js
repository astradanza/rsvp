// One-time move of the first rsvp.fm (feed, profiles, walls) into the guestlist, run once on first request.
// Artists, labels/promoters and clubs become organizers (same email, password, handle); guests become guest
// accounts; follows become each organizer's community; events keep their id (old links keep working),
// guestlist and friends & family RSVPs become confirmed guests, requests keep their status.
// The old tables are not touched: the old site stays readable on old.rsvp.fm.

const DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ORG_KINDS = { promoter: 'promoter', artist: 'artist', club: 'club' };

export async function migrateV1(env, { freeHandle, code, token, reserved, handleRe }) {
  const db = env.DB;
  if (await db.prepare("SELECT 1 FROM gl_meta WHERE key = 'v1_migrated'").first()) return null;
  // one run at a time: take a lock (released on failure, so a later request retries)
  const lock = await db.prepare("INSERT OR IGNORE INTO gl_meta (key, value) VALUES ('v1_lock', datetime('now'))").run();
  if (!lock.meta.changes) return null;
  try { return await run(env, db, { freeHandle, code, token, reserved, handleRe }); }
  catch (e) { await db.prepare("DELETE FROM gl_meta WHERE key = 'v1_lock'").run(); throw e; }
}

async function run(env, db, { freeHandle, code, token, reserved, handleRe }) {
  const tables = new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).results.map((r) => r.name));
  const mark = (detail) => db.prepare("INSERT OR REPLACE INTO gl_meta (key, value) VALUES ('v1_migrated', ?)").bind(JSON.stringify(detail)).run();
  if (!tables.has('users') || !tables.has('events')) { await mark({ skipped: 'no old tables' }); return null; }

  const users = (await db.prepare('SELECT * FROM users ORDER BY id').all()).results;
  const orgOf = new Map(); // old user id -> gl_orgs id
  const stats = { orgs: 0, merged: 0, people: 0, contacts: 0, events: 0, guests: 0 };

  for (const u of users.filter((x) => ORG_KINDS[x.kind])) {
    const email = String(u.email).toLowerCase();
    const existing = await db.prepare('SELECT id FROM gl_orgs WHERE email = ?').bind(email).first();
    if (existing) { orgOf.set(u.id, existing.id); stats.merged++; await db.prepare('UPDATE gl_orgs SET v1_user_id = COALESCE(v1_user_id, ?) WHERE id = ?').bind(u.id, existing.id).run(); continue; }
    let handle = String(u.handle || '').toLowerCase();
    const taken = !handleRe.test(handle) || reserved.has(handle)
      || await db.prepare('SELECT 1 FROM gl_orgs WHERE handle = ?').bind(handle).first()
      || await db.prepare('SELECT 1 FROM gl_events WHERE id = ?').bind(handle).first();
    if (taken) handle = await freeHandle(env, u.name || u.handle);
    const preset = /^\/avatars\/\d+\.webp$/.test(u.avatar || '') ? u.avatar : '';
    const o = await db.prepare(
      `INSERT INTO gl_orgs (email, password_hash, name, kind, handle, bio, logo, invite_token, v1_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    ).bind(email, u.password_hash, u.name, ORG_KINDS[u.kind], handle, u.bio || '', preset, code(12), u.id, u.created_at).first();
    orgOf.set(u.id, o.id);
    stats.orgs++;
    // an uploaded profile photo becomes the logo
    const m = /^\/api\/img\/([a-z0-9]+)$/.exec(u.avatar || '');
    if (m && tables.has('images')) {
      const img = await db.prepare('SELECT mime, data FROM images WHERE id = ?').bind(m[1]).first();
      if (img) {
        const id = code(16);
        await db.prepare('INSERT INTO gl_images (id, org_id, mime, data) VALUES (?, ?, ?, ?)').bind(id, o.id, img.mime, img.data).run();
        await db.prepare('UPDATE gl_orgs SET logo = ? WHERE id = ?').bind('/api/img/' + id, o.id).run();
      }
    }
  }

  // Everyone else (and their password) becomes a guest account
  const people = users.filter((x) => !ORG_KINDS[x.kind]);
  for (let i = 0; i < people.length; i += 50) {
    await db.batch(people.slice(i, i + 50).map((u) => db.prepare('INSERT OR IGNORE INTO gl_people (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .bind(String(u.email).toLowerCase(), u.name, u.password_hash, u.created_at)));
  }
  stats.people = people.length;

  const byId = new Map(users.map((u) => [u.id, u]));
  const stmts = [];
  // Follows become communities (no email consent: they followed, they did not ask for emails)
  if (tables.has('follows')) {
    const follows = (await db.prepare('SELECT follower_id, followee_id, created_at FROM follows').all()).results;
    for (const f of follows) {
      const orgId = orgOf.get(f.followee_id), u = byId.get(f.follower_id);
      if (!orgId || !u) continue;
      stmts.push(db.prepare(`INSERT OR IGNORE INTO gl_contacts (org_id, email, name, status, consent, source, created_at) VALUES (?, ?, ?, 'member', 0, 'followed on rsvp.fm', ?)`)
        .bind(orgId, String(u.email).toLowerCase(), u.name, f.created_at));
      stats.contacts++;
    }
  }

  // Events keep their id; private ones stay off the organizer's page
  const events = (await db.prepare('SELECT * FROM events').all()).results.filter((e) => orgOf.has(e.host_id));
  const moved = new Set();
  for (const e of events) {
    if (await db.prepare('SELECT 1 FROM gl_events WHERE id = ?').bind(e.id).first()) continue;
    const caption = String(e.caption || '').trim();
    const first = caption.split('\n')[0].trim();
    const title = (e.title || first || 'Event').slice(0, 120);
    let details = caption;
    if (first && first === title) details = caption.split('\n').slice(1).join('\n').trim();
    if (!caption) details = [e.subtitle, [e.venue, e.city].filter(Boolean).join(', '), e.about, e.lineup ? 'Line-up:\n' + e.lineup : ''].filter(Boolean).join('\n\n');
    const starts = DT_RE.test(e.starts_at || '') ? e.starts_at.slice(0, 16) : '';
    const ends = starts && DT_RE.test(e.ends_at || '') && e.ends_at.slice(0, 16) > starts ? e.ends_at.slice(0, 16) : '';
    stmts.push(db.prepare(
      `INSERT OR IGNORE INTO gl_events (id, org_id, title, starts_at, ends_at, venue, city, details, plus_max, auto_confirm, open, listed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 1, ?, ?)`
    ).bind(e.id, orgOf.get(e.host_id), title, starts, ends, caption ? '' : (e.venue || ''), caption ? '' : (e.city || ''), details.slice(0, 4000), e.visibility === 'private' ? 0 : 1, e.created_at));
    moved.add(e.id);
    stats.events++;
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));

  // Guestlist and friends & family become confirmed guests; requests keep their status
  const guestStmts = [];
  if (tables.has('rsvps') && moved.size) {
    const rsvps = (await db.prepare(`SELECT r.event_id, r.user_id, r.list, r.created_at FROM rsvps r WHERE r.list IN ('gl', 'ff')`).all()).results;
    for (const r of rsvps) {
      const u = byId.get(r.user_id);
      if (!moved.has(r.event_id) || !u) continue;
      guestStmts.push(db.prepare(`INSERT OR IGNORE INTO gl_guests (event_id, name, email, plus, status, token, created_at) VALUES (?, ?, ?, 0, 'confirmed', ?, ?)`)
        .bind(r.event_id, u.name, String(u.email).toLowerCase(), token(), r.created_at));
      const orgId = orgOf.get(events.find((e) => e.id === r.event_id).host_id);
      guestStmts.push(db.prepare(`INSERT OR IGNORE INTO gl_contacts (org_id, email, name, status, consent, source) VALUES (?, ?, ?, 'member', 0, 'rsvp on rsvp.fm')`)
        .bind(orgId, String(u.email).toLowerCase(), u.name));
      stats.guests++;
    }
  }
  if (tables.has('guest_requests') && moved.size) {
    const reqs = (await db.prepare('SELECT * FROM guest_requests').all()).results;
    for (const r of reqs) {
      if (!moved.has(r.event_id)) continue;
      const status = r.status === 'approved' ? 'confirmed' : r.status === 'declined' ? 'declined' : 'requested';
      guestStmts.push(db.prepare(`INSERT OR IGNORE INTO gl_guests (event_id, name, email, plus, status, token, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)`)
        .bind(r.event_id, r.name, String(r.email).toLowerCase(), status, token(), r.created_at));
      stats.guests++;
    }
  }
  for (let i = 0; i < guestStmts.length; i += 50) await db.batch(guestStmts.slice(i, i + 50));

  await mark({ at: new Date().toISOString(), ...stats });
  return stats;
}
