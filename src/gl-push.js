// Web push for the guestlist: no app to install. Browsers (and iPhones with rsvp.fm on the home screen)
// subscribe through the service worker; we encrypt each message (RFC 8291, aes128gcm) and sign it
// with our VAPID key (RFC 8292). The key pair is created once and kept in gl_meta.

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
// HKDF-SHA256 for outputs up to 32 bytes
async function hkdf(salt, ikm, info, length) {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

// Push services we deliver to (the subscription endpoint comes from the browser)
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;
export function validSubscription(sub) {
  try {
    const u = new URL(sub.endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.test(u.hostname) && unb64u(sub.keys.p256dh).length === 65 && unb64u(sub.keys.auth).length === 16;
  } catch { return false; }
}

export async function vapidKeys(env) {
  const row = await env.DB.prepare("SELECT value FROM gl_meta WHERE key = 'vapid'").first();
  if (row) return JSON.parse(row.value);
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const keys = { publicKey: b64u(await crypto.subtle.exportKey('raw', pair.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey) };
  await env.DB.prepare("INSERT OR IGNORE INTO gl_meta (key, value) VALUES ('vapid', ?)").bind(JSON.stringify(keys)).run();
  // another request may have created them first: always use the stored pair
  return JSON.parse((await env.DB.prepare("SELECT value FROM gl_meta WHERE key = 'vapid'").first()).value);
}

export async function vapidAuth(keys, endpoint) {
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:hello@rsvp.fm' })));
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(header + '.' + claims));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

// RFC 8291: one aes128gcm record
export async function encryptPayload(p256dh, authSecret, payload) {
  const uaPublic = unb64u(p256dh), auth = unb64u(authSecret);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(payload), new Uint8Array([2]))));
  const head = new Uint8Array(21);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPublic.length;
  return concat(head, asPublic, cipher);
}

// Send to one subscription. Returns 'ok', 'gone' (remove it) or 'error'.
export async function sendPush(env, sub, message) {
  const keys = await vapidKeys(env);
  const body = await encryptPayload(sub.p256dh, sub.auth, JSON.stringify(message));
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { authorization: await vapidAuth(keys, sub.endpoint), 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400', urgency: 'normal' },
    body
  }).catch((e) => ({ ok: false, status: 0, text: () => Promise.resolve(String(e)) }));
  if (r.ok) return 'ok';
  if (r.status === 404 || r.status === 410) return 'gone';
  console.error('push failed', r.status, await r.text().catch(() => ''));
  return 'error';
}

// Every device of one person (by email). Returns how many received it.
export async function pushTo(env, email, message) {
  const subs = (await env.DB.prepare('SELECT * FROM gl_push WHERE email = ?').bind(email).all()).results;
  let ok = 0;
  for (const s of subs) {
    const r = await sendPush(env, s, message);
    if (r === 'ok') ok++;
    if (r === 'gone') await env.DB.prepare('DELETE FROM gl_push WHERE endpoint = ?').bind(s.endpoint).run();
  }
  return ok;
}
