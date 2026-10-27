# rsvp.fm

A curated home for promoters, artists and the people who dance with them.
Pages at `rsvp.fm/handle`, a chronological feed, a curated Discover tab, nights with free guestlist or tickets, reposts, and referral links that credit whoever brought a guest.

Runs entirely on Cloudflare: one Worker (API + static app) and one D1 database.

## What works today

- Invite-only sign-up. The very first account needs no invite and becomes the admin. Every member gets 3 invite codes.
- Pages `rsvp.fm/handle` with color, bio, city, follower counts, Top 8, upcoming nights and posts.
- Follow / unfollow. Feed = posts and reposts from people you follow, newest first. No algorithm.
- Posts and reposts. Members can post; anyone can repost.
- Nights (promoters and artists): free guestlist or ticket, price, referral commission %, capacity, line-up, color. Publishing a night posts an announcement.
- RSVP in one tap. Share links carry `?ref=handle`; the RSVP records who referred it.
- Host view on each night: the guestlist, who came through whom, and the commission owed to each referrer.
- Member view: nights you're going to, people you brought, estimated commission.
- Admin: create invite codes, feature pages in Discover.

Not yet: payments and automatic payouts (tickets are reservations for now), image uploads, email (password reset, notifications).

## Deploy (Cloudflare dashboard, no terminal)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository** → pick `rsvp-fm`.
2. Leave the build command empty. Set the **deploy command** to `npm run deploy` (it creates the database tables, then deploys).
3. Deploy. Cloudflare creates the `rsvp-fm` D1 database automatically on first deploy.
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
