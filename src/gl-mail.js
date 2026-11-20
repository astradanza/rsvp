// Emails for the guestlist (list.rsvp.fm), sent with Cloudflare Email Service.
// Transactional only: an RSVP received, a confirmation, and a digest of pending invitations for guests
// who chose to join an organizer's page. Nothing is sent until the `EMAIL` send binding exists.
// Each organizer sends from <handle>@rsvp.fm. Push notifications go out alongside (see gl-push.js).
import { pushTo } from './gl-push.js';

const MAIL_DOMAIN = 'rsvp.fm';
const APP = 'https://rsvp.fm';

export const mailEnabled = (env) => !!(env && env.EMAIL && typeof env.EMAIL.send === 'function');
const appUrl = (env) => (env && env.GL_URL) || APP;
// rsvp.fm/<handle>/<slug>, or the short id
const evPath = (handle, e) => (e.slug && handle ? `/${handle}/${e.slug}` : `/${e.id}`);

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function when(e) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(e.starts_at || '');
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], m[2] - 1, +m[3]));
  return `${DAYS[d.getUTCDay()]} ${+m[3]} ${MONTHS[m[2] - 1]}, ${m[4]}:${m[5]}`;
}
const where = (e) => [e.venue, e.city].filter(Boolean).join(', ');

// One plain layout: white, system type, close to a hand-written email. Works in Gmail, Apple Mail and Outlook.
const FONT = "-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif";
function layout({ kicker, title, lines = [], button, after = [], footer }) {
  const p = (t, style = '') => `<p style="margin:0 0 14px;font:15px/1.6 ${FONT};color:#111111;${style}">${t}</p>`;
  return `<!doctype html><html><head><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head><body style="margin:0;padding:0;background:#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff"><tr><td style="padding:28px 20px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td>
${kicker ? `<p style="margin:0 0 6px;font:13px/1.4 ${FONT};color:#8a8a8a">${kicker}</p>` : ''}
<p style="margin:0 0 18px;font:600 19px/1.35 ${FONT};color:#111111">${title}</p>
${lines.map((l) => p(l)).join('\n')}
${button ? `<p style="margin:22px 0 22px"><a href="${esc(button.href)}" style="display:inline-block;padding:10px 18px;background:#111111;border-radius:6px;font:600 14px/1 ${FONT};color:#ffffff;text-decoration:none">${esc(button.label)}</a></p>` : ''}
${after.map((l) => p(l, 'color:#6b6b6b;font-size:14px')).join('\n')}
<p style="margin:26px 0 0;padding-top:14px;border-top:1px solid #eeeeee;font:12px/1.5 ${FONT};color:#9a9a9a">${footer || 'Sent by rsvp.fm on behalf of the organizer.'}</p>
</td></tr></table></td></tr></table></body></html>`;
}
const strip = (l) => l.replace(/<br\s*\/?>|<\/(?:p|div|tr|li|strong|b)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const textOf = ({ title, lines = [], button, after = [], footer }) =>
  [strip(title), '', ...lines.map(strip), button ? `${button.label}: ${button.href}` : '', '', ...after.map(strip), '', strip(footer || '')].join('\n').replace(/\n{3,}/g, '\n\n').trim();

async function logMail(env, row) {
  await env.DB.prepare('INSERT INTO gl_mail_log (kind, email, event_id, org_id, status, detail) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(row.kind, row.email, row.event_id || null, row.org_id || null, row.status, String(row.detail || '').slice(0, 300)).run();
}

// Send one email; never throws (an email failure must not break an RSVP).
async function send(env, { to, fromHandle, fromName, subject, body, raw, kind, event_id, org_id, unsubscribe }) {
  if (!mailEnabled(env)) return false;
  const msg = {
    to,
    from: { email: `${fromHandle || 'invitations'}@${MAIL_DOMAIN}`, name: fromName ? `${fromName} via rsvp.fm` : 'rsvp.fm' },
    subject,
    html: raw ? raw.html : layout(body),
    text: raw ? raw.text : textOf(body)
  };
  if (unsubscribe) msg.headers = { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
  try {
    let r;
    try { r = await env.EMAIL.send(msg); } catch (e) {
      if (msg.headers && /header/i.test(String(e && e.message))) { delete msg.headers; r = await env.EMAIL.send(msg); } else throw e;
    }
    await logMail(env, { kind, email: to, event_id, org_id, status: 'sent', detail: r && r.messageId });
    return true;
  } catch (e) {
    console.error('email failed', kind, e && e.code, e && e.message);
    await logMail(env, { kind, email: to, event_id, org_id, status: 'error', detail: `${e && e.code || ''} ${e && e.message || ''}` }).catch(() => {});
    return false;
  }
}

// ---------- preferences (one per email) ----------
export async function prefsFor(env, email) {
  let p = await env.DB.prepare('SELECT * FROM gl_prefs WHERE email = ?').bind(email).first();
  if (!p) {
    const a = crypto.getRandomValues(new Uint8Array(18));
    const token = btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await env.DB.prepare("INSERT OR IGNORE INTO gl_prefs (email, token, digest) VALUES (?, ?, 'daily')").bind(email, token).run();
    p = await env.DB.prepare('SELECT * FROM gl_prefs WHERE email = ?').bind(email).first();
  }
  return p;
}
const prefsLink = (env, p) => `${appUrl(env)}/prefs?e=${encodeURIComponent(p.email)}&k=${encodeURIComponent(p.token)}`;

// ---------- transactional ----------
export async function mailRsvp(env, { event, org, guest }) {
  const link = `${appUrl(env)}${evPath(org.handle, event)}?t=${encodeURIComponent(guest.token)}`;
  const ok = guest.status === 'confirmed';
  const plus = guest.plus ? ` +${guest.plus}` : '';
  return send(env, {
    to: guest.email, fromHandle: org.handle, fromName: org.name, kind: ok ? 'confirmed' : 'received', event_id: event.id, org_id: org.id,
    subject: ok ? `You're on the list · ${event.title}` : `Request received · ${event.title}`,
    body: {
      kicker: ok ? 'Confirmed' : 'Request sent',
      title: ok ? "You're on the list." : 'Your request is in.',
      lines: [
        `<strong>${esc(event.title)}</strong>${when(event) ? '<br>' + esc(when(event)) : ''}${where(event) ? '<br>' + esc(where(event)) : ''}`,
        `${esc(guest.name)}${esc(plus)}`,
        ok ? 'See you there.' : `${esc(org.name)} will confirm. You will get an email when you are on the list.`
      ],
      button: { label: ok ? 'See the invitation' : 'Check my status', href: link },
      after: ['Keep this email: the button opens your RSVP.'],
      footer: `${esc(org.name)} invited you through rsvp.fm. You receive this email because you RSVP'd.`
    }
  });
}
// A message from the organizer to the guests of one event (the address, the door time…)
// --- admin: a note for each new account, and one recap a day ---
const adminTo = (env) => String(env.ADMIN_EMAIL || 'daniel@astradanza.com').split(',').map((x) => x.trim()).filter(Boolean);
export async function mailAdmin(env, subject, text) {
  if (!mailEnabled(env)) return;
  for (const to of adminTo(env)) {
    await send(env, { to, fromHandle: 'admin', fromName: '', subject, kind: 'admin', raw: { html: `<div style="font:14px/1.6 -apple-system,Helvetica,Arial,sans-serif;color:#111">${linkHtml(text)}</div>`, text } });
  }
}
export async function adminRecap(env) {
  const since = "datetime('now', '-1 day')";
  const all = async (q) => (await env.DB.prepare(q).all()).results;
  const hosts = await all(`SELECT name, handle, email FROM gl_orgs WHERE created_at > ${since} ORDER BY id`);
  const people = await all(`SELECT name, email FROM gl_people WHERE created_at > ${since} ORDER BY id`);
  const events = await all(`SELECT e.title, e.starts_at, e.slug, e.id, e.listed, o.name AS org, o.handle FROM gl_events e JOIN gl_orgs o ON o.id = e.org_id WHERE e.created_at > ${since} ORDER BY e.created_at`);
  const rsvps = await all(`SELECT e.title, o.name AS org, COUNT(*) AS n, SUM(1 + g.plus) AS people, SUM(g.status = 'confirmed') AS confirmed, SUM(g.status = 'requested') AS pending
    FROM gl_guests g JOIN gl_events e ON e.id = g.event_id JOIN gl_orgs o ON o.id = e.org_id WHERE g.created_at > ${since} GROUP BY e.id ORDER BY n DESC`);
  const joins = await all(`SELECT o.name AS org, COUNT(*) AS n FROM gl_contacts c JOIN gl_orgs o ON o.id = c.org_id WHERE c.created_at > ${since} GROUP BY o.id ORDER BY n DESC`);
  const posts = await all(`SELECT o.name AS org, COUNT(*) AS n FROM gl_posts p JOIN gl_orgs o ON o.id = p.org_id WHERE p.created_at > ${since} GROUP BY o.id`);
  const mails = await all(`SELECT status, COUNT(*) AS n FROM gl_mail_log WHERE created_at > ${since} GROUP BY status`);
  const totals = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM gl_orgs) AS hosts, (SELECT COUNT(*) FROM gl_people) AS people, (SELECT COUNT(*) FROM gl_events) AS events, (SELECT COUNT(*) FROM gl_guests) AS rsvps`).first();
  const base = appUrl(env);
  const nRsvp = rsvps.reduce((a, r) => a + r.n, 0), nPeople = rsvps.reduce((a, r) => a + (r.people || 0), 0);
  const L = [];
  L.push(`Last 24 hours on rsvp.fm`);
  L.push(`${nRsvp} RSVP${nRsvp === 1 ? '' : 's'} (${nPeople} people) · ${events.length} new event${events.length === 1 ? '' : 's'} · ${hosts.length} new host${hosts.length === 1 ? '' : 's'} · ${people.length} new guest account${people.length === 1 ? '' : 's'}`);
  if (rsvps.length) { L.push('', 'RSVPs'); rsvps.forEach((r) => L.push(`- ${r.title} (${r.org}): ${r.n} RSVP, ${r.people} people, ${r.confirmed} confirmed${r.pending ? `, ${r.pending} waiting` : ''}`)); }
  if (events.length) { L.push('', 'New events'); events.forEach((e) => L.push(`- ${e.title} by ${e.org}${e.starts_at ? ', ' + e.starts_at.replace('T', ' ') : ''}${e.listed ? '' : ' (link only)'}: ${base}/${e.handle}/${e.slug || e.id}`)); }
  if (hosts.length) { L.push('', 'New hosts'); hosts.forEach((o) => L.push(`- ${o.name} (@${o.handle}) ${o.email}: ${base}/${o.handle}`)); }
  if (people.length) { L.push('', 'New guest accounts'); people.forEach((p) => L.push(`- ${p.name} ${p.email}`)); }
  if (joins.length) { L.push('', 'Community joins'); joins.forEach((j) => L.push(`- ${j.org}: ${j.n}`)); }
  if (posts.length) { L.push('', 'News posted'); posts.forEach((p) => L.push(`- ${p.org}: ${p.n}`)); }
  if (mails.length) { L.push('', 'Emails: ' + mails.map((m) => `${m.n} ${m.status}`).join(', ')); }
  L.push('', `All time: ${totals.hosts} hosts, ${totals.people} guest accounts, ${totals.events} events, ${totals.rsvps} RSVPs.`);
  const d = new Date().toISOString().slice(0, 10);
  await mailAdmin(env, `rsvp.fm · ${d} · ${nRsvp} RSVP, ${events.length} event${events.length === 1 ? '' : 's'}, ${hosts.length + people.length} account${hosts.length + people.length === 1 ? '' : 's'}`, L.join('\n'));
  return { rsvps: nRsvp, events: events.length, hosts: hosts.length, people: people.length };
}
export async function mailReset(env, { to, name, kind, link }) {
  const text = `Hello${name ? ' ' + name : ''},\n\nHere is your link to log in to rsvp.fm${kind === 'guest' ? '' : ' as ' + name} and choose a new password:\n${link}\n\nIt works once, for one hour. If you did not ask for it, ignore this email: nothing changes.`;
  return send(env, { to, fromHandle: 'hello', fromName: '', subject: 'Your rsvp.fm login link', kind: 'reset',
    raw: { html: `<div>${linkHtml(text)}</div>`, text } });
}
// Links in what organizers write: bare https:// addresses, and [text](https://…)
const LINK_RE = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+)/g;
export function linkHtml(t) {
  return esc(String(t)).replace(LINK_RE, (all, label, href, bare) => {
    if (href) return `<a href="${href}">${label}</a>`;
    const m = /^(.*?)([.,;:!?)]*)$/.exec(bare);
    return `<a href="${m[1]}">${m[1]}</a>${m[2]}`;
  }).replace(/\n/g, '<br>');
}
const linkText = (t) => String(t).replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)');
export async function mailMessage(env, { event, org, guest, subject, text, photo }) {
  // A plain, ordinary-looking email: the organizer's words (and a photo), nothing else designed around them
  const link = `${appUrl(env)}${evPath(org.handle, event)}` + (guest.token ? `?t=${encodeURIComponent(guest.token)}` : '');
  const foot = `You receive this because you are on the guestlist of ${event.title}.\nYour invitation: ${link}`;
  const img = photo && /^\/api\/img\/[a-z0-9]+$/.test(photo) ? `<br><br><img src="${appUrl(env)}${photo}" alt="" style="max-width:100%;height:auto">` : '';
  return send(env, {
    to: guest.email, fromHandle: org.handle, fromName: org.name, kind: 'message', event_id: event.id, org_id: org.id,
    subject,
    raw: {
      html: `<div>${linkHtml(text)}${img}</div><br><div style="color:#888;font-size:12px">--<br>${linkHtml(foot)}</div>`,
      text: `${linkText(text)}${img ? `\n\n${appUrl(env)}${photo}` : ''}\n\n--\n${foot}`
    }
  });
}
export async function mailConfirmed(env, { event, org, guest }) {
  return mailRsvp(env, { event, org, guest: { ...guest, status: 'confirmed' } });
}

// Tickets bought: one email with the link to the QR codes
export async function mailTickets(env, { event, org, order, count, typeName, amount }) {
  const link = `${appUrl(env)}/tickets/${encodeURIComponent(order.token)}`;
  const where = [event.venue, event.city].filter(Boolean).map(esc).join(', ');
  return send(env, {
    to: order.email, fromHandle: org.handle, fromName: org.name, kind: 'tickets', event_id: event.id, org_id: org.id,
    subject: `Your ticket${count > 1 ? 's' : ''} · ${event.title}`,
    body: {
      kicker: 'Tickets', title: `${count} ticket${count > 1 ? 's' : ''} for ${esc(event.title)}`,
      lines: [`<strong>${esc(event.title)}</strong>${when(event) ? '<br>' + esc(when(event)) : ''}${where ? '<br>' + where : ''}`, `${esc(typeName)} × ${count} · ${esc(amount)}`,
        'Show the QR code at the door. Each code works once.'],
      button: { label: 'Show my tickets', href: link },
      after: ['Keep this email: the button opens your QR codes.'],
      footer: `${esc(org.name)} sold you these tickets through rsvp.fm. Payment by Stripe.`
    }
  });
}

// ---------- daily digest: pending invitations ----------
// For each guest who joined at least one page: new invitations (open upcoming events they haven't answered)
// and, once, a reminder for invitations still waiting when the event is less than three days away.
export async function sendDigests(env, { limit = 2000, now = new Date() } = {}) {
  const mail = mailEnabled(env);
  const nowLocal = now.toISOString().slice(0, 16);
  const soon = new Date(now.getTime() + 72 * 3600 * 1000).toISOString().slice(0, 16);
  const dayAgo = new Date(now.getTime() - 40 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const rows = (await env.DB.prepare(
    `SELECT c.email, MAX(c.name) AS name, MAX(c.consent) AS consent, COALESCE(MAX(p.digest), 'daily') AS digest,
       EXISTS(SELECT 1 FROM gl_push s WHERE s.email = c.email) AS has_push, e.id, e.slug, e.title, e.starts_at, e.venue, e.city, o.name AS org_name, o.handle AS org_handle, o.id AS org_id,
       (SELECT MAX(l.created_at) FROM gl_mail_log l WHERE l.email = c.email AND l.event_id = e.id AND l.kind = 'invite' AND l.status = 'sent') AS invited_at,
       EXISTS(SELECT 1 FROM gl_mail_log l WHERE l.email = c.email AND l.event_id = e.id AND l.kind = 'reminder' AND l.status = 'sent') AS reminded
     FROM gl_contacts c
     JOIN gl_events e ON e.org_id = c.org_id AND e.open = 1 AND e.listed = 1 AND e.starts_at != '' AND e.starts_at >= ?1
     JOIN gl_orgs o ON o.id = c.org_id
     LEFT JOIN gl_prefs p ON p.email = c.email
     WHERE c.status = 'member'
       AND ((c.consent = 1 AND COALESCE(p.digest, 'daily') != 'never') OR EXISTS(SELECT 1 FROM gl_push s WHERE s.email = c.email))
       AND NOT EXISTS (SELECT 1 FROM gl_guests g WHERE g.event_id = e.id AND g.email = c.email)
     GROUP BY c.email, e.id
     ORDER BY c.email, e.starts_at`
  ).bind(nowLocal).all()).results;
  const isMonday = now.getUTCDay() === 1;
  const byEmail = new Map();
  for (const r of rows) {
    const fresh = !r.invited_at;
    // one reminder, close to the event, and never the day right after the invitation
    const reminder = !!r.invited_at && !r.reminded && r.starts_at <= soon && r.invited_at <= dayAgo;
    if (!fresh && !reminder) continue;
    // email: with consent, as often as they chose; push: whenever they turned it on
    const canMail = mail && !!r.consent && r.digest !== 'never' && (r.digest !== 'weekly' || isMonday || reminder);
    if (!canMail && !r.has_push) continue;
    if (!byEmail.has(r.email)) byEmail.set(r.email, { name: r.name, fresh: [], waiting: [], mail: canMail, push: !!r.has_push });
    byEmail.get(r.email)[fresh ? 'fresh' : 'waiting'].push(r);
  }
  let sent = 0;
  for (const [email, d] of byEmail) {
    if (sent >= limit) break;
    const p = await prefsFor(env, email);
    const orgs = [...new Set([...d.fresh, ...d.waiting].map((r) => r.org_name))];
    const item = (r) => `<a href="${esc(appUrl(env) + evPath(r.org_handle, r))}" style="color:#111111"><strong>${esc(r.title)}</strong></a><br><span style="color:#6b6b6b">${esc(r.org_name)} · ${esc(when(r))}${where(r) ? ' · ' + esc(where(r)) : ''}</span>`;
    const n = d.fresh.length + d.waiting.length;
    const lines = [];
    if (d.fresh.length) lines.push(...d.fresh.map(item));
    if (d.waiting.length) { lines.push(`<span style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#6E685E">Still waiting for your RSVP</span>`); lines.push(...d.waiting.map(item)); }
    const single = n === 1 ? (d.fresh[0] || d.waiting[0]) : null;
    let delivered = false;
    if (d.push) {
      const pushed = await pushTo(env, email, {
        title: d.fresh.length ? (single ? `${single.org_name} invites you` : `${n} invitations waiting`) : 'Still waiting for your RSVP',
        body: single ? `${single.title}${when(single) ? ' · ' + when(single) : ''}` : orgs.slice(0, 3).join(', '),
        url: single ? evPath(single.org_handle, single) : '/me', tag: 'invitations'
      });
      if (pushed) delivered = true;
    }
    const ok = d.mail && await send(env, {
      to: email, fromHandle: orgs.length === 1 ? (d.fresh[0] || d.waiting[0]).org_handle : 'invitations', fromName: orgs.length === 1 ? orgs[0] : '',
      kind: 'digest', subject: d.fresh.length
        ? (n === 1 ? `${single.org_name} invites you · ${single.title}` : `${n} invitations waiting · ${orgs.slice(0, 3).join(', ')}`)
        : `Still waiting for your RSVP · ${orgs.slice(0, 3).join(', ')}`,
      unsubscribe: prefsLink(env, p),
      body: {
        kicker: 'Invitations',
        title: n === 1 ? `${esc(orgs[0])} invites you.` : `You have ${n} invitations waiting.`,
        lines,
        button: single ? { label: 'RSVP', href: `${appUrl(env)}${evPath(single.org_handle, single)}` } : { label: 'See my invitations', href: `${appUrl(env)}/me` },
        after: [`From ${esc(orgs.join(', '))}. You receive this because you joined their page on rsvp.fm.`],
        footer: `<a href="${esc(prefsLink(env, p))}" style="color:#9C9588">Email settings or unsubscribe</a>`
      }
    });
    if (ok) delivered = true;
    if (!delivered) continue;
    sent++;
    const stmts = [];
    for (const r of d.fresh) stmts.push(env.DB.prepare("INSERT INTO gl_mail_log (kind, email, event_id, org_id, status) VALUES ('invite', ?, ?, ?, 'sent')").bind(email, r.id, r.org_id));
    for (const r of d.waiting) stmts.push(env.DB.prepare("INSERT INTO gl_mail_log (kind, email, event_id, org_id, status) VALUES ('reminder', ?, ?, ?, 'sent')").bind(email, r.id, r.org_id));
    if (stmts.length) await env.DB.batch(stmts);
  }
  return { sent, recipients: byEmail.size };
}
