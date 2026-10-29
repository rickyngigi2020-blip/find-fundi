# Changelog

## 1.3.0 — not released yet

Everything here came from watching a technician use Find Fundi for real on
29 October 2026. She rated it 7 out of 10: too many taps, a tiring
application, and pages that only changed after a refresh.

Run migrations 0018 to 0021 in the Supabase SQL editor before deploying.

### Fixed
- **A fundi who turned a job down kept getting it back.** The search goes
  round every fundi again and again, and a fundi who passed was offered the
  same job in the next round. A fundi who passes, or takes a job and turns it
  down, is now never offered that job again. If everyone has said no, the
  customer is told once and the job waits for new fundis.
- **Nothing updated without a refresh.** My activity, the fundi's jobs and the
  booking screen now change as soon as the job does (Supabase Realtime, with a
  slow check as a backup). Pages brought back with the Back button reload too.
- **The search stalled once every page was closed.** Supabase now moves
  waiting jobs on every minute; the GitHub schedule stays as a backup.
- **The customer was never told a fundi had taken their job.** They now get a
  notification. The "fundi can't take it" one no longer tells them to choose
  another fundi.
- **Admin hid accounts with no profile.** Accounts that never confirmed their
  email or never finished setup now show, with how they signed up and when
  they last signed in.
- **A fundi with papers was marked "Needs interview".** The application only
  took PDFs, so papers held on paper had no way in except "I don't have a
  certificate". Photos of the ID and certificates are now accepted.

### Changed
- **Booking takes two taps:** a trade, then Find a fundi. Area comes from the
  profile, the description is optional, and the button stays on screen.
- **The home-screen app opens straight to your work** (start.html): fundis to
  their jobs, customers with a job under way to My activity, everyone else to
  booking. On first open it asks to turn on job alerts.
- **One-page fundi application.** Name, phone and area are on the same page,
  "highest qualification" is gone, and experience is four buttons.
- Going online as a fundi asks for notifications in the same tap. A device that
  had allowed them but lost its subscription reconnects on its own.
- Admin: a new **Insights** tab (sign-up funnel, demand by trade, area, day and
  hour, offer outcomes, turn-down and cancel reasons, prices and ratings by
  trade, each downloadable as CSV), and a "Back to my work" link.
- Any account, Google ones included, can set a password in Account settings.
- Search engines: description and sharing tags on the home page, robots.txt,
  sitemap.xml, and private pages marked not to be indexed.

## 1.2.0 — 24 October 2026

Booking and notifications now work from phones. Everything below came out of
one afternoon of "Failed to fetch" on Ricky's phone.

### Fixed
- **Sign-ins sent people to a Vercel login.** Supabase's Site URL pointed at
  find-fundi-rico17.vercel.app, which sits behind Vercel's own login, and
  findfundi.com was not an allowed return address. Customers signing in landed
  on a Vercel login wall; anyone signed in to Vercel landed on a second copy of
  the site whose requests were redirected to vercel.com and failed. Every old
  address now redirects to www.findfundi.com, Vercel's login only guards
  preview deployments, and Supabase returns sign-ins to www.findfundi.com.
- **Photos stopped bookings.** On Android a picked photo is a reference into
  the gallery; if the gallery changed it before upload, the upload failed with
  only "Failed to fetch". Photos are now copied and shrunk (to about 300 KB)
  the moment they are picked, and application PDFs are copied on pick too.
- **One dropped request ended a booking.** Reads and uploads retry once, and a
  booking whose request drops checks whether the job was saved before sending
  again, so it is never booked twice.
- **"Failed to fetch" stuck on the waiting screen** after one missed check; it
  now clears when the connection is back.
- **"Turn on" notifications could spin forever** when the browser's push
  service never answered; it now stops after a minute and says why.
- **The every-10-minutes schedule** (moving searches on, keeping Supabase awake)
  called the old address after the redirect went in, and failed. It now calls
  www.findfundi.com.

### Added
- Phones report their own failures: requests that got no answer, and the step
  where turning notifications on failed, are sent to a private `diagnostics`
  bucket and kept 30 days (the privacy policy says so).
- `/check.html`, a connection and notifications check to send to anyone whose
  phone misbehaves. Not linked from the app.
- A test notification, sent at the end of the notifications check.
- **Site guard** (GitHub Actions, hourly and on every push): fails if any old
  address stops redirecting to www.findfundi.com, a page stops answering, or
  code links to an old address.
- **`npm run check`**: replays this release's bugs against the live site with
  a test account and cleans up after itself. Run it before every release.

## 1.0.0

First version: customers describe a job (text, voice note, photos) and are
matched automatically to a verified fundi; fundis apply, take offers and send
prices; admins verify fundis and moderate.
