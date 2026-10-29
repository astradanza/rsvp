// Emails for the guestlist (list.rsvp.fm), sent with Cloudflare Email Service.
// Transactional only: an RSVP received, a confirmation, and a digest of pending invitations for guests
// who chose to join an organizer's page. Nothing is sent until the `EMAIL` send binding exists.
// Each organizer sends from <handle>@rsvp.fm.

const MAIL_DOMAIN = 'rsvp.fm';
const APP = 'https://list.rsvp.fm';

export const mailEnabled = (env) => !!(env && env.EMAIL && typeof env.EMAIL.send === 'function');
const appUrl = (env) => (env && env.GL_URL) || APP;

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

// One sober layout: cream paper, ink, serif. Works in Gmail, Apple Mail and Outlook.
function layout({ kicker, title, lines = [], button, after = [], footer }) {
  const p = (t, style = '') => `<p style="margin:0 0 12px;font:16px/1.55 Georgia,'Times New Roman',serif;color:#1C1B19;${style}">${t}</p>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F2EDE3">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2EDE3"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 0 18px;border-bottom:1px solid #D8D0C1;font:italic 22px Georgia,serif;color:#1C1B19">rsvp<span style="font-style:italic">.fm</span></td></tr>
<tr><td style="padding:28px 0 8px">
${kicker ? `<p style="margin:0 0 10px;font:12px/1.4 Georgia,serif;letter-spacing:2px;text-transform:uppercase;color:#6E685E">${kicker}</p>` : ''}
<h1 style="margin:0 0 18px;font:400 30px/1.15 Georgia,'Times New Roman',serif;color:#1C1B19">${title}</h1>
${lines.map((l) => p(l)).join('\n')}
${button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 8px"><tr><td style="background:#1C1B19"><a href="${esc(button.href)}" style="display:inline-block;padding:14px 26px;font:14px Georgia,serif;letter-spacing:2px;text-transform:uppercase;color:#F2EDE3;text-decoration:none">${esc(button.label)}</a></td></tr></table>` : ''}
${after.map((l) => p(l, 'color:#6E685E;font-size:14px')).join('\n')}
</td></tr>
<tr><td style="padding:22px 0 0;border-top:1px solid #D8D0C1;font:13px/1.5 Georgia,serif;color:#9C9588">${footer || 'Sent by rsvp.fm on behalf of the organizer.'}</td></tr>
</table></td></tr></table></body></html>`;
}
const textOf = ({ title, lines = [], button, after = [], footer }) =>
  [title, '', ...lines.map((l) => l.replace(/<[^>]+>/g, '')), button ? `${button.label}: ${button.href}` : '', '', ...after.map((l) => l.replace(/<[^>]+>/g, '')), '', (footer || '').replace(/<[^>]+>/g, '')].join('\n').replace(/\n{3,}/g, '\n\n').trim();

async function logMail(env, row) {
  await env.DB.prepare('INSERT INTO gl_mail_log (kind, email, event_id, org_id, status, detail) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(row.kind, row.email, row.event_id || null, row.org_id || null, row.status, String(row.detail || '').slice(0, 300)).run();
}

// Send one email; never throws (an email failure must not break an RSVP).
async function send(env, { to, fromHandle, fromName, subject, body, kind, event_id, org_id, unsubscribe }) {
  if (!mailEnabled(env)) return false;
  const msg = {
    to,
    from: { email: `${fromHandle || 'invitations'}@${MAIL_DOMAIN}`, name: fromName ? `${fromName} via rsvp.fm` : 'rsvp.fm' },
    subject,
    html: layout(body),
    text: textOf(body)
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
  const link = `${appUrl(env)}/${event.id}?t=${encodeURIComponent(guest.token)}`;
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
export async function mailConfirmed(env, { event, org, guest }) {
  return mailRsvp(env, { event, org, guest: { ...guest, status: 'confirmed' } });
}

// ---------- daily digest: pending invitations ----------
// For each guest who joined at least one page: new invitations (open upcoming events they haven't answered)
// and, once, a reminder for invitations still waiting when the event is less than three days away.
export async function sendDigests(env, { limit = 2000, now = new Date() } = {}) {
  if (!mailEnabled(env)) return { sent: 0, skipped: 'email off' };
  const nowLocal = now.toISOString().slice(0, 16);
  const soon = new Date(now.getTime() + 72 * 3600 * 1000).toISOString().slice(0, 16);
  const dayAgo = new Date(now.getTime() - 40 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const rows = (await env.DB.prepare(
    `SELECT c.email, MAX(c.name) AS name, e.id, e.title, e.starts_at, e.venue, e.city, o.name AS org_name, o.handle AS org_handle, o.id AS org_id,
       (SELECT MAX(l.created_at) FROM gl_mail_log l WHERE l.email = c.email AND l.event_id = e.id AND l.kind = 'invite' AND l.status = 'sent') AS invited_at,
       EXISTS(SELECT 1 FROM gl_mail_log l WHERE l.email = c.email AND l.event_id = e.id AND l.kind = 'reminder' AND l.status = 'sent') AS reminded
     FROM gl_contacts c
     JOIN gl_events e ON e.org_id = c.org_id AND e.open = 1 AND e.starts_at != '' AND e.starts_at >= ?1
     JOIN gl_orgs o ON o.id = c.org_id
     LEFT JOIN gl_prefs p ON p.email = c.email
     WHERE c.status = 'member' AND c.consent = 1 AND COALESCE(p.digest, 'daily') != 'never'
       AND NOT EXISTS (SELECT 1 FROM gl_guests g WHERE g.event_id = e.id AND g.email = c.email)
     GROUP BY c.email, e.id
     ORDER BY c.email, e.starts_at`
  ).bind(nowLocal).all()).results;
  const weekly = new Set((await env.DB.prepare("SELECT email FROM gl_prefs WHERE digest = 'weekly'").all()).results.map((r) => r.email));
  const isMonday = now.getUTCDay() === 1;
  const byEmail = new Map();
  for (const r of rows) {
    const fresh = !r.invited_at;
    // one reminder, close to the event, and never the day right after the invitation
    const reminder = !!r.invited_at && !r.reminded && r.starts_at <= soon && r.invited_at <= dayAgo;
    if (!fresh && !reminder) continue;
    if (weekly.has(r.email) && !isMonday && !reminder) continue;
    if (!byEmail.has(r.email)) byEmail.set(r.email, { name: r.name, fresh: [], waiting: [] });
    byEmail.get(r.email)[fresh ? 'fresh' : 'waiting'].push(r);
  }
  let sent = 0;
  for (const [email, d] of byEmail) {
    if (sent >= limit) break;
    const p = await prefsFor(env, email);
    const orgs = [...new Set([...d.fresh, ...d.waiting].map((r) => r.org_name))];
    const item = (r) => `<a href="${esc(appUrl(env) + '/' + r.id)}" style="color:#1C1B19"><strong>${esc(r.title)}</strong></a><br><span style="color:#6E685E">${esc(r.org_name)} · ${esc(when(r))}${where(r) ? ' · ' + esc(where(r)) : ''}</span>`;
    const n = d.fresh.length + d.waiting.length;
    const lines = [];
    if (d.fresh.length) lines.push(...d.fresh.map(item));
    if (d.waiting.length) { lines.push(`<span style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#6E685E">Still waiting for your RSVP</span>`); lines.push(...d.waiting.map(item)); }
    const single = n === 1 ? (d.fresh[0] || d.waiting[0]) : null;
    const ok = await send(env, {
      to: email, fromHandle: orgs.length === 1 ? (d.fresh[0] || d.waiting[0]).org_handle : 'invitations', fromName: orgs.length === 1 ? orgs[0] : '',
      kind: 'digest', subject: d.fresh.length
        ? (n === 1 ? `${single.org_name} invites you · ${single.title}` : `${n} invitations waiting · ${orgs.slice(0, 3).join(', ')}`)
        : `Still waiting for your RSVP · ${orgs.slice(0, 3).join(', ')}`,
      unsubscribe: prefsLink(env, p),
      body: {
        kicker: 'Invitations',
        title: n === 1 ? `${esc(orgs[0])} invites you.` : `You have ${n} invitations waiting.`,
        lines,
        button: single ? { label: 'RSVP', href: `${appUrl(env)}/${single.id}` } : { label: 'See my invitations', href: `${appUrl(env)}/me` },
        after: [`From ${esc(orgs.join(', '))}. You receive this because you joined their page on rsvp.fm.`],
        footer: `<a href="${esc(prefsLink(env, p))}" style="color:#9C9588">Email settings or unsubscribe</a>`
      }
    });
    if (!ok) continue;
    sent++;
    const stmts = [];
    for (const r of d.fresh) stmts.push(env.DB.prepare("INSERT INTO gl_mail_log (kind, email, event_id, org_id, status) VALUES ('invite', ?, ?, ?, 'sent')").bind(email, r.id, r.org_id));
    for (const r of d.waiting) stmts.push(env.DB.prepare("INSERT INTO gl_mail_log (kind, email, event_id, org_id, status) VALUES ('reminder', ?, ?, ?, 'sent')").bind(email, r.id, r.org_id));
    if (stmts.length) await env.DB.batch(stmts);
  }
  return { sent, recipients: byEmail.size };
}
