// rsvp.fm front-end — plain JS, no build step.
(function () {
  'use strict';

  // Money features (ticket sales, referral commissions, amounts owed) are built but hidden at launch.
  // Flip to true the day ticketing opens.
  var MONEY = false;
  var me = null;          // logged-in user or null
  var unread = false;     // something new on the Activity page
  var needsInvite = true; // false only before the very first account exists
  var main = document.getElementById('main');
  var hdr = document.getElementById('hdr');
  var PALETTE = ['#E23B2E', '#2F55D4', '#E8A80C', '#1E8C6E', '#9B59D0', '#D23C7A', '#1FA4B4', '#F2EFE6'];

  // ---------- helpers ----------
  // Page types: stored as member / artist / promoter, shown as Guest / Artist / Label / Promoter.
  var KINDS = { member: 'Guest', artist: 'Artist', promoter: 'Label / Promoter', club: 'Club' };
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
  function dateTile(s) { var d = parseLocal(s); return d ? '<b>' + d.getDate() + '</b><i>' + MONTHS[d.getMonth()].toUpperCase() + '</i>' : ''; }
  function ago(s) {
    var t = Date.parse(String(s).replace(' ', 'T') + 'Z');
    var m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return 'now'; if (m < 60) return m + 'm';
    var h = Math.round(m / 60); if (h < 24) return h + 'h';
    var d = Math.round(h / 24); if (d < 7) return d + 'd';
    var dt = new Date(t); return dt.getDate() + ' ' + MONTHS[dt.getMonth()];
  }
  function priceLabel(e) { return e.entry === 'ticket' ? (e.price_cents ? money(e.price_cents, e.currency) : 'Free ticket') : 'Free · RSVP'; }
  function rsvpLabel(e) { return e.is_going ? 'Going ✓' : 'I\'m going'; }
  function rsvpLabelOld(e) { return e.is_going ? (e.entry === 'ticket' ? 'Going' : 'On the list') : (e.entry === 'ticket' ? 'Get ticket' : 'RSVP'); }
  function shareLink(id) { return location.origin + '/e/' + id + (me ? '?ref=' + me.handle : ''); }
  // Invite people: the phone's share sheet (WhatsApp, Messages, Mail, Instagram…), or straight to WhatsApp, SMS or email.
  function inviteText(e, list) {
    var title = (e.caption || e.title || '').split('\n')[0];
    var when = e.starts_at ? ' on ' + fmtDate(e.starts_at) : '';
    if (list === 'ff') return e.host.name + ' invites you to ' + title + when + ': a friends & family ticket is waiting for you. Confirm your name here:';
    if (list === 'gl') return e.host.name + ' invites you to the guestlist of ' + title + when + '. Confirm your name here:';
    return title + when + ', see you there?';
  }
  function inviteButtons(e, list, url) {
    var text = inviteText(e, list), full = text + ' ' + url, enc = encodeURIComponent;
    var subject = list === 'ff' ? 'Your friends & family ticket' : list === 'gl' ? 'You\'re invited: ' + (e.caption || e.title || '').split('\n')[0] : (e.caption || e.title || '').split('\n')[0];
    return '<div class="acts" style="flex-wrap:wrap">' +
      '<button class="pill solid" data-act="invite" data-id="' + esc(url) + '" data-text="' + esc(text) + '">Invite…</button>' +
      '<a class="pill" href="https://wa.me/?text=' + enc(full) + '" target="_blank" rel="noopener">WhatsApp</a>' +
      '<a class="pill" href="sms:?&body=' + enc(full) + '">SMS</a>' +
      '<a class="pill" href="mailto:?subject=' + enc(subject) + '&body=' + enc(full) + '">Email</a>' +
      '<button class="pill ghost" data-act="copylink" data-id="' + esc(url) + '">Copy link</button></div>';
  }
  function copy(text) {
    var done = function () { say('Link copied · ' + text.replace(/^https?:\/\//, '')); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { prompt('Copy this link', text); });
    else prompt('Copy this link', text);
  }

  var I = {
    rep: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3"/></svg>',
    share: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg>',
    back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
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
  // An event's picture: the uploaded image, or a plain block with the first line of the caption.
  function cover(e, h, big) {
    if (e.image && /^(\/api\/img\/|https:\/\/)/.test(e.image)) {
      return '<img src="' + esc(e.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer" style="display:block;width:100%;max-height:' + (big ? 560 : 420) + 'px;object-fit:cover;background:var(--surface)">';
    }
    var first = (e.caption || e.title || '').split('\n')[0];
    return '<div class="cover" style="height:' + h + 'px;background:var(--surface);border-bottom:1px solid var(--line)">' +
      '<div class="t" style="color:var(--fg)"><div class="t1" style="font-size:' + (big ? 30 : 22) + 'px">' + esc(first) + '</div></div></div>';
  }
  // "Sat 14 Nov · 15:00 → 02:00" when it ends the same night, full end date when it runs over several days.
  function whenLine(e) {
    if (!e.starts_at) return '';
    var line = fmtDate(e.starts_at) + ' · ' + fmtTime(e.starts_at);
    var s0 = parseLocal(e.starts_at), e0 = parseLocal(e.ends_at);
    if (e0) {
      var hours = (e0 - s0) / 3600000;
      line += ' → ' + (hours > 0 && hours < 24 ? fmtTime(e.ends_at) : fmtDate(e.ends_at) + ' · ' + fmtTime(e.ends_at));
    } else if (e.ends_at) line += ' → ' + e.ends_at;
    return line;
  }
  function postHtml(p) {
    var a = p.author, e = p.event, h = '<article class="post gut">';
    if (p.reposted_by) h += '<div class="rp">' + I.rep.replace(/20/g, '14') + '<span>' + esc(p.reposted_by.name) + ' reposted</span></div>';
    h += '<a class="who" href="/' + esc(a.handle) + '">' + av(a, 36) + '<span style="min-width:0"><span class="name">' + esc(a.name) + '</span><span class="meta">@' + esc(a.handle) + ' · ' + ago(p.created_at) + '</span></span></a>';
    h += '<p class="txt">' + esc(p.text) + '</p>';
    if (e) {
      h += '<a class="card" href="/e/' + esc(e.id) + '">' + cover(e, 150, false) +
        (e.starts_at ? '<div class="cardfoot"><span>' + whenLine(e) + '</span></div>' : '') + '</a>';
    }
    h += '<div class="acts">';
    if (e && e.visibility === 'public') h += '<button class="pill' + (e.is_going ? ' on' : '') + '" data-act="rsvp" data-list="going" data-id="' + esc(e.id) + '" data-going="' + (e.is_going ? 1 : 0) + '">' + rsvpLabel(e) + '</button>';
    else if (e) h += '<a class="pill" href="/e/' + esc(e.id) + '">Open</a>';
    if (!p.mine) h += '<button class="ico' + (p.i_reposted ? ' on' : '') + '" aria-label="Repost" data-act="repost" data-id="' + p.id + '" data-on="' + (p.i_reposted ? 1 : 0) + '">' + I.rep + '</button>';
    if (e) h += '<button class="ico" aria-label="Copy your referral link" data-act="share" data-id="' + esc(e.id) + '">' + I.share + '</button>';
    if (p.mine && !p.reposted_by) h += '<button class="ico" style="margin-left:' + (e ? '0' : 'auto') + '" data-act="delpost" data-id="' + p.id + '">Delete</button>';
    return h + '</div></article>';
  }
  function evRow(e, line) {
    return '<a class="row" href="/e/' + esc(e.id) + '"><span class="date">' + (e.starts_at ? dateTile(e.starts_at) : '<i>·</i>') + '</span>' +
      '<span style="display:flex;flex-direction:column;gap:2px;min-width:0"><span class="name" style="font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc((e.caption || e.title).split('\n')[0]) + '</span>' +
      '<span class="meta">' + esc(line) + '</span></span></a>';
  }
  function favBtn(u, on) {
    return '<button class="pill' + (on ? ' on' : '') + '" data-act="fav" data-id="' + esc(u.handle) + '" data-on="' + (on ? 1 : 0) + '" aria-label="' + (on ? 'Remove from favourites' : 'Add to favourites') + '">' + (on ? '★' : '☆') + '</button>';
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
    else if (!me) h += '<a class="pill ghost" href="/login">Log in</a>';
    hdr.innerHTML = h + '</span>';
  }
  function setTab(name) {
    var nav = document.getElementById('tabs');
    nav.hidden = !me;
    var dot = document.getElementById('notif-dot'); if (dot) dot.hidden = !unread || name === 'notifications';
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
    function step(n, title, text) {
      return '<div style="display:grid;grid-template-columns:44px minmax(0,1fr);gap:4px 12px;padding-block:18px;border-top:1px solid var(--line)">' +
        '<span class="mono muted" style="font-size:12px;padding-top:3px">' + n + '</span><h2>' + title + '</h2>' +
        '<span></span><p class="txt" style="color:var(--muted)">' + text + '</p></div>';
    }
    main.innerHTML = '<section class="hero gut">' +
      '<span class="label">rsvp.fm</span>' +
      '<h1>See you there.</h1>' +
      '<p>A place made for meeting in real life. Follow the artists, labels and promoters you love, know where they play next, and be there.</p>' +
      '<div class="acts" style="flex-wrap:wrap"><a class="pill big solid" href="/login">Log in</a></div>' +
      '<p class="mono" style="margin:0;font-size:12px;color:var(--muted)">By invitation only. Get the link from an artist, a club, a label or a friend.</p></section>' +
      '<section class="gut" style="padding-block:8px 24px">' +
      step('01', 'Get invited', 'An artist, a club, a label or a friend sends you their link. You join their community and follow them. That\'s the only way in.') +
      step('02', 'Get in', 'Guestlists, friends &amp; family tickets and other special invitations, straight from the people who run the night.') +
      step('03', 'Meet', 'See which friends are going, then put your phone away. The point is the dance floor, not the feed.') +
      '</section>' +
      '<section class="gut" style="padding-block:20px 40px;border-top:1px solid var(--line)">' +
      '<p class="mono" style="margin:0;font-size:13px;line-height:1.8">No ads.<br>No algorithm.<br>No follower counts.<br>Less scrolling, more rendezvous.</p></section>';
  }

  function inviteCard(e) {
    var tag = e.is_host ? 'Your event' : e.my_list ? (LISTS[e.my_list] || 'Going') : 'From @' + e.host.handle;
    var onList = e.my_list === 'gl' || e.my_list === 'ff';
    return '<a href="/e/' + esc(e.id) + '" style="display:block;border-bottom:1px solid var(--line)">' + (e.image ? cover(e, 180) : '') +
      '<div class="gut" style="padding-block:14px 18px;display:flex;flex-direction:column;gap:6px">' +
      '<span class="label" style="' + (onList ? 'color:var(--accent)' : '') + '">' + esc(tag) + '</span>' +
      '<span class="name" style="font-size:17px">' + esc((e.caption || e.title).split('\n')[0]) + '</span>' +
      '<span class="meta">' + esc(['@' + e.host.handle, whenLine(e)].filter(Boolean).join(' · ')) + '</span></div></a>';
  }
  function viewFeed() {
    if (!me) return viewWelcome();
    header({ right: '<a class="ico" aria-label="Search" href="/search">' + I.search + '</a>' }); setTab('feed'); loading();
    api('GET', '/session').then(function (j) { unread = !!j.unread; setTab('feed'); }).catch(function () {});
    api('GET', '/invitations').then(function (j) {
      var h = '<div class="label gut bar">Invitations</div>';
      if (!j.events.length) {
        h += '<div class="gut" style="padding-block:40px 24px"><p style="margin:0 0 8px;font-size:17px">You haven\'t been invited to any event yet.</p>' +
          '<p class="small" style="margin:0 0 16px">You can however follow artists and labels: their next events will show up here.</p>' +
          '<a class="pill solid" href="/search">Find artists and labels</a></div>';
      } else j.events.forEach(function (e) { h += inviteCard(e); });
      main.innerHTML = '<div id="alert"></div>' + h + '<div id="suggest"></div>';
      renderSuggestions(document.getElementById('suggest'), 12);
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
      j.events.forEach(function (e) { h += evRow(e, '@' + e.host.handle + (e.starts_at ? ' · ' + whenLine(e) : '')); });
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
  // Who to follow: people followed by the people you follow, then artists and labels.
  function personCard(u) {
    return '<div class="pick" style="flex:0 0 150px;padding:14px"><a href="/' + esc(u.handle) + '" style="display:flex;flex-direction:column;gap:8px;min-width:0">' + av(u, 48) +
      '<span class="name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(u.name) + '</span>' +
      '<span class="meta" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">@' + esc(u.handle) + '</span>' +
      (u.reason ? '<span class="small" style="font-size:11px;line-height:1.3">' + esc(u.reason) + '</span>' : '') + '</a>' + followBtn(u, false) + '</div>';
  }
  function renderSuggestions(el, max) {
    if (!el || !me) return;
    api('GET', '/suggestions').then(function (j) {
      var list = j.users.slice(0, max);
      if (!list.length) { el.innerHTML = ''; return; }
      el.innerHTML = '<section style="border-bottom:1px solid var(--line);padding-block:14px 4px"><div class="gut" style="display:flex;justify-content:space-between;align-items:baseline">' +
        '<span class="label">Suggested for you</span><a class="small" href="/search">See more</a></div>' +
        '<div class="picks gut">' + list.map(personCard).join('') + '</div></section>';
    }).catch(function () { el.innerHTML = ''; });
  }
  function personRowFollow(u) {
    return '<div class="row" style="gap:12px"><a href="/' + esc(u.handle) + '" style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">' + av(u, 40) +
      '<span style="display:flex;flex-direction:column;min-width:0"><span class="name">' + esc(u.name) + '</span><span class="meta">@' + esc(u.handle) + ' · ' + esc(kindLabel(u.kind)) + (u.city ? ' · ' + esc(u.city) : '') + '</span>' +
      (u.reason && u.reason !== kindLabel(u.kind) ? '<span class="small" style="font-size:11px">' + esc(u.reason) + '</span>' : '') + '</span></a>' +
      (me && !u.is_me ? followBtn(u, !!u.is_following) : '') + '</div>';
  }
  var searchTimer;
  function viewSearch() {
    header({ back: true, title: 'Search' }); setTab('feed');
    var q0 = new URLSearchParams(location.search).get('q') || '';
    main.innerHTML = '<div class="gut section"><div class="field"><label for="sq">Search people, labels, artists and events</label>' +
      '<input id="sq" type="search" autocomplete="off" autocapitalize="none" placeholder="Name, @handle or city" value="' + esc(q0) + '"></div></div>' +
      '<div id="sres"></div>';
    var input = document.getElementById('sq'), out = document.getElementById('sres');
    function showSuggestions() {
      if (!me) { out.innerHTML = ''; return; }
      api('GET', '/suggestions').then(function (j) {
        if (input.value.trim()) return;
        out.innerHTML = j.users.length ? '<section class="gut"><span class="label">Suggested for you</span><div>' + j.users.map(personRowFollow).join('') + '</div></section>'
          : '<div class="end">Search for a name, an @handle or a city.</div>';
      }).catch(function () {});
    }
    function run() {
      var q = input.value.trim();
      try { history.replaceState({}, '', q ? '/search?q=' + encodeURIComponent(q) : '/search'); } catch (e) {}
      if (!q) return showSuggestions();
      api('GET', '/search?q=' + encodeURIComponent(q)).then(function (j) {
        if (input.value.trim() !== q) return;
        var h = '';
        if (j.users.length) h += '<section class="gut"><span class="label">People</span><div>' + j.users.map(personRowFollow).join('') + '</div></section>';
        if (j.events.length) h += '<section class="gut" style="padding-top:16px"><span class="label">Events</span><div>' + j.events.map(function (e) { return evRow(e, '@' + e.host.handle + (e.starts_at ? ' · ' + whenLine(e) : '')); }).join('') + '</div></section>';
        out.innerHTML = h || '<div class="end">No one or nothing matches “' + esc(q) + '”.</div>';
      }).catch(function (e) { out.innerHTML = '<div class="end">' + esc(e.message) + '</div>'; });
    }
    input.addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(run, 220); });
    run();
    input.focus();
  }

  // Pick favourite artists, labels and clubs: the ones you follow, plus a search to find more.
  function favRow(u) {
    return '<div class="row" style="gap:12px"><a href="/' + esc(u.handle) + '" style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">' + av(u, 40) +
      '<span style="display:flex;flex-direction:column;min-width:0"><span class="name">' + esc(u.name) + '</span><span class="meta">@' + esc(u.handle) + ' · ' + esc(kindLabel(u.kind)) + '</span></span></a>' +
      favBtn(u, !!u.favorite) + '</div>';
  }
  function viewFavorites() {
    if (!me) return needLogin();
    header({ back: true, title: 'Favourites' }); setTab('me'); loading();
    api('GET', '/users/' + encodeURIComponent(me.handle)).then(function (j) {
      var pages = j.following.filter(function (f) { return f.kind !== 'member'; });
      main.innerHTML = '<div class="gut section"><p class="small" style="margin:0">Star the artists, labels and clubs you love. They show on your page as your favourites.</p>' +
        '<div class="field"><label for="fq">Find an artist, a label or a club</label><input id="fq" type="search" autocomplete="off" autocapitalize="none" placeholder="Name or @handle"></div></div>' +
        '<div id="fres"></div>' +
        '<section class="gut" id="fmine"><span class="label">You follow</span><div>' + (pages.length ? pages.map(favRow).join('') : '<p class="small">No artists or labels yet. Search above.</p>') + '</div></section>';
      var input = document.getElementById('fq'), out = document.getElementById('fres'), t;
      input.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(function () {
          var q = input.value.trim();
          if (!q) { out.innerHTML = ''; return; }
          api('GET', '/search?q=' + encodeURIComponent(q)).then(function (r) {
            if (input.value.trim() !== q) return;
            var favs = {}; j.following.forEach(function (f) { if (f.favorite) favs[f.handle] = 1; });
            var list = r.users.filter(function (u) { return u.kind !== 'member' && !u.is_me; });
            out.innerHTML = '<section class="gut" style="padding-bottom:16px"><span class="label">Results</span><div>' +
              (list.length ? list.map(function (u) { u.favorite = !!favs[u.handle]; return favRow(u); }).join('') : '<p class="small">No artist, label or club matches.</p>') + '</div></section>';
          }).catch(function () {});
        }, 220);
      });
    }).catch(showError);
  }

  function viewNotifications() {
    if (!me) return needLogin();
    header({ title: 'Activity' }); unread = false; setTab('notifications'); loading();
    api('GET', '/notifications').then(function (j) {
      if (!j.items.length) { main.innerHTML = '<div class="end">Nothing yet. New followers, reposts, wall messages and guestlist activity show up here.</div>'; return; }
      main.innerHTML = '<div>' + j.items.map(function (n) {
        var face = n.actor ? av(n.actor, 36) : '<span style="width:36px;height:36px;border:1px solid var(--line);border-radius:50%;flex-shrink:0"></span>';
        var who = n.actor ? n.actor.name : n.name;
        return '<a class="row gut" href="' + esc(n.link) + '" style="gap:12px;align-items:flex-start' + (n.unread ? ';background:var(--surface)' : '') + '">' + face +
          '<span style="display:flex;flex-direction:column;min-width:0;flex:1"><span style="font-size:14px;line-height:1.4;overflow-wrap:anywhere"><strong class="name" style="display:inline">' + esc(who) + '</strong> ' + esc(n.text) + '</span>' +
          '<span class="meta">' + ago(n.at) + (n.action ? ' · to answer' : '') + '</span></span>' +
          (n.unread ? '<span style="width:8px;height:8px;border-radius:50%;background:var(--accent);margin-top:6px;flex-shrink:0"></span>' : '') + '</a>';
      }).join('') + '</div>';
    }).catch(showError);
  }

  function viewDiscover() {
    header({ title: 'Discover' }); setTab('discover'); loading(); renderDiscover(main);
  }

  function viewProfile(handle) {
    header({ back: true, title: 'rsvp.fm/' + handle }); setTab(me && me.handle === handle ? 'me' : ''); loading();
    api('GET', '/users/' + encodeURIComponent(handle)).then(function (j) {
      var u = j.user, h = '';
      if (u.handle !== handle) history.replaceState({}, '', '/' + u.handle);
      if (j.is_me) {
        header({ back: false, title: '', right: '<a class="ico" aria-label="Settings" href="/settings">' + I.gear + '</a>' });
        hdr.querySelector('.logo').insertAdjacentHTML('afterend', '<a class="pill ghost" href="/switch" aria-label="Switch account" style="margin-left:8px;gap:6px;color:var(--fg)">@' + esc(u.handle) + ' <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></a>');
      }
      if (u.banner && /^\/api\/img\//.test(u.banner)) h += '<div class="banner" style="height:160px;background:' + esc(u.color) + ' url(' + esc(u.banner) + ') center/cover no-repeat"></div>';
      else h += '<div class="banner" style="background:' + esc(u.color) + '"><div style="position:absolute;width:120px;height:120px;border-radius:50%;border:3px solid var(--ink);right:24px;top:-40px"></div><div style="position:absolute;width:40px;height:40px;border-radius:50%;background:var(--ink);right:140px;top:40px"></div></div>';
      h += '<div class="gut" style="display:flex;flex-direction:column;gap:10px;padding-block:0 16px"><div class="ptop"><span class="ring">' + av(u, 68) + '</span>' +
        (j.is_me ? '<a class="pill" href="/settings">Edit page</a>' : (me ? '<span style="display:flex;gap:8px">' + (u.kind !== 'member' ? favBtn(u, j.is_favorite) : '') + followBtn(u, j.is_following) + '</span>' : '<a class="pill solid" href="/login?next=/' + esc(u.handle) + '">Follow</a>')) + '</div>';
      h += '<div><h1>' + esc(u.name) + '</h1><div class="mono muted" style="font-size:12px;margin-top:4px">rsvp.fm/' + esc(u.handle) + (u.ambassador ? ' · AMBASSADOR' : '') + '</div></div>';
      if (u.bio) h += '<p class="txt" style="font-size:14px">' + esc(u.bio) + '</p>';
      h += '<div class="stats"><span>' + esc(kindLabel(u.kind)) + (u.city ? ' · ' + esc(u.city) : '') + '</span></div></div>';
      if (j.is_me) h += '<div id="mine"></div>';
      if (j.events.length) {
        h += '<section class="gut section sep"><h2>Upcoming</h2><div>';
        j.events.forEach(function (e) { h += evRow(e, (e.visibility === 'private' ? 'Private · ' : '') + (whenLine(e) || 'No date')); });
        h += '</div></section>';
      }
      if (j.is_me && u.kind !== 'member') h += '<div class="gut" style="padding-block:0 16px"><a class="pill" href="/new/event">New event</a></div>';
      if (j.past.length) {
        h += '<section class="gut section sep"><h2>Past events</h2><div>';
        j.past.forEach(function (e) { h += evRow(e, whenLine(e)); });
        h += '</div></section>';
      }
      if (j.attended.length) {
        h += '<section class="gut section sep"><h2>' + (j.is_me ? 'Where you\'ve been' : 'Where ' + esc(u.name) + ' has been') + '</h2><div>';
        j.attended.forEach(function (e) { h += evRow(e, '@' + e.host.handle + ' · ' + fmtDate(e.starts_at)); });
        h += '</div></section>';
      }
      // Who they follow, by kind. Favorites when there are some, otherwise the latest follows. No counts.
      [['artist', 'artists', 'Artists'], ['promoter', 'labels &amp; promoters', 'Labels &amp; promoters'], ['club', 'clubs', 'Clubs'], ['member', '', 'Friends']].forEach(function (g) {
        var all = j.following.filter(function (f) { return f.kind === g[0]; });
        if (!all.length) return;
        var favs = all.filter(function (f) { return f.favorite; });
        var list = (favs.length ? favs : all).slice(0, 8);
        var title = g[0] === 'member' ? 'Friends' : favs.length ? 'Favourite ' + g[1] : g[2] + ' followed';
        h += '<section class="gut section sep"><h2>' + title + '</h2><div class="grid4">';
        list.forEach(function (f) { h += '<a class="g" href="/' + esc(f.handle) + '">' + av(f, 56) + '<span>' + esc(f.name) + '</span></a>'; });
        h += '</div></section>';
      });
      if (j.is_me) h += '<div class="gut" style="padding-block:0 20px"><a class="pill" href="/favorites">☆ Add favourite artists and labels</a></div>';
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
          '<p class="err" id="err" hidden></p><div class="acts"><button class="pill solid" type="submit">Post on the wall</button><span class="small">Public</span></div></form>';
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
      if (MONEY) h += '<section class="box" style="border-color:var(--fg)"><span class="label">Referrals</span><span style="font-size:28px;font-weight:800">' + money(ref.total_cents, 'EUR') + '</span>' +
        '<span class="small">' + ref.total_referred + ' people came through your links' + (ref.total_cents ? ' · estimated, paid by hosts' : '') + '</span></section>';
      else if (ref.total_referred) h += '<section class="box"><span class="label">Your links</span><span style="font-size:28px;font-weight:800">' + ref.total_referred + '</span>' +
        '<span class="small">' + (ref.total_referred === 1 ? 'person' : 'people') + ' RSVP\'d through links you shared</span></section>';
      h += '<section style="display:flex;flex-direction:column;gap:4px"><h2>Upcoming plans</h2>';
      if (nights.length) nights.forEach(function (e) { h += evRow(e, '@' + e.host.handle + (e.starts_at ? ' · ' + whenLine(e) : '')); });
      else h += '<p class="small" style="margin:0">Nothing yet. RSVP from your feed.</p>';
      el.innerHTML = h + '</section></div>';
    }).catch(function () { el.innerHTML = ''; });
  }

  function viewEvent(id) {
    header({ back: true, title: '' }); setTab(''); loading();
    var q = new URLSearchParams(location.search);
    try {
      if (q.get('ref')) sessionStorage.setItem('ref:' + id, q.get('ref'));
      if (q.get('k')) sessionStorage.setItem('k:' + id, q.get('k'));
    } catch (e) {}
    var k = q.get('k') || ''; try { k = k || sessionStorage.getItem('k:' + id) || ''; } catch (e) {}
    api('GET', '/events/' + encodeURIComponent(id) + (k ? '?k=' + encodeURIComponent(k) : '')).then(function (j) {
      var e = j.event, h = '';
      header({ back: true, title: (e.caption || e.title).split('\n')[0] });
      h += (e.image ? cover(e, 220, true) : '') + '<div class="gut" style="display:flex;flex-direction:column;gap:16px;padding-block:16px">';
      h += '<a class="who" href="/' + esc(e.host.handle) + '">' + av(e.host, 32) + '<span style="min-width:0"><span class="name">' + esc(e.host.name) + '</span><span class="meta">@' + esc(e.host.handle) +
        (e.visibility === 'private' ? ' · private' : '') + '</span></span></a>';
      if (e.starts_at) h += '<div class="mono" style="font-size:13px">' + whenLine(e) + '</div>';
      h += '<p class="txt">' + esc(e.caption) + '</p>';
      if (e.ticket_url) h += '<a class="pill big" href="' + esc(e.ticket_url) + '" target="_blank" rel="noopener noreferrer" style="align-self:flex-start">Tickets &amp; info' + (e.ticket_source ? ' on ' + esc(e.ticket_source) : '') + ' ↗</a>';
      if (e.friends.length) h += '<div style="display:flex;align-items:center;gap:10px"><div class="faces">' + e.friends.map(function (f) { return '<span class="ring">' + av(f, 26) + '</span>'; }).join('') +
        '</div><span class="small" style="margin-left:8px">' + e.friends.map(function (f) { return esc(f.name); }).join(', ') + ' ' + (e.friends.length > 1 ? 'are' : 'is') + ' going</span></div>';

      // Joining. A link opens its list directly; otherwise members join the guestlist (public events) or ask.
      var kl = e.key_list || '';
      var canGl = e.gl_on && (e.visibility === 'public' || kl === 'gl' || kl === 'ff' || e.is_host);
      var canFf = e.ff_on && (kl === 'ff' || e.is_host);
      var reqGl = e.gl_on && e.allow_requests && !canGl;
      var reqFf = e.ff_on && e.ff_requests && !canFf;
      var listName = kl === 'ff' ? 'friends &amp; family list' : 'guestlist';
      var invText = esc(e.host.name) + ' invited you to join the ' + listName + (e.starts_at ? ' on ' + esc(fmtDate(e.starts_at)) : '') + '.';
      if (me && kl && !e.is_host && e.my_list !== kl && e.my_list !== 'ff') {
        // Invitation through the host's link: confirm your name, you're on the list and you follow the host.
        h += '<section class="box" style="border-color:var(--accent)"><span class="label" style="color:var(--accent)">Invitation</span>' +
          '<h2 style="font-size:20px;line-height:1.3">' + invText + '</h2>' +
          '<form id="f-accept" data-id="' + esc(e.id) + '" data-list="' + kl + '" data-k="' + esc(k) + '" data-host="' + esc(e.host.handle) + '">' +
          '<div class="field"><label for="acc-name">Confirm your name</label><input id="acc-name" name="name" maxlength="60" required value="' + esc(me.name) + '"></div>' +
          '<p class="err" id="err" hidden></p><button class="pill big solid" type="submit">Confirm and follow @' + esc(e.host.handle) + '</button></form></section>';
      } else if (!me && kl) {
        h += '<section class="box" style="border-color:var(--accent)"><span class="label" style="color:var(--accent)">Invitation</span>' +
          '<h2 style="font-size:20px;line-height:1.3">' + invText + '</h2>' +
          '<p class="small" style="margin:0">Confirm your name and create your account. You will be on the list and follow ' + esc(e.host.name) + '.</p>' +
          signupFields('<input type="hidden" name="event" value="' + esc(e.id) + '"><input type="hidden" name="k" value="' + esc(k) + '">') +
          '<p class="small" style="margin:0">Already a member? <a class="accent" href="/login?next=' + encodeURIComponent(location.pathname + '?k=' + k) + '">Log in</a></p></section>';
      } else if (me) {
        h += '<div class="acts" style="flex-wrap:wrap">';
        // "I'm going" always comes first; guestlist and friends & family are extras when the host offers them.
        var ml = e.my_list;
        h += ml ? '<button class="pill big on" data-act="rsvp" data-id="' + esc(e.id) + '" data-going="1">Going ✓</button>'
                : '<button class="pill big solid" data-act="rsvp" data-list="going" data-id="' + esc(e.id) + '" data-going="0">I\'m going</button>';
        if (ml === 'gl') h += '<span class="small">On the guestlist</span>';
        if (ml === 'ff') h += '<span class="small">Friends &amp; family ticket</span>';
        if (ml !== 'ff' && canFf) h += '<button class="pill" data-act="rsvp" data-list="ff" data-id="' + esc(e.id) + '" data-going="0">Get my friends &amp; family ticket</button>';
        if (!ml || ml === 'going') { if (canGl) h += '<button class="pill" data-act="rsvp" data-list="gl" data-id="' + esc(e.id) + '" data-going="0">Join the guestlist</button>'; }
        if (e.my_request && e.my_request.status === 'pending') h += '<span class="small">Request sent for ' + (e.my_request.list === 'ff' ? 'a friends & family ticket' : 'the guestlist') + '. The host will confirm.</span>';
        else {
          if (ml !== 'ff' && reqFf) h += '<button class="pill" data-act="reqlist" data-list="ff" data-id="' + esc(e.id) + '">Request a friends &amp; family ticket</button>';
          if ((!ml || ml === 'going') && reqGl) h += '<button class="pill" data-act="reqlist" data-list="gl" data-id="' + esc(e.id) + '">Request the guestlist</button>';
        }
        if (e.visibility === 'public') h += '<button class="ico" aria-label="Copy link" data-act="share" data-id="' + esc(e.id) + '">' + I.share + '</button>';
        h += '</div>';
      } else if (reqFf || reqGl || canFf || canGl) {
        // Without an account everything goes through a request; a friends & family link asks for that list.
        var opts = [];
        if (e.ff_on && (e.ff_requests || kl === 'ff')) opts.push('ff');
        if (e.gl_on && (e.allow_requests || kl === 'gl')) opts.push('gl');
        if (opts.length) {
          var first = kl && opts.indexOf(kl) >= 0 ? kl : opts[0];
          h += '<section class="box"><h2>' + (opts.length > 1 ? 'Request a spot' : first === 'ff' ? 'Request a friends &amp; family ticket' : 'Request the guestlist') + '</h2>' +
            '<p class="small" style="margin:0">No account needed. The host will confirm.</p>' +
            '<form id="f-request" data-id="' + esc(e.id) + '" data-k="' + esc(k) + '">' +
            (opts.length > 1 ? '<div class="seg">' + opts.map(function (l) { return '<label><input type="radio" name="list" value="' + l + '"' + (l === first ? ' checked' : '') + '><span>' + (l === 'ff' ? 'Friends &amp; family ticket' : 'Guestlist') + '</span></label>'; }).join('') + '</div>'
              : '<input type="hidden" name="list" value="' + first + '">') +
            '<div class="field"><label for="rq-name">Name</label><input id="rq-name" name="name" maxlength="80" autocomplete="name" required></div>' +
            '<div class="field"><label for="rq-email">Email</label><input id="rq-email" name="email" type="email" autocomplete="email" required></div>' +
            '<div class="field"><label for="rq-note">Note for the host (optional)</label><input id="rq-note" name="note" maxlength="300" placeholder="+1, who you know…"></div>' +
            '<p class="err" id="err" hidden></p><button class="pill big solid" type="submit">Send my request</button></form>' +
            '<p class="small" style="margin:0">Already a member? <a class="accent" href="/login?next=' + encodeURIComponent(location.pathname + location.search) + '">Log in</a></p></section>';
        } else {
          h += '<div class="acts"><a class="pill big solid" href="/login?next=' + encodeURIComponent(location.pathname + location.search) + '">Log in to join</a></div>';
        }
      } else {
        h += '<div class="acts"><a class="pill big solid" href="/login?next=' + encodeURIComponent(location.pathname + location.search) + '">Log in to join</a></div>';
      }

      if (e.is_host) {
        var base = location.origin + '/e/' + e.id + '?k=';
        function linkBox(title, url, note, list) {
          return '<section class="box"><span class="label">' + title + '</span>' +
            '<span class="mono" style="font-size:12px;overflow-wrap:anywhere">' + esc(url.replace(/^https?:\/\//, '')) + '</span>' +
            '<span class="small">' + note + '</span>' +
            inviteButtons(e, list, url) + '</section>';
        }
        if (e.gl_on) h += linkBox('Guestlist link', base + e.gl_token, (e.visibility === 'private' ? 'Private event: only people with a link can see it.' : 'Public event: members can also join from the page.') + (e.allow_requests ? ' Requests are on.' : ''), 'gl');
        if (e.ff_on) h += linkBox('Friends & family link', base + e.ff_token, 'Whoever opens it gets a friends & family ticket.' + (e.ff_requests ? ' Requests are on.' : ''), 'ff');
        if (!e.gl_on && !e.ff_on) h += '<p class="small" style="margin:0">Guestlist and friends &amp; family are both off. Turn one on in Edit.</p>';
        h += '<div class="acts" style="flex-wrap:wrap"><a class="pill solid" href="/e/' + esc(e.id) + '/door">Door</a><button class="pill" data-act="exportcsv" data-id="' + esc(e.id) + '">Export CSV</button>' +
          '<a class="pill" href="/e/' + esc(e.id) + '/edit">Edit</a><button class="pill ghost" data-act="delevent" data-id="' + esc(e.id) + '">Delete</button></div><div id="guests"></div>';
      }
      main.innerHTML = h + '</div>';
      if (e.is_host) renderGuests(e, document.getElementById('guests'));
    }).catch(showError);
  }
  function renderGuests(e, el) {
    api('GET', '/events/' + e.id + '/guests').then(function (j) {
      var pending = j.requests.filter(function (r) { return r.status === 'pending'; });
      var approved = j.requests.filter(function (r) { return r.status === 'approved'; });
      var h = '';
      if (pending.length) {
        h += '<section class="box"><span class="label">Requests</span>';
        pending.forEach(function (r) {
          h += '<div class="row" style="align-items:flex-start;gap:10px"><span style="flex:1;min-width:0"><span class="name">' + esc(r.name) + '</span>' +
            '<span class="meta" style="overflow-wrap:anywhere">' + (r.list === 'ff' ? 'Friends & family' : 'Guestlist') + ' · ' + esc(r.email) + '</span>' +
            (r.note ? '<span class="small" style="display:block">' + esc(r.note) + '</span>' : '') + '</span>' +
            '<button class="pill solid" data-act="approve" data-id="' + r.id + '" data-ev="' + esc(e.id) + '">Accept</button>' +
            '<button class="pill ghost" data-act="decline" data-id="' + r.id + '" data-ev="' + esc(e.id) + '">Decline</button></div>';
        });
        h += '</section>';
      }
      ['ff', 'gl', 'going'].forEach(function (l) {
        var members = j.guests.filter(function (g) { return (g.list || 'gl') === l; });
        var others = approved.filter(function (r) { return (r.list || 'gl') === l; });
        if (l === 'ff' && !e.ff_on && !members.length && !others.length) return;
        if (l === 'gl' && !e.gl_on && !members.length && !others.length) return;
        if (l === 'going' && !members.length) return;
        h += '<section class="box"><span class="label">' + LISTS[l] + '</span>';
        members.forEach(function (g) {
          h += '<a class="row" href="/' + esc(g.handle) + '">' + av(g, 28) + '<span class="name" style="flex:1">' + esc(g.name) + '</span><span class="small">' + (g.ref_handle ? 'via @' + esc(g.ref_handle) : '@' + esc(g.handle)) + '</span></a>';
        });
        others.forEach(function (r) {
          h += '<div class="row"><span style="width:28px;height:28px;border:1px solid var(--line);border-radius:50%;flex-shrink:0"></span><span class="name" style="flex:1">' + esc(r.name) + '</span><span class="small" style="overflow-wrap:anywhere">' + esc(r.email) + '</span></div>';
        });
        if (!members.length && !others.length) h += '<p class="small" style="margin:0">No one yet. Send your link.</p>';
        h += '</section>';
      });
      el.innerHTML = h;
    }).catch(function () { el.innerHTML = ''; });
  }

  function viewNew() {
    if (!me) return needLogin();
    header({ title: 'New post' }); setTab('new');
    var h = '<div class="gut section"><form id="f-post"><div class="field"><label for="text">Post to your followers</label>' +
      '<textarea id="text" name="text" rows="6" maxlength="500" placeholder="What\'s on tonight?" required></textarea></div>' +
      '<p class="err" id="err" hidden></p><div class="acts"><button class="pill big solid" type="submit">Post</button></div></form>' +
      '<p class="small">Your posts appear in your followers\' feeds in order. No algorithm.</p>';
    if (me.kind !== 'member') h += '<div class="sep" style="padding-top:16px"><a class="pill" href="/new/event">Create an event instead</a></div>';
    else h += '<p class="small sep" style="padding-top:16px;margin:0">Artist, label, promoter or club? Switch your page type in <a class="accent" href="/settings">Settings</a> to announce nights.</p>';
    main.innerHTML = h + '</div>';
    document.getElementById('text').focus();
  }

  function swatches(name, current) {
    return '<div class="swatches">' + PALETTE.map(function (c, i) {
      return '<label style="background:' + c + '" title="' + c + '"><input type="radio" name="' + name + '" value="' + c + '"' + (c === current || (!current && i === 2) ? ' checked' : '') + ' aria-label="Color ' + c + '"></label>';
    }).join('') + '</div>';
  }

  // Event form: an image, a caption, an optional date, public or private, requests on or off.
  function eventForm(v, editId) {
    var priv = v.visibility === 'private';
    return '<div class="gut section"><form id="f-event"' + (editId ? ' data-id="' + esc(editId) + '"' : '') + '>' +
      '<div class="field"><span class="label">Image</span><div id="ev-img" style="border:1px solid var(--line);border-radius:var(--r);overflow:hidden">' +
      (v.image ? '<img src="' + esc(v.image) + '" alt="" referrerpolicy="no-referrer" style="display:block;width:100%;max-height:420px;object-fit:cover">' : '<div class="small" style="padding:28px 14px;text-align:center">No image yet</div>') + '</div>' +
      '<input type="hidden" name="image" value="' + esc(v.image || '') + '">' +
      '<div class="acts"><label class="pill" for="up-event" style="cursor:pointer">' + (v.image ? 'Replace image' : 'Upload an image') + '</label>' +
      '<input id="up-event" type="file" accept="image/*" data-kind="event" hidden>' +
      (v.image ? '<button class="pill ghost" type="button" data-act="rmevimg">Remove</button>' : '') + '</div></div>' +
      '<div class="field"><label for="caption">Caption</label><textarea id="caption" name="caption" rows="8" maxlength="2000" required placeholder="Name of the night, where, who plays, anything you want to say.">' + esc(v.caption || '') + '</textarea></div>' +
      '<div class="two"><div class="field"><label for="starts_at">Starts (optional)</label><input id="starts_at" name="starts_at" type="datetime-local" value="' + esc((v.starts_at || '').slice(0, 16)) + '"></div>' +
      '<div class="field"><label for="ends_at">Ends (optional)</label><input id="ends_at" name="ends_at" type="datetime-local" value="' + esc(/^\d{4}-/.test(v.ends_at || '') ? v.ends_at.slice(0, 16) : '') + '"></div></div>' +
      '<div class="field"><label for="ticket_url">Tickets / more info link (optional)</label><input id="ticket_url" name="ticket_url" type="url" inputmode="url" autocapitalize="none" placeholder="https://ra.co/events/…" value="' + esc(v.ticket_url || '') + '"></div>' +
      '<fieldset><legend class="field">Who can see it</legend><div class="seg">' +
      '<label><input type="radio" name="visibility" value="public"' + (priv ? '' : ' checked') + '><span>Public</span></label>' +
      '<label><input type="radio" name="visibility" value="private"' + (priv ? ' checked' : '') + '><span>Private · link only</span></label></div></fieldset>' +
      listToggles(v) +
      '<p class="err" id="err" hidden></p><div class="acts"><button class="pill big solid" type="submit">' + (editId ? 'Save' : 'Publish') + '</button></div></form></div>';
  }
  function wireEventForm() {}
  // Two lists per event, each with its own link and its own request switch.
  function check(name, on, label, sub) {
    return '<label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer"><input type="checkbox" name="' + name + '" value="1"' + (on ? ' checked' : '') + ' style="width:auto;margin-top:3px">' +
      '<span style="display:flex;flex-direction:column"><span class="name" style="font-size:13px">' + label + '</span>' + (sub ? '<span class="small">' + sub + '</span>' : '') + '</span></label>';
  }
  function listToggles(v) {
    var glOn = v.gl_on == null ? true : !!v.gl_on;
    return '<fieldset class="box"><legend class="field" style="padding:0 6px">Guestlist</legend>' +
      check('gl_on', glOn, 'Guestlist', 'Free entry. You get a link to send; on a public event members can also join from the page.') +
      check('allow_requests', !!v.allow_requests, 'Accept guestlist requests', 'People can ask; you accept or decline.') + '</fieldset>' +
      '<fieldset class="box"><legend class="field" style="padding:0 6px">Friends &amp; family tickets</legend>' +
      check('ff_on', !!v.ff_on, 'Friends & family tickets', 'Special tickets you send with their own link.') +
      check('ff_requests', !!v.ff_requests, 'Accept friends & family requests', 'People can ask for one; you accept or decline.') + '</fieldset>';
  }
  var LISTS = { gl: 'Guestlist', ff: 'Friends & family', going: 'Going' };


  function viewNewEvent() {
    if (!me) return needLogin();
    header({ back: true, title: 'New event' }); setTab('new');
    if (me.kind === 'member' && !me.is_admin) {
      main.innerHTML = '<div class="end">Switch your page to Artist, Label / Promoter or Club in <a class="accent" href="/settings">Settings</a> to create events.</div>';
      return;
    }
    var q = new URLSearchParams(location.search), v = {};
    q.forEach(function (val, key) { v[key] = val; });
    main.innerHTML = importBox() + eventForm(v, null);
  }
  // Paste a Resident Advisor, Shotgun, DICE… link: the form fills itself, tickets and info stay on that page.
  function importBox(note) {
    return '<div class="gut section" style="padding-bottom:0"><form id="f-import" class="box"><span class="label">Import from a link</span>' +
      '<p class="small" style="margin:0">Already on Resident Advisor, Shotgun, DICE, Eventbrite, Ticket Fairy…? Paste the event link: the image, date, venue and line-up are copied here, and the tickets button points back to that page.</p>' +
      '<div class="field"><label for="imp-url" class="sr">Event link</label><input id="imp-url" name="url" type="url" inputmode="url" autocapitalize="none" autocomplete="off" required placeholder="https://ra.co/events/…"></div>' +
      '<p class="err" id="imp-err" hidden></p>' + (note ? '<p class="small" style="margin:0;color:var(--fg)">' + note + '</p>' : '') +
      '<div class="acts"><button class="pill solid" type="submit">Import</button></div></form></div>';
  }

  // Door mode: one list of everyone (all lists), search, tap to check in.
  function doorEntries(j) {
    var out = [];
    j.guests.forEach(function (g) { out.push({ kind: 'member', key: g.handle, name: g.name, sub: '@' + g.handle, list: g.list || 'gl', at: g.checked_in_at || '', user: g }); });
    j.requests.filter(function (r) { return r.status === 'approved'; }).forEach(function (r) {
      out.push({ kind: 'request', key: String(r.id), name: r.name, sub: r.email + (r.note ? ' · ' + r.note : ''), list: r.list || 'gl', at: r.checked_in_at || '' });
    });
    out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return out;
  }
  function viewDoor(id) {
    if (!me) return needLogin();
    header({ back: true, title: 'Door' }); setTab(''); loading();
    Promise.all([api('GET', '/events/' + encodeURIComponent(id)), api('GET', '/events/' + encodeURIComponent(id) + '/guests')]).then(function (r) {
      var e = r[0].event, list = doorEntries(r[1]);
      header({ back: true, title: 'Door · ' + (e.caption || e.title).split('\n')[0] });
      main.innerHTML = '<div class="gut section"><div class="field"><label for="door-q">Search the list</label><input id="door-q" type="search" autocomplete="off" autocapitalize="none" placeholder="Name, @handle or email"></div><div id="door-list"></div></div>';
      function draw() {
        var q = (document.getElementById('door-q').value || '').toLowerCase().trim();
        var rows = list.filter(function (x) { return !q || (x.name + ' ' + x.sub).toLowerCase().indexOf(q) >= 0; });
        document.getElementById('door-list').innerHTML = rows.map(function (x) {
          return '<button class="row" style="gap:12px;' + (x.at ? 'opacity:.55' : '') + '" data-act="checkin" data-kind="' + x.kind + '" data-id="' + esc(x.key) + '" data-ev="' + esc(id) + '" data-on="' + (x.at ? 1 : 0) + '">' +
            '<span style="width:28px;height:28px;border:1px solid var(--fg);border-radius:var(--r);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:800">' + (x.at ? '✓' : '') + '</span>' +
            '<span style="display:flex;flex-direction:column;min-width:0;flex:1"><span class="name">' + esc(x.name) + '</span><span class="meta" style="overflow-wrap:anywhere">' + esc(x.sub) + '</span></span>' +
            '<span class="small">' + (LISTS[x.list] || '') + '</span></button>';
        }).join('') || '<p class="small">No one matches.</p>';
      }
      document.getElementById('door-q').addEventListener('input', draw);
      draw();
      viewDoor.list = list; viewDoor.draw = draw;
    }).catch(showError);
  }
  function csvCell(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function exportCsv(id) {
    Promise.all([api('GET', '/events/' + encodeURIComponent(id)), api('GET', '/events/' + encodeURIComponent(id) + '/guests')]).then(function (r) {
      var e = r[0].event, j = r[1];
      var rows = [['Name', 'Handle', 'Email', 'List', 'Status', 'Brought by', 'Note', 'Checked in']];
      j.guests.forEach(function (g) { rows.push([g.name, '@' + g.handle, '', LISTS[g.list || 'gl'], 'confirmed', g.ref_handle ? '@' + g.ref_handle : '', '', g.checked_in_at || '']); });
      j.requests.forEach(function (q) { rows.push([q.name, '', q.email, LISTS[q.list || 'gl'], q.status === 'approved' ? 'confirmed' : 'pending', '', q.note, q.checked_in_at || '']); });
      var csv = rows.map(function (row) { return row.map(csvCell).join(','); }).join('\n');
      var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'rsvp-' + ((e.caption || e.title).split('\n')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || e.id) + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      say('Guestlist exported.');
    }).catch(function (err) { say(err.message); });
  }

  function viewEditEvent(id) {
    if (!me) return needLogin();
    header({ back: true, title: 'Edit event' }); setTab(''); loading();
    api('GET', '/events/' + encodeURIComponent(id)).then(function (j) {
      var e = j.event;
      if (!e.is_host) { main.innerHTML = '<div class="end">Only the host can edit this event.</div>'; return; }
      main.innerHTML = eventForm(e, e.id);
    }).catch(showError);
  }

  function viewLogin() {
    if (me) return go('/', true);
    header({ back: true, title: 'Log in' }); setTab('');
    main.innerHTML = '<div class="gut section"><h1>Welcome back.</h1><form id="f-login">' +
      '<div class="field"><label for="login">Handle or email</label><input id="login" name="login" autocomplete="username" autocapitalize="none" required></div>' +
      '<div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>' +
      '<p class="err" id="err" hidden></p><button class="pill big solid" type="submit">Log in</button></form>' +
      '<p class="small">No account yet? rsvp.fm is by invitation: open the link you received.</p></div>';
  }

  // The sign-up fields, shared by the invite landing page and event invitations.
  function signupFields(hidden, nameValue) {
    return '<form id="f-signup">' + hidden +
      '<div class="field"><label for="name">Your name</label><input id="name" name="name" maxlength="60" autocomplete="name" required value="' + esc(nameValue || '') + '"><span class="small">As it should appear on the list.</span></div>' +
      '<div class="field"><label for="handle">Handle</label><input id="handle" name="handle" autocapitalize="none" pattern="[a-z0-9_]{2,24}" maxlength="24" required placeholder="yourname"><span class="small">rsvp.fm/<span id="hprev">handle</span></span></div>' +
      '<fieldset><legend class="field">I am</legend><div class="seg">' +
      '<label><input type="radio" name="kind" value="member" checked><span>Guest</span></label>' +
      '<label><input type="radio" name="kind" value="artist"><span>Artist</span></label>' +
      '<label><input type="radio" name="kind" value="promoter"><span>Label / Promoter</span></label>' +
      '<label><input type="radio" name="kind" value="club"><span>Club</span></label></div></fieldset>' +
      '<div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required></div>' +
      '<div class="field"><label for="password">Password</label><input id="password" name="password" type="password" minlength="8" autocomplete="new-password" required></div>' +
      '<p class="err" id="err" hidden></p><button class="pill big solid" type="submit">Accept and join</button></form>';
  }
  function wireHandle() {
    var hi = document.getElementById('handle'); if (!hi) return;
    hi.addEventListener('input', function () {
      hi.value = hi.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
      document.getElementById('hprev').textContent = hi.value || 'handle';
    });
  }
  function inviterBlock(u, text) {
    return '<a class="who" href="/' + esc(u.handle) + '" style="gap:12px">' + av(u, 56) + '<span style="min-width:0"><span class="name" style="font-size:17px">' + esc(u.name) + '</span>' +
      '<span class="meta">@' + esc(u.handle) + ' · ' + esc(kindLabel(u.kind)) + '</span></span></a>' +
      '<h1 style="font-size:24px;line-height:1.25">' + text + '</h1>';
  }
  function invitePerks(u) {
    return u.kind === 'member' ? 'invited you to rsvp.fm.' : 'invited you to join their community and enjoy special invitations (guestlist, friends &amp; family tickets and more).';
  }
  // rsvp.fm/i/code: who invited you, then sign up. You follow them.
  function viewInviteLanding(code) {
    header({ title: 'Invitation' }); setTab(''); loading();
    api('GET', '/invite/' + encodeURIComponent(code)).then(function (j) {
      var u = j.inviter, h = '<div class="gut section" style="gap:18px">' + inviterBlock(u, esc(u.name) + ' ' + invitePerks(u));
      if (me) {
        h += '<p class="small" style="margin:0">You\'re already on rsvp.fm as @' + esc(me.handle) + '.</p><div class="acts">' + followBtn(u, false) + '<a class="pill" href="/' + esc(u.handle) + '">Open their page</a></div>';
      } else if (!j.valid) {
        h += '<p class="err">This invitation link has been used up. Ask ' + esc(u.name) + ' for a new one.</p>';
      } else {
        h += '<p class="small" style="margin:0">Confirm your name and create your account. You will follow ' + esc(u.name) + '.</p>' +
          signupFields('<input type="hidden" name="invite" value="' + esc(code) + '">') +
          '<p class="small" style="margin:0">Already a member? <a class="accent" href="/login?next=' + encodeURIComponent('/i/' + code) + '">Log in</a></p>';
      }
      main.innerHTML = h + '</div>';
      wireHandle();
    }).catch(showError);
  }
  function viewSignup() {
    if (me) return go('/', true);
    var q = new URLSearchParams(location.search);
    if (q.get('invite')) return go('/i/' + q.get('invite').toLowerCase(), true);
    header({ back: true, title: 'Join' }); setTab('');
    main.innerHTML = '<div class="gut section"><h1>By invitation only.</h1>' +
      '<p class="txt" style="color:var(--muted)">rsvp.fm is open to people invited by an artist, a club, a label or a friend. Open the link you received, or enter your invitation code.</p>' +
      '<form id="f-code"><div class="field"><label for="code">Invitation code</label><input id="code" name="code" autocapitalize="none" autocomplete="off" required></div>' +
      '<button class="pill big solid" type="submit">Continue</button></form>' +
      '<p class="small">Already a member? <a class="accent" href="/login">Log in</a></p></div>';
  }

  function viewSwitch() {
    if (!me) return needLogin();
    header({ back: true, title: 'Switch account' }); setTab('me'); loading();
    api('GET', '/accounts').then(function (j) {
      var h = '<div class="gut section"><h2>Your accounts</h2><div>';
      j.accounts.forEach(function (a) {
        h += '<button class="row" ' + (a.current ? 'disabled style="opacity:1"' : 'data-act="switchto" data-id="' + esc(a.handle) + '"') + '>' + av(a, 44) +
          '<span style="display:flex;flex-direction:column;min-width:0;flex:1"><span class="name">' + esc(a.name) + '</span><span class="meta">@' + esc(a.handle) + ' · ' + esc(kindLabel(a.kind)) + '</span></span>' +
          (a.current ? '<span class="mono" style="font-size:11px">CURRENT</span>' : '<span class="small">Switch</span>') + '</button>';
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
        '<div><h1>' + esc(j.user.name) + '</h1><div class="mono muted" style="font-size:12px">rsvp.fm/' + esc(j.user.handle) + '</div></div></div>' +
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
      '<div class="field"><label for="handle">Handle</label><input id="handle" name="handle" autocapitalize="none" autocomplete="off" pattern="[a-z0-9_]{2,24}" maxlength="24" value="' + esc(me.handle) + '" required>' +
      '<span class="small">rsvp.fm/<span id="hprev">' + esc(me.handle) + '</span> · old links to your page keep working</span></div>' +
      '<div class="field"><label for="name">Display name</label><input id="name" name="name" maxlength="60" value="' + esc(me.name) + '" required></div>' +
      '<div class="field"><label for="bio">Bio</label><textarea id="bio" name="bio" rows="3" maxlength="280">' + esc(me.bio) + '</textarea></div>' +
      '<div class="field"><label for="city">City</label><input id="city" name="city" maxlength="60" value="' + esc(me.city) + '"></div>' +
      '<fieldset><legend class="field">Page type</legend><div class="seg">' +
      ['member', 'artist', 'promoter', 'club'].map(function (k) { return '<label><input type="radio" name="kind" value="' + k + '"' + (me.kind === k ? ' checked' : '') + '><span>' + kindLabel(k) + '</span></label>'; }).join('') +
      '</div></fieldset><fieldset><legend class="field">Page color</legend>' + swatches('color', me.color) + '</fieldset>' +
      '<p class="err" id="err" hidden></p><button class="pill big solid" type="submit">Save</button></form></div>' +
      '<div class="gut section sep" id="invites"><h2>Your invite link</h2><p class="small" style="margin:0">Loading…</p></div>';
    if (me.is_admin) {
      h += '<div class="gut section sep" id="ambassadors"></div>' +
        '<div class="gut section sep"><h2>Admin</h2><form id="f-admin-invites" class="acts"><button class="pill" type="submit">Create 5 single-use codes</button></form>' +
        '<div id="admin-out"></div></div>';
    }
    h += '<div class="gut section sep" id="create"><h2>Create a page</h2><p class="small" style="margin:0">A label, a party series, an artist project, or a page for a partner. It is linked to your account: switch to it by tapping Me. Each page uses one of your invites.</p>' +
      '<form id="f-account">' +
      '<div class="two"><div class="field"><label for="ahandle">Handle</label><input id="ahandle" name="handle" autocapitalize="none" maxlength="24" required placeholder="yourlabel"></div>' +
      '<div class="field"><label for="aname">Display name</label><input id="aname" name="name" maxlength="60" required placeholder="Your Label"></div></div>' +
      '<fieldset><legend class="field">Page type</legend><div class="seg">' +
      '<label><input type="radio" name="kind" value="promoter" checked><span>Label / Promoter</span></label>' +
      '<label><input type="radio" name="kind" value="artist"><span>Artist</span></label>' +
      '<label><input type="radio" name="kind" value="club"><span>Club</span></label>' +
      '<label><input type="radio" name="kind" value="member"><span>Guest</span></label></div></fieldset>' +
      '<div class="field"><label for="aemail">Email (optional)</label><input id="aemail" name="email" type="email" autocomplete="off"></div>' +
      '<div class="field"><label for="apass">Password (optional, to log in to it directly)</label><input id="apass" name="password" type="password" autocomplete="new-password" minlength="8"></div>' +
      '<label class="small" style="display:flex;gap:10px;align-items:flex-start;cursor:pointer"><input type="checkbox" name="hand_over" value="1" style="width:auto;margin-top:2px"><span>This page is for someone else: give me an activation link so they choose their own password. Once they activate it, it leaves your accounts.</span></label>' +
      '<p class="err" id="err-account" hidden></p><button class="pill big solid" type="submit">Create the page</button></form><div id="account-out"></div></div>';
    h += '<div class="gut section sep"><button class="pill ghost" data-act="logout">Log out</button></div>';
    main.innerHTML = h;
    loadInvites();
    if (me.is_admin) loadAmbassadors();
    var hin = document.getElementById('handle');
    if (hin) hin.addEventListener('input', function () {
      hin.value = hin.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
      document.getElementById('hprev').textContent = hin.value || 'handle';
    });
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
          '<div style="height:4px;background:var(--line);overflow:hidden"><div style="height:100%;width:' + pct + '%;background:var(--fg)"></div></div></div>';
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
      '<span style="min-width:0"><span class="name">' + esc(u.name) + (u.ambassador ? ' <span class="mono muted" style="font-size:11px">AMBASSADOR</span>' : '') + '</span>' +
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
    if (p === '/discover') return go('/', true);
    if (p === '/notifications') return viewNotifications();
    if (p === '/search') return viewSearch();
    if (p === '/favorites' || p === '/favourites') return viewFavorites();
    if (p === '/new') return viewNew();
    if (p === '/new/event') return viewNewEvent();
    if (p === '/login') return viewLogin();
    if (p === '/signup' || p === '/invite') return viewSignup();
    if ((m = /^\/i\/([a-z0-9]+)$/i.exec(p))) return viewInviteLanding(m[1].toLowerCase());
    if ((m = /^\/claim\/([A-Za-z0-9_-]+)$/.exec(p))) return viewClaim(m[1]);
    if (p === '/switch') return viewSwitch();
    if (p === '/settings') return viewSettings();
    if ((m = /^\/e\/([a-z0-9]+)\/edit$/i.exec(p))) return viewEditEvent(m[1]);
    if ((m = /^\/e\/([a-z0-9]+)\/door$/i.exec(p))) return viewDoor(m[1]);
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
    if (act === 'share') {
      if (navigator.share) return navigator.share({ url: shareLink(id) }).catch(function () {});
      return copy(shareLink(id));
    }
    if (act === 'invite') {
      var it = b.getAttribute('data-text');
      if (navigator.share) return navigator.share({ text: it, url: id }).catch(function () {});
      return copy(it + ' ' + id);
    }
    if (act === 'copyinvite') return copy(inviteUrl(id));
    if (act === 'copyclaim') return copy(location.origin + '/claim/' + id);
    if (act === 'copylink') return copy(id);
    if (act === 'exportcsv') return exportCsv(id);
    if (!me) return needLogin();
    b.disabled = true;
    var done = function () { b.disabled = false; };
    if (act === 'follow') {
      var on = b.getAttribute('data-on') === '1';
      api(on ? 'DELETE' : 'POST', '/users/' + id + '/follow').then(function () {
        b.setAttribute('data-on', on ? '0' : '1'); b.textContent = on ? 'Follow' : 'Following'; b.classList.toggle('solid', on);
        say(on ? 'Unfollowed @' + id : 'Following @' + id);
      }).catch(function (e) { say(e.message); }).then(done);
    } else if (act === 'fav') {
      var fon = b.getAttribute('data-on') === '1';
      api(fon ? 'DELETE' : 'POST', '/users/' + id + '/favorite').then(function () {
        b.setAttribute('data-on', fon ? '0' : '1'); b.textContent = fon ? '☆' : '★'; b.classList.toggle('on', !fon);
        say(fon ? 'Removed from your favourites.' : 'Added to your favourites.');
        if (!fon) { var fb = b.parentNode.querySelector('[data-act=follow]'); if (fb) { fb.setAttribute('data-on', '1'); fb.textContent = 'Following'; fb.classList.remove('solid'); } }
      }).catch(function (e) { say(e.message); }).then(done);
    } else if (act === 'rsvp') {
      var going = b.getAttribute('data-going') === '1', ref = null, rlist = b.getAttribute('data-list') || 'going';
      try { ref = sessionStorage.getItem('ref:' + id); } catch (e) {}
      var gk = ''; try { gk = sessionStorage.getItem('k:' + id) || ''; } catch (e) {}
      api(going ? 'DELETE' : 'POST', '/events/' + id + '/rsvp', going ? undefined : { ref: ref, k: gk, list: rlist }).then(function () {
        say(going ? 'Cancelled.' : rlist === 'ff' ? 'Your friends & family ticket is confirmed.' : rlist === 'gl' ? 'You\'re on the guestlist.' : 'See you there.'); route();
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
    } else if (act === 'checkin') {
      var on = b.getAttribute('data-on') !== '1', kind = b.getAttribute('data-kind');
      api('POST', '/events/' + b.getAttribute('data-ev') + '/checkin', kind === 'request' ? { kind: 'request', id: id, on: on } : { kind: 'member', handle: id, on: on }).then(function (j) {
        (viewDoor.list || []).forEach(function (x) { if (x.kind === kind && x.key === id) x.at = j.checked_in_at; });
        if (viewDoor.draw) viewDoor.draw();
        say(on ? 'Checked in.' : 'Check-in undone.');
      }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'reqlist') {
      var rk = ''; try { rk = sessionStorage.getItem('k:' + id) || ''; } catch (e) {}
      api('POST', '/events/' + id + '/request', { list: b.getAttribute('data-list'), k: rk }).then(function () { say('Request sent. The host will confirm.'); route(); }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'approve' || act === 'decline') {
      api('POST', '/events/' + b.getAttribute('data-ev') + '/requests/' + id, { status: act === 'approve' ? 'approved' : 'declined' }).then(function () {
        say(act === 'approve' ? 'Added to the guestlist.' : 'Declined.'); route();
      }).catch(function (e) { say(e.message); done(); });
    } else if (act === 'rmevimg') {
      var f0 = document.getElementById('f-event'); f0.image.value = '';
      document.getElementById('ev-img').innerHTML = '<div class="small" style="padding:28px 14px;text-align:center">No image yet</div>'; b.remove();
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
      var evBack = d.event ? '/e/' + d.event : '';
      api('POST', '/signup', d).then(boot).then(function () {
        say(evBack ? 'Welcome. You\'re on the list.' : 'Welcome to rsvp.fm.'); go(evBack || '/', true);
      }).catch(showErr);
    } else if (f.id === 'f-import') {
      var ie = document.getElementById('imp-err'); if (ie) ie.hidden = true;
      if (btn) btn.textContent = 'Reading the page…';
      api('POST', '/import', { url: d.url }).then(function (r) {
        var v = { caption: r.caption, starts_at: r.starts_at, ends_at: r.ends_at, image: r.image, ticket_url: r.ticket_url, visibility: 'public', gl_on: 0 };
        main.innerHTML = importBox('Imported from ' + esc(r.source) + '. Check the details, then publish.' + (r.starts_at ? '' : ' Add the date: it was not on the page.')) + eventForm(v, null);
        document.getElementById('imp-url').value = d.url;
        var cap = document.getElementById('caption'); if (cap) cap.scrollIntoView({ block: 'center' });
      }).catch(function (e2) {
        if (btn) { btn.disabled = false; btn.textContent = 'Import'; }
        if (ie) { ie.textContent = e2.message; ie.hidden = false; } else say(e2.message);
      });
    } else if (f.id === 'f-code') {
      go('/i/' + String(d.code || '').trim().toLowerCase().replace(/^.*\/i\//, '').replace(/[^a-z0-9]/g, ''));
    } else if (f.id === 'f-accept') {
      var aid = f.getAttribute('data-id');
      var nm = String(d.name || '').trim();
      (nm && nm !== me.name ? api('PATCH', '/me', { name: nm }) : Promise.resolve()).then(function () {
        return api('POST', '/events/' + aid + '/rsvp', { list: f.getAttribute('data-list'), k: f.getAttribute('data-k'), ref: null });
      }).then(function () { say('Confirmed. You follow @' + f.getAttribute('data-host') + '.'); return boot(); }).then(route).catch(showErr);
    } else if (f.id === 'f-wall') {
      var wh = f.getAttribute('data-handle');
      api('POST', '/wall/' + wh, d).then(function () {
        say('Posted on the wall.');
        api('GET', '/users/' + wh).then(function (j) { renderWall(j.user, j.is_me); });
      }).catch(showErr);
    } else if (f.id === 'f-post') {
      api('POST', '/posts', d).then(function () { say('Posted.'); go('/'); }).catch(showErr);
    } else if (f.id === 'f-event') {
      var eid = f.getAttribute('data-id');
      api(eid ? 'PATCH' : 'POST', eid ? '/events/' + eid : '/events', d).then(function (j) { say(eid ? 'Saved.' : 'Your night is live.'); go('/e/' + j.id, true); }).catch(showErr);
    } else if (f.id === 'f-me') {
      api('PATCH', '/me', d).then(function (j) {
        var renamed = j.user.handle !== me.handle;
        for (var k in j.user) me[k] = j.user[k];
        if (renamed) { setTab('me'); say('Your page is now rsvp.fm/' + me.handle); }
        var ap = document.getElementById('avprev'); if (ap) ap.innerHTML = av(me, 72);
        if (!renamed) say('Saved.'); if (btn) btn.disabled = false;
      }).catch(showErr);
    } else if (f.id === 'f-admin-invites') {
      api('POST', '/admin/invites', { count: 5 }).then(function (j) {
        document.getElementById('admin-out').innerHTML = '<p class="small">New codes: ' + j.codes.map(esc).join(' · ') + '</p>';
        if (btn) btn.disabled = false;
      }).catch(showErr);
    } else if (f.id === 'f-request') {
      d.k = f.getAttribute('data-k') || '';
      api('POST', '/events/' + f.getAttribute('data-id') + '/request', d).then(function (j) {
        f.outerHTML = '<p class="txt">' + (j.already ? 'You already asked. ' : 'Request sent. ') + 'The host will confirm.</p>';
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
  // Event images keep their shape (posters, square, portrait): longest side at most `max` px.
  function prepareImageFit(file, max) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
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
    if (kind === 'event') {
      prepareImageFit(input.files[0], 1600)
        .then(function (data) { return api('POST', '/images', { data: data }); })
        .then(function (j) {
          var form = document.getElementById('f-event'); form.image.value = j.url;
          document.getElementById('ev-img').innerHTML = '<img src="' + esc(j.url) + '" alt="" style="display:block;width:100%;max-height:420px;object-fit:cover">';
          say('Image ready.');
        })
        .catch(function (e) { say(e.message); input.value = ''; });
      return;
    }
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
      me = j.user; needsInvite = j.needs_invite !== false; unread = !!j.unread;
    });
  }
  // Never stay stuck on "Loading…": give the session check 8 seconds, then render anyway.
  var started = false;
  function start() { if (!started) { started = true; route(); } }
  setTimeout(start, 8000);
  boot().catch(function () {}).then(start);
})();
