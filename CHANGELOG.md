# Changelog

## Unreleased

### Changed
- **New accounts are made with Google only.** The email and password form is
  gone from the sign-up page. The 5 accounts made earlier with an email and
  password still sign in as before, and Terms says so.

## 1.6.0 — 16 November 2026

Find Fundi starts earning: a commission on jobs paid straight to the fundi, a
wallet so fundis can see and clear what they owe, and a lock on job offers when
it is left unpaid. This release also carries 1.4.0 (selfie and KRA PIN, starting
ratings) and 1.5.0 (fixed-price services), which have not gone live yet.

Run migration 0025 in the Supabase SQL editor before deploying, and add
`COMMISSION_PAYBILL` and `COMMISSION_ACCOUNT_NO` to the Vercel environment
variables (they are never stored in the code).

### Added
- **Commission on cash and M-Pesa jobs.** When a fundi marks a job complete,
  10% of the agreed price is recorded, due 6 days later. It comes out of the
  price, so the customer never pays more. Jobs completed before 16 November 2026
  owe nothing.
- **Founding fundis.** The first 50 fundis approved pay no commission on their
  first 7 jobs. The fundis already approved were counted, oldest first, up to 50.
- **A wallet on the fundi's Home screen.** It shows what is owed, when each
  commission is due, the paybill details to pay with, and how many commission-free
  jobs are left.
- **"I've paid".** The fundi pays by M-Pesa, enters the M-Pesa code, and every
  admin gets a notification straight away. Saying so does not unlock anything.
- **The 6-day lock.** A fundi with a commission past its due date is skipped
  when jobs are offered, no longer sees an offer waiting, and cannot accept one,
  until it is paid. Jobs already under way carry on. It is worked out from the
  dates each time, so nothing has to run in the background, and it lifts the
  moment an admin confirms payment.
- **A Commissions tab for admins.** Payments waiting to confirm come first (with
  a count on the tab), then who owes what, then what was paid lately. Confirming
  a payment is what lifts the lock.

### Changed
- **The fundi's Home screen works like a driver app.** The city sits behind
  everything, with each area where it is and areas with open jobs lit up; today's
  earnings and the rating float at the top; one big GO button takes the fundi
  online, and the bar under it says whether they are offline, finding jobs, or
  paused for unpaid commission. A job offer slides up over the whole screen with
  one large Accept button that empties as time runs out. The wallet, jobs in hand,
  earnings and the area list sit in a sheet that scrolls up over the city, and
  rises higher when there is a job or money owed. Account opens from the photo in
  the corner.
- **Area lists lead with central and west Nairobi.** Westlands, Kilimani,
  Kileleshwa, Lavington, Upper Hill, Hurlingham, Riverside, Parklands, Spring
  Valley, Loresho, Runda, Gigiri, Muthaiga, Karen, Lang'ata and the CBD come first
  on every form; the other areas stay, listed after them.
- **Card is hidden** from the payment choice and refused by the API, until card
  payments exist. Customers choose between M-Pesa and cash.
- Terms of Service and Privacy Policy updated (16 November 2026): the fundi
  commission and the lock, commission records, and that Find Fundi still never
  holds a customer's payment.

### Not built yet
- 1% commission on a fundi's profit from materials (parked until the market is
  better understood).

## 1.5.0 — 16 November 2026

Common jobs now have fixed prices, so a fundi picks the job from a list and the
price fills in instead of being haggled.

Run migration 0024 in the Supabase SQL editor before deploying. It adds the
rates table empty: no prices are shown to anyone until an admin adds them.

### Added
- **A menu of fixed-price services.** Admins manage it on a new Rates tab: pick
  a trade, name the service, set the price, and switch services on or off.
  Nothing is pre-filled; enter only prices you have checked with real fundis.
- **The fundi picks the job and the price fills in.** When a fundi sends a
  price, a "What is the job?" list shows the services for their trade. Choosing
  one sets the price, and the server sets it from the menu, so no amount sent
  with it can change it. "Other job" keeps the old way: the fundi types their
  own price. The customer sees the service name above the price. Booking is
  still two taps: the customer never browses the menu.
- A job remembers which service its price came from, and the name as it was
  then, so renaming a service later does not rewrite old jobs.

### Changed
- Terms of Service updated (16 November 2026): listed services have fixed
  prices; other jobs are priced by the fundi.
- The list of trades is now defined once on the server (`src/utils/categories.js`),
  and the release check fails if the website's list and the menu's list drift apart.

## 1.4.0 — 16 November 2026

Fundis now prove who they are with a selfie and a KRA PIN as well as their ID.

Run migrations 0022 and 0023 in the Supabase SQL editor before deploying.

### Added
- **Selfie and KRA PIN on the fundi application.** The apply page takes a
  selfie (the front camera opens on a phone) and a KRA PIN, checked for the
  right shape: a letter, nine digits and a letter. Photos are copied and
  shrunk the moment they are picked, as in 1.2.0.
- **Selfies are kept in their own private bucket**, `fundi-identity`. A fundi
  can upload into their own folder and nothing else: no login can read a selfie
  back, only the short-lived links the admin screen asks for.
- **The admin screen shows each applicant's selfie and KRA PIN** next to their
  ID. Fundis verified before this release show "not supplied" and are not
  affected.

- **The selfie is the fundi's profile picture, with their rating.** It shows on
  the fundi's own profile and on the card a customer sees once a fundi has
  their job. Neither can read the file itself: the API hands out a one-hour link.
- **A starting rating for new fundis.** The admin gives a rating (1 to 5, in
  half stars) when approving, and approval is refused without one. Customer
  reviews then move it: the starting rating counts as three reviews, so the
  first review nudges it and real reviews take over as they pile up. The
  rating shows as an ordinary rating; the number of reviews appears only once
  there are real reviews to count.

### Changed
- Privacy Policy updated (16 November 2026): lists the selfie and KRA PIN, who
  can see them (admins only) and how long they are kept (while the account is
  open; deleted within 30 days of a rejection or a deletion request).

## 1.3.0 — 29 October 2026

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
