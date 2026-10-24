# Changelog

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
