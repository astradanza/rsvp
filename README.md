# rsvp.fm

Clubs, labels and artists keep guestlist spots and special-price tickets for the people close to them. rsvp.fm is where they stay in touch with that community and give them those invitations. It doesn't replace ticketing (regular tickets stay on Resident Advisor, Shotgun, DICE…): it's the side door for your people. Guests only follow, see the offers meant for them, say they're going, and repost what pages share (with a comment).

See you there. A place made for meeting in real life: follow the artists, labels and promoters you love, know where they play next, and be there. No ads, no algorithm, no follower counts, free.

Money features (ticket sales, referral commissions, amounts owed to referrers) are built but hidden at launch: set `MONEY = true` at the top of `public/app.js` to show them.
Pages at `rsvp.fm/handle`, a chronological feed, an Activity page, events with guestlists and friends & family tickets, reposts, and referral links that credit whoever brought a guest.

Runs entirely on Cloudflare: one Worker (API + static app) and one D1 database.

## What works today

- By invitation only. The very first account becomes the admin; after that you get in through a personal invite link (`rsvp.fm/i/code`, 10 sign-ups), an admin single-use code, or an event's guestlist / friends & family link. The invite page says who invited you ("Deeplabel invited you to join their community and enjoy special invitations (guestlist, friends & family tickets and more)"); an event link says "… invited you to join the guestlist on Sat 12 Dec", asks you to confirm your name, puts you on the list and makes you follow the host. You always follow whoever invited you; a friend (Guest account) follows you back, artists, labels and clubs don't.
- Ambassadors: admins see members running low on invites (2 or fewer left) on their feed and in Settings, and can make them ambassadors (50 invites) or top them up by 10.
- Page types: Guest, Artist, Label / Promoter, Club.
- Pages `rsvp.fm/handle` with color, bio, city, upcoming and past events, where you've been (events you were on the list for), the artists, labels & promoters and clubs you follow (your favourites when you've starred some: ☆ on their page, or "Add favourite artists and labels" on your own page), friends, posts, and a public wall: any member can write on it, the author or the page owner can delete.
- Change your handle from Settings. Old handles keep redirecting to you (pages and referral links don't break) and can't be taken by anyone else.
- Search (magnifier at the top of the feed, `/search`): people and pages by name, @handle or city, plus public upcoming events.
- Suggestions: "Suggested for you" at the top of the feed and on the search page — people followed by the people you follow ("Followed by A and B"), then artists and labels. No ranking algorithm, just your network.
- Invitations (home tab): upcoming events you're on a list for (guestlist, friends & family, going), your own events, and public events announced by the pages you follow, soonest first. Empty state invites you to follow artists and labels. Posts and reposts stay on each page.
- Roles: artists, labels / promoters and clubs (pages) post, create events and write on walls. Guests can't post: they repost pages' posts with an optional comment, shown on their page under Reposts.
- Features: labels, promoters and clubs feature artists ("Feature" on the artist's page). The label's page lists its Featured artists; the artist's page shows Featured by. The artist gets a notification.
- Follow / unfollow. No algorithm.
- Posts and reposts. Members can post; anyone can repost.
- Events (labels, promoters, artists): an image, a caption, an optional start and end (date and time). Public (announced to followers and listed on the page) or private (only reachable with the guestlist link). Each event has two lists, each switched on or off by the host: the guestlist and friends & family tickets. Each list has its own link (`rsvp.fm/e/id?k=…`): members who open it are on that list in one tap. Separately, any member can tap "I'm going" on an event they can see. Requests can be allowed per list: members ask in one tap, people without an account leave a name, email and note; the host accepts or declines. No counters anywhere: no follower counts, no "going" counts.
- Import an event from a link (New event → Import from a link): paste a Resident Advisor, Shotgun, DICE, Eventbrite, Ticket Fairy… event URL. The Worker reads the page (Resident Advisor's GraphQL API, then schema.org JSON-LD, Next.js page data, Open Graph tags; code in `src/importer.js`) and prefills the form: image (kept hosted on the original site), caption with title, venue, line-up and description, start and end. The event gets a "Tickets & info on …" button pointing back to the original page. Any event can also carry that link by hand.
- Invite from the event (host view, under each list link): "Invite…" opens the phone's share sheet (WhatsApp, Messages, Mail, Instagram… pick contacts there), plus direct WhatsApp, SMS and email buttons with a ready message ("Deeplabel invites you to the guestlist of Secret garden on Sat 12 Dec. Confirm your name here: …"). Nothing is sent from the server and no contacts are read.
- Community offers: each event shows what the host keeps for its community (guestlist, friends & family tickets with an optional special price such as "€10 instead of €25"), on the event page, in Invitations and in the invite messages. A "Regular tickets & info on …" button points to the usual ticketing.
- Share links carry `?ref=handle`; the guestlist records who brought whom.
- Host view on each event: the list links, requests to accept or decline, and the lists with who brought whom.
- Door mode (`/e/id/door`): everyone on every list in one searchable list; tap to check someone in, tap again to undo.
- Export CSV: name, handle, email (only for people who requested without an account), list, status, brought by, note, checked in.
- Member view: nights you're going to, people you brought, estimated commission.
- Admin: unlimited invite link, single-use codes.
- Activity page (bell in the tab bar, a dot when there is something new): new followers, reposts, wall messages, sign-ups through your invite link, people going to or joining the lists of your events, requests to answer, and your own accepted requests. Built from what happened; only the time you last opened it is stored.
- Anyone can create a page (a label, a party series, an artist project, or a page for a partner). Each page uses one invite. Pages you create are linked to your account; switch between linked accounts from your page, like on Instagram. You can also link an existing account by logging in to it once. A page made for someone else gets an activation link (`rsvp.fm/claim/…`); once activated it leaves your accounts.

- Profile photo: pick one of 16 hand-drawn avatars (new members get one at random) or upload your own; optional header image. Uploads are resized in the browser and stored in D1.

Not yet: payments and automatic payouts (tickets are reservations for now), event posters, email (password reset, notifications).

## Deploy (Cloudflare dashboard, no terminal)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository** → pick `rsvp-fm`.
2. Leave the build command empty and the deploy command on its default (`npx wrangler deploy`).
3. Deploy. Cloudflare creates the `rsvp-fm` D1 database on first deploy, and the Worker creates its tables on the first request.
4. Worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain** → `rsvp.fm`.
5. Open rsvp.fm and sign up first: that account is the admin.

Every push to `main` redeploys.

## Run locally

```sh
npm install
npm run dev   # http://localhost:8787
```

## Layout

- `src/index.js` — the Worker: JSON API under `/api/*`, static files for everything else.
- `public/` — the app (plain HTML/CSS/JS, no build step).
- `migrations/` — D1 schema. Add a new numbered file for each schema change.

## Guestlist (list.rsvp.fm)

A second, separate product on its own subdomain, built from scratch around the guestlist only. Same Worker and database, its own tables (`gl_*`), sessions and app (`src/gl.js`, `public/gl/`). Cream paper, serif type, no images.

- Organizers (promoter, label or artist; no difference for now) create an account, then an event: name, start and end, venue, city, details, whether guests may bring a +1, +2 or +3, automatic confirmation on or off, list open or closed.
- Guest page `list.rsvp.fm/<id>`: the invitation (host, event, details) and a "Request a spot on the guestlist" form: full name, email, how many they bring, RSVP. They come back to the same page to see their status (requested, confirmed). Same email again updates the RSVP.
- Back office `list.rsvp.fm/e/<id>`: the link to share, requests / people / confirmed, sort by arrival or A–Z, confirm one by one or everyone, decline, copy the list as text, export CSV, close or reopen the list, edit, delete.

- Organizer page `list.rsvp.fm/<handle>`: logo (kept with its shape and transparency), name, bio, one of six dark, code-style themes with their own colors and type (Terminal: JetBrains Mono; Phosphor: IBM Plex Mono; Amber: Space Mono; Graphite: Fira Code; Solarized: Source Code Pro; Nocturne: Instrument Serif + IBM Plex Mono; Terminal by default), or a Custom theme: background, text and accent colors plus title and text fonts from 18 Google Fonts (mono, serif, sans), with a live preview and a contrast warning also worn by its event pages. Public (everyone sees upcoming events) or by invitation (visitors can "Request an invitation"; accepted people, people who RSVP'd and people holding the page's invitation link see the events).
- Community (back office): everyone who RSVP'd, asked to be kept posted or requested an invitation; accept or decline requests; who agreed to receive the next invitations by email; export CSV.
- Guests: no checkbox on the RSVP. After the RSVP, a "Join <organizer>'s page" step asks them to opt in to the next invitations by email (by tapping Join), with an optional password to receive the organizer's next invitations on rsvp.fm ("My invitations": upcoming events of their pages, their RSVP statuses). No email is sent yet: consent is stored for later.

Setup: Cloudflare → Workers & Pages → the rsvp-fm Worker → Settings → Domains & Routes → Add → Custom domain → `list.rsvp.fm`. Any hostname starting with `list.`, `guestlist.` or `gl.` serves this app.

### Guestlist emails

Sent with Cloudflare Email Service from `<handle>@rsvp.fm` ("Astradanza via rsvp.fm"); code in `src/gl-mail.js`. Nothing is sent until the send binding exists.

- On RSVP: "Request received" (or "You're on the list" when confirmation is automatic), with a link back to the guest's RSVP.
- On confirmation (one by one or "Confirm everyone"): "You're on the list".
- Daily at 16:00 UTC (cron): one digest per guest who joined at least one page, listing new invitations they haven't answered, plus one reminder for invitations still waiting less than three days before the event. Each invitation is emailed once (`gl_mail_log`).
- Every digest has an "Email settings or unsubscribe" link and List-Unsubscribe headers; guests choose "as they come", weekly or never (`/prefs`, or in My invitations).

To switch emails on: Workers Paid plan, then Email → Email Sending → add `rsvp.fm` in the Cloudflare dashboard, then add `"send_email": [{ "name": "EMAIL" }]` to `wrangler.jsonc`.
