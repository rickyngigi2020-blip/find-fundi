---
name: morning-coffee
description: Ricky's start-of-day briefing for Find Fundi. Summarises everything built so far, what changed recently, and what is left (split into what Ricky must do and what still needs building), checked against the real state of the code and database. Use when Ricky says "morning coffee", asks for a summary of what's been done and what's left, or starts a new working session wanting to know where things stand.
metadata:
  owner: Ricky Ngigi
  version: "1.0.0"
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
- **Live site:** `curl https://find-fundi.vercel.app/api/v1/fundi/status`
  (401 = working, 503 = Supabase keys missing, 500 = crashing).
- **Vercel sign-in:** run `npx vercel whoami`. If it shows a username, put under
  **Heads-up**: "The Vercel CLI is still signed in on this PC; revoke it in Vercel >
  Account Settings > Tokens (or `npx vercel logout`) when you no longer need it."
  Ricky asked to be reminded about this often.
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
  - Hosting: live on Vercel (find-fundi.vercel.app); custom domain connected yet?
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
- Access: …

**Since last time** (last few commits, one line each)

**Left to do**
Needs you (accounts, keys, settings, decisions):
- …
To build:
- …

**Heads-up** (only if there is something: unsaved work, a migration not run,
something broken, servers down)

**Your freelance rates** (always include; copy from "Freelance pricing" below)

**Suggested next step:** one recommendation and why, then ask what he wants to tackle.
```

Rules:
- Only list something as done if it's in the committed code; mark anything built
  but uncommitted or not yet migrated under **Heads-up**.
- Don't pad. If a section is empty, drop it.
- Don't start building anything as part of the briefing. Wait for Ricky's pick.

## Freelance pricing

Ricky builds sites and apps for clients too (first quote: KES 50,000 online shop
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

## 3. After the briefing

- If a next-session reminder memory asked for this summary, delete it and remove
  its line from `MEMORY.md`, since it has now been done.
- Update the pending-external-setup memory if any item turned out to be finished
  or newly needed.
