// rsvp.fm — Guestlist. Organizer pages and event pages for guests; a small back office for organizers.
(function () {
  'use strict';
  var main = document.getElementById('main');
  var hdr = document.getElementById('hdr');
  var org = null, person = null, mailOn = false;
  var KINDS = { promoter: 'Promoter', label: 'Label', artist: 'Artist' };
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // Six themes for organizer pages: colors and type. Fonts load when a theme is shown.
  var THEMES = {
    terminal: { name: 'Terminal', paper: '#0A0A0A', ink: '#E6E6E6', accent: '#3DDC84', d: 'JetBrains Mono', t: 'JetBrains Mono' },
    phosphor: { name: 'Phosphor', paper: '#030803', ink: '#8CFF9E', accent: '#D4FF5C', d: 'IBM Plex Mono', t: 'IBM Plex Mono' },
    amber: { name: 'Amber', paper: '#0D0A04', ink: '#FFB347', accent: '#FFD9A0', d: 'Space Mono', t: 'Space Mono' },
    graphite: { name: 'Graphite', paper: '#16181D', ink: '#D7DAE0', accent: '#61AFEF', d: 'Fira Code', t: 'Fira Code' },
    solarized: { name: 'Solarized', paper: '#002B36', ink: '#EEE8D5', accent: '#B58900', d: 'Source Code Pro', t: 'Source Code Pro' },
    nocturne: { name: 'Nocturne', paper: '#0B0B12', ink: '#E4DFF5', accent: '#A68BFF', d: 'Instrument Serif', t: 'IBM Plex Mono' }
  };
  var DEFAULT_THEME = 'terminal';
  // Fonts for themes and custom themes (loaded from Google Fonts when shown)
  var FONTS = {
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
  function fontStack(name) { var f = FONTS[name] || {}; return "'" + name + "'," + (f.mono ? 'ui-monospace,Menlo,monospace' : f.serif ? 'Georgia,serif' : 'system-ui,sans-serif'); }
  var loadedFonts = {};
  function loadFont(name) {
    var f = FONTS[name]; if (!f || loadedFonts[name]) return;
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
  function theme(t, custom) {
    var body = document.body;
    CUSTOM_VARS.forEach(function (v) { body.style.removeProperty(v); });
    body.removeAttribute('data-plain');
    if (t === 'custom' && custom) {
      var vars = customVars(custom);
      Object.keys(vars).forEach(function (k) { body.style.setProperty(k, vars[k]); });
      loadFont(custom.display); loadFont(custom.text);
      body.setAttribute('data-theme', 'custom');
      if (!(FONTS[custom.text] || {}).mono) body.setAttribute('data-plain', '1');
    } else {
      if (t !== '') t = THEMES[t] ? t : DEFAULT_THEME;
      if (t) { loadFonts(t); body.setAttribute('data-theme', t); } else body.removeAttribute('data-theme');
    }
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', t === 'custom' && custom ? custom.paper : t ? THEMES[t].paper : '#F2EDE3');
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
  function pageUrl(id) { return location.origin + '/' + id; }
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
    if (kind === 'guest') h += person ? '<nav class="nav"><a href="/me">My invitations</a></nav>' : '<span class="sc">Guestlist</span>';
    else if (org) h += '<nav class="nav"><a href="/" data-nav="events">Events</a><a href="/community" data-nav="community">Community</a><a href="/account" data-nav="account">Page</a></nav>';
    else if (person) h += '<nav class="nav"><a href="/me" data-nav="me">My invitations</a></nav>';
    else h += '<nav class="nav"><a href="/login">Log in</a></nav>';
    hdr.innerHTML = h;
    if (kind !== 'guest') theme('');
  }
  function setNav(name) { Array.prototype.forEach.call(hdr.querySelectorAll('[data-nav]'), function (a) { a.classList.toggle('on', a.getAttribute('data-nav') === name); }); }
  function loading() { main.innerHTML = '<p class="quiet center">Loading…</p>'; }
  function showError(e) { main.innerHTML = '<div class="stack center"><p class="when">' + esc(e.message) + '</p><p><a href="/">Back</a></p></div>'; }

  // ---------- welcome, sign up, log in ----------
  function viewWelcome() {
    header();
    main.innerHTML = '<div class="stack lg">' +
      '<p class="sc">For promoters, labels &amp; artists</p>' +
      '<h1>The guestlist,<br><em>kept simply.</em></h1>' +
      '<p class="lead">Your page, your events, one link each. Your guests leave their name and RSVP; you confirm the list and take it to the door. They can ask to receive your next invitations.</p>' +
      '<div class="acts"><a class="btn" href="/signup">Create an account</a><a class="btn line" href="/login">Log in</a></div>' +
      '<hr class="rule">' +
      '<div class="stack">' +
      '<div><h2><em>i.</em> Your page</h2><p class="quiet">Your logo, a few words, one of six themes. Public, or private: by invitation only.</p></div>' +
      '<div><h2><em>ii.</em> Your guestlists</h2><p class="quiet">A name, a date, a place. Guests write their full name and email, bring a +1, +2 or +3 if you allow it, and RSVP.</p></div>' +
      '<div><h2><em>iii.</em> Your community</h2><p class="quiet">Everyone who RSVPs can ask to be kept posted. Next time, they hear from you first.</p></div>' +
      '</div></div>';
  }
  function kindSeg(current) {
    return '<fieldset style="border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:6px"><span class="sc" style="font-size:13px">You are</span><div class="seg">' +
      ['promoter', 'label', 'artist'].map(function (k) { return '<label><input type="radio" name="kind" value="' + k + '"' + ((current || 'promoter') === k ? ' checked' : '') + '><span>' + KINDS[k] + '</span></label>'; }).join('') +
      '</div></fieldset>';
  }
  function viewSignup() {
    header();
    main.innerHTML = '<div class="stack lg"><div class="stack"><p class="sc">Organizers</p><h1>Create an account</h1></div>' +
      '<form id="f-signup">' +
      '<label><span>Name guests will see</span><input name="name" maxlength="80" required placeholder="Your label, collective or artist name" autocomplete="organization"></label>' +
      kindSeg('promoter') +
      '<label><span>Email</span><input name="email" type="email" required autocomplete="email"></label>' +
      '<label><span>Password</span><input name="password" type="password" minlength="8" required autocomplete="new-password"></label>' +
      '<p class="err" id="err" hidden></p><button class="btn wide" type="submit">Create my account</button></form>' +
      '<p class="quiet small center">Already have one? <a href="/login">Log in</a></p></div>';
  }
  function viewLogin() {
    header();
    var who = new URLSearchParams(location.search).get('as') === 'guest' ? 'guest' : 'org';
    main.innerHTML = '<div class="stack lg"><div class="stack"><div class="tabs2"><button data-act="loginas" data-id="org" class="' + (who === 'org' ? 'on' : '') + '">Organizer</button><button data-act="loginas" data-id="guest" class="' + (who === 'guest' ? 'on' : '') + '">Guest</button></div><h1 class="center">Log in</h1></div>' +
      '<form id="f-login" data-as="' + who + '"><label><span>Email</span><input name="email" type="email" required autocomplete="email"></label>' +
      '<label><span>Password</span><input name="password" type="password" required autocomplete="current-password"></label>' +
      '<p class="err" id="err" hidden></p><button class="btn wide" type="submit">Log in</button></form>' +
      (who === 'org' ? '<p class="quiet small center">New here? <a href="/signup">Create an organizer account</a></p>' : '<p class="quiet small center">Guests create their password after an RSVP.</p>') + '</div>';
  }

  // ---------- organizer: page settings ----------
  function swatch(paper, ink, d, t, name, sub) {
    return '<span class="sw" style="background:' + paper + ';color:' + ink + '"><b style="font-family:' + fontStack(d) + '">Aa</b><i style="font-family:' + fontStack(t) + '">' + name + '</i><small style="font-family:' + fontStack(t) + '">' + sub + '</small></span>';
  }
  function themeGrid(current, custom) {
    Object.keys(THEMES).forEach(loadFonts);
    var c = custom || startCustom(current);
    return '<div class="themes">' + Object.keys(THEMES).map(function (k) {
      var t = THEMES[k];
      return '<label><input type="radio" name="theme" value="' + k + '"' + (current === k ? ' checked' : '') + '>' + swatch(t.paper, t.ink, t.d, t.t, t.name, t.d === t.t ? t.d : t.d.split(' ')[0] + ' · ' + t.t) + '</label>';
    }).join('') +
      '<label><input type="radio" name="theme" value="custom"' + (current === 'custom' ? ' checked' : '') + '><span id="sw-custom">' + swatch(c.paper, c.ink, c.display, c.text, 'Custom', 'Your colors, your type') + '</span></label>' +
      '</div>' + customEditor(c, current === 'custom');
  }
  function startCustom(from) {
    var t = THEMES[from] || THEMES[DEFAULT_THEME];
    return { paper: t.paper, ink: t.ink, accent: t.accent, display: t.d, text: t.t };
  }
  function fontSelect(name, value) {
    return '<select name="' + name + '" data-custom="1">' + Object.keys(FONTS).map(function (f) { return '<option' + (f === value ? ' selected' : '') + '>' + f + '</option>'; }).join('') + '</select>';
  }
  function customEditor(c, open) {
    return '<div id="custom-ed" class="box"' + (open ? '' : ' hidden') + '><span class="sc">Custom theme</span>' +
      '<div class="colors">' +
      '<label><span>Background</span><input type="color" name="c_paper" data-custom="1" value="' + c.paper + '"></label>' +
      '<label><span>Text</span><input type="color" name="c_ink" data-custom="1" value="' + c.ink + '"></label>' +
      '<label><span>Accent</span><input type="color" name="c_accent" data-custom="1" value="' + c.accent + '"></label></div>' +
      '<label><span>Titles</span>' + fontSelect('c_display', c.display) + '</label>' +
      '<label><span>Text</span>' + fontSelect('c_text', c.text) + '</label>' +
      '<div class="acts small"><span class="quiet">Start from</span>' + Object.keys(THEMES).map(function (k) { return '<button type="button" class="link small" data-act="customfrom" data-id="' + k + '">' + THEMES[k].name + '</button>'; }).join('') + '</div>' +
      '<div id="custom-preview"></div></div>';
  }
  function readCustom() {
    var f = document.getElementById('f-account'); if (!f) return null;
    var v = function (n) { var el = f.elements.namedItem(n); return el ? el.value : ''; };
    return { paper: v('c_paper'), ink: v('c_ink'), accent: v('c_accent'), display: v('c_display'), text: v('c_text') };
  }
  function renderCustomPreview() {
    var c = readCustom(), el = document.getElementById('custom-preview'); if (!c || !el) return;
    loadFont(c.display); loadFont(c.text);
    var vars = customVars(c), ratio = contrast(c.paper, c.ink);
    el.innerHTML = '<div style="background:' + c.paper + ';color:' + c.ink + ';border:1px solid ' + vars['--line'] + ';padding:22px 18px;display:flex;flex-direction:column;gap:10px;text-align:center">' +
      '<span style="font:500 11px/1.3 ' + vars['--text'] + ';letter-spacing:.12em;text-transform:uppercase;color:' + vars['--muted'] + '">' + esc(org.name) + ' invites you</span>' +
      '<span style="font:400 30px/1.1 ' + vars['--display'] + '">Name of the night</span>' +
      '<span style="font:400 15px/1.4 ' + vars['--text'] + ';color:' + c.accent + '">Saturday 31 October, 23:00</span>' +
      '<span style="font:400 14px/1.5 ' + vars['--text'] + ';color:' + vars['--muted'] + '">Sunset to sunrise. Dress up.</span>' +
      '<span style="align-self:center;margin-top:6px;background:' + c.ink + ';color:' + c.paper + ';font:500 12px/1 ' + vars['--text'] + ';letter-spacing:.12em;padding:13px 26px">RSVP</span></div>' +
      (ratio < 4.5 ? '<p class="err small" style="margin-top:8px">Low contrast between background and text: guests may struggle to read.</p>' : '');
    var sw = document.getElementById('sw-custom'); if (sw) sw.innerHTML = swatch(c.paper, c.ink, c.display, c.text, 'Custom', 'Your colors, your type');
  }

  function viewAccount() {
    if (!org) return go('/login', true);
    header(); setNav('account');
    var inv = location.origin + '/' + org.handle + '?i=' + org.invite_token;
    main.innerHTML = '<div class="stack lg"><div class="toolbar"><h1>Your page</h1><a class="btn small line" href="/' + esc(org.handle) + '">View</a></div>' +
      '<div class="stack"><span class="sc">Logo</span><div class="box" style="align-items:center;background:' + (org.custom && org.theme === 'custom' ? org.custom : THEMES[org.theme] || THEMES[DEFAULT_THEME]).paper + ';color:' + (org.custom && org.theme === 'custom' ? org.custom : THEMES[org.theme] || THEMES[DEFAULT_THEME]).ink + '">' + (org.logo ? logoImg(org.logo) : '<p class="quiet small">No logo yet. A square or wide mark on a transparent background looks best.</p>') +
      '<div class="acts"><label class="btn small line" style="flex-direction:row;cursor:pointer">' + (org.logo ? 'Replace' : 'Upload a logo') + '<input type="file" id="up-logo" accept="image/png,image/jpeg,image/webp" hidden></label>' +
      (org.logo ? '<button class="link small" data-act="rmlogo">Remove</button>' : '') + '</div></div></div>' +
      '<form id="f-account">' +
      '<label><span>Address</span><span class="prefix"><em>' + esc(location.host) + '/</em><input name="handle" maxlength="30" required autocapitalize="none" autocomplete="off" value="' + esc(org.handle) + '"></span></label>' +
      '<label><span>Name</span><input name="name" maxlength="80" required value="' + esc(org.name) + '"></label>' +
      kindSeg(org.kind) +
      '<label><span>Bio</span><textarea name="bio" maxlength="600" placeholder="A few words about you, your nights, your music.">' + esc(org.bio) + '</textarea></label>' +
      '<div class="stack" style="gap:8px"><span class="sc" style="font-size:13px">Theme</span>' + themeGrid(org.theme === 'custom' || THEMES[org.theme] ? org.theme : DEFAULT_THEME, org.custom) + '</div>' +
      '<div class="stack" style="gap:8px"><span class="sc" style="font-size:13px">Who can see your events</span><div class="seg">' +
      '<label><input type="radio" name="visibility" value="public"' + (org.visibility !== 'private' ? ' checked' : '') + '><span>Everyone</span></label>' +
      '<label><input type="radio" name="visibility" value="private"' + (org.visibility === 'private' ? ' checked' : '') + '><span>By invitation</span></label></div>' +
      '<p class="quiet small">By invitation: visitors see your name, logo and bio, and can request an invitation. People you accept, people who RSVP\'d to one of your events, and people with your invitation link see your events.</p></div>' +
      '<p class="err" id="err" hidden></p><button class="btn" type="submit">Save</button></form>' +
      '<div class="box"><span class="sc">Invitation link to your page</span><span class="linkline">' + esc(inv.replace(/^https?:\/\//, '')) + '</span>' +
      '<p class="quiet small">Whoever opens it can see your events and join your community, even when your page is by invitation.</p>' +
      '<div class="acts"><button class="btn small" data-act="copylink" data-id="' + esc(inv) + '">Copy link</button><button class="link small" data-act="newinvite">Make a new link</button></div></div>' +
      '<hr class="rule"><p class="quiet small">' + esc(org.email) + ' · <button class="link small" data-act="logout">Log out</button></p></div>';
    renderCustomPreview();
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
      '<div class="two"><label><span>Starts</span><input name="starts_at" type="datetime-local" value="' + esc(v.starts_at || '') + '"></label>' +
      '<label><span>Ends (optional)</span><input name="ends_at" type="datetime-local" value="' + esc(v.ends_at || '') + '"></label></div>' +
      '<div class="two"><label><span>Venue</span><input name="venue" maxlength="120" value="' + esc(v.venue || '') + '"></label>' +
      '<label><span>City</span><input name="city" maxlength="80" value="' + esc(v.city || '') + '"></label></div>' +
      '<label><span>Details</span><textarea name="details" maxlength="4000" placeholder="Line-up, address, dress code, door time, anything guests should know.">' + esc(v.details || '') + '</textarea></label>' +
      '<label><span>Guests may bring</span><select name="plus_max">' +
      ['No one', 'A +1', 'Up to +2', 'Up to +3'].map(function (t, i) { return '<option value="' + i + '"' + (pm === i ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></label>' +
      '<label class="check"><input type="checkbox" name="auto_confirm"' + (v.auto_confirm ? ' checked' : '') + '><span>Confirm requests automatically<small>Otherwise every RSVP waits for your confirmation.</small></span></label>' +
      '<label class="check"><input type="checkbox" name="open"' + (v.open === false ? '' : ' checked') + '><span>Guestlist open<small>Close it when you are full: the page stays, the form goes.</small></span></label>' +
      '<p class="err" id="err" hidden></p><div class="acts"><button class="btn" type="submit">' + (id ? 'Save' : 'Create the guestlist') + '</button>' +
      (id ? '<a class="link" href="/e/' + esc(id) + '">Cancel</a>' : '') + '</div></form>';
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
  var current = null;
  function viewManage(id) {
    if (!org) return go('/login?next=' + encodeURIComponent('/e/' + id), true);
    header(); setNav('events'); loading();
    api('GET', '/events/' + id).then(function (j) {
      current = { event: j.event, guests: j.guests, sort: (current && current.sort) || 'arrival' };
      renderManage();
    }).catch(showError);
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
    var e = current.event, c = counts(current.guests), url = pageUrl(e.id);
    var h = '<div class="stack lg">' +
      '<div class="stack"><p class="sc">' + (e.open ? 'Guestlist open' : 'Guestlist closed') + '</p><h1>' + esc(e.title) + '</h1>' +
      (e.starts_at ? '<p class="when">' + esc(whenLine(e)) + '</p>' : '') +
      ([e.venue, e.city].filter(Boolean).length ? '<p class="quiet">' + esc([e.venue, e.city].filter(Boolean).join(', ')) + '</p>' : '') + '</div>' +
      '<div class="box"><span class="sc">Link for your guests</span><span class="linkline">' + esc(url.replace(/^https?:\/\//, '')) + '</span>' +
      '<div class="acts"><button class="btn small" data-act="copylink" data-id="' + esc(url) + '">Copy link</button>' +
      (navigator.share ? '<button class="btn small line" data-act="sharelink" data-id="' + esc(url) + '">Share…</button>' : '') +
      '<a class="btn small line" href="/' + esc(e.id) + '" target="_blank" rel="noopener">View page</a></div></div>' +
      '<div class="stats"><div class="stat"><b>' + c.requests + '</b><span>Requests</span></div><div class="stat"><b>' + c.people + '</b><span>People</span></div>' +
      '<div class="stat"><b>' + c.confirmed + '</b><span>Confirmed</span></div></div>' +
      '<div class="toolbar"><div class="seg" style="min-width:200px"><label><input type="radio" name="sort" value="arrival"' + (current.sort === 'arrival' ? ' checked' : '') + ' data-act="sort"><span>By arrival</span></label>' +
      '<label><input type="radio" name="sort" value="az"' + (current.sort === 'az' ? ' checked' : '') + ' data-act="sort"><span>A – Z</span></label></div>' +
      (c.waiting ? '<button class="btn small" data-act="confirmall">Confirm everyone (' + c.waiting + ')</button>' : '') + '</div>';
    if (!current.guests.length) h += '<div class="stack center" style="padding:20px 0"><p class="ornament">· · ·</p><p class="quiet">No one yet. Send the link.</p></div>';
    else {
      h += '<div class="list">' + sorted().map(function (g) {
        return '<div class="guest ' + g.status + '"><span class="n">' + esc(g.name) + '<span class="plus">' + plusLabel(g.plus) + '</span></span>' +
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
  }
  function listText() {
    var e = current.event, gs = sorted().filter(function (g) { return g.status !== 'declined'; });
    var head = e.title + (e.starts_at ? ' — ' + longDate(e.starts_at) : '');
    var lines = gs.map(function (g) { return g.name + plusLabel(g.plus) + (g.status === 'confirmed' ? '' : ' (pending)'); });
    var c = counts(current.guests);
    return head + '\n\n' + lines.join('\n') + '\n\n' + c.people + (c.people === 1 ? ' person' : ' people') + ' · ' + c.confirmed + ' confirmed';
  }

  // ---------- guests: an organizer's page ----------
  function joinForm(o, mode, inviteToken) {
    // mode: 'post' (keep me posted) or 'request' (request an invitation)
    var p = person;
    return '<form id="f-join" data-handle="' + esc(o.handle) + '" data-i="' + esc(inviteToken || '') + '">' +
      (p ? '<p class="quiet center">As ' + esc(p.name) + ' · ' + esc(p.email) + '</p>' :
        '<label><span>Full name</span><input name="name" maxlength="100" required autocomplete="name"></label>' +
        '<label><span>Email</span><input name="email" type="email" required autocomplete="email"></label>') +
      (mode === 'request' ? '<label><span>A word for ' + esc(o.name) + ' (optional)</span><input name="note" maxlength="300" placeholder="Who you know, where we met…"></label>' : '') +
      (p ? '' : '<label><span>Password (optional)</span><input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="To receive invitations here on rsvp.fm"></label>') +
      '<p class="err" id="err" hidden></p><button class="btn wide" type="submit">' + (mode === 'request' ? 'Request an invitation' : 'Join ' + esc(o.name)) + '</button>' +
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
      h += '<div class="stack center">' + logoImg(o.logo) + '<h1>' + esc(o.name) + '</h1><p class="sc">' + esc(KINDS[o.kind] || '') + '</p>' + (o.bio ? '<p class="bio">' + esc(o.bio) + '</p>' : '') + '</div>';
      h += '<p class="ornament">· · ·</p>';
      if (j.access) {
        h += '<div class="stack"><h3>Upcoming</h3>';
        if (j.events.length) h += '<div class="list">' + j.events.map(function (e) {
          return '<a class="item" href="/' + esc(e.id) + '"><span class="date">' + esc(shortDate(e.starts_at)) + '</span><span class="main"><span class="t">' + esc(e.title) + '</span>' +
            '<span class="m">' + esc([e.venue, e.city].filter(Boolean).join(', ')) + (e.open ? '' : (e.venue || e.city ? ' · ' : '') + 'list closed') + '</span></span></a>';
        }).join('') + '</div>';
        else h += '<p class="quiet">No upcoming events yet.</p>';
        h += '</div>';
        if (j.my_status === 'member') h += '<div class="card"><p class="sc">Community</p><h2>You\'re in.</h2><p class="quiet small">' + esc(o.name) + '\'s next invitations land in <a href="/me">My invitations</a>.</p></div>';
        else if (!j.is_owner) h += '<div class="stack"><h3>Keep me posted</h3><p class="quiet small">Be the first to hear about ' + esc(o.name) + '\'s next guestlists.</p>' + joinForm(o, 'post', i) + '</div>';
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
  function viewGuest(id) {
    loading();
    var t = tokenFor(id);
    api('GET', '/p/' + id + (t ? '?t=' + encodeURIComponent(t) : '')).then(function (j) {
      var e = j.event, host = e.host, h = '<div class="stack lg">';
      header('guest'); theme(host.theme, host.custom);
      document.title = e.title + ' — ' + host.name;
      h += '<div class="stack center">' + (host.logo ? '<a href="/' + esc(host.handle) + '" style="text-decoration:none">' + logoImg(host.logo, 'mark') + '</a>' : '') +
        '<p class="sc"><a href="/' + esc(host.handle) + '" style="text-decoration:none">' + esc(host.name) + '</a> invites you</p><h1>' + esc(e.title) + '</h1>' +
        (e.starts_at ? '<p class="when">' + esc(whenLine(e)) + '</p>' : '') +
        ([e.venue, e.city].filter(Boolean).length ? '<p class="quiet">' + esc([e.venue, e.city].filter(Boolean).join(', ')) + '</p>' : '') + '</div>';
      h += '<p class="ornament">· · ·</p>';
      if (e.details) h += '<p class="details">' + esc(e.details) + '</p><hr class="rule">';
      if (j.mine) h += statusCard(e, j.mine, id) + afterRsvp(e, j.mine, id);
      else if (!e.open) h += '<div class="card"><h2>The guestlist is closed.</h2><p class="quiet">Thank you for your interest.</p></div>';
      else h += rsvpForm(e, person || {});
      main.innerHTML = h + '</div>';
    }).catch(function (e) { header('guest'); showError(e); });
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
      '<p class="quiet small">' + (ok ? 'See you there.' : no ? esc(e.host.name) + ' could not add you this time.' : esc(e.host.name) + ' will confirm. Come back to this page to see your status.') + '</p>' +
      (!no && e.open ? '<p><button class="link small" data-act="editrsvp" data-id="' + esc(id) + '">Change my RSVP</button></p>' : '') + '</div>';
  }
  // After the RSVP: receive the next invitations here, with a password.
  // After the RSVP: join the organizer's page to get their next invitations, and keep them here with a password.
  function afterRsvp(e, m, id) {
    var host = esc(e.host.name);
    if (m.consent) {
      if (person) return '<p class="quiet small center">You\'re in ' + host + '\'s community. Their next invitations land in <a href="/me">My invitations</a>.</p>';
      if (m.has_account) return '<p class="quiet small center">You\'re in ' + host + '\'s community. <a href="/login?as=guest&amp;next=' + encodeURIComponent('/' + id) + '">Log in</a> to see all your invitations.</p>';
      return '<div class="box"><span class="sc">You\'re in ' + host + '\'s community</span>' +
        '<p class="quiet small">Choose a password to find their next invitations here on rsvp.fm, one tap to RSVP.</p>' +
        '<form id="f-person" data-id="' + esc(id) + '"><label><span>Password for ' + esc(m.email) + '</span><input name="password" type="password" minlength="8" required autocomplete="new-password"></label>' +
        '<p class="err" hidden></p><button class="btn" type="submit">Create my account</button></form></div>';
    }
    var withPassword = !person && !m.has_account;
    return '<div class="box"><span class="sc">Next time</span><h2 style="font-size:24px">Join ' + host + '\'s page</h2>' +
      '<p class="quiet small">Be the first to receive their next invitations.</p>' +
      '<form id="f-keep" data-id="' + esc(id) + '">' +
      (withPassword ? '<label><span>Password (optional)</span><input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="To find them here on rsvp.fm"></label>' : '') +
      '<p class="err" hidden></p><button class="btn" type="submit">Join ' + host + '</button>' +
      '<p class="quiet small">By joining, you agree that ' + host + ' emails you their next invitations.</p></form></div>';
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
  function viewMe() {
    if (!person) return go('/login?as=guest', true);
    header(); setNav('me'); loading();
    api('GET', '/people/me').then(function (j) {
      var h = '<div class="stack lg"><div class="stack"><p class="sc">' + esc(j.person.name) + '</p><h1>My invitations</h1></div>';
      if (j.events.length) h += '<div class="list">' + j.events.map(function (e) {
        var st = e.my_status === 'confirmed' ? 'On the list' + plusLabel(e.my_plus) : e.my_status === 'requested' ? 'Requested' + plusLabel(e.my_plus) : e.my_status === 'declined' ? 'Not this time' : 'Invitation';
        return '<a class="item" href="/' + esc(e.id) + '"><span class="date">' + esc(shortDate(e.starts_at)) + '</span><span class="main"><span class="t">' + esc(e.title) + '</span>' +
          '<span class="m">' + esc(e.host.name) + ' · ' + esc(st) + '</span></span></a>';
      }).join('') + '</div>';
      else h += '<p class="quiet">No invitations right now. They will appear here as soon as the pages you follow open a guestlist.</p>';
      if (j.pages.length) h += '<div class="stack"><h3>Pages</h3><div class="list">' + j.pages.map(function (o) {
        return '<a class="item" href="/' + esc(o.handle) + '"><span class="main"><span class="t">' + esc(o.name) + '</span><span class="m">' + esc(KINDS[o.kind] || '') + (o.my_status === 'requested' ? ' · invitation requested' : '') + '</span></span></a>';
      }).join('') + '</div></div>';
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
    var b = ev.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
    if (act === 'sort') { current.sort = b.value; renderManage(); return; }
    if (act === 'digest') {
      var q = (document.getElementById('prefs') || {}).getAttribute ? document.getElementById('prefs').getAttribute('data-q') : '';
      api('POST', '/prefs' + (q || ''), { digest: b.value }).then(function (r) { say(r.digest === 'never' ? 'No more invitation emails.' : r.digest === 'weekly' ? 'One email a week, at most.' : 'Saved.'); }).catch(function (e) { say(e.message); });
      return;
    }
    if (act === 'loginas') { go('/login' + (id === 'guest' ? '?as=guest' : ''), true); return; }
    if (act === 'copylink') return copy(id, 'Link copied.');
    if (act === 'sharelink') { navigator.share({ title: current.event.title, url: id }).catch(function () {}); return; }
    if (act === 'copytext') return copy(listText(), 'List copied.');
    if (act === 'csv') {
      return csvDownload([['Name', 'Email', 'Plus ones', 'People', 'Status', 'Keep me posted', 'Requested at']].concat(sorted().map(function (g) {
        return [g.name, g.email, g.plus, 1 + g.plus, g.status, g.consent ? 'yes' : 'no', g.created_at];
      })), fileSafe(current.event.title) + '-guestlist.csv');
    }
    if (act === 'commcsv') {
      return csvDownload([['Name', 'Email', 'Status', 'Keep me posted', 'On rsvp.fm', 'Source', 'Since']].concat((viewCommunity.list || []).map(function (c) {
        return [c.name, c.email, c.status, c.consent ? 'yes' : 'no', c.has_account ? 'yes' : 'no', c.source, c.created_at];
      })), fileSafe(org.name) + '-community.csv');
    }
    if (act === 'editrsvp') {
      api('GET', '/p/' + id + '?t=' + encodeURIComponent(tokenFor(id))).then(function (j) {
        var card = main.querySelector('.card'); if (card) card.outerHTML = rsvpForm(j.event, j.mine || {});
        var box = main.querySelector('#f-person'); if (box) box.closest('.box').remove();
      });
      return;
    }
    if (act === 'customfrom') {
      var st = startCustom(id), f2 = document.getElementById('f-account');
      f2.elements.namedItem('c_paper').value = st.paper; f2.elements.namedItem('c_ink').value = st.ink; f2.elements.namedItem('c_accent').value = st.accent;
      f2.elements.namedItem('c_display').value = st.display; f2.elements.namedItem('c_text').value = st.text;
      renderCustomPreview(); return;
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
  function onCustomInput(ev) {
    var t = ev.target;
    if (t.name === 'theme') { var ed = document.getElementById('custom-ed'); if (ed) ed.hidden = t.value !== 'custom'; return; }
    if (t.getAttribute && t.getAttribute('data-custom')) renderCustomPreview();
  }
  document.addEventListener('input', onCustomInput);
  document.addEventListener('change', function (ev) {
    onCustomInput(ev);
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
      var asGuest = f.getAttribute('data-as') === 'guest';
      api('POST', asGuest ? '/people/login' : '/login', d).then(function (j) {
        if (asGuest) person = j.person; else org = j.org;
        go(safeNext || (asGuest ? '/me' : '/'), true);
      }).catch(fail);
    } else if (f.id === 'f-account') {
      d.custom = readCustom();
      api('PATCH', '/me', d).then(function (j) { org = j.org; say('Saved.'); viewAccount(); }).catch(fail);
    } else if (f.id === 'f-event') {
      var eid = f.getAttribute('data-id');
      d.plus_max = Number(d.plus_max);
      api(eid ? 'PATCH' : 'POST', eid ? '/events/' + eid : '/events', d).then(function (j) { say(eid ? 'Saved.' : 'Your guestlist is ready.'); go('/e/' + j.id, true); }).catch(fail);
    } else if (f.id === 'f-rsvp') {
      var gid = f.getAttribute('data-id');
      d.plus = Number(d.plus || 0);
      api('POST', '/p/' + gid + '/rsvp', d).then(function (r) {
        try { localStorage.setItem('gl:' + gid, r.token); } catch (e) {}
        history.replaceState({}, '', '/' + gid + '?t=' + encodeURIComponent(r.token));
        viewGuest(gid);
      }).catch(fail);
    } else if (f.id === 'f-person') {
      var pid = f.getAttribute('data-id');
      api('POST', '/people/signup', { event: pid, t: tokenFor(pid), password: d.password }).then(function (j) {
        person = j.person; say('Done. Your next invitations will be waiting here.'); viewGuest(pid);
      }).catch(fail);
    } else if (f.id === 'f-keep') {
      var kid = f.getAttribute('data-id');
      api('POST', '/p/' + kid + '/keep', { t: tokenFor(kid), password: d.password || '' }).then(function (r) {
        if (r.person) person = r.person;
        say('You joined. Their next invitations will reach you.'); viewGuest(kid);
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
    var p = location.pathname.replace(/\/+$/, '') || '/', m;
    if (p === '/') return org ? viewEvents() : person ? viewMe() : viewWelcome();
    if (p === '/login') return viewLogin();
    if (p === '/signup') return org ? go('/', true) : viewSignup();
    if (p === '/account') return viewAccount();
    if (p === '/community') return viewCommunity();
    if (p === '/me') return viewMe();
    if (p === '/prefs') return viewPrefs();
    if (p === '/new') return viewNew();
    if ((m = /^\/e\/([a-z0-9]{4,16})$/.exec(p))) return viewManage(m[1]);
    if ((m = /^\/e\/([a-z0-9]{4,16})\/edit$/.exec(p))) return viewEdit(m[1]);
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
