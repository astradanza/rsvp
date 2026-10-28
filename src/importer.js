// Import an event from a ticketing page (Resident Advisor, Shotgun, DICE, Eventbrite, Ticket Fairy…).
// Reads, in order: Resident Advisor's public GraphQL API, schema.org Event data (JSON-LD), Next.js page data,
// then Open Graph tags. Returns fields for the event form; the image stays hosted where it is.

const SOURCES = [
  [/(^|\.)ra\.co$/, 'Resident Advisor'],
  [/(^|\.)residentadvisor\.net$/, 'Resident Advisor'],
  [/(^|\.)shotgun\.live$/, 'Shotgun'],
  [/(^|\.)dice\.fm$/, 'DICE'],
  [/(^|\.)link\.dice\.fm$/, 'DICE'],
  [/(^|\.)eventbrite\.[a-z.]+$/, 'Eventbrite'],
  [/(^|\.)ticketfairy\.com$/, 'Ticket Fairy'],
  [/(^|\.)xceed\.me$/, 'Xceed'],
  [/(^|\.)fever(up)?\.com$/, 'Fever'],
  [/(^|\.)songkick\.com$/, 'Songkick'],
  [/(^|\.)bandsintown\.com$/, 'Bandsintown'],
  [/(^|\.)facebook\.com$/, 'Facebook'],
  [/(^|\.)partiful\.com$/, 'Partiful'],
  [/(^|\.)lu\.ma$/, 'Luma'],
  [/(^|\.)posh\.vip$/, 'Posh'],
  [/(^|\.)weezevent\.com$/, 'Weezevent'],
  [/(^|\.)billetweb\.fr$/, 'Billetweb'],
  [/(^|\.)skiddle\.com$/, 'Skiddle'],
  [/(^|\.)fatsoma\.com$/, 'Fatsoma'],
  [/(^|\.)boletia\.com$/, 'Boletia'],
  [/(^|\.)passline\.com$/, 'Passline']
];
export function sourceName(host) {
  host = String(host || '').toLowerCase().replace(/^www\./, '');
  for (const [re, name] of SOURCES) if (re.test(host)) return name;
  return host;
}

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

export function checkUrl(raw) {
  let u;
  let t = String(raw || '').trim();
  if (t && !/^[a-z]+:\/\//i.test(t) && /^[\w-]+(\.[\w-]+)+\//.test(t)) t = 'https://' + t;
  try { u = new URL(t); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const h = u.hostname.toLowerCase();
  // public hosts only
  if (!h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':') || /(^|\.)(localhost|local|internal)$/.test(h)) return null;
  u.protocol = 'https:';
  u.hash = '';
  return u;
}

const decode = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const stripHtml = (s) => decode(String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n\n').replace(/<[^>]+>/g, ''))
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// "2026-02-20T23:00:00+01:00" → "2026-02-20T23:00" (the local time of the event)
function localTime(v) {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(String(v || ''));
  return m ? m[1] + 'T' + m[2] : '';
}

function meta(html, name) {
  const re = new RegExp('<meta[^>]+(?:property|name)=["\']' + name.replace(/[:.]/g, '\\$&') + '["\'][^>]*>', 'i');
  const tag = re.exec(html);
  if (!tag) return '';
  const c = /content=["']([^"']*)["']/i.exec(tag[0]) || /content=([^\s>]+)/i.exec(tag[0]);
  return c ? decode(c[1]).trim() : '';
}

function findEvent(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findEvent(n, depth + 1); if (r) return r; } return null; }
  const t = [].concat(node['@type'] || []).join(' ');
  if (/Event\b/.test(t) && (node.startDate || node.name)) return node;
  if (node['@graph']) return findEvent(node['@graph'], depth + 1);
  for (const k of Object.keys(node)) { if (node[k] && typeof node[k] === 'object') { const r = findEvent(node[k], depth + 1); if (r) return r; } }
  return null;
}
function jsonLdEvent(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { const ev = findEvent(JSON.parse(m[1].trim())); if (ev) return ev; } catch { /* not JSON */ }
  }
  return null;
}
const first = (v) => (Array.isArray(v) ? v[0] : v);
const imageOf = (v) => { v = first(v); return typeof v === 'string' ? v : v && (v.url || v.contentUrl) || ''; };

// Clean "Name at Venue, City ⟋ RA" / "Name, Paris · Tickets Shotgun" / "Name Tickets | DICE"
function cleanTitle(t, source) {
  t = String(t || '').trim();
  t = t.replace(/\s*[⟋|·–—-]\s*(RA|Resident Advisor|DICE|Shotgun|Eventbrite|Ticket ?Fairy|Xceed|Fever)\b.*$/i, '');
  t = t.replace(/\s*[·|]\s*(Tickets?|Billets?|Bilhetes|Entradas|Boletos)\b.*$/i, '');
  t = t.replace(/\s+(Tickets?|Billets?)$/i, '');
  return t.trim();
}

export function parseHtml(html, pageUrl) {
  const url = new URL(pageUrl);
  const source = sourceName(url.hostname);
  const out = { title: '', venue: '', city: '', starts_at: '', ends_at: '', image: '', description: '', lineup: [], ticket_url: pageUrl, source };
  const ev = jsonLdEvent(html);
  if (ev) {
    out.title = decode(ev.name || '');
    out.starts_at = localTime(ev.startDate);
    out.ends_at = localTime(ev.endDate);
    out.image = imageOf(ev.image);
    out.description = stripHtml(ev.description || '');
    const loc = first(ev.location);
    if (loc && typeof loc === 'object') {
      out.venue = decode(loc.name || '');
      const a = loc.address;
      out.city = decode(typeof a === 'object' && a ? a.addressLocality || '' : '');
    }
    const perf = [].concat(ev.performer || []).map((p) => (typeof p === 'string' ? p : p && p.name)).filter(Boolean);
    out.lineup = perf.map(decode);
  }
  // Next.js page data: look for an object with a start time
  if (!out.starts_at) {
    const nd = /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
    if (nd) {
      try {
        const seen = new Set();
        const walk = (n, d) => {
          if (!n || typeof n !== 'object' || d > 12 || seen.has(n)) return null;
          seen.add(n);
          if (!Array.isArray(n)) {
            const s = n.startTime || n.startDate || n.startsAt || n.start_time || n.beginsAt;
            if (s && /^\d{4}-\d{2}-\d{2}/.test(String(s)) && (n.title || n.name)) return n;
          }
          for (const k of Object.keys(n)) { const r = walk(n[k], d + 1); if (r) return r; }
          return null;
        };
        const n = walk(JSON.parse(nd[1]), 0);
        if (n) {
          out.title = out.title || decode(n.title || n.name || '');
          out.starts_at = localTime(n.startTime || n.startDate || n.startsAt || n.start_time || n.beginsAt);
          out.ends_at = out.ends_at || localTime(n.endTime || n.endDate || n.endsAt || n.end_time || n.finishesAt);
          const v = n.venue || n.place || n.location;
          if (v && typeof v === 'object') { out.venue = out.venue || decode(v.name || ''); const c = v.city || v.area; out.city = out.city || decode(typeof c === 'object' && c ? c.name || '' : c || ''); }
        }
      } catch { /* ignore */ }
    }
  }
  const ogTitle = meta(html, 'og:title') || meta(html, 'twitter:title') || decode((/<title[^>]*>([^<]*)<\/title>/i.exec(html) || [])[1] || '');
  out.title = out.title || cleanTitle(ogTitle, source);
  out.image = out.image || meta(html, 'og:image') || meta(html, 'twitter:image');
  out.description = out.description || meta(html, 'og:description') || meta(html, 'description');
  out.starts_at = out.starts_at || localTime(meta(html, 'event:start_time'));
  out.ends_at = out.ends_at || localTime(meta(html, 'event:end_time'));
  // "Name at Venue, City" (RA titles) when no venue came from structured data
  if (!out.venue) {
    const m = /^(.*) at ([^,]+), (.+)$/.exec(cleanTitle(ogTitle, source));
    if (m) { out.title = out.title === cleanTitle(ogTitle, source) ? m[1] : out.title; out.venue = m[2]; out.city = m[3]; }
  }
  if (out.image) { try { out.image = new URL(out.image, url).href; } catch { out.image = ''; } }
  if (!/^https:\/\//.test(out.image)) out.image = '';
  return out;
}

// Resident Advisor: its pages carry no date in their tags, so ask its public GraphQL API first.
async function fromRA(id, pageUrl) {
  const q = (fields) => fetch('https://ra.co/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA, referer: pageUrl, 'ra-content-language': 'en' },
    body: JSON.stringify({ operationName: 'GET_EVENT', variables: { id: String(id) }, query: `query GET_EVENT($id: ID!) { event(id: $id) { ${fields} } }` }),
    signal: AbortSignal.timeout(8000)
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  let j = await q('id title date startTime endTime content lineup venue { name area { name } } images { filename } artists { name }');
  if (!j || !j.data || !j.data.event) j = await q('id title startTime endTime content venue { name } images { filename }');
  const e = j && j.data && j.data.event;
  if (!e) return null;
  const img = (e.images || []).map((i) => i && i.filename).find(Boolean) || '';
  return {
    title: decode(e.title || ''), venue: decode(e.venue && e.venue.name || ''), city: decode(e.venue && e.venue.area && e.venue.area.name || ''),
    starts_at: localTime(e.startTime || e.date), ends_at: localTime(e.endTime),
    image: /^https:\/\//.test(img) ? img : img ? 'https://images.ra.co/' + img.replace(/^\//, '') : '',
    description: stripHtml(e.content || ''),
    lineup: (e.artists || []).map((a) => a && decode(a.name)).filter(Boolean),
    ticket_url: pageUrl, source: 'Resident Advisor'
  };
}

export async function importEvent(raw) {
  const url = checkUrl(raw);
  if (!url) throw new Error('Paste the full link of the event page (https://…).');
  const pageUrl = url.href;
  const ra = /(^|\.)ra\.co$/.test(url.hostname) && /\/events\/(\d+)/.exec(url.pathname);
  let data = ra ? await fromRA(ra[1], 'https://ra.co/events/' + ra[1]) : null;
  if (!data || !data.starts_at) {
    let html = '';
    try {
      const r = await fetch(pageUrl, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en' }, redirect: 'follow', signal: AbortSignal.timeout(9000) });
      if (r.ok && /html/i.test(r.headers.get('content-type') || 'text/html')) html = (await r.text()).slice(0, 3000000);
    } catch { /* unreachable */ }
    if (html) {
      const p = parseHtml(html, pageUrl);
      data = data ? { ...p, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v && (!Array.isArray(v) || v.length))) } : p;
    }
  }
  if (!data || !data.title) throw new Error(sourceName(url.hostname) + ' did not let us read this page. Fill the event in by hand, and paste the link in "Tickets / more info".');
  return data;
}

// Turn imported fields into a caption for rsvp.fm's simple events.
export function captionFrom(d) {
  const where = [d.venue, d.city].filter(Boolean).join(', ');
  const parts = [d.title, where].filter(Boolean).join('\n');
  let desc = String(d.description || '').trim();
  if (desc.length > 900) desc = desc.slice(0, 900).replace(/\s+\S*$/, '') + '…';
  const lineup = (d.lineup || []).slice(0, 30);
  // skip the line-up when the description already lists it
  const showLineup = lineup.length && !lineup.every((n) => desc.toLowerCase().includes(n.toLowerCase()));
  return [parts, showLineup ? 'Line-up:\n' + lineup.join('\n') : '', desc].filter(Boolean).join('\n\n').slice(0, 2000);
}
