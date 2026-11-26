# Changelog

## Coming in 1.8

- **Panic button for fundis.** Built alongside 1.7, then held back on
  26 November 2026 so it can be tested on its own. It comes with migration
  0028 and its own Terms and Privacy wording.

## 1.7.0 — 26 November 2026

Prices are agreed by quotation, not haggled, plus the fixes from a tester's
feedback (25 November 2026) and testimonials. The panic button moved to 1.8.

Database (Supabase SQL editor):
1. Migration 0026: done 26 November 2026.
2. Migration 0027: done. It is now safe to run again; its last row should show
   `requested_columns = 3` and `testimonials_table = true`.
3. **Straight after deploying, run `0026b_quotations_catch_up.sql` again**, even
   though it was run once on 26 November. Until the deploy, the live 1.6 code
   writes prices the old way, and only 0026b copies those into quotations.
   Running it twice is safe. Its last row must show
   `jobs_with_price_but_no_quotation = 0` and `price_changes_not_copied = 0`.

### Fixed (tester feedback)
- **A fundi on a job is not offered another.** A booked fundi kept getting
  offers and the bar kept saying "Finding jobs near you". Offers now wait until
  the job in hand is marked complete, and the bar says "On a job". A busy fundi
  is skipped for now, not counted as having said no.
- **Screens no longer go stale.** The booking confirmation now follows the job
  (quotation sent, accepted, complete) instead of saying "booked" for ever; it
  also showed "Your fundi" instead of the fundi's name. My activity no longer
  redraws itself every 15 seconds (the fundi's photo link changed on every
  check). A live connection that drops is opened again, and pages check again
  when the phone comes back online.
- **The fixed price is set when booking.** A customer can pick a service from
  the trade's fixed-price list while booking. It becomes the locked first line
  of the fundi's quotation, so the fundi only adds parts, labour or transport.
- **Fundis know what the job is before they call.** Each trade asks two or
  three quick questions answered with a tap (which appliance, what's wrong, can
  the car be driven). A booking needs one thing to go on: a service, an answer
  or a sentence, a voice note or a photo.

### Added
- **Itemised quotations.** The fundi lists each charge on its own line: the
  listed service at its fixed price (locked, set by the server from the Rates
  menu), then labour, parts, transport or anything else, with an optional
  quantity. The customer sees the total first, then the table, ending in
  TOTAL QUOTATION.
- **A thread for each job.** Opening a quotation shows the job's price history
  laid out like a chat, in Find Fundi's colours: every quotation, every update,
  and every answer, with times. There are no typed messages; customer and fundi
  still talk by phone. A call button sits in the header.
- **"Find another fundi".** A customer who would rather not go ahead at the
  quoted price can turn the quotation down. The job goes straight to the next
  fundi, and the fundi whose quotation was turned down is never offered it again.
- **Updated quotations show what changed.** After the customer accepts, a new
  price is sent as an updated quotation: lines from the agreed quotation, with
  any changed amount struck through, and an "Added since" section for new
  charges. The fixed-rate line can't be changed. Work carries on at the agreed
  price until the customer accepts.
- Notifications about a quotation open its thread directly, even when the app
  is already open.
- Admins see every quotation on a job, line by line, and a count of quotations
  customers turned down.
- **Testimonials.** Admins type in what real customers and fundis said, tick
  that the person agreed to be quoted, and publish it. Published ones show near
  the bottom of the home page with first name, customer or fundi, and area. With
  none published the section does not appear. None are made up.
- A fundi whose quotation was turned down sees a notice on Home saying the job
  went to another fundi, until they dismiss it.

### Changed
- Every version of a price is kept in one table (`job_quotations`). Old prices
  and price changes are copied in; `job_price_changes` is no longer written to.
- Phones still running the old app can send a single price; it becomes a
  one-line quotation.
- Terms of Service updated (26 November 2026): quotations list each charge,
  customers can turn one down for another fundi, and updates only count once
  accepted; a fixed-price service picked while booking is the quotation's first
  line; testimonials.
- Privacy Policy updated (26 November 2026): what a testimonial shows.
- Migration 0027 can be run twice without an error (it stopped with "column
  requested_rate_id already exists"), and `npm run check` now fails on any
  migration from 0027 on that can't be.
- Wording across the booking and fundi pages says "quotation" instead of "price".
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
