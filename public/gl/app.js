// rsvp.fm — Guestlist. One page per event for guests; a small back office for organizers.
(function () {
  'use strict';
  var main = document.getElementById('main');
  var hdr = document.getElementById('hdr');
  var org = null;
  var KINDS = { promoter: 'Promoter', label: 'Label', artist: 'Artist' };
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(method, path, data) {
    var opts = { method: method, headers: {}, credentials: 'same-origin' };
    if (data !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(data); }
    return fetch('/api' + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || 'Something went wrong.');
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
      else d[el.name] = el.value;
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

  function header(kind) {
    var h = '<a class="wordmark" href="/">rsvp<em>.fm</em></a>';
    if (kind === 'guest') h += '<span class="sc">Guestlist</span>';
    else if (org) h += '<nav class="nav"><a href="/" data-nav="events">Events</a><a href="/account" data-nav="account">' + esc(org.name) + '</a></nav>';
    else h += '<nav class="nav"><a href="/login">Log in</a></nav>';
    hdr.innerHTML = h;
  }
  function setNav(name) { Array.prototype.forEach.call(hdr.querySelectorAll('[data-nav]'), function (a) { a.classList.toggle('on', a.getAttribute('data-nav') === name); }); }
  function loading() { main.innerHTML = '<p class="quiet center">Loading…</p>'; }
  function showError(e) { main.innerHTML = '<div class="stack center"><p class="when">' + esc(e.message) + '</p><p><a href="/">Back</a></p></div>'; }

  // ---------- organizers: welcome, sign up, log in ----------
  function viewWelcome() {
    header();
    main.innerHTML = '<div class="stack lg">' +
      '<p class="sc">For promoters, labels &amp; artists</p>' +
      '<h1>The guestlist,<br><em>kept simply.</em></h1>' +
      '<p class="lead">Create the event, send one link. Your guests leave their name and RSVP; you confirm the list and take it to the door.</p>' +
      '<div class="acts"><a class="btn" href="/signup">Create an account</a><a class="btn line" href="/login">Log in</a></div>' +
      '<hr class="rule">' +
      '<div class="stack">' +
      '<div><h2><em>i.</em> Create the event</h2><p class="quiet">A name, a date, a place, a few words. Choose whether guests may bring a +1, +2 or +3.</p></div>' +
      '<div><h2><em>ii.</em> Share the link</h2><p class="quiet">Guests open it, write their full name and email, and RSVP.</p></div>' +
      '<div><h2><em>iii.</em> Keep the list</h2><p class="quiet">See every request, confirm one by one or everyone at once, sort by name, copy or export.</p></div>' +
      '</div></div>';
  }
  function viewSignup() {
    header();
    main.innerHTML = '<div class="stack lg"><div class="stack"><p class="sc">Organizers</p><h1>Create an account</h1></div>' +
      '<form id="f-signup">' +
      '<label><span>Name guests will see</span><input name="name" maxlength="80" required placeholder="Your label, collective or artist name" autocomplete="organization"></label>' +
      '<fieldset style="border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:6px"><span class="sc" style="font-size:13px">You are</span><div class="seg">' +
      ['promoter', 'label', 'artist'].map(function (k, i) { return '<label><input type="radio" name="kind" value="' + k + '"' + (i === 0 ? ' checked' : '') + '><span>' + KINDS[k] + '</span></label>'; }).join('') +
      '</div></fieldset>' +
      '<label><span>Email</span><input name="email" type="email" required autocomplete="email"></label>' +
      '<label><span>Password</span><input name="password" type="password" minlength="8" required autocomplete="new-password"></label>' +
      '<p class="err" id="err" hidden></p><button class="btn wide" type="submit">Create my account</button></form>' +
      '<p class="quiet small center">Already have one? <a href="/login">Log in</a></p></div>';
  }
  function viewLogin() {
    header();
    main.innerHTML = '<div class="stack lg"><div class="stack"><p class="sc">Organizers</p><h1>Log in</h1></div>' +
      '<form id="f-login"><label><span>Email</span><input name="email" type="email" required autocomplete="email"></label>' +
      '<label><span>Password</span><input name="password" type="password" required autocomplete="current-password"></label>' +
      '<p class="err" id="err" hidden></p><button class="btn wide" type="submit">Log in</button></form>' +
      '<p class="quiet small center">New here? <a href="/signup">Create an account</a></p></div>';
  }
  function viewAccount() {
    if (!org) return go('/login', true);
    header(); setNav('account');
    main.innerHTML = '<div class="stack lg"><h1>Account</h1><form id="f-account">' +
      '<label><span>Name guests will see</span><input name="name" maxlength="80" required value="' + esc(org.name) + '"></label>' +
      '<fieldset style="border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:6px"><span class="sc" style="font-size:13px">You are</span><div class="seg">' +
      ['promoter', 'label', 'artist'].map(function (k) { return '<label><input type="radio" name="kind" value="' + k + '"' + (org.kind === k ? ' checked' : '') + '><span>' + KINDS[k] + '</span></label>'; }).join('') +
      '</div></fieldset><p class="quiet small">' + esc(org.email) + '</p>' +
      '<p class="err" id="err" hidden></p><button class="btn" type="submit">Save</button></form>' +
      '<hr class="rule"><p><button class="link" data-act="logout">Log out</button></p></div>';
  }

  // ---------- organizers: events ----------
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
  function exportCsv() {
    var e = current.event;
    var q = function (v) { v = String(v == null ? '' : v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var rows = [['Name', 'Email', 'Plus ones', 'People', 'Status', 'Requested at']].concat(sorted().map(function (g) {
      return [g.name, g.email, g.plus, 1 + g.plus, g.status, g.created_at];
    }));
    var csv = '﻿' + rows.map(function (r) { return r.map(q).join(','); }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (e.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'guestlist') + '-guestlist.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  // ---------- guests: the event page ----------
  function tokenFor(id) { var t = new URLSearchParams(location.search).get('t'); if (t) return t; try { return localStorage.getItem('gl:' + id) || ''; } catch (e) { return ''; } }
  function viewGuest(id) {
    header('guest'); loading();
    var t = tokenFor(id);
    api('GET', '/p/' + id + (t ? '?t=' + encodeURIComponent(t) : '')).then(function (j) {
      var e = j.event, h = '<div class="stack lg">';
      document.title = e.title + ' — Guestlist';
      h += '<div class="stack center"><p class="sc">' + esc(e.host.name) + ' invites you</p><h1>' + esc(e.title) + '</h1>' +
        (e.starts_at ? '<p class="when">' + esc(whenLine(e)) + '</p>' : '') +
        ([e.venue, e.city].filter(Boolean).length ? '<p class="quiet">' + esc([e.venue, e.city].filter(Boolean).join(', ')) + '</p>' : '') + '</div>';
      h += '<p class="ornament">· · ·</p>';
      if (e.details) h += '<p class="details">' + esc(e.details) + '</p><hr class="rule">';
      if (j.mine) h += statusCard(e, j.mine, id);
      else if (!e.open) h += '<div class="card"><h2>The guestlist is closed.</h2><p class="quiet">Thank you for your interest.</p></div>';
      else h += rsvpForm(e, {});
      main.innerHTML = h + '</div>';
    }).catch(showError);
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

  // ---------- events ----------
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest('a[href]');
    if (a && a.origin === location.origin && !a.target && !ev.metaKey && !ev.ctrlKey && !a.hasAttribute('download')) { ev.preventDefault(); go(a.pathname + a.search); return; }
    var b = ev.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
    if (act === 'sort') { current.sort = b.value; renderManage(); return; }
    if (act === 'copylink') return copy(id, 'Link copied.');
    if (act === 'sharelink') { navigator.share({ title: current.event.title, url: id }).catch(function () {}); return; }
    if (act === 'copytext') return copy(listText(), 'List copied.');
    if (act === 'csv') return exportCsv();
    if (act === 'editrsvp') {
      api('GET', '/p/' + id + '?t=' + encodeURIComponent(tokenFor(id))).then(function (j) {
        var card = main.querySelector('.card'); if (card) card.outerHTML = rsvpForm(j.event, j.mine || {});
      });
      return;
    }
    if (act === 'logout') { api('POST', '/logout').then(function () { org = null; go('/', true); }); return; }
    b.disabled = true;
    var done = function () { b.disabled = false; };
    if (act === 'status') {
      var to = b.getAttribute('data-to');
      api('PATCH', '/events/' + current.event.id + '/guests/' + id, { status: to }).then(function () {
        current.guests.forEach(function (g) { if (String(g.id) === id) g.status = to; });
        renderManage();
      }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'confirmall') {
      api('POST', '/events/' + current.event.id + '/confirm-all').then(function (r) {
        current.guests.forEach(function (g) { if (g.status === 'requested') g.status = 'confirmed'; });
        renderManage(); say(r.confirmed + ' confirmed.');
      }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'toggleopen') {
      var open = !current.event.open;
      api('POST', '/events/' + current.event.id + '/open', { open: open }).then(function () {
        current.event.open = open; renderManage(); say(open ? 'Guestlist reopened.' : 'Guestlist closed.');
      }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'delevent') {
      if (b.getAttribute('data-confirm') !== '1') { b.setAttribute('data-confirm', '1'); b.textContent = 'Tap again to delete it for good'; return done(); }
      api('DELETE', '/events/' + id).then(function () { say('Deleted.'); go('/', true); }).catch(function (e) { say(e.message); done(); });
    }
  });
  document.addEventListener('submit', function (ev) {
    var f = ev.target; ev.preventDefault();
    var err = document.getElementById('err'), btn = f.querySelector('[type=submit]');
    var fail = function (e) { if (err) { err.textContent = e.message; err.hidden = false; } else say(e.message); if (btn) btn.disabled = false; };
    if (err) err.hidden = true;
    if (btn) btn.disabled = true;
    var d = formData(f);
    var next = new URLSearchParams(location.search).get('next');
    if (f.id === 'f-signup' || f.id === 'f-login') {
      api('POST', f.id === 'f-signup' ? '/signup' : '/login', d).then(function (j) {
        org = j.org; go(next && /^\/[^/]/.test(next) ? next : '/', true);
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
      api('POST', '/p/' + gid + '/rsvp', d).then(function (r) {
        try { localStorage.setItem('gl:' + gid, r.token); } catch (e) {}
        history.replaceState({}, '', '/' + gid + '?t=' + encodeURIComponent(r.token));
        viewGuest(gid);
      }).catch(fail);
    }
  });

  // ---------- routing ----------
  function route() {
    var p = location.pathname.replace(/\/+$/, '') || '/', m;
    if (p === '/') return org ? viewEvents() : viewWelcome();
    if (p === '/login') return org ? go('/', true) : viewLogin();
    if (p === '/signup') return org ? go('/', true) : viewSignup();
    if (p === '/account') return viewAccount();
    if (p === '/new') return viewNew();
    if ((m = /^\/e\/([a-z0-9]{4,16})$/.exec(p))) return viewManage(m[1]);
    if ((m = /^\/e\/([a-z0-9]{4,16})\/edit$/.exec(p))) return viewEdit(m[1]);
    if ((m = /^\/([a-z0-9]{4,16})$/.exec(p))) return viewGuest(m[1]);
    header(); main.innerHTML = '<div class="stack center"><p class="when">Nothing here.</p><p><a href="/">Back</a></p></div>';
  }
  window.addEventListener('popstate', route);
  api('GET', '/session').then(function (j) { org = j.org; }).catch(function () {}).then(route);
})();
