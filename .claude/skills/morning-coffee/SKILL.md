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
- **Open items — verify each one, don't assume:**
  - Google Maps key: is `assets/map.js` still using `YOUR_GOOGLE_MAPS_API_KEY`?
  - Legal pages: do Terms & Conditions / Privacy Policy pages exist? (They must
    include the job-media visibility disclaimer from memory.)
  - Payments: any real M-Pesa/Daraja integration in `src/`, or is price still
    agreed in-app with nothing charged?
  - Phone login: any SMS/OTP sign-in, or still email + Google only?
  - Landing page: fake hero stats (e.g. "2,400+") and pill-shaped buttons
    (`rounded-full` on CTAs) still in `index.html`?
  - Tailwind weights: `font-600/700/800` classes still used site-wide (they
    aren't real Tailwind classes, so headings render semi-bold)?
  - Hosting: any deployment config, or local only with the temporary phone tunnel?
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

**Suggested next step:** one recommendation and why, then ask what he wants to tackle.
```

Rules:
- Only list something as done if it's in the committed code; mark anything built
  but uncommitted or not yet migrated under **Heads-up**.
- Don't pad. If a section is empty, drop it.
- Don't start building anything as part of the briefing. Wait for Ricky's pick.

## 3. After the briefing

- If a next-session reminder memory asked for this summary, delete it and remove
  its line from `MEMORY.md`, since it has now been done.
- Update the pending-external-setup memory if any item turned out to be finished
  or newly needed.
