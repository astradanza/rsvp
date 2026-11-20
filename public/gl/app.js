// rsvp.fm — Guestlist. Organizer pages and event pages for guests; a small back office for organizers.
(function () {
  'use strict';
  var main = document.getElementById('main');
  var hdr = document.getElementById('hdr');
  var org = null, person = null, mailOn = false;
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // Six themes for organizer pages: colors and type. Fonts load when a theme is shown.
  var THEMES = {
    minimal: { name: 'Minimal', paper: '#000000', ink: '#F2F2F2', accent: '#B6FF5C', d: 'Helvetica', t: 'Share Tech Mono' },
    terminal: { name: 'Terminal', paper: '#0A0A0A', ink: '#E6E6E6', accent: '#3DDC84', d: 'JetBrains Mono', t: 'JetBrains Mono' },
    phosphor: { name: 'Phosphor', paper: '#030803', ink: '#8CFF9E', accent: '#D4FF5C', d: 'IBM Plex Mono', t: 'IBM Plex Mono' },
    amber: { name: 'Amber', paper: '#0D0A04', ink: '#FFB347', accent: '#FFD9A0', d: 'Space Mono', t: 'Space Mono' },
    graphite: { name: 'Graphite', paper: '#16181D', ink: '#D7DAE0', accent: '#61AFEF', d: 'Fira Code', t: 'Fira Code' },
    solarized: { name: 'Solarized', paper: '#002B36', ink: '#EEE8D5', accent: '#B58900', d: 'Source Code Pro', t: 'Source Code Pro' },
    nocturne: { name: 'Nocturne', paper: '#0B0B12', ink: '#E4DFF5', accent: '#A68BFF', d: 'Instrument Serif', t: 'IBM Plex Mono' }
  };
  var DEFAULT_THEME = 'minimal';
  // Fonts for themes and custom themes (loaded from Google Fonts when shown)
  var FONTS = {
    'Helvetica': { system: "'Helvetica Neue',Helvetica,Arial,sans-serif" },
    'Share Tech Mono': { g: 'Share+Tech+Mono', mono: 1 },
    'JetBrains Mono': { g: 'JetBrains+Mono:ital,wght@0,400;0,500;1,400', mono: 1 },
    'IBM Plex Mono': { g: 'IBM+Plex+Mono:ital,wght@0,400;0,500;1,400', mono: 1 },
    'Space Mono': { g: 'Space+Mono:ital,wght@0,400;0,700;1,400', mono: 1 },
    'Fira Code': { g: 'Fira+Code:wght@400;500', mono: 1 },
    'Source Code Pro': { g: 'Source+Code+Pro:ital,wght@0,400;0,500;1,400', mono: 1 },
    'DM Mono': { g: 'DM+Mono:ital,wght@0,400;0,500;1,400', mono: 1 },
    'Instrument Serif': { g: 'Instrument+Serif:ital@0;1', serif: 1 },
    'Cormorant Garamond': { g: 'Cormorant+Garamond:ital,wght@0,400;0,500;1,400', serif: 1 },
    'EB Garamond': { g: 'EB+Garamond:ital,wght@0,400;0,500;1,400', serif: 1 },
    'Playfair Display': { g: 'Playfair+Display:ital,wght@0,400;0,500;1,400', serif: 1 },
    'Fraunces': { g: 'Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;1,9..144,400', serif: 1 },
    'Bodoni Moda': { g: 'Bodoni+Moda:ital,opsz,wght@0,6..96,400;0,6..96,500;1,6..96,400', serif: 1 },
    'Libre Caslon Text': { g: 'Libre+Caslon+Text:ital,wght@0,400;1,400', serif: 1 },
    'Inter': { g: 'Inter:wght@300;400;500' },
    'Jost': { g: 'Jost:wght@300;400;500' },
    'Space Grotesk': { g: 'Space+Grotesk:wght@300;400;500' },
    'Syne': { g: 'Syne:wght@400;500;700' },
    'Archivo': { g: 'Archivo:wght@300;400;500' }
  };
  function fontStack(name) { var f = FONTS[name] || {}; if (f.system) return f.system; return "'" + name + "'," + (f.mono ? 'ui-monospace,Menlo,monospace' : f.serif ? 'Georgia,serif' : 'system-ui,sans-serif'); }
  var loadedFonts = {};
  function loadFont(name) {
    var f = FONTS[name]; if (!f || !f.g || loadedFonts[name]) return;
    loadedFonts[name] = 1;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=' + f.g + '&display=swap';
    document.head.appendChild(l);
  }
  function loadFonts(t) { var th = THEMES[t]; if (th) { loadFont(th.d); loadFont(th.t); } }
  // Colors: a custom theme picks paper, ink and accent; the in-between greys are mixed from them.
  function hexRgb(h) { var n = parseInt(String(h).slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function mix(a, b, t) { var x = hexRgb(a), y = hexRgb(b); return '#' + [0, 1, 2].map(function (i) { return Math.round(x[i] + (y[i] - x[i]) * t).toString(16).padStart(2, '0'); }).join(''); }
  function lum(h) { return hexRgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce(function (s, v, i) { return s + v * [0.2126, 0.7152, 0.0722][i]; }, 0); }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  var CUSTOM_VARS = ['--paper', '--paper2', '--ink', '--muted', '--faint', '--line', '--accent', '--ok', '--display', '--text'];
  function customVars(c) {
    return { '--paper': c.paper, '--paper2': mix(c.paper, c.ink, 0.06), '--ink': c.ink, '--muted': mix(c.ink, c.paper, 0.4), '--faint': mix(c.ink, c.paper, 0.62),
      '--line': mix(c.ink, c.paper, 0.84), '--accent': c.accent, '--ok': c.accent, '--display': fontStack(c.display), '--text': fontStack(c.text) };
  }
  // theme(name) for guest-facing pages (unknown names fall back to the default); theme('') for the back office.
  // One look everywhere: black, Helvetica bold, LCD mono (the organizer's theme choice is gone)
  function theme() {
    var body = document.body;
    CUSTOM_VARS.forEach(function (v) { body.style.removeProperty(v); });
    body.removeAttribute('data-plain');
    loadFont('Share Tech Mono'); body.setAttribute('data-theme', 'house');
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', '#000000');
  }


  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(method, path, data) {
    var opts = { method: method, headers: {}, credentials: 'same-origin' };
    if (data !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(data); }
    return fetch('/api' + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'Something went wrong.'); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function say(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(say.t); say.t = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function go(path, replace) { history[replace ? 'replaceState' : 'pushState']({}, '', path); route(); window.scrollTo(0, 0); }
  function formData(f) {
    var d = {};
    Array.prototype.forEach.call(f.elements, function (el) {
      if (!el.name) return;
      if (el.type === 'checkbox') d[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) d[el.name] = el.value; }
      else if (el.type !== 'file') d[el.name] = el.value;
    });
    return d;
  }
  function parse(s) { var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || ''); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : null; }
  function time(d) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function longDate(s) { var d = parse(s); return d ? DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] : ''; }
  function shortDate(s) { var d = parse(s); return d ? d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) : '—'; }
  function whenLine(e) {
    var s = parse(e.starts_at); if (!s) return '';
    var line = longDate(e.starts_at) + ', ' + time(s);
    var x = parse(e.ends_at);
    if (x) line += (x - s < 86400000 ? ' – ' + time(x) : ' – ' + longDate(e.ends_at) + ', ' + time(x));
    return line;
  }
  function plusLabel(n) { return n ? ' +' + n : ''; }
  function copy(text, done) {
    var ok = function () { say(done || 'Copied.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { window.prompt('Copy', text); });
    else window.prompt('Copy', text);
  }
  // An event's address: rsvp.fm/<handle>/<slug> (the short id still works)
  function eventPath(e, handle) { return e.slug && handle ? '/' + handle + '/' + e.slug : '/' + e.id; }
  function pageUrl(e, handle) { return location.origin + eventPath(e, handle); }
  function logoImg(src, cls) { return src ? '<div class="logo' + (cls ? ' ' + cls : '') + '"><img src="' + esc(src) + '" alt=""></div>' : ''; }
  function csvDownload(rows, filename) {
    var q = function (v) { v = String(v == null ? '' : v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var blob = new Blob(['﻿' + rows.map(function (r) { return r.map(q).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  var fileSafe = function (s) { return String(s).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'list'; };

  // Back office pages use the house look; guest-facing pages wear the organizer's theme.
  function header(kind) {
    var h = '<a class="wordmark" href="/">rsvp<em>.fm</em></a>';
    if (kind === 'guest') h += person ? '<nav class="nav"><a href="/me" data-nav="me">Feed</a></nav>' : '<span class="sc">Guestlist</span>';
    else if (org) h += '<nav class="nav"><a href="/" data-nav="events">Events</a><a href="/community" data-nav="community">Community</a><a href="/account" data-nav="account">Page</a></nav>';
    else if (person) h += '<nav class="nav"><a href="/me" data-nav="me">Feed</a></nav>';
    else h += '<nav class="nav"><a href="/login">Log in</a></nav>';
    // The account in use; tap to switch to another one signed in on this device
    var who = org ? org.name : person ? person.name : '';
    if (who) h = h.replace(/<\/nav>$/, '') + (/<\/nav>$/.test(h) ? '' : '<nav class="nav">') + '<button class="acct-btn" data-act="accounts" aria-label="Switch account" title="' + esc(who) + '">' +
      (org && org.logo ? '<img src="' + esc(org.logo) + '" alt="">' : esc(who.trim().charAt(0).toUpperCase())) + '</button></nav>';
    hdr.innerHTML = h + '<div id="acct-menu" class="acct-menu" hidden></div>';
    theme();
  }
  function accountsMenu() {
    var m = document.getElementById('acct-menu'); if (!m) return;
    if (!m.hidden) { m.hidden = true; return; }
    m.innerHTML = '<p class="quiet small">Loading…</p>'; m.hidden = false;
    api('GET', '/accounts').then(function (j) {
      m.innerHTML = '<span class="sc">Accounts on this device</span>' + j.accounts.map(function (a) {
        var key = a.type === 'guest' ? 'guest' : a.handle;
        return '<button class="acct-row' + (a.active ? ' on' : '') + '" data-act="switchacct" data-id="' + esc(key) + '">' +
          '<span class="acct-av">' + (a.logo ? '<img src="' + esc(a.logo) + '" alt="">' : esc(String(a.name || '?').charAt(0).toUpperCase())) + '</span>' +
          '<span class="acct-t"><b>' + esc(a.name) + '</b><small>' + (a.type === 'guest' ? esc(a.email) : '@' + esc(a.handle)) + '</small></span>' +
          '<span class="switch' + (a.active ? ' on' : '') + '" aria-hidden="true"><i></i></span></button>';
      }).join('') +
        '<div class="acts small"><a class="link small" href="/login?add=1">Add an account</a>' +
        (org ? '<button class="link small" data-act="logout">Log out of ' + esc(org.name) + '</button>' : person ? '<button class="link small" data-act="plogout">Log out</button>' : '') + '</div>';
    }).catch(function (e) { m.innerHTML = '<p class="err small">' + esc(e.message) + '</p>'; });
  }
  function setNav(name) { Array.prototype.forEach.call(hdr.querySelectorAll('[data-nav]'), function (a) { a.classList.toggle('on', a.getAttribute('data-nav') === name); }); }
  function loading() { main.innerHTML = '<p class="quiet center">Loading…</p>'; }
  function showError(e) { main.innerHTML = '<div class="stack center"><p class="when">' + esc(e.message) + '</p><p><a href="/">Back</a></p></div>'; }

  // ---------- welcome, sign up, log in ----------
  function viewWelcome() {
    header();
    main.innerHTML = '<div class="stack lg">' +
      '<h1>The guestlist,<br><em>kept simply.</em></h1>' +
      '<p class="lead">Your page, your events, one link each. Your guests leave their name and RSVP; you confirm the list and take it to the door. They can ask to receive your next invitations.</p>' +
      '<div class="acts"><a class="btn" href="/signup">Create an account</a><a class="btn line" href="/login">Log in</a></div>' +
      '<hr class="rule">' +
      '<div class="stack">' +
      '<div><h2><em>i.</em> Your page</h2><p class="quiet">Your logo and a few words. Public, or private: by invitation only.</p></div>' +
      '<div><h2><em>ii.</em> Your guestlists</h2><p class="quiet">A name, a date, a place. Guests write their full name and email, bring a +1, +2 or +3 if you allow it, and RSVP.</p></div>' +
      '<div><h2><em>iii.</em> Your community</h2><p class="quiet">Everyone who RSVPs can ask to be kept posted. Next time, they hear from you first.</p></div>' +
      '</div></div>';
  }
  function viewSignup() {
    header();
    main.innerHTML = '<div class="stack lg"><div class="stack"><h1>Create an account</h1></div>' +
      '<form id="f-signup">' +
      '<label><span>Name guests will see</span><input name="name" maxlength="80" required placeholder="Your name, or your collective\'s" autocomplete="organization"></label>' +
      '<label><span>Email</span><input name="email" type="email" required autocomplete="email"></label>' +
      '<label><span>Password</span><input name="password" type="password" minlength="8" required autocomplete="new-password"></label>' +
      '<p class="err" id="err" hidden></p><button class="btn wide" type="submit">Create my account</button></form>' +
      '<p class="quiet small center">Already have one? <a href="/login">Log in</a></p></div>';
  }
  function viewLogin() {
    header();
    main.innerHTML = '<div class="stack lg"><div class="stack"><h1>' + (/[?&]add=1/.test(location.search) && (org || person) ? 'Add an account' : 'Log in') + '</h1></div>' +
      '<form id="f-login"><label><span>Email or handle</span><input name="email" required autocomplete="username" autocapitalize="none"></label>' +
      '<label><span>Password</span><input name="password" type="password" required autocomplete="current-password"></label>' +
      '<p class="err" id="err" hidden></p><button class="btn wide" type="submit">Log in</button></form>' +
      '<p class="small center"><a href="/forgot">Forgot your password?</a></p>' +
      '<p class="quiet small center">Your rsvp.fm account works here: same email, same password.</p>' +
      '<p class="quiet small center">No account yet? <a href="/signup">Create one</a></p></div>';
  }

  // ---------- tickets (beta): sold through Stripe Checkout (Apple Pay, Google Pay, cards); one QR code per ticket ----------
  function loadScript(src) {
    return new Promise(function (ok, ko) {
      if (document.querySelector('script[src="' + src + '"]')) return ok();
      var sc = document.createElement('script'); sc.src = src; sc.onload = ok; sc.onerror = function () { ko(new Error('Could not load ' + src)); }; document.head.appendChild(sc);
    });
  }
  function localInput(iso) {
    if (!iso) return ''; var d = new Date(iso); if (isNaN(d)) return '';
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  function loadTix() {
    var slot = document.getElementById('tix-slot'); if (!slot) return;
    api('GET', '/events/' + current.event.id + '/tickets').then(function (j) {
      current.tix = j;
      // First time with a Stripe key: create the webhook that confirms payments (once per mode)
      if (j.stripe.connected && !loadTix.linked) { loadTix.linked = true; api('POST', '/tix/connect', {}).catch(function (e) { say(e.message); }); }
      var st = j.stripe.connected ? (j.stripe.mode === 'live' ? '' : '<p class="small"><span class="tag">test mode</span> Payments are simulated: use the card 4242 4242 4242 4242.</p>') :
        '<p class="small"><span class="tag">not connected</span> Add your Stripe secret key to the Worker to sell (see the setup notes).</p>';
      var h = '<div class="box"><span class="sc">Tickets <span class="tag">beta</span></span>' + st +
        '<label class="check"><input type="checkbox" data-act="tixreleases"' + (j.releases ? ' checked' : '') + '><span>Sell in releases<small>One ticket on sale at a time, in this order. The next opens when one sells out or you stop it.</small></span></label>';
      if (j.types.length) {
        h += '<div class="stats"><div class="stat"><b>' + j.tickets + '</b><span>Sold</span></div><div class="stat"><b>' + j.checked_in + '</b><span>Checked in</span></div><div class="stat"><b style="font-size:20px">' + esc(j.revenue || '0') + '</b><span>Revenue</span></div></div>';
        h += '<div class="list">' + j.types.map(function (t) {
          return '<div class="item"><span class="main"><span class="t">' + esc(t.name) + ' · ' + esc(t.label) + '</span>' +
            (t.access_code ? '<span class="m">Secret link: ' + esc(location.host + eventPath(current.event, org.handle) + '/' + t.access_code) + '</span>' : '') + '<span class="m">' + t.sold + (t.capacity ? ' / ' + t.capacity : '') + ' sold' + (t.active ? '' : ' · sale stopped') + (t.release === 'current' ? ' · on sale now' : t.release === 'next' ? ' · next' : '') + '</span></span>' +
            '<span class="s"><button class="link small" data-act="tixactive" data-id="' + t.id + '" data-on="' + (t.active ? 1 : 0) + '">' + (t.active ? 'Stop sale' : 'Resume sale') + '</button>' +
            (t.sold ? '' : ' <button class="link small" data-act="tixdel" data-id="' + t.id + '">Delete</button>') + '</span></div>' +
            '<form class="tixcap stack" data-id="' + t.id + '" id="f-tixcap-' + t.id + '" style="gap:8px"><div class="row2">' +
            '<label><span>How many</span><input name="capacity" inputmode="numeric" placeholder="No limit" value="' + (t.capacity || '') + '" style="font-size:14px"></label>' +
            '<label><span>Sale ends</span><input name="sale_ends" type="datetime-local" value="' + esc(localInput(t.sale_ends)) + '" style="font-size:14px"></label></div>' +
            '<div class="acts small"><button class="btn small line" type="submit">Save</button>' + (t.ended ? '<span class="quiet small">Sale ended</span>' : '') + '</div></form>';
        }).join('') + '</div>';
        h += '<div class="acts small"><a class="btn small" href="/e/' + esc(current.event.id) + '/scan">Scan tickets at the door</a></div>';
      }
      h += '<form id="f-tixtype" class="stack"><span class="sc" style="font-size:13px">' + (j.types.length ? 'Add a ticket' : 'Sell tickets for this event') + '</span>' +
        '<label><span>Name</span><input name="name" maxlength="60" placeholder="Early bird, Regular, Door…" required></label>' +
        '<div class="row2"><label><span>Price</span><input name="price" inputmode="decimal" placeholder="300" required></label>' +
        '<label><span>Currency</span><select name="currency"><option value="mxn">MXN</option><option value="eur">EUR</option><option value="usd">USD</option><option value="gbp">GBP</option></select></label></div>' +
        '<label><span>How many (leave empty for no limit)</span><input name="capacity" inputmode="numeric" placeholder="100"></label>' +
        '<label><span>Secret word (optional)</span><input name="access_code" maxlength="30" placeholder="family" autocapitalize="none"><small class="quiet">Only people with the link ending in /this-word see this ticket.</small></label>' +
        '<p class="err" hidden></p><div class="acts"><button class="btn small" type="submit">Add the ticket</button></div></form>';
      if (j.orders.length) h += '<div class="stack"><span class="sc" style="font-size:13px">Sales</span><div class="list">' + j.orders.map(function (o) {
        return '<div class="item"><span class="main"><span class="t">' + esc(o.name) + ' × ' + o.qty + '</span><span class="m">' + esc(o.email) + ' · ' + esc(o.amount) + ' · ' + esc(ago(o.paid_at || o.created_at)) + '</span></span></div>';
      }).join('') + '</div></div>';
      slot.innerHTML = h + '</div>';
    }).catch(function (e) { slot.innerHTML = '<p class="err small">' + esc(e.message) + '</p>'; });
  }
  function buyBox(e) {
    var rel = e.tickets.some(function (t) { return t.release; });
    var sp = e.tickets.filter(function (t) { return t.special && t.active && t.left !== 0 && !t.ended; });
    // Any ticket not sold out (or closed) can be chosen, at any time; the current release comes first
    var sellable = function (t) { return rel ? t.release === 'current' || t.release === 'next' : t.left !== 0 && !t.ended; };
    var on = sp.concat(e.tickets.filter(function (t) { return !t.special && rel && t.release === 'current'; }), e.tickets.filter(function (t) { return !t.special && sellable(t) && t.release !== 'current'; }));
    var h = '<div class="card" id="buy"><p class="sc">Tickets</p>';
    if (!on.length) return h + '<h2>Sold out.</h2></div>';
    // Secret-link tickets (friends & family): set apart, on top, and chosen first
    h += '<form id="f-buy" data-id="' + esc(e.id) + '" class="stack">' + e.tickets.filter(function (t) { return t.special; }).map(function (t) {
      var off = !t.active || t.left === 0 || t.ended;
      // A ticket stub: the invitation on the left, the price and what's left after the perforation
      return '<label class="tix-special' + (off ? ' off' : '') + '"><input type="radio" name="type_id" value="' + t.id + '"' + (off ? ' disabled' : t === on[0] ? ' checked' : '') + '>' +
        '<span class="ts-main"><span class="ts-kicker">Invitation only</span><b>' + esc(t.name) + '</b>' +
        '<span class="ts-note">You\'ve been invited to access these tickets</span></span>' +
        '<span class="ts-stub"><span class="ts-price">' + esc(t.label.replace(/\.00$/, '')) + '</span>' +
        '<span class="ts-left">' + (off ? (t.left === 0 ? 'Sold out' : 'Closed') : t.left !== null ? t.left + ' left' : '') + '</span></span></label>';
    }).join('') + e.tickets.filter(function (t) { return !t.special; }).map(function (t, i) {
      var off = !sellable(t);
      var left = t.left !== null && t.left !== 0 ? t.left + ' left' : '';
      var ends = ''; // the end of a sale is not shown to buyers (it still closes the ticket on time)
      var note = rel ? (t.release === 'past' ? (t.ended && t.left !== 0 ? 'Closed' : 'Sold out') : t.release === 'next' ? left || 'Next' : [left || 'On sale now', ends].filter(Boolean).join(' · ')) :
        t.left === 0 ? 'Sold out' : t.ended ? 'Closed' : [left, ends].filter(Boolean).join(' · ');
      return '<label class="check tix-opt' + (off ? ' off' : '') + '"><input type="radio" name="type_id" value="' + t.id + '"' + (off ? ' disabled' : t === on[0] ? ' checked' : '') + '>' +
        '<span><b>' + esc(t.name) + '</b> · ' + esc(t.label) + (note ? '<small>' + note + '</small>' : '') + '</span></label>';
    }).join('') +
      '<div class="qty"><span class="sc">How many</span><div class="stepper"><button type="button" class="step" data-act="qtystep" data-id="-1" aria-label="One less">&minus;</button>' +
      '<input name="qty" value="1" inputmode="numeric" readonly aria-label="Number of tickets"><button type="button" class="step" data-act="qtystep" data-id="1" aria-label="One more">+</button></div></div>' +
      '<label><span>Full name</span><input name="name" required autocomplete="name" value="' + esc(person ? person.name : '') + '"></label>' +
      '<label><span>Email</span><input name="email" type="email" required autocomplete="email" value="' + esc(person ? person.email : '') + '"><small class="quiet">Your QR codes are sent there.</small></label>' +
      '<div class="buy-total"><span class="bt-calc" id="bt-calc"></span><span class="bt-sum" id="bt-sum"></span></div>' +
      '<p class="err" hidden></p><button class="btn wide" type="submit">Pay · Apple Pay or card</button>' +
      '<p class="quiet small center">Secure payment by Stripe. One QR code per ticket.</p></form></div>';
    return h;
  }
  // "ends in 2d 4h" next to a ticket whose sale has an end; the page reloads the tickets when it is reached
  function tickCountdowns() {
    var els = document.querySelectorAll('.countdown[data-until]'); if (!els.length) return;
    var reload = false;
    els.forEach(function (el) {
      var ms = Date.parse(el.getAttribute('data-until')) - Date.now();
      if (ms <= 0) { el.textContent = 'ended'; reload = true; return; }
      var m = Math.floor(ms / 60000), d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = m % 60, ss = Math.floor(ms / 1000) % 60;
      el.textContent = 'ends in ' + (d ? d + 'd ' + hh + 'h ' + mm + 'm' : hh ? hh + 'h ' + mm + 'm ' + ss + 's' : mm + 'm ' + ss + 's');
    });
    clearTimeout(tickCountdowns.t);
    if (reload && !tickCountdowns.reloaded) { tickCountdowns.reloaded = true; tickCountdowns.t = setTimeout(route, 2500); return; }
    if (reload) return;
    tickCountdowns.t = setTimeout(tickCountdowns, 1000);
  }
  // The quantity (− / +) and the total before paying: tickets × price, in big
  function fmtMoney(cents, cur) {
    try { return new Intl.NumberFormat('en', { style: 'currency', currency: String(cur).toUpperCase(), minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100); } catch (x) { return (cents / 100) + ' ' + String(cur).toUpperCase(); }
  }
  function buyTotal(e) {
    var f = document.getElementById('f-buy'); if (!f || !e) return;
    var sel = f.querySelector('input[name=type_id]:checked'), q = f.elements.namedItem('qty');
    var t = sel && e.tickets.filter(function (x) { return String(x.id) === sel.value; })[0];
    var max = Math.min(10, t && t.left !== null && t.left > 0 ? t.left : 10), n = Math.max(1, Math.min(max, parseInt(q.value, 10) || 1));
    q.value = n;
    f.querySelectorAll('.step').forEach(function (b) { b.disabled = b.getAttribute('data-id') === '-1' ? n <= 1 : n >= max; });
    document.getElementById('bt-calc').textContent = t ? n + ' × ' + t.name + ' · ' + fmtMoney(t.price, t.currency) : '';
    document.getElementById('bt-sum').textContent = t ? fmtMoney(t.price * n, t.currency) : '';
  }
  function viewTickets(tk) {
    header('guest'); loading();
    var tries = 0;
    (function load() {
      api('GET', '/orders/' + encodeURIComponent(tk)).then(function (j) {
        var e = j.event, o = j.order;
        if (o.status === 'pending' && tries++ < 15) {
          main.innerHTML = '<div class="stack center"><p class="sc">Tickets</p><h1>Confirming your payment…</h1><p class="quiet">This takes a few seconds.</p></div>';
          return setTimeout(load, 2500);
        }
        if (o.status !== 'paid') {
          main.innerHTML = '<div class="stack center"><h1>No payment yet.</h1><p class="quiet">If you paid, your tickets arrive by email within minutes. Otherwise, <a href="' + esc(eventPath(e, e.host.handle)) + '">go back to the event</a>.</p></div>';
          return;
        }
        loadScript('/qrcode.js').then(function () {
          var h = '<div class="stack lg"><div class="stack"><p class="sc">' + esc(e.host.name) + ' · ' + o.qty + ' ticket' + (o.qty > 1 ? 's' : '') + '</p><h1>' + esc(e.title) + '</h1>' +
            (e.starts_at ? '<p class="when">' + esc(whenLine(e)) + '</p>' : '') + ([e.venue, e.city].filter(Boolean).length ? '<p class="quiet">' + esc([e.venue, e.city].filter(Boolean).join(', ')) + '</p>' : '') + '</div>' +
            '<p class="quiet small">Show a code at the door. Each works once. A screenshot works too.</p>';
          h += j.tickets.map(function (t, i) {
            var q = qrcode(0, 'M'); q.addData(t.code); q.make();
            return '<div class="ticket"><div class="qr">' + q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }) + '</div>' +
              '<p class="sc">' + esc(o.type) + ' · ' + (i + 1) + ' / ' + j.tickets.length + '</p><p class="code">' + esc(t.code) + '</p>' +
              (t.checked_in_at ? '<p class="small"><span class="tag">checked in</span></p>' : '') + '</div>';
          }).join('');
          h += '<p class="quiet small center">' + esc(o.name) + ' · ' + esc(o.amount) + '</p><p class="center"><a href="' + esc(eventPath(e, e.host.handle)) + '">Event page</a></p>';
          main.innerHTML = h + '</div>';
        });
      }).catch(showError);
    })();
  }
  // The door: camera scan (BarcodeDetector where the browser has it, jsQR otherwise) or a typed code
  function viewScan(id) {
    if (!org) return go('/login?next=' + encodeURIComponent('/e/' + id + '/scan'), true);
    header(); stopScan();
    main.innerHTML = '<div class="stack lg"><div class="toolbar"><h1>Door</h1><a class="btn small line" href="/e/' + esc(id) + '">Back</a></div>' +
      '<div id="scan-res" class="scan-res idle"><b>Ready</b><span>Point the camera at a ticket.</span></div>' +
      '<div class="scanbox"><video id="scan-v" playsinline muted></video><canvas id="scan-c" hidden></canvas></div>' +
      '<form id="f-scan" class="copyfield"><input name="code" placeholder="Or type the code" autocapitalize="characters" autocomplete="off" style="font-size:16px"><button class="btn small" type="submit">Check</button></form></div>';
    var v = document.getElementById('scan-v'), last = '', lastAt = 0;
    scanState.event = id;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (stream) {
      scanState.stream = stream; v.srcObject = stream; v.play();
      var det = ('BarcodeDetector' in window) ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
      var ready = det ? Promise.resolve() : loadScript('/jsqr.js');
      ready.then(function () {
        var c = document.getElementById('scan-c'), ctx2 = c.getContext('2d', { willReadFrequently: true });
        scanState.timer = setInterval(function () {
          if (!v.videoWidth || scanState.busy) return;
          var found = function (txt) { if (!txt) return; var now = Date.now(); if (txt === last && now - lastAt < 4000) return; last = txt; lastAt = now; checkTicket(id, txt); };
          if (det) det.detect(v).then(function (r) { if (r[0]) found(r[0].rawValue); }).catch(function () {});
          else { c.width = v.videoWidth; c.height = v.videoHeight; ctx2.drawImage(v, 0, 0); var img = ctx2.getImageData(0, 0, c.width, c.height); var r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' }); if (r) found(r.data); }
        }, 250);
      });
    }).catch(function () { var r = document.getElementById('scan-res'); if (r) r.innerHTML = '<b>No camera</b><span>Allow the camera, or type the codes.</span>'; });
  }
  var scanState = {};
  function stopScan() {
    if (!scanState) { scanState = {}; return; }
    if (scanState.timer) clearInterval(scanState.timer);
    if (scanState.stream) scanState.stream.getTracks().forEach(function (t) { t.stop(); });
    scanState = {};
  }
  function checkTicket(id, txt) {
    scanState.busy = true;
    api('POST', '/events/' + id + '/checkin', { code: txt }).then(function (r) {
      var el = document.getElementById('scan-res'); if (!el) return;
      el.className = 'scan-res ' + (r.result === 'ok' ? 'ok' : r.result === 'used' ? 'used' : 'bad');
      el.innerHTML = '<b>' + esc(r.message) + '</b><span>' + esc([r.holder, r.type].filter(Boolean).join(' · ')) + (r.at ? ' · at ' + esc(ago(r.at)) : '') + '</span>';
      if (navigator.vibrate) navigator.vibrate(r.result === 'ok' ? 80 : [60, 60, 60]);
    }).catch(function (e) { say(e.message); }).then(function () { setTimeout(function () { scanState.busy = false; }, 900); });
  }

  // ---------- forgotten password: a magic link by email ----------
  function viewForgot() {
    header();
    main.innerHTML = '<div class="stack lg"><div class="stack"><p class="sc">Forgot your password</p><h1>Get a login link</h1></div>' +
      '<p class="quiet">Enter your handle or your email. We send a link to the email of the account: it logs you in, then you choose a new password.</p>' +
      '<form id="f-forgot"><label><span>Handle or email</span><input name="login" required autocomplete="username" autocapitalize="none"></label>' +
      '<p class="err" id="err" hidden></p><button class="btn wide" type="submit">Send me a link</button></form>' +
      '<p class="quiet small center"><a href="/login">Back to log in</a></p></div>';
  }
  function viewReset() {
    header(); loading();
    var k = new URLSearchParams(location.search).get('k') || '';
    api('POST', '/magic', { k: k }).then(function (j) {
      org = j.org; person = j.person || person;
      history.replaceState({}, '', '/reset');
      header();
      var as = j.org ? 'org' : 'guest', name = j.org ? j.org.name : j.person.name;
      main.innerHTML = '<div class="stack lg"><div class="stack"><p class="sc">Logged in as ' + esc(name) + '</p><h1>Choose a new password</h1></div>' +
        '<form id="f-newpass" data-as="' + as + '"><label><span>New password</span><input name="password" type="password" minlength="8" required autocomplete="new-password"></label>' +
        '<p class="err" id="err" hidden></p><button class="btn wide" type="submit">Save the password</button></form>' +
        '<p class="quiet small center"><a href="' + (j.org ? '/' : '/me') + '">Skip for now</a></p></div>';
    }).catch(function (e) {
      main.innerHTML = '<div class="stack center"><p class="when">' + esc(e.message) + '</p><p><a href="/forgot">Get a new link</a></p></div>';
    });
  }

  // ---------- organizer: page settings ----------
  function viewAccount() {
    if (!org) return go('/login', true);
    header(); setNav('account');
    var inv = location.origin + '/' + org.handle + '?i=' + org.invite_token;
    main.innerHTML = '<div class="stack lg"><div class="toolbar"><h1>Your page</h1><a class="btn small line" href="/' + esc(org.handle) + '">View</a></div>' + newsBox() +
      '<div class="stack"><span class="sc">Logo</span><div class="box" style="align-items:center">' + (org.logo ? logoImg(org.logo) : '<p class="quiet small">No logo yet. A square or wide mark on a transparent background looks best.</p>') +
      '<div class="acts"><label class="btn small line" style="flex-direction:row;cursor:pointer">' + (org.logo ? 'Replace' : 'Upload a logo') + '<input type="file" id="up-logo" accept="image/png,image/jpeg,image/webp" hidden></label>' +
      (org.logo ? '<button class="link small" data-act="rmlogo">Remove</button>' : '') + '</div></div></div>' +
      '<form id="f-account">' +
      '<label><span>Address</span><span class="prefix"><em>' + esc(location.host) + '/</em><input name="handle" maxlength="30" required autocapitalize="none" autocomplete="off" value="' + esc(org.handle) + '"></span></label>' +
      '<label><span>Name</span><input name="name" maxlength="80" required value="' + esc(org.name) + '"></label>' +
      '<label><span>Bio</span><textarea name="bio" maxlength="600" placeholder="A few words about you, your nights, your music.">' + esc(org.bio) + '</textarea></label>' +
      '<div class="stack" style="gap:8px"><span class="sc" style="font-size:13px">Who can see your events</span><div class="seg">' +
      '<label><input type="radio" name="visibility" value="public"' + (org.visibility !== 'private' ? ' checked' : '') + '><span>Everyone</span></label>' +
      '<label><input type="radio" name="visibility" value="private"' + (org.visibility === 'private' ? ' checked' : '') + '><span>By invitation</span></label></div>' +
      '<p class="quiet small">By invitation: visitors see your name, logo and bio, and can request an invitation. People you accept, people who RSVP\'d to one of your events, and people with your invitation link see your events.</p></div>' +
      '<div class="stack" style="gap:8px"><span class="sc" style="font-size:13px">Who can join your community</span><div class="seg">' +
      '<label><input type="radio" name="join" value="open"' + (org.join !== 'approval' ? ' checked' : '') + '><span>Anyone</span></label>' +
      '<label><input type="radio" name="join" value="approval"' + (org.join === 'approval' ? ' checked' : '') + '><span>On request</span></label></div>' +
      '<p class="quiet small">On request: everyone who joins your page or RSVPs asks to join, and you confirm them in Community. People with your invitation links join right away.</p></div>' +
      '<p class="err" id="err" hidden></p><button class="btn" type="submit">Save</button></form>' +
      '<div class="box"><span class="sc">Invitation link to your page</span><span class="linkline">' + esc(inv.replace(/^https?:\/\//, '')) + '</span>' +
      '<p class="quiet small">Whoever opens it can see your events and join your community, even when your page is by invitation.</p>' +
      '<div class="acts"><button class="btn small" data-act="copylink" data-id="' + esc(inv) + '">Copy link</button><button class="link small" data-act="newinvite">Make a new link</button></div></div>' +
      '<hr class="rule"><p class="quiet small">' + esc(org.email) + ' · <button class="link small" data-act="logout">Log out</button></p></div>';
    loadNews();
  }
  // Logos keep their shape and transparency; resized in the browser.
  function prepareLogo(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 640, s = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var out = c.toDataURL('image/png');
        if (out.length > 1100000) { out = c.toDataURL('image/webp', 0.9); if (!/^data:image\/webp/.test(out) || out.length > 1100000) out = c.toDataURL('image/jpeg', 0.88); }
        resolve(out);
      };
      img.onerror = function () { reject(new Error('This file could not be read as an image.')); };
      img.src = url;
    });
  }

  // ---------- organizer: community ----------
  function viewCommunity() {
    if (!org) return go('/login', true);
    header(); setNav('community'); loading();
    api('GET', '/community').then(function (j) {
      viewCommunity.list = j.contacts;
      var req = j.contacts.filter(function (c) { return c.status === 'requested'; });
      var mem = j.contacts.filter(function (c) { return c.status === 'member'; });
      var h = '<div class="stack lg"><h1>Community</h1>' +
        '<div class="stats"><div class="stat"><b>' + mem.length + '</b><span>Members</span></div><div class="stat"><b>' + mem.filter(function (c) { return c.consent; }).length + '</b><span>Keep me posted</span></div>' +
        '<div class="stat"><b>' + req.length + '</b><span>Requests</span></div></div>';
      if (req.length) {
        h += '<div class="stack"><h3>Invitation requests</h3><div class="list">' + req.map(function (c) {
          return '<div class="guest"><span class="n">' + esc(c.name || c.email) + '</span><span class="s"><button class="btn small" data-act="member" data-id="' + c.id + '" data-to="member">Accept</button><button class="link small" data-act="member" data-id="' + c.id + '" data-to="declined">Decline</button></span>' +
            '<span class="e">' + esc(c.email) + (c.note ? ' · ' + esc(c.note) : '') + '</span></div>';
        }).join('') + '</div></div>';
      }
      h += '<div class="stack"><h3>Members</h3>';
      if (!mem.length) h += '<p class="quiet">Everyone who RSVPs to your events, or asks to be kept posted on your page, appears here.</p>';
      else h += '<div class="list">' + mem.map(function (c) {
        return '<div class="guest"><span class="n">' + esc(c.name || c.email) + '</span><span class="s">' + (c.consent ? '<span class="tag confirmed" title="Agreed to receive your next invitations">Keep me posted</span>' : '') + '</span>' +
          '<span class="e">' + esc(c.email) + (c.has_account ? ' · on rsvp.fm' : '') + (c.source ? ' · ' + esc(c.source) : '') + '</span></div>';
      }).join('') + '</div><div class="acts"><button class="btn small line" data-act="commcsv">Export CSV</button></div>';
      main.innerHTML = h + '</div></div>';
    }).catch(showError);
  }

  // ---------- organizer: events ----------
  function viewEvents() {
    header(); setNav('events'); loading();
    api('GET', '/events').then(function (j) {
      var h = '<div class="stack lg"><div class="toolbar"><h1>Events</h1><a class="btn small" href="/new">New event</a></div>';
      if (!j.events.length) {
        h += '<div class="stack center" style="padding:30px 0"><p class="ornament">· · ·</p><p class="when">No events yet.</p><p class="quiet">Create one and send its link: the list fills itself.</p><p><a class="btn" href="/new">Create an event</a></p></div>';
      } else {
        h += '<div class="list">' + j.events.map(function (e) {
          return '<a class="item" href="/e/' + esc(e.id) + '"><span class="date">' + esc(shortDate(e.starts_at)) + '</span><span class="main"><span class="t">' + esc(e.title) + '</span>' +
            '<span class="m">' + (e.requests ? e.requests + (e.requests === 1 ? ' request' : ' requests') + ' · ' + e.people + (e.people === 1 ? ' person' : ' people') + ' · ' + e.confirmed + ' confirmed' : 'No one yet') + (e.open ? '' : ' · closed') + '</span></span></a>';
        }).join('') + '</div>';
      }
      h += '<p class="quiet small">Your page: <a href="/' + esc(org.handle) + '">' + esc(location.host + '/' + org.handle) + '</a></p>';
      main.innerHTML = h + '</div>';
    }).catch(showError);
  }
  function eventForm(v, id) {
    var pm = v.plus_max || 0;
    return '<form id="f-event"' + (id ? ' data-id="' + esc(id) + '"' : '') + '>' +
      '<label><span>Event</span><input name="title" maxlength="120" required value="' + esc(v.title || '') + '" placeholder="Name of the night"></label>' +
      '<label><span>Link</span><span class="prefix"><em>' + esc(location.host + '/' + org.handle + '/') + '</em><input name="slug" maxlength="60" autocapitalize="none" autocomplete="off" value="' + esc(v.slug || '') + '" placeholder="made from the name"></span></label>' +
      '<div class="two"><label><span>Starts</span><input name="starts_at" type="datetime-local" value="' + esc(v.starts_at || '') + '"></label>' +
      '<label><span>Ends (optional)</span><input name="ends_at" type="datetime-local" value="' + esc(v.ends_at || '') + '"></label></div>' +
      '<div class="two"><label><span>Venue</span><input name="venue" maxlength="120" value="' + esc(v.venue || '') + '"></label>' +
      '<label><span>City</span><input name="city" maxlength="80" value="' + esc(v.city || '') + '"></label></div>' +
      '<label><span>Details</span><textarea name="details" maxlength="4000" placeholder="Line-up, address, dress code, door time, anything guests should know.">' + esc(v.details || '') + '</textarea></label>' +
      '<div class="stack" style="gap:8px"><span class="sc" style="font-size:13px">Photos</span>' +
      '<input type="hidden" name="photos" value="' + esc(JSON.stringify(v.photos || [])) + '"><div id="photos">' + photosGrid(v.photos || []) + '</div>' +
      '<div class="acts"><label class="btn small line" style="flex-direction:row;cursor:pointer">Add photos<input type="file" id="up-photos" accept="image/*" multiple hidden></label>' +
      '<span class="quiet small">The first one is the cover. Up to 12.</span></div></div>' +
      '<label><span>Guests may bring</span><select name="plus_max">' +
      ['No one', 'A +1', 'Up to +2', 'Up to +3'].map(function (t, i) { return '<option value="' + i + '"' + (pm === i ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></label>' +
      '<label class="check"><input type="checkbox" name="auto_confirm"' + (v.auto_confirm ? ' checked' : '') + '><span>Confirm requests automatically<small>Otherwise every RSVP waits for your confirmation.</small></span></label>' +
      '<label class="check"><input type="checkbox" name="open"' + (v.open === false ? '' : ' checked') + '><span>Guestlist open<small>Close it when you are full: the page stays, the form goes.</small></span></label>' +
      '<div class="stack" style="gap:8px"><span class="sc" style="font-size:13px">Who can find it</span><div class="seg">' +
      '<label><input type="radio" name="listed" value="1"' + (v.listed === false ? '' : ' checked') + '><span>Public</span></label>' +
      '<label><input type="radio" name="listed" value="0"' + (v.listed === false ? ' checked' : '') + '><span>Link only</span></label></div>' +
      '<p class="quiet small">Public: on your page and in the rsvp.fm feed. Link only: no one finds it unless you send them the link.</p></div>' +
      '<label class="check"><input type="checkbox" name="guest_invites"' + (v.guest_invites === false ? '' : ' checked') + '><span>Guests can invite friends<small>Guests get a link to share. You see who brought whom; their friends RSVP like everyone else.</small></span></label>' +
      '<p class="err" id="err" hidden></p><div class="acts"><button class="btn" type="submit">' + (id ? 'Save' : 'Create the guestlist') + '</button>' +
      (id ? '<a class="link" href="/e/' + esc(id) + '">Cancel</a>' : '') + '</div></form>';
  }
  // Event photos in the form: thumbnails, tap ★ to make one the cover, × to remove
  function photosGrid(list) {
    if (!list.length) return '';
    return '<div class="photos">' + list.map(function (u, i) {
      return '<div class="ph"><img src="' + esc(u) + '" alt="">' + (i === 0 ? '<span class="ph-cover">Cover</span>' : '<button type="button" class="ph-btn ph-star" data-act="coverphoto" data-id="' + esc(u) + '" aria-label="Make it the cover">★</button>') +
        '<button type="button" class="ph-btn ph-x" data-act="rmphoto" data-id="' + esc(u) + '" aria-label="Remove">×</button></div>';
    }).join('') + '</div>';
  }
  function formPhotos() { var el = document.querySelector('#f-event input[name=photos]'); try { return el ? JSON.parse(el.value || '[]') : []; } catch (e) { return []; } }
  function setFormPhotos(list) {
    var el = document.querySelector('#f-event input[name=photos]'); if (!el) return;
    el.value = JSON.stringify(list); document.getElementById('photos').innerHTML = photosGrid(list);
  }
  // Photos are resized in the browser: 1600px, JPEG
  function preparePhoto(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var out = '', sizes = [1600, 1280, 1024];
        for (var i = 0; i < sizes.length; i++) {
          var s = Math.min(1, sizes[i] / Math.max(img.width, img.height));
          var c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          out = c.toDataURL('image/jpeg', 0.84);
          if (out.length < 1200000) break;
        }
        URL.revokeObjectURL(url); resolve(out);
      };
      img.onerror = function () { reject(new Error('This file could not be read as an image.')); };
      img.src = url;
    });
  }

  function viewNew() {
    if (!org) return go('/login', true);
    header(); setNav('events');
    main.innerHTML = '<div class="stack lg"><div class="stack"><p class="sc">New event</p><h1>Create a guestlist</h1></div>' + eventForm({}, null) + '</div>';
  }
  function viewEdit(id) {
    if (!org) return go('/login', true);
    header(); setNav('events'); loading();
    api('GET', '/events/' + id).then(function (j) {
      main.innerHTML = '<div class="stack lg"><div class="stack"><p class="sc">Edit</p><h1>' + esc(j.event.title) + '</h1></div>' + eventForm(j.event, id) +
        '<hr class="rule"><p><button class="link" data-act="delevent" data-id="' + esc(id) + '">Delete this event and its list</button></p></div>';
    }).catch(showError);
  }

  // Back office: who RSVP'd, confirm, sort, copy, export.
  var current = null, buyEv = null;
  function viewManage(id) {
    if (!org) return go('/login?next=' + encodeURIComponent('/e/' + id), true);
    header(); setNav('events'); loading();
    api('GET', '/events/' + id).then(function (j) {
      current = { event: j.event, guests: j.guests, invites: j.invites || [], slots: (current && current.slots) || 1, sort: (current && current.sort) || 'arrival' };
      renderManage();
    }).catch(function (e) { if (e.status === 404) { history.replaceState({}, '', '/' + id); viewGuest(id); } else showError(e); });
  }
  function counts(gs) {
    var live = gs.filter(function (g) { return g.status !== 'declined'; });
    return {
      requests: live.length,
      people: live.reduce(function (n, g) { return n + 1 + g.plus; }, 0),
      confirmed: gs.filter(function (g) { return g.status === 'confirmed'; }).reduce(function (n, g) { return n + 1 + g.plus; }, 0),
      waiting: gs.filter(function (g) { return g.status === 'requested'; }).length
    };
  }
  function sorted() {
    var gs = current.guests.slice();
    if (current.sort === 'az') gs.sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }); });
    return gs;
  }
  function renderManage() {
    var e = current.event, c = counts(current.guests), url = pageUrl(e, org.handle);
    var h = '<div class="stack lg">' +
      '<div class="stack"><p class="sc">' + (e.open ? 'Guestlist open' : 'Guestlist closed') + '</p><h1>' + esc(e.title) + '</h1>' +
      (e.starts_at ? '<p class="when">' + esc(whenLine(e)) + '</p>' : '') +
      ([e.venue, e.city].filter(Boolean).length ? '<p class="quiet">' + esc([e.venue, e.city].filter(Boolean).join(', ')) + '</p>' : '') + '</div>' +
      '<div class="box"><span class="sc">Link for your guests</span><span class="linkline">' + esc(url.replace(/^https?:\/\//, '')) + '</span>' +
      '<div class="acts"><button class="btn small" data-act="copylink" data-id="' + esc(url) + '">Copy link</button>' +
      (navigator.share ? '<button class="btn small line" data-act="sharelink" data-id="' + esc(url) + '">Share…</button>' : '') +
      '<a class="btn small line" href="' + esc(eventPath(e, org.handle)) + '" target="_blank" rel="noopener">View page</a></div></div>' +
      (org.beta ? '<div id="tix-slot"></div>' : '') + invitesBox() + messageBox() +
      '<div class="stats"><div class="stat"><b>' + c.requests + '</b><span>Requests</span></div><div class="stat"><b>' + c.people + '</b><span>People</span></div>' +
      '<div class="stat"><b>' + c.confirmed + '</b><span>Confirmed</span></div></div>' +
      '<div class="toolbar"><div class="seg" style="min-width:200px"><label><input type="radio" name="sort" value="arrival"' + (current.sort === 'arrival' ? ' checked' : '') + ' data-act="sort"><span>By arrival</span></label>' +
      '<label><input type="radio" name="sort" value="az"' + (current.sort === 'az' ? ' checked' : '') + ' data-act="sort"><span>A – Z</span></label></div>' +
      (c.waiting ? '<button class="btn small" data-act="confirmall">Confirm everyone (' + c.waiting + ')</button>' : '') + '</div>';
    if (!current.guests.length) h += '<div class="stack center" style="padding:20px 0"><p class="ornament">· · ·</p><p class="quiet">No one yet. Send the link.</p></div>';
    else {
      var byId = {}; current.guests.forEach(function (x) { byId[x.id] = x; });
      h += '<div class="list">' + sorted().map(function (g) {
        return '<div class="guest ' + g.status + '"><span class="n">' + esc(g.name) + '<span class="plus">' + plusLabel(g.plus) + '</span>' +
          (g.names && g.names.length ? '<span class="e" style="display:block;font-size:14px">with ' + esc(g.names.join(', ')) + '</span>' : '') +
          (g.via && byId[g.via] ? '<span class="e" style="display:block;font-size:12px">via ' + esc(byId[g.via].name) + '</span>' : '') + '</span>' +
          '<span class="s">' + (g.status === 'confirmed' ? '<button class="tag confirmed" data-act="status" data-id="' + g.id + '" data-to="requested" title="Tap to undo">Confirmed</button>'
            : g.status === 'declined' ? '<button class="tag declined" data-act="status" data-id="' + g.id + '" data-to="requested" title="Tap to undo">Declined</button>'
            : '<button class="btn small" data-act="status" data-id="' + g.id + '" data-to="confirmed">Confirm</button><button class="link small" data-act="status" data-id="' + g.id + '" data-to="declined">Decline</button>') + '</span>' +
          '<span class="e">' + esc(g.email) + '</span></div>';
      }).join('') + '</div>';
      h += '<div class="acts"><button class="btn small line" data-act="copytext">Copy as text</button><button class="btn small line" data-act="csv">Export CSV</button></div>';
    }
    h += '<p class="quiet small">' + (mailOn ? 'Guests get an email when they RSVP and when you confirm them.' : 'Emails are not switched on yet: guests see their status on the event page.') + '</p>';
    h += '<hr class="rule"><div class="acts"><a class="link" href="/e/' + esc(e.id) + '/edit">Edit event</a><button class="link" data-act="toggleopen">' + (e.open ? 'Close the guestlist' : 'Reopen the guestlist') + '</button></div></div>';
    main.innerHTML = h;
    if (org.beta) loadTix();
  }
  // Unique links: "you've been invited to register N names on the guestlist"
  function inviteUrl(code) { return pageUrl(current.event, org.handle) + '?inv=' + code; }
  // Write to the guests: the address, the door time… by email (and notification)
  // Links in what organizers write: bare https:// addresses, and [text](https://…)
  var LINK_RE = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+)/g;
  function linkify(t) {
    return esc(t).replace(LINK_RE, function (all, label, href, bare) {
      if (href) return '<a href="' + href + '" target="_blank" rel="noopener">' + label + '</a>';
      var m = /^(.*?)([.,;:!?)]*)$/.exec(bare);
      return '<a href="' + m[1] + '" target="_blank" rel="noopener">' + m[1] + '</a>' + m[2];
    });
  }
  function ago(s) {
    var d = new Date(String(s).replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')); if (isNaN(d)) return '';
    return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) + ', ' + time(d);
  }
  function updatesList(list, owner) {
    if (!list || !list.length) return '';
    return '<div class="updates">' + list.map(function (u) {
      return '<div class="update"><p class="date">' + esc(ago(u.created_at)) + (owner ? (u.guests_only ? ' · Guests only' : ' · Public') + (u.emailed ? ' · Emailed' : '') : '') + '</p>' +
        (u.text ? '<p class="details">' + linkify(u.text) + '</p>' : '') +
        (u.photo ? '<a href="' + esc(u.photo) + '" target="_blank" rel="noopener"><img class="upd-photo" src="' + esc(u.photo) + '" alt="" loading="lazy"></a>' : '') +
        (owner ? '<div><button class="link small" data-act="delupdate" data-id="' + u.id + '">Delete</button></div>' : '') + '</div>';
    }).join('') + '</div>';
  }
  // Updates: posted on the event page; emailed to confirmed guests only when the box is ticked
  function messageBox() {
    var e = current.event, nConf = current.guests.filter(function (g) { return g.status === 'confirmed'; }).length;
    var m = e.msg || {}, auto = mailOn && m.auto && m.text ? '<p class="small">Emailed on its own to every new confirmed guest: <b>' + esc(m.subject) + '</b> · <button class="link small" data-act="stopauto">Stop</button></p>' : '';
    return '<div class="box"><span class="sc">Updates</span>' + auto +
      '<form id="f-update" data-confirm="0">' +
      '<label><span>New update</span><textarea name="text" maxlength="5000" placeholder="News, the address, the door time… Links work as they are, or write [text](https://…)."></textarea></label>' +
      '<input type="hidden" name="photo" value=""><div id="upd-photo"></div>' +
      '<div class="acts small"><label class="btn small line" style="flex-direction:row;cursor:pointer">Add a photo<input type="file" id="up-upd" accept="image/*" hidden></label></div>' +
      '<label class="check"><input type="checkbox" name="guests_only"><span>Only guests on the list see it<small>Otherwise everyone who opens the event page sees it.</small></span></label>' +
      (mailOn ? '<label class="check"><input type="checkbox" name="email"><span>Also email it to confirmed guests (' + nConf + ')<small>Sent from ' + esc(org.handle) + '@rsvp.fm, as a plain email.</small></span></label>' +
        '<div id="upd-mail" class="stack" hidden>' +
        '<label><span>Email subject</span><input name="subject" maxlength="140" value="' + esc('Update · ' + e.title) + '"></label>' +
        '<label class="check"><input type="checkbox" name="auto" checked><span>Also email it to everyone confirmed later</span></label>' +
        '<div class="acts small"><input name="test_to" type="email" value="' + esc(org.email || '') + '" placeholder="you@example.com" style="flex:1;min-width:160px;font-size:16px"><button class="btn small line" type="button" data-act="testmsg">Send a test</button></div></div>' : '') +
      '<p class="err" hidden></p><div class="acts"><button class="btn small" type="submit">Post the update</button></div></form>' +
      updatesList(e.updates, true) + '</div>';
  }
  function invitesBox() {
    var h = '<div class="box"><span class="sc">Unique invitation links</span>' +
      '<p class="quiet small">One link for one guest, who registers up to the number of names you choose. Confirmed right away.</p>' +
      '<div class="toolbar" style="justify-content:flex-start;gap:14px"><div class="stepper"><button type="button" data-act="slots" data-id="-1" aria-label="Fewer names">−</button>' +
      '<span><b>' + current.slots + '</b> ' + (current.slots === 1 ? 'name' : 'names') + '</span><button type="button" data-act="slots" data-id="1" aria-label="More names">+</button></div>' +
      '<input id="inv-label" maxlength="80" placeholder="For whom (optional)" style="flex:1;min-width:140px;font-size:16px"></div>' +
      '<div><button class="btn small" data-act="newinv">Create the link</button></div>';
    if (current.invites.length) {
      h += '<div class="list">' + current.invites.map(function (i) {
        var url = inviteUrl(i.code);
        return '<div class="guest"><span class="n" style="font-size:16px">' + (i.label ? esc(i.label) + ' · ' : '') + i.slots + (i.slots === 1 ? ' name' : ' names') + '</span>' +
          '<span class="s">' + (i.used ? '<span class="tag confirmed">Used</span>' : '<button class="btn small line" data-act="copylink" data-id="' + esc(url) + '">Copy</button>' +
            (navigator.share ? '<button class="link small" data-act="shareinv" data-id="' + esc(url) + '" data-slots="' + i.slots + '">Share</button>' : '') +
            '<button class="link small" data-act="delinv" data-id="' + esc(i.code) + '">Delete</button>') + '</span>' +
          '<span class="e">' + (i.used ? esc(i.guest_name) + (i.names.length ? ' with ' + esc(i.names.join(', ')) : '') : esc(url.replace(/^https?:\/\//, ''))) + '</span></div>';
      }).join('') + '</div>';
    }
    return h + '</div>';
  }
  function listText() {
    var e = current.event, gs = sorted().filter(function (g) { return g.status !== 'declined'; });
    var head = e.title + (e.starts_at ? ' — ' + longDate(e.starts_at) : '');
    var lines = gs.map(function (g) { return g.name + plusLabel(g.plus) + (g.names && g.names.length ? ' — ' + g.names.join(', ') : '') + (g.status === 'confirmed' ? '' : ' (pending)'); });
    var c = counts(current.guests);
    return head + '\n\n' + lines.join('\n') + '\n\n' + c.people + (c.people === 1 ? ' person' : ' people') + ' · ' + c.confirmed + ' confirmed';
  }

  // ---------- news: hosts post on their page; their community reads (and comments, when allowed) ----------
  function postHtml(p, ctx) {
    var canComment = p.comments_on && (ctx.host || ctx.member);
    var h = '<div class="post" data-id="' + p.id + '">';
    if (ctx.feed && p.host) h += '<a class="post-host" href="/' + esc(p.host.handle) + '"><span class="acct-av">' + (p.host.logo ? '<img src="' + esc(p.host.logo) + '" alt="">' : esc(p.host.name.charAt(0).toUpperCase())) + '</span><b>' + esc(p.host.name) + '</b></a>';
    h += '<p class="date">' + esc(ago(p.created_at)) + '</p>';
    if (p.text) h += '<p class="details">' + linkify(p.text) + '</p>';
    if (p.photo) h += '<a href="' + esc(p.photo) + '" target="_blank" rel="noopener"><img class="upd-photo" src="' + esc(p.photo) + '" alt="" loading="lazy"></a>';
    if (ctx.host) h += '<div class="acts small"><button class="link small" data-act="postcomments" data-id="' + p.id + '" data-on="' + (p.comments_on ? 1 : 0) + '"><span class="switch' + (p.comments_on ? ' on' : '') + '" style="display:inline-block;vertical-align:middle;margin-right:8px"><i></i></span>Comments ' + (p.comments_on ? 'on' : 'off') + '</button>' +
      '<button class="link small" data-act="delpost" data-id="' + p.id + '">Delete</button></div>';
    if (p.comments.length && (p.comments_on || ctx.host)) h += '<div class="comments">' + p.comments.map(function (c) {
      return '<div class="comment"><p><b>' + esc(c.name) + '</b>' + (c.by_host ? ' <span class="tag">host</span>' : '') + ' <span class="quiet small">' + esc(ago(c.created_at)) + '</span>' +
        (c.can_delete ? ' <button class="link small" data-act="delcomment" data-id="' + c.id + '">Delete</button>' : '') + '</p><p class="details">' + linkify(c.text) + '</p></div>';
    }).join('') + '</div>';
    if (canComment) h += '<form id="f-comment-' + p.id + '" class="f-comment" data-id="' + p.id + '"><input name="text" maxlength="1000" placeholder="Write a comment" autocomplete="off" style="font-size:16px"><button class="btn small line" type="submit">Send</button><p class="err" hidden></p></form>';
    return h + '</div>';
  }
  function postsHtml(list, ctx) { return '<div class="posts">' + list.map(function (p) { return postHtml(p, ctx); }).join('') + '</div>'; }
  function viewFeed() {
    if (!person) return go('/login?as=guest', true);
    header(); setNav('news'); loading();
    api('GET', '/people/feed').then(function (j) {
      var h = '<div class="stack lg"><h1>News</h1>';
      h += j.posts.length ? postsHtml(j.posts, { feed: true, member: true }) : '<p class="quiet">Nothing yet. News from the pages you joined will show here.</p>';
      main.innerHTML = h + '</div>';
    }).catch(showError);
  }
  function newsBox() {
    return '<div class="box" id="news-box"><span class="sc">News</span><p class="quiet small">Your community sees your news on your page and in their newsfeed.</p>' +
      '<form id="f-post"><label><span>New post</span><textarea name="text" maxlength="5000" placeholder="Links work as they are, or write [text](https://…)."></textarea></label>' +
      '<input type="hidden" name="photo" value=""><div id="post-photo"></div>' +
      '<div class="acts small"><label class="btn small line" style="flex-direction:row;cursor:pointer">Add a photo<input type="file" id="up-post" accept="image/*" hidden></label></div>' +
      '<label class="check"><input type="checkbox" name="comments" checked><span>Allow comments</span></label>' +
      '<p class="err" hidden></p><div class="acts"><button class="btn small" type="submit">Publish</button></div></form><div id="news-list"><p class="quiet small">Loading…</p></div></div>';
  }
  // Reload what shows the news, keeping the scroll
  function refreshNews() {
    if (document.getElementById('news-list')) return loadNews();
    var y = window.scrollY; Promise.resolve(route()).then(function () { setTimeout(function () { window.scrollTo(0, y); }, 700); });
  }
  function loadNews() {
    api('GET', '/posts').then(function (j) {
      var el = document.getElementById('news-list'); if (el) el.innerHTML = j.posts.length ? postsHtml(j.posts, { host: true }) : '';
    }).catch(function () {});
  }

  // ---------- guests: an organizer's page ----------
  function joinForm(o, mode, inviteToken) {
    // mode: 'post' (keep me posted), 'ask' (ask to join, the host confirms) or 'request' (request an invitation)
    var p = person;
    return '<form id="f-join" data-handle="' + esc(o.handle) + '" data-i="' + esc(inviteToken || '') + '">' +
      (p ? '<p class="quiet center">As ' + esc(p.name) + ' · ' + esc(p.email) + '</p>' :
        '<label><span>Full name</span><input name="name" maxlength="100" required autocomplete="name"></label>' +
        '<label><span>Email</span><input name="email" type="email" required autocomplete="email"></label>') +
      (mode === 'request' ? '<label><span>A word for ' + esc(o.name) + ' (optional)</span><input name="note" maxlength="300" placeholder="Who you know, where we met…"></label>' : '') +
      (p ? '' : '<label><span>Password (optional)</span><input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="To receive invitations here on rsvp.fm"></label>') +
      '<p class="err" id="err" hidden></p><button class="btn wide" type="submit">' + (mode === 'request' ? 'Request an invitation' : mode === 'ask' ? 'Ask to join ' + esc(o.name) : 'Join ' + esc(o.name)) + '</button>' +
      '<p class="quiet small center">By joining, you agree that ' + esc(o.name) + ' emails you their next invitations.</p></form>';
  }
  function viewOrg(handle) {
    loading();
    var i = new URLSearchParams(location.search).get('i') || '';
    api('GET', '/o/' + handle + (i ? '?i=' + encodeURIComponent(i) : '')).then(function (j) {
      var o = j.org;
      header('guest'); theme(o.theme, o.custom);
      document.title = o.name + ' — rsvp.fm';
      var h = '<div class="stack lg">';
      if (j.is_owner) h += '<p class="quiet small center">This is your page · <a href="/account">Edit</a></p>';
      h += '<div class="stack center">' + logoImg(o.logo) + '<h1>' + esc(o.name) + '</h1>' + (o.bio ? '<p class="bio">' + esc(o.bio) + '</p>' : '') + '</div>';
      h += '<p class="ornament">· · ·</p>';
      if (j.access) {
        h += '<div class="stack"><h3>Upcoming</h3>';
        // Upcoming events as a grid of thumbnails: 2 columns on phones, more on wider screens
        if (j.events.length) h += '<div class="egrid">' + j.events.map(function (e) {
          var where = [e.venue, e.city].filter(Boolean).join(', ');
          return '<a class="ecard" href="' + esc(eventPath(e, o.handle)) + '"><span class="thumb">' +
            (e.photos && e.photos[0] ? '<img src="' + esc(e.photos[0]) + '" alt="" loading="lazy">' : '<span class="ph-date">' + esc(parse(e.starts_at) ? shortDate(e.starts_at) : '·') + '</span>') + '</span>' +
            '<span class="date">' + esc(parse(e.starts_at) ? shortDate(e.starts_at) + ' · ' + time(parse(e.starts_at)) : 'Date to come') + '</span>' +
            '<span class="t">' + esc(e.title) + '</span>' + (where || !e.open ? '<span class="m">' + esc(where) + (e.open ? '' : (where ? ' · ' : '') + 'list closed') + '</span>' : '') + '</a>';
        }).join('') + '</div>';
        else h += '<p class="quiet">No upcoming events yet.</p>';
        h += '</div>';
        if (j.posts && j.posts.length) h += '<div class="stack"><h3>News</h3>' + postsHtml(j.posts, { host: j.is_owner && !!org, member: !!person && j.my_status === 'member' }) + '</div>';
        else if (j.has_news && j.my_status !== 'member') h += '<p class="quiet small center">' + esc(o.name) + ' shares news with their community.</p>';
        if (j.my_status === 'member') h += '<div class="card"><p class="sc">Community</p><h2>You\'re in.</h2><p class="quiet small">' + esc(o.name) + '\'s next invitations land in <a href="/me">My invitations</a>.</p></div>' + pushBox({});
        else if (j.my_status === 'requested') h += '<div class="card"><p class="sc">Community</p><h2>Your request is in.</h2><p class="quiet small">' + esc(o.name) + ' confirms who joins. Once you\'re in, their next invitations land in <a href="/me">My invitations</a>.</p></div>';
        else if (!j.is_owner) h += '<div class="stack"><h3>Keep me posted</h3><p class="quiet small">Be the first to hear about ' + esc(o.name) + '\'s next guestlists.' + (o.join === 'approval' && !j.invited ? ' ' + esc(o.name) + ' confirms who joins.' : '') + '</p>' + joinForm(o, o.join === 'approval' && !j.invited ? 'ask' : 'post', i) + '</div>';
      } else if (j.my_status === 'requested') {
        h += '<div class="card"><p class="sc">By invitation</p><h2>Your request is in.</h2><p class="quiet small">' + esc(o.name) + ' will let you in. You\'ll find their events in <a href="/me">My invitations</a>.</p></div>';
      } else {
        h += '<div class="stack center"><h2><em>By invitation.</em></h2><p class="quiet">' + esc(o.name) + '\'s events are shared with their community. Request an invitation, or wait for an invitation link.</p></div>' +
          '<div class="stack"><h3>Request an invitation</h3>' + joinForm(o, 'request', '') + '</div>';
      }
      main.innerHTML = h + '</div>';
    }).catch(function (e) { header('guest'); showError(e); });
  }

  // ---------- guests: the event page ----------
  function tokenFor(id) { var t = new URLSearchParams(location.search).get('t'); if (t) return t; try { return localStorage.getItem('gl:' + id) || ''; } catch (e) { return ''; } }
  function inviteFor(id) { var q = new URLSearchParams(location.search).get('inv'); if (q) { try { sessionStorage.setItem('inv:' + id, q); } catch (e) {} return q; } try { return sessionStorage.getItem('inv:' + id) || ''; } catch (e) { return ''; } }
  function viewGuest(id) {
    loading();
    var t = tokenFor(id), inv = inviteFor(id);
    var via0 = new URLSearchParams(location.search).get('via'); if (via0) { try { sessionStorage.setItem('via:' + id, via0); } catch (e) {} }
    var key = ''; try { key = sessionStorage.getItem('k:' + id) || ''; } catch (e) {}
    var qs = [t ? 't=' + encodeURIComponent(t) : '', inv ? 'inv=' + encodeURIComponent(inv) : '', key ? 'k=' + encodeURIComponent(key) : ''].filter(Boolean).join('&');
    api('GET', '/p/' + id + (qs ? '?' + qs : '')).then(function (j) {
      var e = j.event, host = e.host, h = '<div class="stack lg">';
      header('guest'); theme(host.theme, host.custom);
      document.title = e.title + ' — ' + host.name;
      var ph = e.photos || [];
      if (ph[0]) h += '<img class="cover" src="' + esc(ph[0]) + '" alt="">';
      h += '<div class="stack center">' + (host.logo ? '<a href="/' + esc(host.handle) + '" style="text-decoration:none">' + logoImg(host.logo, 'mark') + '</a>' : '') +
        '<p class="sc"><a href="/' + esc(host.handle) + '" style="text-decoration:none">' + esc(host.name) + '</a> invites you</p><h1>' + esc(e.title) + '</h1>' +
        (e.starts_at ? '<p class="when">' + esc(whenLine(e)) + '</p>' : '') +
        ([e.venue, e.city].filter(Boolean).length ? '<p class="quiet">' + esc([e.venue, e.city].filter(Boolean).join(', ')) + '</p>' : '') + '</div>';
      h += '<p class="ornament">· · ·</p>';
      if (e.updates && e.updates.length) h += '<div class="stack"><h3>Updates</h3>' + updatesList(e.updates, false) + '</div><hr class="rule">';
      if (e.details) h += '<p class="details">' + linkify(e.details) + '</p>';
      if (ph.length > 1) h += '<div class="gallery">' + ph.slice(1).map(function (u) { return '<a href="' + esc(u) + '" target="_blank" rel="noopener"><img src="' + esc(u) + '" alt="" loading="lazy"></a>'; }).join('') + '</div>';
      if (e.details || ph.length > 1) h += '<hr class="rule">';
      if (e.tickets && e.tickets.length) { h += buyBox(e); setTimeout(tickCountdowns, 0); setTimeout(function () { buyTotal(e); }, 0); buyEv = e; }
      if (j.invite && !j.invite.mine && j.invite.used) h += '<div class="card"><p class="sc">Invitation</p><h2>This link has already been used.</h2><p class="quiet small">Ask ' + esc(host.name) + ' for a new one.</p></div>';
      else if (j.invite && !(j.mine && j.mine.invite_code === j.invite.code)) h += inviteForm(e, j.invite, person || j.mine || {});
      else if (j.mine) h += statusCard(e, j.mine, id) + inviteFriends(e, j.mine) + afterRsvp(e, j.mine, id);
      else if (e.tickets && e.tickets.length) { /* a ticketed event: the tickets are the way in */ }
      else if (!e.open) h += '<div class="card"><h2>The guestlist is closed.</h2><p class="quiet">Thank you for your interest.</p></div>';
      else h += rsvpForm(e, person || {});
      main.innerHTML = h + '</div>';
    }).catch(function (e) { header('guest'); showError(e); });
  }
  // A unique link: the guest registers up to N names (theirs first)
  function inviteForm(e, inv, v) {
    var n = inv.slots, others = v.names || [], rows = '';
    for (var i = 1; i < n; i++) rows += '<label><span>Name ' + (i + 1) + (i === 1 ? ' (optional)' : '') + '</span><input name="n' + i + '" maxlength="100" autocomplete="off" value="' + esc(others[i - 1] || '') + '"></label>';
    return '<div class="stack"><div class="card"><p class="sc">Invitation</p><h2>You\'ve been invited to register ' + n + (n === 1 ? ' name' : ' names') + ' on the guestlist.</h2>' +
      '<p class="quiet small">From ' + esc(e.host.name) + '. Confirmed as soon as you send it.</p></div>' +
      '<form id="f-rsvp" data-id="' + esc(e.id) + '" data-inv="' + esc(inv.code) + '" data-slots="' + n + '">' +
      '<label><span>Your full name</span><input name="name" maxlength="100" required autocomplete="name" value="' + esc(v.name || '') + '"></label>' +
      '<label><span>Your email</span><input name="email" type="email" required autocomplete="email" value="' + esc(v.email || '') + '"></label>' + rows +
      '<p class="err" hidden></p><button class="btn wide" type="submit">RSVP</button></form>' +
      '<p class="quiet small center">Names and email go to ' + esc(e.host.name) + ' only.</p></div>';
  }
  function rsvpForm(e, v) {
    var opts = '';
    for (var i = 0; i <= e.plus_max; i++) opts += '<option value="' + i + '"' + ((v.plus || 0) === i ? ' selected' : '') + '>' + (i === 0 ? 'Just me' : 'Me +' + i) + '</option>';
    return '<div class="stack"><h3>Request a spot on the guestlist</h3>' +
      '<form id="f-rsvp" data-id="' + esc(e.id) + '">' +
      '<label><span>Full name</span><input name="name" maxlength="100" required autocomplete="name" value="' + esc(v.name || '') + '"></label>' +
      '<label><span>Email</span><input name="email" type="email" required autocomplete="email" value="' + esc(v.email || '') + '"></label>' +
      (e.plus_max ? '<label><span>Coming</span><select name="plus">' + opts + '</select></label>' : '') +
      '<p class="err" id="err" hidden></p><button class="btn wide" type="submit">RSVP</button></form>' +
      '<p class="quiet small center">Your name and email go to ' + esc(e.host.name) + ' only.</p></div>';
  }
  function statusCard(e, m, id) {
    var ok = m.status === 'confirmed', no = m.status === 'declined';
    return '<div class="card"><p class="sc">' + (ok ? 'Confirmed' : no ? 'Guestlist' : 'Request sent') + '</p>' +
      '<h2>' + (ok ? 'You\'re on the list.' : no ? 'The list is full.' : 'Your request is in.') + '</h2>' +
      '<p class="quiet">' + esc(m.name) + plusLabel(m.plus) + '</p>' +
      '<p class="quiet small">' + (ok ? 'See you there.' : no ? esc(e.host.name) + ' could not add you this time.' : esc(e.host.name) + ' will confirm. Come back to this page or check your email to see your status update.') + '</p>' +
      (!no && e.open ? '<p><button class="link small" data-act="editrsvp" data-id="' + esc(id) + '">Change my RSVP</button></p>' : '') + '</div>';
  }
  // After the RSVP: receive the next invitations here, with a password.
  // After the RSVP: join the organizer's page to get their next invitations, and keep them here with a password.
  // Guests share the event with friends (when the host allows it): their link carries ?via= so the host sees who brought whom
  function inviteFriends(e, m) {
    if (!m.ref || m.status === 'declined' || !e.open) return '';
    var url = location.origin + eventPath(e, e.host.handle) + '?via=' + m.ref;
    var msg = 'Join me at ' + e.title + (parse(e.starts_at) ? ' (' + shortDate(e.starts_at) + ')' : '') + '. RSVP here: ' + url;
    return '<div class="box"><span class="sc">Invite friends</span><p class="quiet small">Send them your link. They RSVP on the guestlist' + (e.host ? ', and ' + esc(e.host.name) + ' sees they came through you' : '') + '.</p>' +
      '<div class="copyfield"><input readonly value="' + esc(url) + '" onclick="this.select()" style="font-size:14px"><button class="btn small" data-act="copylink" data-id="' + esc(url) + '">Copy</button></div>' +
      '<div class="acts small">' + (navigator.share ? '<button class="btn small line" data-act="sharefriends" data-id="' + esc(url) + '" data-text="' + esc(msg) + '">Share…</button>' : '') +
      '<a class="btn small line" href="https://wa.me/?text=' + encodeURIComponent(msg) + '" target="_blank" rel="noopener">WhatsApp</a>' +
      '<a class="btn small line" href="sms:?&body=' + encodeURIComponent(msg) + '">Message</a>' +
      '<a class="btn small line" href="mailto:?subject=' + encodeURIComponent(e.title) + '&body=' + encodeURIComponent(msg) + '">Email</a></div></div>';
  }
  function afterRsvp(e, m, id) {
    var host = esc(e.host.name), ask = e.host.join === 'approval';
    if (m.consent && ask) return '<p class="quiet small center">You asked to join ' + host + '\'s community. Once they confirm, their next invitations reach you.</p>' + (person ? pushBox({}) : '');
    if (m.consent) {
      if (person) return '<p class="quiet small center">You\'re in ' + host + '\'s community. Their next invitations land in <a href="/me">My invitations</a>.</p>' + pushBox({});
      if (m.has_account) return '<p class="quiet small center">You\'re in ' + host + '\'s community. <a href="/login?as=guest&amp;next=' + encodeURIComponent('/' + id) + '">Log in</a> to see all your invitations.</p>';
      return '<div class="box"><span class="sc">You\'re in ' + host + '\'s community</span>' +
        '<p class="quiet small">Choose a password to find their next invitations here on rsvp.fm, one tap to RSVP.</p>' +
        '<form id="f-person" data-id="' + esc(id) + '"><label><span>Password for ' + esc(m.email) + '</span><input name="password" type="password" minlength="8" required autocomplete="new-password"></label>' +
        '<p class="err" hidden></p><button class="btn" type="submit">Create my account</button></form></div>' + pushBox({ event: id, t: tokenFor(id) });
    }
    var withPassword = !person && !m.has_account;
    return '<div class="box"><span class="sc">Next time</span><h2 style="font-size:24px">Join ' + host + '\'s page</h2>' +
      '<p class="quiet small">Be the first to receive their next invitations.</p>' +
      '<form id="f-keep" data-id="' + esc(id) + '">' +
      (withPassword ? '<label><span>Password (optional)</span><input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="To find them here on rsvp.fm"></label>' : '') +
      '<p class="err" hidden></p><button class="btn" type="submit">' + (ask ? 'Ask to join ' : 'Join ') + host + '</button>' +
      '<p class="quiet small">By joining, you agree that ' + host + ' emails you their next invitations.</p></form></div>';
  }

  // ---------- push notifications (no app: the browser, or rsvp.fm on the iPhone home screen) ----------
  var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var standalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  var pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  var swReady = pushSupported ? navigator.serviceWorker.register('/sw.js').then(function () { return navigator.serviceWorker.ready; }).catch(function () { return null; }) : Promise.resolve(null);
  function b64ToBytes(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var r = atob(s), a = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; }
  // A box that explains, offers or confirms push. ctx: { event, t } when coming from an RSVP without an account.
  function pushBox(ctx) {
    var id = 'push-' + Math.random().toString(36).slice(2, 8);
    setTimeout(function () { renderPush(id, ctx || {}); }, 0);
    return '<div class="box" id="' + id + '" hidden></div>';
  }
  function renderPush(id, ctx) {
    var el = document.getElementById(id); if (!el) return;
    var show = function (h) { el.innerHTML = '<span class="sc">Notifications</span>' + h; el.hidden = false; };
    if (isIOS && !standalone) {
      return show('<p class="small">Get your invitations as notifications on your iPhone, no app to download:</p>' +
        '<ol class="small" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px">' +
        '<li>Tap <b>Share</b> <svg width="14" height="16" viewBox="0 0 14 18" fill="none" stroke="currentColor" stroke-width="1.6" style="vertical-align:-2px"><path d="M7 1v11M3 5l4-4 4 4"/><path d="M4 8H1v9h12V8h-3"/></svg> at the bottom of Safari</li>' +
        '<li>Choose <b>Add to Home Screen</b></li><li>Open rsvp.fm from your home screen, log in, and turn notifications on</li></ol>' +
        (person ? '' : '<p class="quiet small">You will need a password to log in there: create it above.</p>'));
    }
    if (!pushSupported) return;
    if (Notification.permission === 'denied') return show('<p class="quiet small">Notifications are blocked for rsvp.fm in your settings.</p>');
    swReady.then(function (reg) {
      if (!reg) return;
      return reg.pushManager.getSubscription().then(function (sub) {
        if (sub) return show('<p class="small">On this device. New invitations show up as notifications.</p><p><button class="link small" data-act="pushoff" data-id="' + id + '">Turn off</button></p>');
        if (!person && !(ctx.event && ctx.t)) return;
        show('<p class="small">Be told the moment a new invitation arrives, right on this ' + (isIOS ? 'iPhone' : 'device') + '.</p>' +
          '<div><button class="btn small" data-act="pushon" data-id="' + id + '" data-event="' + esc(ctx.event || '') + '" data-t="' + esc(ctx.t || '') + '">Turn on notifications</button></div>');
      });
    });
  }
  function pushOn(b) {
    var id = b.getAttribute('data-id');
    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') throw new Error('Notifications were not allowed.');
      return Promise.all([swReady, api('GET', '/push/key')]);
    }).then(function (r) {
      return r[0].pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(r[1].key) });
    }).then(function (sub) {
      return api('POST', '/push/subscribe', { subscription: sub.toJSON(), event: b.getAttribute('data-event') || undefined, t: b.getAttribute('data-t') || undefined });
    }).then(function () { say('Notifications on.'); renderPush(id, {}); });
  }
  function pushOff(b) {
    var id = b.getAttribute('data-id');
    return swReady.then(function (reg) { return reg && reg.pushManager.getSubscription(); }).then(function (sub) {
      if (!sub) return;
      return api('POST', '/push/unsubscribe', { endpoint: sub.endpoint }).then(function () { return sub.unsubscribe(); });
    }).then(function () { say('Notifications off.'); renderPush(id, {}); });
  }

  // ---------- guests: email settings ----------
  function prefsWidget(digest, q) {
    return '<div class="stack" style="gap:8px"><h3>Invitation emails</h3><div class="seg" id="prefs" data-q="' + esc(q || '') + '">' +
      [['daily', 'As they come'], ['weekly', 'Weekly'], ['never', 'Never']].map(function (o) {
        return '<label><input type="radio" name="digest" value="' + o[0] + '"' + (digest === o[0] ? ' checked' : '') + ' data-act="digest"><span>' + o[1] + '</span></label>';
      }).join('') + '</div><p class="quiet small">From the pages you joined: new invitations, and one reminder when an event is close and you haven\'t answered.</p></div>';
  }
  function viewPrefs() {
    header(); loading();
    var q = location.search;
    api('GET', '/prefs' + q).then(function (j) {
      main.innerHTML = '<div class="stack lg"><div class="stack"><p class="sc">' + esc(j.email) + '</p><h1>Email settings</h1></div>' + prefsWidget(j.digest, q) + '</div>';
    }).catch(showError);
  }

  // ---------- guests: my invitations ----------
  // The guest's feed: pending invitations, then the guestlists they are on, then news from their pages, then the public listing
  function inviteItem(e) {
    var st = e.my_status === 'confirmed' ? 'On the list' + plusLabel(e.my_plus) : e.my_status === 'requested' ? 'Requested' + plusLabel(e.my_plus) : 'Invitation';
    return '<a class="item" href="' + esc(eventPath(e, e.host.handle)) + '"><span class="date">' + esc(shortDate(e.starts_at)) + '</span><span class="main"><span class="t">' + esc(e.title) + '</span>' +
      '<span class="m">' + esc(e.host.name) + ' · ' + esc(st) + '</span></span></a>';
  }
  function listingCard(e) {
    var where = [e.venue, e.city].filter(Boolean).join(', ');
    return '<a class="lcard" href="' + esc(eventPath(e, e.host.handle)) + '">' + (e.photos && e.photos[0] ? '<img src="' + esc(e.photos[0]) + '" alt="" loading="lazy">' : '') +
      '<span class="post-host"><span class="acct-av">' + (e.host.logo ? '<img src="' + esc(e.host.logo) + '" alt="">' : esc(e.host.name.charAt(0).toUpperCase())) + '</span><b>' + esc(e.host.name) + '</b></span>' +
      '<span class="date">' + esc(parse(e.starts_at) ? longDate(e.starts_at) : 'Date to come') + '</span><span class="t">' + esc(e.title) + '</span>' + (where ? '<span class="m">' + esc(where) + '</span>' : '') + '</a>';
  }
  function viewMe() {
    if (!person) return go('/login?as=guest', true);
    header(); setNav('me'); loading();
    api('GET', '/people/me').then(function (j) {
      var pending = j.events.filter(function (e) { return e.my_status === '' || e.my_status === 'requested'; });
      var onList = j.events.filter(function (e) { return e.my_status === 'confirmed'; });
      var h = '<div class="stack lg"><div class="stack"><p class="sc">' + esc(j.person.name) + '</p><h1>Feed</h1></div>';
      if (pending.length) h += '<div class="stack"><h3>Pending</h3><div class="list">' + pending.map(inviteItem).join('') + '</div></div>';
      if (onList.length) h += '<div class="stack"><h3>On the list</h3><div class="list">' + onList.map(inviteItem).join('') + '</div></div>';
      if (!pending.length && !onList.length) h += '<p class="quiet">No invitations right now. They show up here as soon as the pages you follow open a guestlist.</p>';
      if (j.posts && j.posts.length) h += '<div class="stack"><h3>News</h3>' + postsHtml(j.posts, { feed: true, member: true }) + '</div>';
      if (j.listing && j.listing.length) h += '<div class="stack"><h3>Happening</h3><div class="lfeed">' + j.listing.map(listingCard).join('') + '</div></div>';
      if (j.pages.length) h += '<div class="stack"><h3>Pages you follow</h3><div class="list">' + j.pages.map(function (o) {
        return '<a class="item" href="/' + esc(o.handle) + '"><span class="main"><span class="t">' + esc(o.name) + '</span><span class="m">' + (o.my_status === 'requested' ? 'Request sent' : '') + '</span></span></a>';
      }).join('') + '</div></div>';
      h += pushBox({});
      h += '<div id="prefs-slot"></div>';
      h += '<hr class="rule"><p class="quiet small">' + esc(j.person.email) + ' · <button class="link small" data-act="plogout">Log out</button></p>';
      main.innerHTML = h + '</div>';
      api('GET', '/prefs').then(function (p) { var sl = document.getElementById('prefs-slot'); if (sl) sl.innerHTML = prefsWidget(p.digest, ''); }).catch(function () {});
    }).catch(showError);
  }

  // ---------- events ----------
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest('a[href]');
    if (a && a.origin === location.origin && !a.target && !ev.metaKey && !ev.ctrlKey && !a.hasAttribute('download')) { ev.preventDefault(); go(a.pathname + a.search); return; }
    var am = document.getElementById('acct-menu');
    if (am && !am.hidden && !ev.target.closest('#acct-menu') && !ev.target.closest('.acct-btn')) am.hidden = true;
    var b = ev.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
    if (act === 'sort') { current.sort = b.value; renderManage(); return; }
    if (act === 'digest') {
      var q = (document.getElementById('prefs') || {}).getAttribute ? document.getElementById('prefs').getAttribute('data-q') : '';
      api('POST', '/prefs' + (q || ''), { digest: b.value }).then(function (r) { say(r.digest === 'never' ? 'No more invitation emails.' : r.digest === 'weekly' ? 'One email a week, at most.' : 'Saved.'); }).catch(function (e) { say(e.message); });
      return;
    }
    if (act === 'stopauto' || act === 'startauto') {
      var on = act === 'startauto';
      api('POST', '/events/' + current.event.id + '/message', { auto_only: true, auto: on }).then(function () {
        current.event.msg.auto = on; say(on ? 'New guests will get it too.' : 'Stopped. New guests will not get it.'); renderManage();
      }).catch(function (e) { say(e.message); });
      return;
    }
    if (act === 'testmsg') {
      var td = formData(document.getElementById('f-update'));
      if ((!td.text && !td.photo) || !td.test_to) { say('Write the update and a test address.'); return; }
      b.disabled = true;
      api('POST', '/events/' + current.event.id + '/updates', { subject: td.subject, text: td.text, photo: td.photo, test_to: td.test_to }).then(function (r) { b.disabled = false; say('Test sent to ' + r.test + '.'); }).catch(function (e) { b.disabled = false; say(e.message); });
      return;
    }
    if (act === 'delupdate') {
      api('DELETE', '/events/' + current.event.id + '/updates/' + id).then(function () {
        current.event.updates = current.event.updates.filter(function (u) { return String(u.id) !== String(id); }); say('Deleted.'); renderManage();
      }).catch(function (e) { say(e.message); });
      return;
    }
    if (act === 'rmupdphoto') { var fu = document.getElementById('f-update'); fu.elements.namedItem('photo').value = ''; document.getElementById('upd-photo').innerHTML = ''; return; }
    if (act === 'loginas') { go('/login' + (id === 'guest' ? '?as=guest' : ''), true); return; }
    if (act === 'copylink') return copy(id, 'Link copied.');
    if (act === 'sharefriends') { navigator.share({ title: document.title, text: b.getAttribute('data-text'), url: id }).catch(function () {}); return; }
    if (act === 'sharelink') { navigator.share({ title: current.event.title, url: id }).catch(function () {}); return; }
    if (act === 'copytext') return copy(listText(), 'List copied.');
    if (act === 'slots') { current.slots = Math.max(1, Math.min(20, current.slots + Number(id))); var lb = document.getElementById('inv-label'); var keep = lb ? lb.value : ''; renderManage(); var lb2 = document.getElementById('inv-label'); if (lb2) lb2.value = keep; return; }
    if (act === 'shareinv') {
      var n = Number(b.getAttribute('data-slots'));
      navigator.share({ title: current.event.title, text: 'You\'ve been invited to register ' + n + (n === 1 ? ' name' : ' names') + ' on the guestlist of ' + current.event.title + '.', url: id }).catch(function () {});
      return;
    }
    if (act === 'csv') {
      var byIdC = {}; current.guests.forEach(function (x) { byIdC[x.id] = x; });
      return csvDownload([['Name', 'Email', 'Plus ones', 'People', 'Other names', 'Status', 'Keep me posted', 'Invited by', 'Requested at']].concat(sorted().map(function (g) {
        return [g.name, g.email, g.plus, 1 + g.plus, (g.names || []).join('; '), g.status, g.consent ? 'yes' : 'no', g.via && byIdC[g.via] ? byIdC[g.via].name : '', g.created_at];
      })), fileSafe(current.event.title) + '-guestlist.csv');
    }
    if (act === 'commcsv') {
      return csvDownload([['Name', 'Email', 'Status', 'Keep me posted', 'On rsvp.fm', 'Source', 'Since']].concat((viewCommunity.list || []).map(function (c) {
        return [c.name, c.email, c.status, c.consent ? 'yes' : 'no', c.has_account ? 'yes' : 'no', c.source, c.created_at];
      })), fileSafe(org.name) + '-community.csv');
    }
    if (act === 'editrsvp') {
      api('GET', '/p/' + id + '?t=' + encodeURIComponent(tokenFor(id))).then(function (j) {
        var card = main.querySelector('.card');
        if (card) card.outerHTML = j.mine && j.mine.invite_code ? inviteForm(j.event, { code: j.mine.invite_code, slots: (j.invite && j.invite.slots) || (j.mine.names.length + 1) }, j.mine) : rsvpForm(j.event, j.mine || {});
        var box = main.querySelector('#f-person'); if (box) box.closest('.box').remove();
      });
      return;
    }
    if (act === 'pushon' || act === 'pushoff') {
      b.disabled = true;
      (act === 'pushon' ? pushOn(b) : pushOff(b)).catch(function (e) { say(e.message || 'Could not change notifications.'); b.disabled = false; });
      return;
    }
    if (act === 'rmphoto') { setFormPhotos(formPhotos().filter(function (u) { return u !== id; })); return; }
    if (act === 'coverphoto') { var pl = formPhotos().filter(function (u) { return u !== id; }); pl.unshift(id); setFormPhotos(pl); return; }
    if (act === 'accounts') { accountsMenu(); return; }
    if (act === 'qtystep') { var qf = document.getElementById('f-buy'), qi = qf.elements.namedItem('qty'); qi.value = (parseInt(qi.value, 10) || 1) + parseInt(id, 10); buyTotal(buyEv); return; }
    if (act === 'tixreleases') { api('PATCH', '/events/' + current.event.id + '/tickets/releases', { on: b.checked }).then(loadTix).catch(function (e) { say(e.message); }); return; }
    if (act === 'tixactive') { api('PATCH', '/events/' + current.event.id + '/tickets/' + id, { active: b.getAttribute('data-on') !== '1' }).then(loadTix).catch(function (e) { say(e.message); }); return; }
    if (act === 'tixdel') { api('DELETE', '/events/' + current.event.id + '/tickets/' + id).then(loadTix).catch(function (e) { say(e.message); }); return; }
    if (act === 'postcomments') {
      var on = b.getAttribute('data-on') !== '1';
      api('PATCH', '/posts/' + id, { comments: on }).then(function () { say(on ? 'Comments on.' : 'Comments off.'); refreshNews(); }).catch(function (e) { say(e.message); });
      return;
    }
    if (act === 'delpost') {
      if (b.getAttribute('data-sure') !== '1') { b.setAttribute('data-sure', '1'); b.textContent = 'Tap again to delete'; return; }
      api('DELETE', '/posts/' + id).then(function () { say('Deleted.'); refreshNews(); }).catch(function (e) { say(e.message); });
      return;
    }
    if (act === 'delcomment') { api('DELETE', '/comments/' + id).then(function () { say('Comment deleted.'); refreshNews(); }).catch(function (e) { say(e.message); }); return; }
    if (act === 'rmpostphoto') { var fp = document.getElementById('f-post'); fp.elements.namedItem('photo').value = ''; document.getElementById('post-photo').innerHTML = ''; return; }
    if (act === 'switchacct') {
      api('POST', '/switch', id === 'guest' ? { guest: true } : { handle: id }).then(function (j) {
        org = j.org; person = j.person || person; say('Now using ' + (org ? org.name : person.name) + '.'); go(org ? '/' : '/me', true);
      }).catch(function (e) { say(e.message); });
      return;
    }
    if (act === 'logout') { api('POST', '/logout').then(function () { org = null; go('/', true); }); return; }
    if (act === 'plogout') { api('POST', '/people/logout').then(function () { person = null; go('/', true); }); return; }
    b.disabled = true;
    var done = function () { b.disabled = false; };
    if (act === 'status') {
      var to = b.getAttribute('data-to');
      api('PATCH', '/events/' + current.event.id + '/guests/' + id, { status: to }).then(function () {
        current.guests.forEach(function (g) { if (String(g.id) === id) g.status = to; });
        renderManage();
      }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'member') {
      api('PATCH', '/community/' + id, { status: b.getAttribute('data-to') }).then(function (r) { say(r.status === 'member' ? 'Accepted.' : 'Declined.'); viewCommunity(); }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'newinv') {
      var lab = (document.getElementById('inv-label') || {}).value || '';
      api('POST', '/events/' + current.event.id + '/invites', { slots: current.slots, label: lab }).then(function (r) {
        current.invites.unshift({ code: r.code, slots: r.slots, label: lab, used: false, names: [] });
        renderManage(); copy(inviteUrl(r.code), 'Link created and copied.');
      }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'delinv') {
      api('DELETE', '/events/' + current.event.id + '/invites/' + id).then(function () {
        current.invites = current.invites.filter(function (i) { return i.code !== id; }); renderManage(); say('Link deleted.');
      }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'confirmall') {
      api('POST', '/events/' + current.event.id + '/confirm-all').then(function (r) {
        current.guests.forEach(function (g) { if (g.status === 'requested') g.status = 'confirmed'; });
        renderManage(); say(r.confirmed + ' confirmed' + (r.emailed ? ', emails on their way.' : '.'));
      }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'toggleopen') {
      var open = !current.event.open;
      api('POST', '/events/' + current.event.id + '/open', { open: open }).then(function () {
        current.event.open = open; renderManage(); say(open ? 'Guestlist reopened.' : 'Guestlist closed.');
      }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'rmlogo') {
      api('DELETE', '/me/logo').then(function () { org.logo = ''; viewAccount(); }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'newinvite') {
      api('POST', '/me/invite-link').then(function (r) { org.invite_token = r.invite_token; say('New link. The old one no longer works.'); viewAccount(); }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'delevent') {
      if (b.getAttribute('data-confirm') !== '1') { b.setAttribute('data-confirm', '1'); b.textContent = 'Tap again to delete it for good'; return done(); }
      api('DELETE', '/events/' + id).then(function () { say('Deleted.'); go('/', true); }).catch(function (e) { say(e.message); done(); });
    }
  });
  document.addEventListener('change', function (ev) {
    if (ev.target.name === 'type_id' && ev.target.closest('#f-buy')) { buyTotal(buyEv); return; }
    if (ev.target.name === 'email' && ev.target.closest('#f-update')) {
      var um = document.getElementById('upd-mail'); if (um) um.hidden = !ev.target.checked;
      var fu0 = document.getElementById('f-update'); fu0.setAttribute('data-confirm', '0'); fu0.querySelector('[type=submit]').textContent = 'Post the update';
      return;
    }
    if (ev.target.id === 'up-post' && ev.target.files.length) {
      var fpp = document.getElementById('f-post'), sbp = fpp.querySelector('[type=submit]');
      sbp.disabled = true; say('Uploading the photo…');
      preparePhoto(ev.target.files[0]).then(function (data) { return api('POST', '/images', { data: data }); }).then(function (r) {
        fpp.elements.namedItem('photo').value = r.url;
        document.getElementById('post-photo').innerHTML = '<img class="upd-photo" src="' + esc(r.url) + '" alt=""><div><button type="button" class="link small" data-act="rmpostphoto">Remove the photo</button></div>';
        sbp.disabled = false;
      }).catch(function (e) { sbp.disabled = false; say(e.message); });
      ev.target.value = '';
      return;
    }
    if (ev.target.id === 'up-upd' && ev.target.files.length) {
      var fu = document.getElementById('f-update'), sb = fu.querySelector('[type=submit]');
      sb.disabled = true; say('Uploading the photo…');
      preparePhoto(ev.target.files[0]).then(function (data) { return api('POST', '/images', { data: data }); }).then(function (r) {
        fu.elements.namedItem('photo').value = r.url;
        document.getElementById('upd-photo').innerHTML = '<img class="upd-photo" src="' + esc(r.url) + '" alt=""><div><button type="button" class="link small" data-act="rmupdphoto">Remove the photo</button></div>';
        sb.disabled = false;
      }).catch(function (e) { sb.disabled = false; say(e.message); });
      ev.target.value = '';
      return;
    }
    if (ev.target.id === 'up-photos' && ev.target.files.length) {
      var files = Array.prototype.slice.call(ev.target.files, 0, 12), list = formPhotos(), btn = document.querySelector('#f-event [type=submit]');
      if (btn) btn.disabled = true;
      say('Uploading ' + files.length + (files.length === 1 ? ' photo…' : ' photos…'));
      files.reduce(function (p, f) {
        return p.then(function () {
          if (list.length >= 12) return;
          return preparePhoto(f).then(function (data) { return api('POST', '/images', { data: data }); }).then(function (r) { list.push(r.url); setFormPhotos(list); });
        });
      }, Promise.resolve()).then(function () { say('Photos added. Save to publish them.'); }).catch(function (e) { say(e.message); })
        .then(function () { if (btn) btn.disabled = false; ev.target.value = ''; });
      return;
    }
    if (ev.target.id !== 'up-logo' || !ev.target.files[0]) return;
    say('Uploading…');
    prepareLogo(ev.target.files[0]).then(function (data) { return api('POST', '/me/logo', { data: data }); })
      .then(function (r) { org.logo = r.logo; say('Logo updated.'); viewAccount(); })
      .catch(function (e) { say(e.message); });
  });
  document.addEventListener('submit', function (ev) {
    var f = ev.target; ev.preventDefault();
    var err = f.querySelector('.err'), btn = f.querySelector('[type=submit]');
    var fail = function (e) { if (err) { err.textContent = e.message; err.hidden = false; } else say(e.message); if (btn) btn.disabled = false; };
    if (err) err.hidden = true;
    if (btn) btn.disabled = true;
    var d = formData(f);
    var next = new URLSearchParams(location.search).get('next');
    var safeNext = next && /^\/[^/]/.test(next) ? next : '';
    if (f.id === 'f-signup') {
      api('POST', '/signup', d).then(function (j) { org = j.org; go('/account', true); say('Welcome. Set up your page.'); }).catch(fail);
    } else if (f.id === 'f-login') {
      api('POST', '/login', d).then(function (j) {
        if (j.org) org = j.org; else { person = j.person; org = null; }
        go(safeNext || (j.org ? '/' : '/me'), true);
      }).catch(fail);
    } else if (f.id === 'f-account') {
      api('PATCH', '/me', d).then(function (j) { org = j.org; say('Saved.'); viewAccount(); }).catch(fail);
    } else if (f.id === 'f-event') {
      var eid = f.getAttribute('data-id');
      d.plus_max = Number(d.plus_max);
      api(eid ? 'PATCH' : 'POST', eid ? '/events/' + eid : '/events', d).then(function (j) { say(eid ? 'Saved.' : 'Your guestlist is ready.'); go('/e/' + j.id, true); }).catch(fail);
    } else if (f.id === 'f-rsvp') {
      var gid = f.getAttribute('data-id');
      d.plus = Number(d.plus || 0);
      if (f.getAttribute('data-inv')) {
        d.inv = f.getAttribute('data-inv'); d.t = tokenFor(gid) || undefined; d.names = [];
        for (var k = 1; k < Number(f.getAttribute('data-slots')); k++) if (d['n' + k]) d.names.push(d['n' + k]);
      }
      try { d.via = sessionStorage.getItem('via:' + gid) || undefined; } catch (e) {}
      api('POST', '/p/' + gid + '/rsvp', d).then(function (r) {
        try { localStorage.setItem('gl:' + gid, r.token); } catch (e) {}
        history.replaceState({}, '', location.pathname + '?t=' + encodeURIComponent(r.token));
        viewGuest(gid);
      }).catch(fail);
    } else if (f.id === 'f-person') {
      var pid = f.getAttribute('data-id');
      api('POST', '/people/signup', { event: pid, t: tokenFor(pid), password: d.password }).then(function (j) {
        person = j.person; say('Done. Your next invitations will be waiting here.'); viewGuest(pid);
      }).catch(fail);
    } else if (/^f-tixcap-/.test(f.id)) {
      api('PATCH', '/events/' + current.event.id + '/tickets/' + f.getAttribute('data-id'), { capacity: d.capacity || 0, sale_ends: d.sale_ends ? new Date(d.sale_ends).toISOString() : '' }).then(function () { say('Saved.'); loadTix(); }).catch(fail);
    } else if (f.id === 'f-tixtype') {
      api('POST', '/events/' + current.event.id + '/tickets', d).then(function () { say('Ticket added. It is on sale on your event page.'); loadTix(); }).catch(fail);
    } else if (f.id === 'f-buy') {
      try { d.k = sessionStorage.getItem('k:' + f.getAttribute('data-id')) || undefined; } catch (e) {}
      api('POST', '/p/' + f.getAttribute('data-id') + '/checkout', d).then(function (r) { location.href = r.url; }).catch(fail);
    } else if (f.id === 'f-scan') {
      if (d.code) checkTicket(scanState.event, d.code); f.reset(); btn.disabled = false;
    } else if (f.id === 'f-post') {
      if (!d.text && !d.photo) { fail(new Error('Write something or add a photo.')); return; }
      api('POST', '/posts', { text: d.text, photo: d.photo, comments: !!d.comments }).then(function () {
        say('Published.'); f.reset(); f.elements.namedItem('photo').value = ''; document.getElementById('post-photo').innerHTML = ''; btn.disabled = false; loadNews();
      }).catch(fail);
    } else if (/^f-comment-/.test(f.id)) {
      if (!d.text) { btn.disabled = false; return; }
      api('POST', '/posts/' + f.getAttribute('data-id') + '/comments', { text: d.text }).then(function () { refreshNews(); }).catch(fail);
    } else if (f.id === 'f-forgot') {
      api('POST', '/forgot', d).then(function () {
        main.innerHTML = '<div class="stack lg center"><h1>Check your email</h1><p class="quiet">If an account matches <b>' + esc(d.login) + '</b>, a login link is on its way. It works once, for one hour.</p><p class="small"><a href="/login">Back to log in</a></p></div>';
      }).catch(fail);
    } else if (f.id === 'f-newpass') {
      var asg = f.getAttribute('data-as');
      api('POST', '/password', { password: d.password, as: asg }).then(function () { say('Password saved.'); go(asg === 'org' ? '/' : '/me', true); }).catch(fail);
    } else if (f.id === 'f-update') {
      if (!d.text && !d.photo) { fail(new Error('Write something or add a photo.')); return; }
      var n = current.guests.filter(function (g) { return g.status === 'confirmed'; }).length;
      if (d.email && f.getAttribute('data-confirm') !== '1') {
        f.setAttribute('data-confirm', '1'); btn.disabled = false; btn.textContent = 'Tap again to post and email ' + n + (n === 1 ? ' person' : ' people'); return;
      }
      api('POST', '/events/' + current.event.id + '/updates', { text: d.text, photo: d.photo, guests_only: !!d.guests_only, email: !!d.email, subject: d.subject, auto: !!d.auto }).then(function (r) {
        say('Posted' + (d.email ? ' and emailed to ' + r.sent + (r.sent === 1 ? ' guest.' : ' guests.') : '.'));
        current.event.updates = [r.update].concat(current.event.updates || []);
        if (d.email) current.event.msg = { subject: d.subject, text: d.text, auto: !!d.auto };
        renderManage();
      }).catch(fail);
    } else if (f.id === 'f-keep') {
      var kid = f.getAttribute('data-id');
      api('POST', '/p/' + kid + '/keep', { t: tokenFor(kid), password: d.password || '' }).then(function (r) {
        if (r.person) person = r.person;
        say(r.status === 'requested' ? 'Request sent. They confirm who joins.' : 'You joined. Their next invitations will reach you.'); viewGuest(kid);
      }).catch(fail);
    } else if (f.id === 'f-join') {
      d.i = f.getAttribute('data-i');
      api('POST', '/o/' + f.getAttribute('data-handle') + '/join', d).then(function (r) {
        if (r.person) person = r.person;
        say(r.status === 'member' ? 'You\'re in.' : 'Request sent.'); route();
      }).catch(fail);
    }
  });

  // ---------- routing ----------
  function route() {
    stopScan();
    var p = location.pathname.replace(/\/+$/, '') || '/', m;
    if (p === '/') return org ? viewEvents() : person ? viewMe() : standalone ? viewLogin() : viewWelcome();
    if (p === '/login') return viewLogin();
    if (p === '/forgot') return viewForgot();
    if (p === '/reset') return viewReset();
    if (p === '/signup') return org ? go('/', true) : viewSignup();
    if (p === '/account') return viewAccount();
    if (p === '/community') return viewCommunity();
    if (p === '/me') return viewMe();
    if (p === '/news') return go('/me', true);
    if (p === '/prefs') return viewPrefs();
    if (p === '/new') return viewNew();
    if ((m = /^\/e\/([a-z0-9]{4,16})$/.exec(p))) return org ? viewManage(m[1]) : (history.replaceState({}, '', '/' + m[1]), viewGuest(m[1]));
    if ((m = /^\/i\/([a-z0-9]{4,16})$/i.exec(p))) {
      return api('GET', '/invite/' + m[1].toLowerCase()).then(function (r) { go(r.handle ? '/' + r.handle : '/', true); }).catch(function () { go('/', true); });
    }
    if ((m = /^\/e\/([a-z0-9]{4,16})\/edit$/.exec(p))) return viewEdit(m[1]);
    if ((m = /^\/e\/([a-z0-9]{4,16})\/scan$/.exec(p))) return viewScan(m[1]);
    if ((m = /^\/tickets\/([A-Za-z0-9_-]{20,64})$/.exec(p))) return viewTickets(m[1]);
    if ((m = /^\/([a-z0-9][a-z0-9_-]{1,29})\/([a-z0-9][a-z0-9-]{0,59})(?:\/([a-z0-9][a-z0-9-]{0,29}))?$/i.exec(p)) && m[1] !== 'e' && m[1] !== 'i') {
      loading();
      var secret = m[3] ? m[3].toLowerCase() : '';
      return api('GET', '/resolve/' + m[1].toLowerCase() + '/' + m[2].toLowerCase()).then(function (r) { if (secret) { try { sessionStorage.setItem('k:' + r.id, secret); } catch (e) {} } viewGuest(r.id); })
        .catch(function (e) { header('guest'); showError(e); });
    }
    if ((m = /^\/([a-z0-9][a-z0-9_-]{1,29})$/i.exec(p))) {
      var slug = m[1].toLowerCase();
      loading();
      return api('GET', '/resolve/' + slug).then(function (r) { return r.type === 'event' ? viewGuest(slug) : viewOrg(slug); })
        .catch(function (e) { header('guest'); showError(e); });
    }
    header(); main.innerHTML = '<div class="stack center"><p class="when">Nothing here.</p><p><a href="/">Back</a></p></div>';
  }
  window.addEventListener('popstate', route);
  api('GET', '/session').then(function (j) { org = j.org; person = j.person; mailOn = !!j.mail; }).catch(function () {}).then(route);
})();
