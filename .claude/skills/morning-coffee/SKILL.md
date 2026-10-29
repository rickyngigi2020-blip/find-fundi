---
name: morning-coffee
description: Ricky's start-of-day briefing for Find Fundi. Summarises everything built so far, what changed recently, and what is left (split into what Ricky must do and what still needs building), checked against the real state of the code and database. Use when Ricky says "morning coffee", asks for a summary of what's been done and what's left, or starts a new working session wanting to know where things stand.
metadata:
  owner: Ricky Ngigi
  version: "1.1.0"
---

# Morning Coffee: Find Fundi briefing

Ricky starts the day with a clear picture of the project before deciding what to
work on. Give him a short, accurate briefing. Every "done" or "left" item must be
**checked against the current code, git history, or database**, never repeated
from memory or old notes without verifying. Old notes go stale fast here, since
more than one session often works on the project.

## 1. Gather (read-only, before writing anything)

- **Memory:** read `MEMORY.md` and the Find Fundi memories it points to (pending
  external setup, T&C disclaimers, phone tunnel, any next-session note).
- **Git:** `git log --oneline` on `main` for the full history, and the commits
  from the last few days for "since last time". `git status --short` for unsaved
  or untracked work.
- **Database migrations:** list `supabase/migrations/`. For the newest migration,
  confirm its columns/tables exist with a quick service-role query (as done in
  past sessions). Report any migration that hasn't been applied.
- **Servers:** check whether ports 3000 (serve.mjs) and 3001 (API) are listening.
  Don't start them unless Ricky asks.
- **Live site:** `curl https://www.findfundi.com/api/v1/fundi/status`
  (401 = working, 503 = Supabase keys missing, 500 = crashing). The site lives
  only at www.findfundi.com; every other address must redirect there. Check the
  latest **Site guard** and **Keep Find Fundi running** runs on GitHub
  (`https://api.github.com/repos/rickyngigi2020-blip/find-fundi/actions/runs?per_page=10`)
  and put any failure under **Heads-up**.
- **Reports from phones:** list the private Supabase bucket `diagnostics` for
  the last 24 hours (service-role key in `.env`; one folder per UTC day). Each
  file is a phone saying what failed: `network-failures`, `push-failure`,
  `connection-check`, `notifications-check`. Ignore ones from
  `release-check@findfundi.com`. Summarise real ones under **Heads-up** in plain
  words ("2 bookings from Veronicah's phone didn't get through, both uploads").
- **Waiting jobs and offers:** with the service-role key, list jobs still in
  `requested` and, for each, how many offers it has had and how many expired
  unanswered. A job on a high `search_round` that keeps going to the same
  fundi is the open "unanswered offers repeat forever" issue below; say so in
  **Heads-up**. Also call `POST https://www.findfundi.com/api/v1/tick` once; it
  should answer 200 with two counts. Supabase's own scheduler (migration 0019,
  every minute) is meant to call it, so GitHub's 10-minute run is only a backup.
- **Notifications on:** count rows in `push_subscriptions` against the number of
  accounts. On 29 Oct 2026 it was 1 of 10, which is why jobs went unseen with the
  app closed. Report the new number.
- **Vercel sign-in:** run `npx vercel whoami`. If it shows a username, put under
  **Heads-up**: "The Vercel CLI is still signed in on this PC; revoke it in Vercel >
  Account Settings > Tokens (or `npx vercel logout`) when you no longer need it."
  Ricky asked to be reminded about this often.
- **Custom domain:** done. www.findfundi.com has been live since October 2026,
  so the daily domain reminder Ricky asked for on 2026-10-05 is finished. Do not
  bring it back.
- **Version:** read `version` in `package.json` and the top of `CHANGELOG.md`.
  If there are commits since the last `v*` tag, mention them as unreleased.
- **Open items — verify each one, don't assume:**
  - Google Maps key: is `public/assets/map.js` still using `YOUR_GOOGLE_MAPS_API_KEY`?
  - Legal pages: do Terms & Conditions / Privacy Policy pages exist? (They must
    include the job-media visibility disclaimer from memory.)
  - Payments: any real M-Pesa/Daraja integration in `src/`, or is price still
    agreed in-app with nothing charged?
  - Phone login: any SMS/OTP sign-in, or still email + Google only?
  - Landing page: fake hero stats (e.g. "2,400+") and pill-shaped buttons
    (`rounded-full` on CTAs) still in `public/index.html`?
  - Tailwind weights: `font-600/700/800` classes still used site-wide (they
    aren't real Tailwind classes, so headings render semi-bold)?
  - Hosting: live on Vercel at www.findfundi.com (old addresses redirect there).
  - The "app": Find Fundi is **not a real app** and is in no app store. It is the
    website plus `public/manifest.webmanifest` and `public/sw.js`, which let a
    phone save it to the home screen and open it full screen (`"display":
    "standalone"`). Installing copies a shortcut, nothing downloads, and the
    service worker caches nothing — it exists so push notifications work, which
    iPhone only allows once the site is on the home screen. Ricky knows and is
    happy with this for now. **A real native app is a separate build from
    scratch and has not been started.** When that decision is made, this line
    and the briefing's "Access" wording both need rewriting. Since 1.3.0 the
    saved shortcut opens `public/start.html`, which sends a fundi to their jobs,
    a customer with a job under way to My activity, and anyone else to booking,
    and asks for job alerts on first open. Verify `start_url` in the manifest.
  - Offers that expire unanswered: a fundi who passes or turns a job down is
    barred from it for good (1.3.0), but one whose offer only times out is
    offered it again every round, forever, with a notification each time. On
    29 Oct 2026 32 of 37 offers had expired unanswered and one test job had gone
    to the same fundi 40+ times. Ricky has not decided whether to cap it (for
    example, bar a fundi after 3 missed offers). Look in `matchingService.js`
    (`fundisWhoTurnedDown`) to see if a cap now exists before listing this.
  - Migrations 0018 to 0021 (jobs in Realtime, the every-minute scheduler,
    optional job details, optional qualification) were run in Supabase on
    29 Oct 2026. Confirm any newer migration the same way as the newest one.
  - Launch videos: `brag-output-2026-10-29-152830/` holds the 1.3 videos
    (landscape and vertical for WhatsApp Status, Stories and Reels), with copies
    on Ricky's Desktop and the folder pinned in Quick Access. The folder is
    ignored by git. The earlier `brag-output/` is out of date: it shows
    customers choosing a fundi and the old vercel.app address.
  - Launch checklist from the `no-vibe-coded` skill: custom domain, favicon,
    "made with AI" badge removed, privacy policy, terms and conditions.

## 2. Brief

Plain language. Ricky isn't deeply technical, so name features by what users see
("customers can record a voice note"), not by files or tables. Keep it scannable.

```
Morning, Ricky. Here's where Find Fundi stands.

**Done so far**
- Customer side: …
- Fundi side: …
- Admin: …
- Security & reliability: …
- Access: … (the saved home-screen shortcut now opens straight to the person's work)
- Insights: admin sees sign-ups, demand by trade/area/time, offer outcomes,
  cancel reasons and prices, each downloadable as CSV.

**Since last time** (last few commits, one line each)

**Left to do**
Needs you (accounts, keys, settings, decisions):
- …
To build:
- …

**Heads-up** (only if there is something: unsaved work, a migration not run,
something broken, servers down)

**Your freelance rates** (PAUSED by Ricky on 2026-10-25: leave this block out until he asks for it back)

**Suggested next step:** one recommendation and why, then ask what he wants to tackle.
```

Rules:
- Only list something as done if it's in the committed code; mark anything built
  but uncommitted or not yet migrated under **Heads-up**.
- Don't pad. If a section is empty, drop it.
- Don't start building anything as part of the briefing. Wait for Ricky's pick.

## Freelance pricing

**Paused: do not show this block in briefings until Ricky asks.** Ricky builds sites and apps for clients too (first quote: KES 50,000 online shop
website + Android app, 29 Sep 2026: KES 20,000 labour + KES 30,000 setup and
running costs). Show this block in every briefing, as is:

- **Day rate:** a KES 20,000 build is about 8–10 working days, so roughly
  KES 2,000–2,500 a day. Quote extra work so it doesn't fall below that.
- **Included:** 2 rounds of changes. A round = one combined list of feedback,
  fixed together.
- **Extra changes** (charged per round, not per change; paid upfront):
  - Small tweaks (wording, colours, photos, moving a button): KES 2,000–3,000 per round
  - Medium changes (new page, checkout redesign, product filter): KES 4,000–6,000 each
  - New features (discount codes, map tracking, loyalty points): quote separately
- **Agree upfront:** a "change" adjusts something built; a "feature" is new.
- **Backend options for client builds** (KES 50,000 online-shop quotes, Google Sheets
  in Ricky's Drive, one file per option; your labour / what the client pays from year 2):
  - [A: Own server (PocketBase on a VPS)](https://docs.google.com/spreadsheets/d/1lpBllIqIduX7hnbOY7R_eXaiGiWWw4KWbwX5FhOFouA/edit):
    30,000 / ~12,300 a year. SQL-style, cheap, but you maintain the server; charge monthly maintenance, set up off-server backups day one.
  - [B: Kenyan shared hosting](https://docs.google.com/spreadsheets/d/1lmLYPN4t7hydgIEizbNOiojWFJ-agVc-3wewi-ZlYkI/edit):
    39,000 / ~5,500 a year. Domain + email bundled, paid by M-Pesa, but PHP, logins built by hand, no live updates.
  - [C: Supabase Pro, client's own plan](https://docs.google.com/spreadsheets/d/1JO_Np0uJAcZeYVM14VUad3qUcf-WCXhZUaa0uZGkBFo/edit):
    20,000 / ~41,000 a year. No upkeep, expensive for a small shop.
  - [D: Supabase, project on Ricky's own Pro plan](https://docs.google.com/spreadsheets/d/1L9rm-UJH2-NsfqDhzYarobdgAQOxp6ufjI2VQVVkaTI/edit):
    24,000 / ~1,290 a month. Pro is $25/month per organisation (includes one small
    project); each extra project ~$10/month. **Catch:** only pays off once Ricky has
    several clients (or Find Fundi) on the plan; with one client he's ~KES 1,900/month
    out of pocket. Client projects in his org belong to him; put ownership in the
    agreement (projects can be transferred out).
  - Client-facing package names: Basic = B, Pro = A, Pro Max = D, Pro Max Ultra = C.
    All four quotes plus a client guide doc live in the Drive folder
    [Online Shop Quotations](https://drive.google.com/drive/folders/1xth8OI1F6DvMHMoMLNHmQHtZlb3s6Bb4).
  - Firebase ruled out: Firestore isn't SQL, reports are hard.
  - Prices are estimates from 29 Sep 2026 (KES 129/USD); check before quoting.

## Carry-forward list (as of 29 October 2026, version 1.3.0)

Release 1.3.0 came out of a real technician testing Find Fundi (she rated it
7 out of 10: too many taps, a tiring application, pages that needed a refresh).
Ricky's goal is for Find Fundi to be as simple as it can be: a customer in two
taps, a fundi straight to their work. Verify each item below before reporting it
as still open.

Needs Ricky:
- Supabase > Authentication > Email: switch off "Confirm email", or finish the
  custom email setup. One email sign-up was stuck unconfirmed.
- Cancel the old test job in the admin Jobs tab if it is still going round
  (`requested`, tailoring, high `search_round`); it notifies a fundi every
  90 seconds or so.
- Decide the cap on unanswered offers (see Open items).
- Google search: verify www.findfundi.com in Search Console (DNS TXT record),
  submit `https://www.findfundi.com/sitemap.xml`, and create a Google Business
  Profile (Nairobi). `robots.txt`, the sitemap and the page tags are in place.
- Tell any customer who thought they were "removed" to sign in again at
  www.findfundi.com: their account was intact, and the old address signs people
  out because sign-ins are kept per address.
- Still outstanding from before: Google Maps key, Google sign-in branding,
  M-Pesa credentials, SMS provider (also the possible SMS backup for people
  with notifications off, roughly KES 1 a message), revoke the Vercel CLI token.
- Post the videos (WhatsApp Status, Stories, Reels). He has not heard the
  soundtrack yet; ask if it needs changing.

To build, if Ricky asks:
- The cap on unanswered offers, once he decides.
- A real native app, only if he decides to (not started).
- Anything more he wants in the admin Insights tab for competitor research.

Things that went wrong in this work and should not repeat:
- A SQL check for him to run in the Supabase editor must be one query that
  returns one row with the "all good" values stated; the editor only shows the
  last statement's result. (Saved as a feedback memory.)

## 3. After the briefing

- If a next-session reminder memory asked for this summary, delete it and remove
  its line from `MEMORY.md`, since it has now been done.
- Update the pending-external-setup memory if any item turned out to be finished
  or newly needed.
