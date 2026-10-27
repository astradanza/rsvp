# rsvp.fm

See you there. A place made for meeting in real life: follow the artists, labels and promoters you love, know where they play next, and be there. No ads, no algorithm, no follower counts, free.

Money features (ticket sales, referral commissions, amounts owed to referrers) are built but hidden at launch: set `MONEY = true` at the top of `public/app.js` to show them.
Pages at `rsvp.fm/handle`, a chronological feed, an Activity page, events with guestlists and friends & family tickets, reposts, and referral links that credit whoever brought a guest.

Runs entirely on Cloudflare: one Worker (API + static app) and one D1 database.

## What works today

- Open sign-up: no invite code needed. The very first account becomes the admin. Every member still has a personal invite link (`rsvp.fm/i/code`, 10 sign-ups): people who join through it are credited to the member and follow each other; the member sees who joined and how many are left.
- Ambassadors: admins see members running low on invites (2 or fewer left) on their feed and in Settings, and can make them ambassadors (50 invites) or top them up by 10.
- Pages `rsvp.fm/handle` with color, bio, city, Top 8, upcoming nights, posts, and a public wall: any member can write on it, the author or the page owner can delete.
- Change your handle from Settings. Old handles keep redirecting to you (pages and referral links don't break) and can't be taken by anyone else.
- Search (magnifier at the top of the feed, `/search`): people and pages by name, @handle or city, plus public upcoming events.
- Suggestions: "Suggested for you" at the top of the feed and on the search page — people followed by the people you follow ("Followed by A and B"), then artists and labels. No ranking algorithm, just your network.
- Invitations (home tab): upcoming events you're on a list for (guestlist, friends & family, going), your own events, and public events announced by the pages you follow, soonest first. Empty state invites you to follow artists and labels. Posts and reposts stay on each page.
- Follow / unfollow. No algorithm.
- Posts and reposts. Members can post; anyone can repost.
- Events (labels, promoters, artists): an image, a caption, an optional start and end (date and time). Public (announced to followers and listed on the page) or private (only reachable with the guestlist link). Each event has two lists, each switched on or off by the host: the guestlist and friends & family tickets. Each list has its own link (`rsvp.fm/e/id?k=…`): members who open it are on that list in one tap. Separately, any member can tap "I'm going" on an event they can see. Requests can be allowed per list: members ask in one tap, people without an account leave a name, email and note; the host accepts or declines. No counters anywhere: no follower counts, no "going" counts.
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
