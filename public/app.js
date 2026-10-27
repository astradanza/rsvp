// rsvp.fm front-end — plain JS, no build step.
(function () {
  'use strict';

  var me = null;          // logged-in user or null
  var needsInvite = true; // false only before the very first account exists
  var main = document.getElementById('main');
  var hdr = document.getElementById('hdr');
  var PALETTE = ['#E23B2E', '#2F55D4', '#E8A80C', '#1E8C6E', '#9B59D0', '#D23C7A', '#1FA4B4', '#F2EFE6'];

  // ---------- helpers ----------
  // Page types: stored as member / artist / promoter, shown as Guest / Artist / Label / Promoter.
  var KINDS = { member: 'Guest', artist: 'Artist', promoter: 'Label / Promoter' };
  function kindLabel(k) { return KINDS[k] || k; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fgFor(hex) {
    var h = (hex || '#000000').replace('#', '');
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 120 ? '#0D0D0C' : '#F2EFE6';
  }
  function api(method, path, data) {
    var opt = { method: method, headers: {}, credentials: 'same-origin' };
    if (data !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(data); }
    return fetch('/api' + path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'Request failed.'); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  var tt;
  function say(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(tt); tt = setTimeout(function () { el.hidden = true; }, 2800);
  }
  function go(path, replace) {
    if (replace) history.replaceState({}, '', path); else history.pushState({}, '', path);
    route(); window.scrollTo(0, 0);
  }
  function needLogin() {
    say('Log in or join to do that.');
    go('/login?next=' + encodeURIComponent(location.pathname + location.search));
  }
  function money(cents, cur) {
    try { return new Intl.NumberFormat('en', { style: 'currency', currency: cur || 'EUR', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100); }
    catch (e) { return (cents / 100).toFixed(2) + ' ' + cur; }
  }
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function parseLocal(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(s) { var d = parseLocal(s); return d ? DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] : ''; }
  function fmtTime(s) { var d = parseLocal(s); return d ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : (s || ''); }
  function dateTile(s) { var d = parseLocal(s); return d ? d.getDate() + '\n' + MONTHS[d.getMonth()].toUpperCase() : ''; }
  function ago(s) {
    var t = Date.parse(String(s).replace(' ', 'T') + 'Z');
    var m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return 'now'; if (m < 60) return m + 'm';
    var h = Math.round(m / 60); if (h < 24) return h + 'h';
    var d = Math.round(h / 24); if (d < 7) return d + 'd';
    var dt = new Date(t); return dt.getDate() + ' ' + MONTHS[dt.getMonth()];
  }
  function priceLabel(e) { return e.entry === 'ticket' ? (e.price_cents ? money(e.price_cents, e.currency) : 'Free ticket') : 'Free · RSVP'; }
  function rsvpLabel(e) { return e.is_going ? (e.entry === 'ticket' ? 'Going' : 'On the list') : (e.entry === 'ticket' ? 'Get ticket' : 'RSVP'); }
  function shareLink(id) { return location.origin + '/e/' + id + (me ? '?ref=' + me.handle : ''); }
  function copy(text) {
    var done = function () { say('Link copied · ' + text.replace(/^https?:\/\//, '')); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { prompt('Copy this link', text); });
    else prompt('Copy this link', text);
  }

  var I = {
    rep: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3"/></svg>',
    share: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg>',
    back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    gear: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>'
  };

  // ---------- pieces ----------
  function av(u, size) {
    var c = u.color || '#A3A097';
    if (u.avatar && /^\/(avatars|api\/img)\//.test(u.avatar)) {
      return '<img class="av" src="' + esc(u.avatar) + '" alt="" width="' + size + '" height="' + size + '" loading="lazy" style="width:' + size + 'px;height:' + size + 'px;object-fit:cover;background:#000">';
    }
    return '<span class="av" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.4) + 'px;background:' + esc(c) + ';color:' + fgFor(c) + '">' + esc((u.name || u.handle || '?').charAt(0).toUpperCase()) + '</span>';
  }
  function cover(e, h, big) {
    var s = big ? [220, -50, -60, 70, 24, 28, 40] : [150, -30, -40, 46, 20, 20, 26];
    return '<div class="cover" style="height:' + h + 'px;background:' + esc(e.color) + '">' +
      '<div class="c1" style="width:' + s[0] + 'px;height:' + s[0] + 'px;right:' + s[1] + 'px;top:' + s[2] + 'px"></div>' +
      '<div class="c2" style="width:' + s[3] + 'px;height:' + s[3] + 'px;left:' + s[4] + 'px;top:' + s[5] + 'px"></div>' +
      '<div class="t" style="color:' + fgFor(e.color) + '"><div class="t1" style="font-size:' + s[6] + 'px">' + esc(e.title) + '</div>' +
      (e.subtitle ? '<div class="t2">' + esc(e.subtitle) + '</div>' : '') + '</div></div>';
  }
  function postHtml(p) {
    var a = p.author, e = p.event, h = '<article class="post gut">';
    if (p.reposted_by) h += '<div class="rp">' + I.rep.replace(/20/g, '14') + '<span>' + esc(p.reposted_by.name) + ' reposted</span></div>';
    h += '<a class="who" href="/' + esc(a.handle) + '">' + av(a, 36) + '<span style="min-width:0"><span class="name">' + esc(a.name) + '</span><span class="meta">@' + esc(a.handle) + ' · ' + ago(p.created_at) + '</span></span></a>';
    h += '<p class="txt">' + esc(p.text) + '</p>';
    if (e) {
      h += '<a class="card" href="/e/' + esc(e.id) + '">' + cover(e, 150, false) +
        '<div class="cardfoot"><span>' + fmtDate(e.starts_at) + (e.city ? ' · ' + esc(e.city) : '') + '</span><span style="color:var(--fg)">' + priceLabel(e) + '</span></div></a>';
    }
    h += '<div class="acts">';
    if (e) h += '<button class="pill' + (e.is_going ? ' on' : '') + '" data-act="rsvp" data-id="' + esc(e.id) + '" data-going="' + (e.is_going ? 1 : 0) + '">' + rsvpLabel(e) + '</button>';
    if (!p.mine) h += '<button class="ico' + (p.i_reposted ? ' on' : '') + '" aria-label="Repost" data-act="repost" data-id="' + p.id + '" data-on="' + (p.i_reposted ? 1 : 0) + '">' + I.rep + (p.reposts ? '<span>' + p.reposts + '</span>' : '') + '</button>';
    else if (p.reposts) h += '<span class="ico">' + I.rep + '<span>' + p.reposts + '</span></span>';
    if (e) h += '<button class="ico" aria-label="Copy your referral link" data-act="share" data-id="' + esc(e.id) + '">' + I.share + '</button><span class="going">' + e.going + ' going</span>';
    if (p.mine && !p.reposted_by) h += '<button class="ico" style="margin-left:' + (e ? '0' : 'auto') + '" data-act="delpost" data-id="' + p.id + '">Delete</button>';
    return h + '</div></article>';
  }
  function evRow(e, line) {
    return '<a class="row" href="/e/' + esc(e.id) + '"><span class="date" style="background:' + esc(e.color) + ';color:' + fgFor(e.color) + '">' + dateTile(e.starts_at) + '</span>' +
      '<span style="display:flex;flex-direction:column;gap:2px;min-width:0"><span style="font-weight:700;font-size:16px">' + esc(e.title) + ' <span class="muted" style="font-weight:400">' + esc(e.subtitle) + '</span></span>' +
      '<span class="meta">' + esc(line) + '</span></span></a>';
  }
  function followBtn(u, on) {
    return '<button class="pill' + (on ? '' : ' solid') + '" data-act="follow" data-id="' + esc(u.handle) + '" data-on="' + (on ? 1 : 0) + '">' + (on ? 'Following' : 'Follow') + '</button>';
  }
  function header(opts) {
    var h = '';
    if (opts.back) h += '<button class="back" aria-label="Back" data-act="back">' + I.back + '</button><span class="htitle">' + esc(opts.title || '') + '</span>';
    else h += '<a class="logo" href="/">rsvp<b>.fm</b></a>' + (opts.title ? '<span class="htitle muted" style="margin-left:8px">' + esc(opts.title) + '</span>' : '');
    h += '<span class="hright">';
    if (opts.right) h += opts.right;
    else if (!me) h += '<a class="pill ghost" href="/login">Log in</a><a class="pill solid" href="/signup">Join</a>';
    hdr.innerHTML = h + '</span>';
  }
  function setTab(name) {
    var nav = document.getElementById('tabs');
    nav.hidden = !me;
    if (me) document.getElementById('tab-me').setAttribute('href', '/' + me.handle);
    Array.prototype.forEach.call(nav.querySelectorAll('a'), function (a) { a.classList.toggle('on', a.getAttribute('data-tab') === name); });
  }
  function loading() { main.innerHTML = '<div class="end">Loading…</div>'; }
  function showError(e) {
    main.innerHTML = '<div class="end">' + esc(e.message || 'Something went wrong.') + '<br><br><a class="pill" href="/">Back home</a></div>';
  }

  // ---------- views ----------
  function viewWelcome() {
    header({}); setTab('');
    main.innerHTML = '<section class="hero gut"><span class="label accent">Invite only</span>' +
      '<h1>The guestlist for people who make nights happen.</h1>' +
      '<p>Promoters, artists and the people who dance with them. Follow who you trust, RSVP in one tap, share your link and get rewarded when friends come along.</p>' +
      '<div class="acts" style="flex-wrap:wrap"><a class="pill big solid" href="/signup">I have an invite</a><a class="pill big" href="/login">Log in</a></div></section>' +
      '<div class="sep"></div><div id="disc"></div>';
    renderDiscover(document.getElementById('disc'));
  }

  function viewFeed() {
    if (!me) return viewWelcome();
    header({}); setTab('feed'); loading();
    api('GET', '/feed').then(function (j) {
      var h = '<div class="label gut bar">Following · chronological</div>';
      j.items.forEach(function (p) { h += postHtml(p); });
      if (!j.items.length) h += '<div class="end">Your feed is empty. Follow a few people in <a class="accent" href="/discover">Discover</a>, or post something.</div>';
      else h += '<div class="end">You\'re all caught up.</div>';
      main.innerHTML = '<div id="alert"></div>' + h;
      if (me.is_admin) api('GET', '/admin/ambassadors').then(function (a) {
        var el = document.getElementById('alert');
        if (!el || !a.low.length) return;
        el.innerHTML = '<a href="/settings" class="gut bar" style="display:block;background:var(--accent);color:var(--ink);font-weight:700;padding-block:12px">' +
          (a.low.length === 1 ? '@' + esc(a.low[0].handle) + ' is' : a.low.length + ' members are') + ' running low on invites. Make them ambassadors →</a>';
      }).catch(function () {});
    }).catch(showError);
  }

  function renderDiscover(el) {
    api('GET', '/discover').then(function (j) {
      var h = '<section class="gut section"><h2>Selection of the week</h2><p class="small" style="margin:0">Curated. A few pages worth following.</p></section>';
      if (j.picks.length) {
        h += '<div class="picks gut">';
        j.picks.forEach(function (u) {
          h += '<div class="pick"><a href="/' + esc(u.handle) + '" style="display:flex;flex-direction:column;gap:10px">' + av(u, 52) +
            '<span class="name">' + esc(u.name) + '</span><span class="meta">' + esc(kindLabel(u.kind)) + (u.city ? ' · ' + esc(u.city) : '') + '</span></a>' + (me ? followBtn(u, false) : '') + '</div>';
        });
        h += '</div>';
      } else h += '<p class="small gut" style="margin:0 0 16px">' + (me ? 'You follow everyone in this week\'s selection.' : 'The selection opens soon.') + '</p>';
      h += '<section class="gut section sep"><h2>Upcoming</h2><div>';
      j.events.forEach(function (e) { h += evRow(e, (e.city ? e.city + ' · ' : '') + priceLabel(e) + ' · ' + e.going + ' going'); });
      if (!j.events.length) h += '<p class="small">No nights announced yet.</p>';
      h += '</div></section>';
      if (j.newcomers.length) {
        h += '<section class="gut section sep"><h2>New faces</h2><div class="grid4">';
        j.newcomers.forEach(function (u) { h += '<a class="g" href="/' + esc(u.handle) + '">' + av(u, 56) + '<span>' + esc(u.name) + '</span></a>'; });
        h += '</div></section>';
      }
      el.innerHTML = h;
    }).catch(function (e) { el.innerHTML = '<div class="end">' + esc(e.message) + '</div>'; });
  }
  function viewDiscover() {
    header({ title: 'Discover' }); setTab('discover'); loading(); renderDiscover(main);
  }

  function viewProfile(handle) {
    header({ back: true, title: 'rsvp.fm/' + handle }); setTab(me && me.handle === handle ? 'me' : ''); loading();
    api('GET', '/users/' + encodeURIComponent(handle)).then(function (j) {
      var u = j.user, h = '';
      if (j.is_me) {
        header({ back: false, title: '', right: '<a class="ico" aria-label="Settings" href="/settings">' + I.gear + '</a>' });
        hdr.querySelector('.logo').insertAdjacentHTML('afterend', '<a class="pill ghost" href="/switch" aria-label="Switch account" style="margin-left:8px;gap:6px;color:var(--fg)">@' + esc(u.handle) + ' <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></a>');
      }
      if (u.banner && /^\/api\/img\//.test(u.banner)) h += '<div class="banner" style="height:160px;background:' + esc(u.color) + ' url(' + esc(u.banner) + ') center/cover no-repeat"></div>';
      else h += '<div class="banner" style="background:' + esc(u.color) + '"><div style="position:absolute;width:120px;height:120px;border-radius:50%;border:3px solid var(--ink);right:24px;top:-40px"></div><div style="position:absolute;width:40px;height:40px;border-radius:50%;background:var(--ink);right:140px;top:40px"></div></div>';
      h += '<div class="gut" style="display:flex;flex-direction:column;gap:10px;padding-block:0 16px"><div class="ptop"><span class="ring">' + av(u, 68) + '</span>' +
        (j.is_me ? '<a class="pill" href="/settings">Edit page</a>' : (me ? followBtn(u, j.is_following) : '<a class="pill solid" href="/login?next=/' + esc(u.handle) + '">Follow</a>')) + '</div>';
      h += '<div><h1>' + esc(u.name) + '</h1><div class="mono accent" style="font-size:12px;margin-top:2px">rsvp.fm/' + esc(u.handle) + (u.ambassador ? ' · AMBASSADOR' : '') + '</div></div>';
      if (u.bio) h += '<p class="txt" style="font-size:14px">' + esc(u.bio) + '</p>';
      h += '<div class="stats"><span><strong>' + j.followers + '</strong> followers</span><span><strong>' + j.following + '</strong> following</span><span>' + esc(kindLabel(u.kind)) + (u.city ? ' · ' + esc(u.city) : '') + '</span></div></div>';
      if (j.is_me) h += '<div id="mine"></div>';
      if (j.events.length) {
        h += '<section class="gut section sep"><h2>Upcoming</h2><div>';
        j.events.forEach(function (e) { h += evRow(e, fmtDate(e.starts_at) + (e.venue ? ' · ' + e.venue : '') + ' · ' + priceLabel(e)); });
        h += '</div></section>';
      }
      if (j.is_me && u.kind !== 'member') h += '<div class="gut" style="padding-block:0 16px"><a class="pill" href="/new/event">Announce a night</a></div>';
      if (j.top8.length) {
        h += '<section class="gut section sep"><h2>Top 8</h2><div class="grid4">';
        j.top8.forEach(function (f) { h += '<a class="g" href="/' + esc(f.handle) + '">' + av(f, 56) + '<span>' + esc(f.name) + '</span></a>'; });
        h += '</div></section>';
      }
      h += '<section class="gut section sep" id="wall" data-handle="' + esc(u.handle) + '"><h2>Wall</h2><p class="small" style="margin:0">Loading…</p></section>';
      h += '<div class="sep"><div class="gut" style="padding-top:16px"><h2>Posts</h2></div>';
      j.posts.forEach(function (p) { h += postHtml(p); });
      if (!j.posts.length) h += '<div class="end">No posts yet.</div>';
      main.innerHTML = h + '</div>';
      if (j.is_me) renderMine(document.getElementById('mine'));
      renderWall(u, j.is_me);
    }).catch(showError);
  }
  function renderWall(u, isMe) {
    var el = document.getElementById('wall'); if (!el) return;
    api('GET', '/wall/' + encodeURIComponent(u.handle)).then(function (j) {
      var h = '<h2>Wall</h2>';
      if (me) {
        h += '<form id="f-wall" data-handle="' + esc(u.handle) + '"><div class="field"><label for="walltext">' +
          (isMe ? 'Write on your own wall' : 'Write on ' + esc(u.name) + '\'s wall') + '</label>' +
          '<textarea id="walltext" name="text" rows="2" maxlength="500" required placeholder="' + (isMe ? 'Pin a note for visitors' : 'Say something. Everyone can read it.') + '"></textarea></div>' +
          '<p class="err" id="err" hidden></p><div class="acts"><button class="pill on" type="submit">Post on the wall</button><span class="small">Public</span></div></form>';
      } else {
        h += '<p class="small" style="margin:0"><a class="accent" href="/login?next=/' + esc(u.handle) + '">Log in</a> to write on this wall.</p>';
      }
      if (!j.items.length) h += '<p class="small" style="margin:0">Nothing here yet.' + (isMe ? ' Your friends can leave you messages here.' : ' Be the first.') + '</p>';
      j.items.forEach(function (w) {
        h += '<div class="post" style="padding-block:12px"><div style="display:flex;align-items:center;gap:10px">' +
          '<a class="who" href="/' + esc(w.author.handle) + '" style="flex:1;min-width:0">' + av(w.author, 32) +
          '<span style="min-width:0"><span class="name">' + esc(w.author.name) + '</span><span class="meta">@' + esc(w.author.handle) + ' · ' + ago(w.created_at) + '</span></span></a>' +
          (w.can_delete ? '<button class="ico" data-act="delwall" data-id="' + w.id + '" data-handle="' + esc(u.handle) + '">Delete</button>' : '') +
          '</div><p class="txt">' + esc(w.text) + '</p></div>';
      });
      el.innerHTML = h;
    }).catch(function (e) { el.innerHTML = '<h2>Wall</h2><p class="err">' + esc(e.message) + '</p>'; });
  }
  function renderMine(el) {
    Promise.all([api('GET', '/me/referrals'), api('GET', '/me/nights')]).then(function (r) {
      var ref = r[0], nights = r[1].events, h = '<div class="gut" style="padding-block:0 16px;display:flex;flex-direction:column;gap:16px">';
      h += '<section class="box" style="border-color:var(--accent)"><span class="label accent">Referrals</span><span style="font-size:28px;font-weight:800">' + money(ref.total_cents, 'EUR') + '</span>' +
        '<span class="small">' + ref.total_referred + ' people came through your links' + (ref.total_cents ? ' · estimated, paid by hosts' : '') + '</span></section>';
      h += '<section style="display:flex;flex-direction:column;gap:4px"><h2>Your nights</h2>';
      if (nights.length) nights.forEach(function (e) { h += evRow(e, fmtDate(e.starts_at) + ' · ' + (e.city || e.venue)); });
      else h += '<p class="small" style="margin:0">Nothing yet. RSVP from your feed.</p>';
      el.innerHTML = h + '</section></div>';
    }).catch(function () { el.innerHTML = ''; });
  }

  function viewEvent(id) {
    header({ back: true, title: '' }); setTab(''); loading();
    var q = new URLSearchParams(location.search);
    if (q.get('ref')) { try { sessionStorage.setItem('ref:' + id, q.get('ref')); } catch (e) {} }
    api('GET', '/events/' + encodeURIComponent(id)).then(function (j) {
      var e = j.event, h = '';
      header({ back: true, title: e.title + (e.subtitle ? ' ' + e.subtitle : '') });
      h += cover(e, 260, true) + '<div class="gut" style="display:flex;flex-direction:column;gap:16px;padding-block:16px">';
      h += '<a class="who" href="/' + esc(e.host.handle) + '">' + av(e.host, 32) + '<span style="font-size:14px">Hosted by <strong>' + esc(e.host.name) + '</strong></span></a>';
      h += '<div class="facts"><div><span>When</span><b>' + fmtDate(e.starts_at) + '</b><span>' + fmtTime(e.starts_at) + (e.ends_at ? ' → ' + esc(e.ends_at) : '') + '</span></div>' +
        '<div><span>Where</span><b>' + esc(e.venue || 'Secret location') + '</b><span>' + esc(e.city) + '</span></div>' +
        '<div><span>Entry</span><b>' + (e.entry === 'ticket' ? 'Ticket' : 'Free guestlist') + '</b><span>' + priceLabel(e) + (e.capacity ? ' · ' + e.capacity + ' max' : '') + '</span></div>' +
        '<div><span>Line-up</span><b>' + esc(e.lineup || 'TBA') + '</b></div></div>';
      if (e.about) h += '<p class="txt">' + esc(e.about) + '</p>';
      h += '<div style="display:flex;align-items:center;gap:10px">';
      if (e.friends.length) { h += '<div class="faces">'; e.friends.forEach(function (f) { h += '<span class="ring">' + av(f, 26) + '</span>'; }); h += '</div>'; }
      h += '<span class="small"' + (e.friends.length ? ' style="margin-left:8px"' : '') + '>' + e.going + ' going' + (e.friends.length ? ' · ' + e.friends.map(function (f) { return esc(f.name); }).join(', ') : '') + '</span></div>';
      if (me && e.entry === 'ticket' && e.commission_pct) {
        h += '<section class="ref"><span style="font-weight:700;font-size:15px">Earn ' + e.commission_pct + '% on every ticket sold through your link</span>' +
          '<span class="small" style="overflow-wrap:anywhere">' + esc(shareLink(e.id).replace(/^https?:\/\//, '')) + '</span>' +
          '<button class="pill" style="align-self:flex-start;border-color:var(--accent);color:var(--accent)" data-act="share" data-id="' + esc(e.id) + '">Copy my link</button></section>';
      } else {
        h += '<div><button class="pill" data-act="share" data-id="' + esc(e.id) + '">Copy link</button></div>';
      }
      if (e.is_host) h += '<div id="guests"></div><div><button class="pill ghost" data-act="delevent" data-id="' + esc(e.id) + '">Delete this event</button></div>';
      h += '</div><div class="buy gut"><div style="display:flex;flex-direction:column"><span style="font-weight:800;font-size:18px">' + priceLabel(e) + '</span><span class="meta">' + (e.entry === 'ticket' ? 'Payment opens soon · reserve your spot' : 'Free guestlist') + '</span></div>' +
        '<button class="pill big ' + (e.is_going ? 'on' : 'solid') + '" data-act="rsvp" data-id="' + esc(e.id) + '" data-going="' + (e.is_going ? 1 : 0) + '">' + rsvpLabel(e) + '</button></div>';
      main.innerHTML = h;
      if (e.is_host) renderGuests(e, document.getElementById('guests'));
    }).catch(showError);
  }
  function renderGuests(e, el) {
    api('GET', '/events/' + e.id + '/guests').then(function (j) {
      var h = '<section class="box"><span class="label">Host view · guestlist (' + j.guests.length + ')</span>';
      if (j.referrers.length) {
        h += '<table><thead><tr><th>Referrer</th><th class="n">Guests</th>' + (e.entry === 'ticket' ? '<th class="n">Owed</th>' : '') + '</tr></thead><tbody>';
        j.referrers.forEach(function (r) { h += '<tr><td><a href="/' + esc(r.handle) + '">@' + esc(r.handle) + '</a></td><td class="n">' + r.referred + '</td>' + (e.entry === 'ticket' ? '<td class="n">' + money(r.owed_cents, e.currency) + '</td>' : '') + '</tr>'; });
        h += '</tbody></table>';
      }
      h += '<table><thead><tr><th>Guest</th><th>Via</th></tr></thead><tbody>';
      j.guests.forEach(function (g) { h += '<tr><td><a href="/' + esc(g.handle) + '">' + esc(g.name) + '</a></td><td class="muted">' + (g.ref_handle ? '@' + esc(g.ref_handle) : '—') + '</td></tr>'; });
      if (!j.guests.length) h += '<tr><td colspan="2" class="muted">No one yet.</td></tr>';
      el.innerHTML = h + '</tbody></table></section>';
    }).catch(function () { el.innerHTML = ''; });
  }

  function viewNew() {
    if (!me) return needLogin();
    header({ title: 'New post' }); setTab('new');
    var h = '<div class="gut section"><form id="f-post"><div class="field"><label for="text">Post to your followers</label>' +
      '<textarea id="text" name="text" rows="6" maxlength="500" placeholder="What\'s on tonight?" required></textarea></div>' +
      '<p class="err" id="err" hidden></p><div class="acts"><button class="pill big on" type="submit">Post</button></div></form>' +
      '<p class="small">Your posts appear in your followers\' feeds in order. No algorithm.</p>';
    if (me.kind !== 'member') h += '<div class="sep" style="padding-top:16px"><a class="pill" href="/new/event">Announce a night instead</a></div>';
    else h += '<p class="small sep" style="padding-top:16px;margin:0">Label, promoter or artist? Switch your page type in <a class="accent" href="/settings">Settings</a> to announce nights.</p>';
    main.innerHTML = h + '</div>';
    document.getElementById('text').focus();
  }

  function swatches(name, current) {
    return '<div class="swatches">' + PALETTE.map(function (c, i) {
      return '<label style="background:' + c + '" title="' + c + '"><input type="radio" name="' + name + '" value="' + c + '"' + (c === current || (!current && i === 2) ? ' checked' : '') + ' aria-label="Color ' + c + '"></label>';
    }).join('') + '</div>';
  }

  function viewNewEvent() {
    if (!me) return needLogin();
    header({ back: true, title: 'Announce a night' }); setTab('new');
    if (me.kind === 'member' && !me.is_admin) {
      main.innerHTML = '<div class="end">Switch your page to Label / Promoter or Artist in <a class="accent" href="/settings">Settings</a> to announce nights.</div>';
      return;
    }
    main.innerHTML = '<div class="gut section"><form id="f-event">' +
      '<div class="field"><label for="title">Name of the night</label><input id="title" name="title" maxlength="80" required placeholder="Cirque Surprise"></div>' +
      '<div class="field"><label for="subtitle">Edition or tagline</label><input id="subtitle" name="subtitle" maxlength="60" placeholder="Vol. 3"></div>' +
      '<div class="two"><div class="field"><label for="starts_at">Starts</label><input id="starts_at" name="starts_at" type="datetime-local" required></div>' +
      '<div class="field"><label for="ends_at">Ends</label><input id="ends_at" name="ends_at" maxlength="25" placeholder="02:00"></div></div>' +
      '<div class="two"><div class="field"><label for="venue">Venue</label><input id="venue" name="venue" maxlength="80" placeholder="Secret location"></div>' +
      '<div class="field"><label for="city">City</label><input id="city" name="city" maxlength="60" placeholder="Paris"></div></div>' +
      '<fieldset><legend class="field">Entry</legend><div class="seg">' +
      '<label><input type="radio" name="entry" value="guestlist" checked><span>Free guestlist</span></label>' +
      '<label><input type="radio" name="entry" value="ticket"><span>Ticket</span></label></div></fieldset>' +
      '<div id="ticket-fields" hidden><div class="two"><div class="field"><label for="price">Price</label><input id="price" name="price" type="number" min="0" step="0.5" inputmode="decimal" placeholder="25"></div>' +
      '<div class="field"><label for="currency">Currency</label><select id="currency" name="currency"><option>EUR</option><option>GBP</option><option>USD</option><option>MXN</option></select></div></div>' +
      '<div class="field" style="margin-top:14px"><label for="commission_pct">Referral commission (%)</label><input id="commission_pct" name="commission_pct" type="number" min="0" max="50" step="1" placeholder="10"></div></div>' +
      '<div class="field"><label for="capacity">Capacity (leave empty for no limit)</label><input id="capacity" name="capacity" type="number" min="0" step="1" inputmode="numeric"></div>' +
      '<div class="field"><label for="lineup">Line-up</label><input id="lineup" name="lineup" maxlength="200" placeholder="Céline · Flabaire · ?"></div>' +
      '<div class="field"><label for="about">About</label><textarea id="about" name="about" rows="4" maxlength="1000"></textarea></div>' +
      '<fieldset><legend class="field">Color</legend>' + swatches('color', me.color) + '</fieldset>' +
      '<div class="field"><label for="announce">Announcement post (optional)</label><textarea id="announce" name="announce" rows="3" maxlength="500" placeholder="Same big top, same hours, nothing else revealed."></textarea></div>' +
      '<p class="err" id="err" hidden></p><div class="acts"><button class="pill big on" type="submit">Publish the night</button></div></form></div>';
    var form = document.getElementById('f-event');
    form.addEventListener('change', function () {
      document.getElementById('ticket-fields').hidden = form.entry.value !== 'ticket';
    });
  }

  function viewLogin() {
    if (me) return go('/', true);
    header({ back: true, title: 'Log in' }); setTab('');
    main.innerHTML = '<div class="gut section"><h1>Welcome back.</h1><form id="f-login">' +
      '<div class="field"><label for="login">Handle or email</label><input id="login" name="login" autocomplete="username" autocapitalize="none" required></div>' +
      '<div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>' +
      '<p class="err" id="err" hidden></p><button class="pill big solid" type="submit">Log in</button></form>' +
      '<p class="small">No account? rsvp.fm is invite-only. <a class="accent" href="/signup">Join with an invite</a>.</p></div>';
  }

  function viewSignup() {
    if (me) return go('/', true);
    header({ back: true, title: 'Join' }); setTab('');
    var q = new URLSearchParams(location.search);
    main.innerHTML = '<div class="gut section"><h1>Claim your rsvp.fm/handle.</h1><form id="f-signup">' +
      (needsInvite ? '<div class="field"><label for="invite">Invite code</label><input id="invite" name="invite" autocapitalize="none" required value="' + esc(q.get('invite') || '') + '"></div>' :
        '<p class="small" style="margin:0">You are the first one here. This account becomes the admin.</p>') +
      '<div class="field"><label for="handle">Handle</label><input id="handle" name="handle" autocapitalize="none" pattern="[a-z0-9_]{2,24}" maxlength="24" required placeholder="astradanza"><span class="small">rsvp.fm/<span id="hprev">handle</span></span></div>' +
      '<div class="field"><label for="name">Display name</label><input id="name" name="name" maxlength="60" required></div>' +
      '<fieldset><legend class="field">I am</legend><div class="seg">' +
      '<label><input type="radio" name="kind" value="member" checked><span>Guest</span></label>' +
      '<label><input type="radio" name="kind" value="artist"><span>Artist</span></label>' +
      '<label><input type="radio" name="kind" value="promoter"><span>Label / Promoter</span></label></div></fieldset>' +
      '<div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required></div>' +
      '<div class="field"><label for="password">Password</label><input id="password" name="password" type="password" minlength="8" autocomplete="new-password" required></div>' +
      '<p class="err" id="err" hidden></p><button class="pill big solid" type="submit">Create my page</button></form></div>';
    var hi = document.getElementById('handle');
    hi.addEventListener('input', function () {
      hi.value = hi.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
      document.getElementById('hprev').textContent = hi.value || 'handle';
    });
  }

  function viewSwitch() {
    if (!me) return needLogin();
    header({ back: true, title: 'Switch account' }); setTab('me'); loading();
    api('GET', '/accounts').then(function (j) {
      var h = '<div class="gut section"><h2>Your accounts</h2><div>';
      j.accounts.forEach(function (a) {
        h += '<button class="row" ' + (a.current ? 'disabled style="opacity:1"' : 'data-act="switchto" data-id="' + esc(a.handle) + '"') + '>' + av(a, 44) +
          '<span style="display:flex;flex-direction:column;min-width:0;flex:1"><span class="name">' + esc(a.name) + '</span><span class="meta">@' + esc(a.handle) + ' · ' + esc(kindLabel(a.kind)) + '</span></span>' +
          (a.current ? '<span class="accent mono" style="font-size:11px">CURRENT</span>' : '<span class="small">Switch</span>') + '</button>';
      });
      h += '</div></div>';
      h += '<div class="gut section sep"><a class="pill" href="/settings#create" style="align-self:flex-start">Create a new page</a></div>';
      h += '<div class="gut section sep"><h2>Add an existing account</h2><p class="small" style="margin:0">Log in once to link it. After that, switch in one tap.</p>' +
        '<form id="f-link"><div class="field"><label for="llogin">Handle or email</label><input id="llogin" name="login" autocapitalize="none" autocomplete="off" required></div>' +
        '<div class="field"><label for="lpass">Password</label><input id="lpass" name="password" type="password" autocomplete="off" required></div>' +
        '<p class="err" id="err" hidden></p><button class="pill big solid" type="submit">Add account</button></form></div>';
      if (j.accounts.length > 1) h += '<div class="gut section sep"><button class="pill ghost" data-act="unlink">Remove @' + esc(me.handle) + ' from this group</button></div>';
      main.innerHTML = h;
    }).catch(showError);
  }

  function viewClaim(token) {
    header({ title: 'Activate' }); setTab(''); loading();
    api('GET', '/claim/' + token).then(function (j) {
      main.innerHTML = '<div class="gut section"><div style="display:flex;align-items:center;gap:12px">' + av(j.user, 56) +
        '<div><h1>' + esc(j.user.name) + '</h1><div class="mono accent" style="font-size:12px">rsvp.fm/' + esc(j.user.handle) + '</div></div></div>' +
        '<p class="small" style="margin:0">This page was created for ' + esc(j.email) + '. Choose a password to take it over.</p>' +
        '<form id="f-claim" data-token="' + esc(token) + '"><div class="field"><label for="cpass">Password</label><input id="cpass" name="password" type="password" minlength="8" autocomplete="new-password" required></div>' +
        '<p class="err" id="err" hidden></p><button class="pill big solid" type="submit">Activate my page</button></form></div>';
    }).catch(showError);
  }

  function viewSettings() {
    if (!me) return needLogin();
    header({ back: true, title: 'Settings' }); setTab('me');
    var presets = [];
    for (var i = 1; i <= 16; i++) presets.push('/avatars/' + (i < 10 ? '0' : '') + i + '.webp');
    var custom = me.avatar && me.avatar.indexOf('/api/img/') === 0;
    var h = '<div class="gut section"><h2>Profile photo</h2>' +
      '<div style="display:flex;align-items:center;gap:14px"><span id="avprev">' + av(me, 72) + '</span>' +
      '<div style="display:flex;flex-direction:column;gap:8px"><label class="pill" for="up-avatar" style="cursor:pointer">Upload my own photo</label>' +
      '<input id="up-avatar" type="file" accept="image/*" data-kind="avatar" hidden><span class="small">' + (custom ? 'Using your photo.' : 'Or pick one of ours below.') + '</span></div></div>' +
      '<div class="avgrid" role="radiogroup" aria-label="Default photos">' + presets.map(function (p, k) {
        return '<label class="avopt"><input type="radio" name="avatar" form="f-me" value="' + p + '"' + (me.avatar === p ? ' checked' : '') + ' aria-label="Drawing ' + (k + 1) + '"><img src="' + p + '" alt="" width="64" height="64" loading="lazy"></label>';
      }).join('') + '</div><p class="small" style="margin:0">Pick one, then tap Save at the bottom of “Your page”.</p></div>' +
      '<div class="gut section sep"><h2>Header image</h2>' +
      '<div id="bnprev" class="banner" style="height:120px;border-radius:12px;background:' + esc(me.color) + (me.banner ? ' url(' + esc(me.banner) + ') center/cover no-repeat' : '') + '"></div>' +
      '<div class="acts" style="flex-wrap:wrap"><label class="pill" for="up-banner" style="cursor:pointer">' + (me.banner ? 'Replace header' : 'Upload a header') + '</label>' +
      '<input id="up-banner" type="file" accept="image/*" data-kind="banner" hidden>' +
      (me.banner ? '<button class="pill ghost" data-act="rmbanner">Remove</button>' : '') + '</div>' +
      '<p class="small" style="margin:0">Wide images work best (3 to 1). We crop the center.</p></div>' +
      '<div class="gut section sep"><h2>Your page</h2><form id="f-me">' +
      '<div class="field"><label for="name">Display name</label><input id="name" name="name" maxlength="60" value="' + esc(me.name) + '" required></div>' +
      '<div class="field"><label for="bio">Bio</label><textarea id="bio" name="bio" rows="3" maxlength="280">' + esc(me.bio) + '</textarea></div>' +
      '<div class="field"><label for="city">City</label><input id="city" name="city" maxlength="60" value="' + esc(me.city) + '"></div>' +
      '<fieldset><legend class="field">Page type</legend><div class="seg">' +
      ['member', 'artist', 'promoter'].map(function (k) { return '<label><input type="radio" name="kind" value="' + k + '"' + (me.kind === k ? ' checked' : '') + '><span>' + kindLabel(k) + '</span></label>'; }).join('') +
      '</div></fieldset><fieldset><legend class="field">Page color</legend>' + swatches('color', me.color) + '</fieldset>' +
      '<p class="err" id="err" hidden></p><button class="pill big solid" type="submit">Save</button></form></div>' +
      '<div class="gut section sep" id="invites"><h2>Your invite link</h2><p class="small" style="margin:0">Loading…</p></div>';
    if (me.is_admin) {
      h += '<div class="gut section sep" id="ambassadors"></div>' +
        '<div class="gut section sep"><h2>Admin</h2><form id="f-admin-invites" class="acts"><button class="pill" type="submit">Create 5 single-use codes</button></form>' +
        '<form id="f-feature"><div class="field"><label for="fhandle">Feature in Discover (handle)</label><input id="fhandle" name="handle" autocapitalize="none" required></div>' +
        '<div class="acts"><button class="pill" type="submit" name="featured" value="1">Feature</button><button class="pill ghost" type="submit" name="featured" value="0">Remove</button></div></form><div id="admin-out"></div></div>';
    }
    h += '<div class="gut section sep" id="create"><h2>Create a page</h2><p class="small" style="margin:0">A label, a party series, an artist project, or a page for a partner. It is linked to your account: switch to it by tapping Me. Each page uses one of your invites.</p>' +
      '<form id="f-account">' +
      '<div class="two"><div class="field"><label for="ahandle">Handle</label><input id="ahandle" name="handle" autocapitalize="none" maxlength="24" required placeholder="astradanza"></div>' +
      '<div class="field"><label for="aname">Display name</label><input id="aname" name="name" maxlength="60" required placeholder="Astradanza"></div></div>' +
      '<fieldset><legend class="field">Page type</legend><div class="seg">' +
      '<label><input type="radio" name="kind" value="promoter" checked><span>Label / Promoter</span></label>' +
      '<label><input type="radio" name="kind" value="artist"><span>Artist</span></label>' +
      '<label><input type="radio" name="kind" value="member"><span>Guest</span></label></div></fieldset>' +
      '<div class="field"><label for="aemail">Email (optional)</label><input id="aemail" name="email" type="email" autocomplete="off"></div>' +
      '<div class="field"><label for="apass">Password (optional, to log in to it directly)</label><input id="apass" name="password" type="password" autocomplete="new-password" minlength="8"></div>' +
      '<label class="small" style="display:flex;gap:10px;align-items:flex-start;cursor:pointer"><input type="checkbox" name="hand_over" value="1" style="width:auto;margin-top:2px"><span>This page is for someone else: give me an activation link so they choose their own password. Once they activate it, it leaves your accounts.</span></label>' +
      '<p class="err" id="err-account" hidden></p><button class="pill big solid" type="submit">Create the page</button></form><div id="account-out"></div></div>';
    h += '<div class="gut section sep"><button class="pill ghost" data-act="logout">Log out</button></div>';
    main.innerHTML = h;
    loadInvites();
    if (me.is_admin) loadAmbassadors();
    if (location.hash === '#create') setTimeout(function () { var c = document.getElementById('create'); if (c) c.scrollIntoView(); }, 60);
  }
  function inviteUrl(code) { return location.origin + '/i/' + code; }
  function loadInvites() {
    api('GET', '/me/invites').then(function (j) {
      var el = document.getElementById('invites'); if (!el) return;
      var h = '<h2>Your invite link</h2>';
      h += '<p class="small" style="margin:0">One link for everyone you vouch for. ' + (j.unlimited ? 'As admin, yours has no limit.' : 'It works for ' + j.quota + ' sign-ups.') + '</p>';
      h += '<div class="ref" style="border-style:solid"><span class="mono" style="font-size:14px;overflow-wrap:anywhere">' + esc(inviteUrl(j.link).replace(/^https?:\/\//, '')) + '</span>' +
        '<div class="acts"><button class="pill on" data-act="copyinvite" data-id="' + esc(j.link) + '">Copy link</button>' +
        '<button class="pill ghost" data-act="regeninvite">New link</button></div></div>';
      if (!j.unlimited) {
        var pct = Math.min(100, Math.round(100 * j.used / Math.max(1, j.quota)));
        h += '<div style="display:flex;flex-direction:column;gap:6px"><div style="display:flex;justify-content:space-between" class="small"><span>' + j.used + ' joined</span><span><strong style="color:var(--fg)">' + j.remaining + '</strong> left of ' + j.quota + '</span></div>' +
          '<div style="height:6px;border-radius:3px;background:var(--line);overflow:hidden"><div style="height:100%;width:' + pct + '%;background:var(--accent)"></div></div></div>';
        if (j.remaining === 0) h += '<p class="small" style="margin:0">Your link is used up. We\'ll be in touch.</p>';
      } else h += '<p class="small" style="margin:0">' + j.used + ' joined through your link.</p>';
      if (j.joined.length) {
        h += '<div><span class="label">Joined through you</span><div class="grid4" style="margin-top:10px">';
        j.joined.forEach(function (u) { h += '<a class="g" href="/' + esc(u.handle) + '">' + av(u, 48) + '<span>' + esc(u.name) + '</span></a>'; });
        h += '</div></div>';
      }
      el.innerHTML = h;
    }).catch(function (e) { var el = document.getElementById('invites'); if (el) el.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }
  function personRow(u, actions) {
    return '<div class="row" style="gap:12px"><a href="/' + esc(u.handle) + '" style="display:flex;align-items:center;gap:10px;min-width:0;flex:1">' + av(u, 36) +
      '<span style="min-width:0"><span class="name">' + esc(u.name) + (u.ambassador ? ' <span class="accent mono" style="font-size:11px">AMBASSADOR</span>' : '') + '</span>' +
      '<span class="meta">@' + esc(u.handle) + ' · ' + u.used + ' joined · ' + u.remaining + ' left · ' + esc(u.email) + '</span></span></a>' + actions + '</div>';
  }
  function loadAmbassadors() {
    api('GET', '/admin/ambassadors').then(function (j) {
      var el = document.getElementById('ambassadors'); if (!el) return;
      var h = '<h2>Running low on invites</h2><p class="small" style="margin:0">Members with ' + j.threshold + ' invites left or fewer. Reach out, then make them ambassadors (' + 50 + ' invites).</p>';
      if (j.low.length) j.low.forEach(function (u) {
        h += personRow(u, '<div style="display:flex;flex-direction:column;gap:6px"><button class="pill on" data-act="ambassador" data-id="' + esc(u.handle) + '">Ambassador</button>' +
          '<button class="pill ghost" data-act="addquota" data-id="' + esc(u.handle) + '">+10</button></div>');
      });
      else h += '<p class="small" style="margin:0">No one yet.</p>';
      h += '<h2 style="margin-top:16px">Ambassadors</h2>';
      if (j.ambassadors.length) j.ambassadors.forEach(function (u) { h += personRow(u, '<button class="pill ghost" data-act="addquota" data-id="' + esc(u.handle) + '">+10</button>'); });
      else h += '<p class="small" style="margin:0">None yet.</p>';
      el.innerHTML = h;
    }).catch(function () {});
  }

  // ---------- router ----------
  function route() {
    var p = location.pathname.replace(/\/+$/, '') || '/';
    var m;
    if (p === '/') return viewFeed();
    if (p === '/discover') return viewDiscover();
    if (p === '/new') return viewNew();
    if (p === '/new/event') return viewNewEvent();
    if (p === '/login') return viewLogin();
    if (p === '/signup' || p === '/invite') return viewSignup();
    if ((m = /^\/i\/([a-z0-9]+)$/i.exec(p))) return go('/signup?invite=' + m[1].toLowerCase(), true);
    if ((m = /^\/claim\/([A-Za-z0-9_-]+)$/.exec(p))) return viewClaim(m[1]);
    if (p === '/switch') return viewSwitch();
    if (p === '/settings') return viewSettings();
    if ((m = /^\/e\/([a-z0-9]+)$/i.exec(p))) return viewEvent(m[1]);
    if ((m = /^\/@?([a-z0-9_]{2,24})$/i.exec(p))) return viewProfile(m[1].toLowerCase());
    header({}); setTab(''); main.innerHTML = '<div class="end">Nothing here.<br><br><a class="pill" href="/">Back home</a></div>';
  }

  // ---------- events ----------
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest('a');
    if (a && a.origin === location.origin && !a.target && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey) {
      ev.preventDefault(); return go(a.pathname + a.search + a.hash);
    }
    var b = ev.target.closest('button[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
    if (act === 'back') { if (history.length > 1) history.back(); else go('/'); return; }
    if (act === 'share') return copy(shareLink(id));
    if (act === 'copyinvite') return copy(inviteUrl(id));
    if (act === 'copyclaim') return copy(location.origin + '/claim/' + id);
    if (!me) return needLogin();
    b.disabled = true;
    var done = function () { b.disabled = false; };
    if (act === 'follow') {
      var on = b.getAttribute('data-on') === '1';
      api(on ? 'DELETE' : 'POST', '/users/' + id + '/follow').then(function () {
        b.setAttribute('data-on', on ? '0' : '1'); b.textContent = on ? 'Follow' : 'Following'; b.classList.toggle('solid', on);
        say(on ? 'Unfollowed @' + id : 'Following @' + id);
      }).catch(function (e) { say(e.message); }).then(done);
    } else if (act === 'rsvp') {
      var going = b.getAttribute('data-going') === '1', ref = null;
      try { ref = sessionStorage.getItem('ref:' + id); } catch (e) {}
      api(going ? 'DELETE' : 'POST', '/events/' + id + '/rsvp', going ? undefined : { ref: ref }).then(function () {
        say(going ? 'Cancelled.' : 'You\'re on the list.'); route();
      }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'repost') {
      var r = b.getAttribute('data-on') === '1';
      api(r ? 'DELETE' : 'POST', '/posts/' + id + '/repost').then(function () {
        b.setAttribute('data-on', r ? '0' : '1'); b.classList.toggle('on', !r); say(r ? 'Repost removed.' : 'Reposted to your followers.');
      }).catch(function (e) { say(e.message); }).then(done);
    } else if (act === 'delpost') {
      if (b.getAttribute('data-confirm') !== '1') { b.setAttribute('data-confirm', '1'); b.textContent = 'Tap again to delete'; return done(); }
      api('DELETE', '/posts/' + id).then(function () { say('Post deleted.'); route(); }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'delevent') {
      if (b.getAttribute('data-confirm') !== '1') { b.setAttribute('data-confirm', '1'); b.textContent = 'Tap again to delete the event and its guestlist'; return done(); }
      api('DELETE', '/events/' + id).then(function () { say('Event deleted.'); go('/' + me.handle); }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'delwall') {
      if (b.getAttribute('data-confirm') !== '1') { b.setAttribute('data-confirm', '1'); b.textContent = 'Tap again to delete'; return done(); }
      var wh = b.getAttribute('data-handle');
      api('DELETE', '/wall/' + wh + '/' + id).then(function () { say('Deleted.'); return api('GET', '/users/' + wh).then(function (j) { renderWall(j.user, j.is_me); }); }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'switchto') {
      api('POST', '/accounts/switch', { handle: id }).then(boot).then(function () { say('Now on @' + me.handle); go('/' + me.handle, true); }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'unlink') {
      if (b.getAttribute('data-confirm') !== '1') { b.setAttribute('data-confirm', '1'); b.textContent = 'Tap again: you will need to log in to switch back'; return done(); }
      api('POST', '/accounts/unlink', {}).then(function () { say('Removed from the group.'); viewSwitch(); }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'rmbanner') {
      api('PATCH', '/me', { banner: '' }).then(function (j) { for (var k in j.user) me[k] = j.user[k]; say('Header removed.'); viewSettings(); }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'regeninvite') {
      if (b.getAttribute('data-confirm') !== '1') { b.setAttribute('data-confirm', '1'); b.textContent = 'Tap again: the old link stops working'; return done(); }
      api('POST', '/me/invites/regenerate', {}).then(function () { say('New invite link ready.'); loadInvites(); }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'ambassador') {
      api('POST', '/admin/ambassador', { handle: id }).then(function (j) { say('@' + id + ' is now an ambassador with ' + j.quota + ' invites.'); loadAmbassadors(); }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'addquota') {
      api('POST', '/admin/quota', { handle: id, add: 10 }).then(function () { say('Gave @' + id + ' 10 more invites.'); loadAmbassadors(); }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'logout') {
      api('POST', '/logout', {}).then(function () { me = null; go('/'); }).catch(function (e) { say(e.message); done(); });
    } else done();
  });

  function formData(form) {
    var o = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.type === 'submit') return;
      if (el.type === 'radio' || el.type === 'checkbox') { if (el.checked) o[el.name] = el.value; return; }
      o[el.name] = el.value;
    });
    return o;
  }
  document.addEventListener('submit', function (ev) {
    var f = ev.target; ev.preventDefault();
    var err = document.getElementById('err');
    var btn = ev.submitter || f.querySelector('[type=submit]');
    var showErr = function (e) { if (err) { err.textContent = e.message; err.hidden = false; } else say(e.message); if (btn) btn.disabled = false; };
    if (err) err.hidden = true;
    if (btn) btn.disabled = true;
    var d = formData(f);
    var next = new URLSearchParams(location.search).get('next');
    var safeNext = next && /^\/[^/]/.test(next) ? next : '/';
    if (f.id === 'f-login') {
      api('POST', '/login', d).then(boot).then(function () { go(safeNext, true); }).catch(showErr);
    } else if (f.id === 'f-signup') {
      api('POST', '/signup', d).then(boot).then(function () { say('Welcome to rsvp.fm.'); go('/' + me.handle, true); }).catch(showErr);
    } else if (f.id === 'f-wall') {
      var wh = f.getAttribute('data-handle');
      api('POST', '/wall/' + wh, d).then(function () {
        say('Posted on the wall.');
        api('GET', '/users/' + wh).then(function (j) { renderWall(j.user, j.is_me); });
      }).catch(showErr);
    } else if (f.id === 'f-post') {
      api('POST', '/posts', d).then(function () { say('Posted.'); go('/'); }).catch(showErr);
    } else if (f.id === 'f-event') {
      api('POST', '/events', d).then(function (j) { say('Your night is live.'); go('/e/' + j.id, true); }).catch(showErr);
    } else if (f.id === 'f-me') {
      api('PATCH', '/me', d).then(function (j) {
        for (var k in j.user) me[k] = j.user[k];
        var ap = document.getElementById('avprev'); if (ap) ap.innerHTML = av(me, 72);
        say('Saved.'); if (btn) btn.disabled = false;
      }).catch(showErr);
    } else if (f.id === 'f-admin-invites') {
      api('POST', '/admin/invites', { count: 5 }).then(function (j) {
        document.getElementById('admin-out').innerHTML = '<p class="small">New codes: ' + j.codes.map(esc).join(' · ') + '</p>';
        if (btn) btn.disabled = false;
      }).catch(showErr);
    } else if (f.id === 'f-link') {
      api('POST', '/accounts/link', d).then(boot).then(function () { say('Account added. Now on @' + me.handle); go('/' + me.handle, true); }).catch(showErr);
    } else if (f.id === 'f-claim') {
      api('POST', '/claim/' + f.getAttribute('data-token'), d).then(boot).then(function () { say('Your page is yours.'); go('/' + me.handle, true); }).catch(showErr);
    } else if (f.id === 'f-account') {
      var ea = document.getElementById('err-account'); ea.hidden = true;
      if (!d.password) delete d.password;
      if (!d.email) delete d.email;
      api('POST', '/accounts', d).then(function (j) {
        var out = document.getElementById('account-out');
        var h = '<div class="box" style="margin-top:12px"><span>Page created: <a class="accent" href="/' + esc(j.user.handle) + '">rsvp.fm/' + esc(j.user.handle) + '</a></span>';
        if (j.claim) h += '<span class="small">Send this activation link so they choose their password:</span><span class="mono" style="font-size:12px;overflow-wrap:anywhere">' + esc(location.origin + '/claim/' + j.claim) + '</span>' +
          '<div><button class="pill" type="button" data-act="copyclaim" data-id="' + esc(j.claim) + '">Copy link</button></div>';
        else h += '<span class="small">It is in your accounts: tap your name on your page to switch to it.</span>' +
          '<div><button class="pill on" type="button" data-act="switchto" data-id="' + esc(j.user.handle) + '">Switch to @' + esc(j.user.handle) + '</button></div>';
        out.innerHTML = h + '</div>';
        f.reset(); if (btn) btn.disabled = false;
      }).catch(function (e) { ea.textContent = e.message; ea.hidden = false; if (btn) btn.disabled = false; });
    } else if (f.id === 'f-feature') {
      var featured = btn && btn.value === '1';
      api('POST', '/admin/feature', { handle: d.handle, featured: featured }).then(function () {
        say(featured ? '@' + d.handle + ' is featured in Discover.' : '@' + d.handle + ' removed from Discover.'); if (btn) btn.disabled = false;
      }).catch(showErr);
    }
  });

  // Resize and crop an image in the browser before upload: avatars 400×400, headers 1500×500.
  function prepareImage(file, w, h) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
        var sw = w / scale, sh = h / scale, sx = (img.naturalWidth - sw) / 2, sy = (img.naturalHeight - sh) / 2;
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        var ctx = c.getContext('2d'); ctx.fillStyle = '#0D0D0C'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('This file could not be read as an image. Try a JPEG or PNG.')); };
      img.src = url;
    });
  }
  document.addEventListener('change', function (ev) {
    var input = ev.target;
    if (!input.matches || !input.matches('input[type=file][data-kind]') || !input.files || !input.files[0]) return;
    var kind = input.getAttribute('data-kind');
    say('Uploading…');
    prepareImage(input.files[0], kind === 'banner' ? 1500 : 400, kind === 'banner' ? 500 : 400)
      .then(function (data) { return api('POST', '/me/image', { kind: kind, data: data }); })
      .then(function (j) {
        me[kind] = j.url;
        say(kind === 'banner' ? 'Header updated.' : 'Photo updated.');
        viewSettings();
      })
      .catch(function (e) { say(e.message); input.value = ''; });
  });

  window.addEventListener('popstate', route);

  function boot() {
    return api('GET', '/session').then(function (j) {
      me = j.user; needsInvite = j.needs_invite !== false;
    });
  }
  // Never stay stuck on "Loading…": give the session check 8 seconds, then render anyway.
  var started = false;
  function start() { if (!started) { started = true; route(); } }
  setTimeout(start, 8000);
  boot().catch(function () {}).then(start);
})();
