# System Rules — Telepractice Studio (Canopy Studio)

Every rule below is a load-bearing invariant of this system: generated sites,
the builder, or both break (usually silently, usually in production) when it is
violated. Under each rule are its **technical details**, the **implementation
rules** a change must obey, and the **important related functions / code**.

Paths are relative to the repository root. Generated-site code lives under
`public/_scaffold/templates/` (`cloudflare/`, `vercel/`, and `shared/` used by
both); the builder itself lives in `src/` and `public/`.

## Summary — user flow and the rules that matter most

**What this system is.** Canopy Studio is a builder that produces a
self-contained, deploy-ready ZIP of a white-label practice website
(Cloudflare Workers or Vercel) backed by one Neon Postgres database. The
builder never deploys anything — the operator downloads the ZIP and deploys
it. A generated site has exactly two authenticated account types, the
practice **owner** and public **clients**, plus unauthenticated visitors.

### User flow

1. **Build (builder operator, no account).** Enter practice details, pick a
   theme and target, set the initial owner username/email/password and the
   Neon `DATABASE_URL`, download the ZIP. The raw password exists only in
   memory during the build; the ZIP carries a salted PBKDF2 hash.
2. **Deploy (operator).** Unzip and deploy. No manual secret step is needed:
   on Cloudflare the production values ride in the `wrangler.jsonc` `vars`
   block, which is intentional (Rule G2) — the deploy-time copy of
   `.dev.vars`, which Wrangler never uploads.
3. **First contact (automatic).** The first real request creates the schema
   (all 59 statements), inserts the site's `tele_sites` row, and seeds the
   owner account from the `ADMIN_*` values. From then on the database owner
   row is authoritative; the seed can never overwrite an owner-edited
   account.
4. **Owner setup.** The owner signs in at a date-rotating dashboard URL
   (Rule A3), publishes the monthly schedule and open slots, edits content.
5. **Visitor browsing (no account).** Public pages, blog, gallery and the
   open calendar are readable by anyone; reserving a slot requires a client
   account.
6. **Client booking.** Register (email + password, same 8–25 complexity
   policy as the owner), sign in, pick an open slot and GCash or Maya, and
   enter a **required consultation phone number** (the internet-outage
   fallback). One atomic insert creates the booking as `confirmed` /
   `awaiting_proof` with a payment window of booking time + 15 minutes
   (Rule E1). Guests see neither the calendar nor the payment details
   (Rule E5).
7. **Client payment.** Pay off-platform, then click **Upload payment proof**
   to attach the transaction screenshot; the booking flips to
   `pending_review` and can no longer be dropped. The 15-minute window **is**
   a deadline for bookings without proof: at 15 minutes the cron drops the
   booking, and an upload after that is answered 409 (Rules E2–E3).
8. **Cron reminders and drop (automatic).** On Cloudflare a cron ticks every
   minute (Rule D1): it stamps a client reminder once a booking is 12
   minutes old without proof, and **drops the booking** once the 15-minute
   window passes without proof (`cancelled`/`expired`). The drop notifies
   both sides on site — the owner under **Dropped Bookings** in the
   dashboard (with the consultation phone number), the client with a
   "Slot released" entry in their appointment list (Rule D3).
9. **Owner review.** Approve the proof (`approved`), reject it (proof
   `rejected`, booking released), or mark payment received manually — the
   client can still attach the screenshot afterwards (Rule E4).

### The important rules (one line each; details in the sections below)

| # | Rule |
|---|---|
| A1 | Passwords are **8–25 characters with one upper, one lower, one number, one symbol — for every user type**; one definition (`PASSWORD_MIN`/`PASSWORD_MAX`) imported everywhere, never re-typed. |
| A2 | Passwords exist only as PBKDF2 hashes; verification is **constant-time** (always derive, constant-time compare, dummy hash for unknown emails). |
| A3 | The owner dashboard lives at a **date-rotating URL**, never a fixed `/admin`. |
| B1–B2 | Every mutating request needs **CSRF** validation; cookies are HttpOnly + SameSite=Strict under a strict CSP. |
| B3 | Error logs never carry credentials; full error causes only behind `DEBUG_OWNER=1`/`WORKER_DEBUG=1`. |
| C1 | All tables are **`tele_`-prefixed** and every query is scoped by `site_id`; ownership checks live in the SQL. |
| C2 | Requests use the **bootstrapping** DB client — the first request creates schema + site row. |
| C3 | `DATABASE_URL` is normalised (protocol checked, driver-only params stripped) before reaching Neon. |
| D1 | Scheduler cadence per target: Cloudflare **every minute**, Vercel **daily**, standalone worker **90 s / 180 s**. |
| D2 | The **cron must never bootstrap the schema** — raw client only, missing schema (`42P01`) is a quiet skip. |
| D3 | The sweep stamps the 12-minute reminder, then at 15 minutes **drops** an unpaid booking (cancel + expire + owner-notification stamp in one statement); it never deletes. |
| E1 | Booking is **one atomic `INSERT … SELECT`** against an open, published, future, untaken slot. |
| E2 | The 15-minute payment window **is the deadline for bookings without proof**: reminder at 12, automatic drop at 15, both sides notified on site. |
| E3 | Proof upload: one per appointment, PNG/JPEG/WebP by magic bytes, ≤ 3 MB; accepted any time **before** the drop, 409 after it. |
| E4 | Cancellation/rejection are **deliberate human actions** with their own guards (owner cancel only > 24 h out). |
| E5 | **Guests see no calendar and no GCash/Maya details** — both are account-only; `/api/availability` 401s without a client session. |
| F1 | Menu hrefs pass **one canonical sanitizer**, copied byte-for-byte to the browser. |
| G1 | Scaffold **`__TOKEN__` placeholders** only where the builder substitutes them — never in comments or prose. |
| G2 | The `wrangler.jsonc` **`vars` block is intentional**; do not remove it or "move it to secrets" by default. |
| G3 | Template fixes reach live sites only by **regenerating the ZIP and redeploying**. |
| G4 | The **blog CMS is always on**: builder switch disabled, `features.blog` forced `true` in every package. |

---

## A. Accounts and credentials

### Rule A1 — Password length is 8–25 characters for **every** user type

The owner (builder operator, generated-site owner sign-in, owner
change-password) and the public client (sign-up and sign-in) all use the same
length rule: **minimum 8, maximum 25**. No surface may introduce its own
bounds.

- **Technical details:** The owner policy additionally requires one lowercase
  letter, one uppercase letter, one number and one symbol. Since 2026-10-15
  the client policy is identical — the same four character classes are
  enforced for client sign-up in both runtimes' `registerProblem()` — so
  there is no longer any difference between the two policies. `verifyPasswordHash()` itself rejects
  passwords outside 8–25, so a stored hash can never be verified against an
  out-of-range candidate. Consequence of raising the floor from 7 to 8
  (2026-10-15): an account created under the old rule with a 7-character
  password can no longer sign in after redeploy and needs a password reset.
- **Implementation rules:**
  - Never hard-code `8` or `25` (or any literal length bound) at a call site.
    Import the shared constants — the runtimes, `verifyPasswordHash()` and the
    builder's `package-core.js` all do. A literal bound anywhere is a future
    drift bug — this exact drift (12–128 on some surfaces, later a hard-coded
    copy in `package-core.js`) caused production signup failures.
  - When the rule changes, change it in the single source of truth only
    (below), and update §A1 of this file plus the password note in
    `current_code.md`.
  - Boundary test passwords must satisfy the character-class rule where it
    applies: an 8-character owner test password needs a digit and a symbol
    (e.g. `Abcdef1!` passes, `Abcde1!` is now too short at 7).
- **Related code:**
  - `public/_scaffold/templates/shared/lib/admin-security.js` —
    `PASSWORD_MIN = 7`, `PASSWORD_MAX = 25` (the single source of truth),
    `verifyPasswordHash()`.
  - Generated runtimes import them: `cloudflare/src/index.js` and
    `vercel/api/index.js` (`import { PASSWORD_MAX, PASSWORD_MIN, … }`),
    used by the owner validator, client register route
    (`password.length < PASSWORD_MIN || password.length > PASSWORD_MAX`),
    and the builder form validation.
  - Tests: `test/builder.test.js` (password boundaries at 7 and 25).

### Rule A2 — Passwords are stored only as PBKDF2 hashes; sessions are HMAC-signed and credential-bound

Plaintext passwords never persist and never appear in logs. Owner credentials
seed from deploy-time secrets once, after which the database row is
authoritative.

- **Technical details:** Hash format is `pbkdf2$210000$<salt>$<digest>`
  (PBKDF2-SHA-256, 210,000 iterations, 16-byte random salt, 256-bit output).
  `verifyPasswordHash()` refuses iteration counts outside 100,000–1,000,000.
  Owner session tokens are `base64url(payload).base64url(HMAC-SHA-256)` with a
  12-hour TTL (`ADMIN_SESSION_TTL_SECONDS = 43200`); the payload carries a
  *credential tag* — an HMAC over `username + current password hash` — so
  changing the password or username invalidates every existing session.
  Client sessions live 30 days (`CLIENT_SESSION_TTL_SECONDS`). All secret
  comparisons use a constant-time equality helper.
- **Technical details (constant-time verification):** All three verifiers —
  `verifyPasswordHash()` (owner) and each runtime's local `passwordMatches()`
  (clients) — obey the same discipline. (1) The digest comparison is always
  constant-time: `constantEqual()` in the shared lib and the Cloudflare
  runtime, `timingSafeEqual()` on Vercel; a digest is never compared with
  `===`. (2) The verifier **always runs the PBKDF2 derivation before
  deciding**, even when the stored hash is malformed or the candidate is
  outside the length policy — a fixed dummy salt and the default iteration
  count stand in when the stored parameters are unusable, and the
  well-formedness/length guards are applied to the result afterwards. Timing
  therefore cannot reveal which check failed. (3) Both client sign-in routes
  verify against `DUMMY_PASSWORD_HASH` when the email has no account, so an
  unknown email costs the same PBKDF2 as a wrong password and returns the
  same 401 — sign-in timing cannot enumerate registered emails. (The one
  length pre-check that remains, before Vercel's `timingSafeEqual`, compares
  only the fixed 32-byte digest length, which is public.)
- **Implementation rules:**
  - Never log, return, or store a plaintext password or a full hash (see
    Rule B3 for the logging gate).
  - A new verifier must derive-then-compare like the existing three: no early
    return before the derivation, no non-constant-time digest comparison,
    and sign-in routes must keep the dummy-hash path for unknown accounts.
  - The `ADMIN_*` seed may only refresh the owner row while it is still the
    untouched seed (`updated_at = created_at`); once the owner edits anything
    in the dashboard, the seed must never overwrite it.
  - Session verification must keep checking signature, `exp`, subject, *and*
    the credential tag — dropping the tag check re-validates sessions after a
    password change.
- **Related code:**
  - `shared/lib/admin-security.js` — `createPasswordHash()`,
    `verifyPasswordHash()`, `passwordDigest()`, `credentialTag()`,
    `createAdminSession()`, `verifyAdminSession()`, `constantEqual()`.
  - `cloudflare/src/index.js` — `ensureAdminUser()` (seed-once logic),
    `ownerSessionCookie()`, `currentClient()`; mirrored in
    `vercel/api/index.js`.

### Rule A3 — The owner dashboard lives at a date-rotating URL

The owner sign-in/dashboard is not at `/admin`; its path rotates daily and is
derived from the date in the site's time zone.

- **Technical details:** The path is `/<last letter of the day's zodiac
  animal>admin<day-of-month>/dashboard` (Monday-first animal sequence), e.g.
  `/tadmin8/dashboard`. Login responses return the current path; a request to
  a stale path does not authenticate.
- **Implementation rules:** Always generate the path through the shared helper
  with the site's configured time zone — never hard-code a path, and never
  compute it in UTC when the site runs on another zone.
- **Related code:** `shared/lib/admin-url.js` — `adminDashboardPath(date,
  timeZone)`; used by both runtimes' login handlers and admin-page guard.

---

## B. Request security

### Rule B1 — Every state-changing request requires CSRF validation

All POST/PATCH/DELETE routes in both the builder and the generated runtimes
reject requests without a valid CSRF token before doing any work.

- **Technical details:** The token is issued by `GET /api/csrf`, carried in an
  `HttpOnly; SameSite=Strict` cookie (Max-Age 3600), and echoed back in the
  `X-CSRF-Token` header. `csrfOk()` also enforces same-origin. JSON request
  bodies are capped (`MAX_JSON_BYTES = 256 KB`).
- **Implementation rules:** New mutating routes must call the CSRF check as
  their first statement, and browser code must fetch/refresh the token before
  submitting (client helpers already do this — follow `uploadPaymentProof()`'s
  pattern).
- **Related code:** `cloudflare/src/index.js` — `csrfOk()`, CSRF cookie
  issuance at `/api/csrf`; `public/app.js` / `public/download.js` (builder);
  `shared/public/appointments.js` — `getCsrf()`, `uploadPaymentProof()`.

### Rule B2 — Cookies are HttpOnly + SameSite=Strict; responses carry the full security-header set

- **Technical details:** Session and CSRF cookies are `HttpOnly`,
  `SameSite=Strict`, `Secure` on HTTPS (with the `__Host-` prefix where
  applicable in the builder). Every response passes through
  `headersWithSecurity()`: a restrictive CSP (`default-src 'self'`, no
  objects, `frame-ancestors 'none'`), `nosniff`, `X-Frame-Options: DENY`,
  referrer and permissions policies. API/JSON responses are `no-store`.
- **Implementation rules:** Never set a session cookie by hand outside the
  existing cookie helpers; never weaken the CSP for one route — inline assets
  needed by a page belong in the packaged static files.
- **Related code:** `cloudflare/src/index.js` — `headersWithSecurity()`,
  `json()`, `clientSessionCookie()`, `ownerSessionCookie()` (mirrored in
  `vercel/api/index.js`); builder equivalents in `src/index.js`.

### Rule B3 — Error logs never carry credentials; full causes are DEBUG-gated

Server logs must not contain a raw error `cause` from an auth/password path,
because those objects can embed usernames or password material.

- **Technical details:** `debugError(label, cause)` prints a one-line summary
  (error `name` or `code` only) by default. It prints the full cause object
  **only** when `DEBUG_OWNER=1` or `WORKER_DEBUG=1` (also accepts
  `true`/`yes`) is set in the environment.
- **Implementation rules:** Route every owner-account / credential error log
  through `debugError()` — never `console.error(label, cause)` directly on an
  auth path. Non-auth paths may log the cause normally.
- **Related code:** `cloudflare/src/index.js` and `vercel/api/index.js` —
  `debugError()` (defined near the top of each runtime), called from
  `ensureAdminUser()` and the owner-account read path.

---

## C. Database

### Rule C1 — Every table is `tele_`-prefixed and every query is scoped by `site_id`

There are no unprefixed tables in a generated database, and no query may read
or write rows belonging to another site.

- **Technical details:** All schema objects in `shared/db/schema.sql` use the
  `tele_` prefix (e.g. `tele_appointments`, `tele_client_accounts`,
  `tele_appointment_payment_proofs`). Generated code embeds one immutable
  `SITE_ID` per package and every statement filters `site_id = ${SITE_ID}`.
  Foreign keys cascade from `tele_sites(site_id)`. An unprefixed table name is
  not a style issue — it raises Postgres `42P01` (undefined_table) at runtime.
- **Implementation rules:**
  - New tables/columns go into `schema.sql` with the prefix, plus an
    idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` migration line for
    existing deployments (the schema is re-run on bootstrap; see Rule C2).
  - Ownership checks belong in the SQL (`AND client_account_id = ${client.id}`),
    not in JavaScript after the fact.
- **Related code:** `shared/db/schema.sql`; `test/sql-identifiers.test.js`
  (enforces the prefix across all runtime SQL); the `SITE_ID` constant in both
  runtimes.

### Rule C2 — Request handlers use the bootstrapping client; the schema must exist before the first real query

A fresh deployment creates its own schema and site row on first contact;
handlers never assume an operator ran SQL manually.

- **Technical details:** `sql(env)` (Cloudflare) / `getDb()` (Vercel) await
  `ensureSiteRow()` → `ensureSchema()` before every query. `ensureSchema()`
  runs all 59 statements of `schema.sql` (~16 KB: 12 `CREATE TABLE`, 17
  `ALTER TABLE`, 14 `CREATE INDEX`, `DO $$` guards) inside **one transaction**,
  memoised per isolate (`schemaReady`); it gives up after two failures
  (`schemaFailures > 1`) so a misconfigured database fails fast with the real
  query error. `ensureSiteRow()` then inserts the `tele_sites` row
  (`ON CONFLICT DO NOTHING`) — without it, every FK-referencing insert (client
  signup first) fails on a fresh deploy. No `lock_timeout`/`statement_timeout`
  is configured anywhere, which is exactly why Rule D2 exists.
- **Implementation rules:**
  - Ordinary routes must keep using `sql(env)` / `getDb()` — bypassing the
    bootstrap reintroduces fresh-deploy failures.
  - Schema statements must stay idempotent (`IF NOT EXISTS`, `DO $$`
    guards): they can re-run in any isolate at any time.
  - Do not wrap additional request-path work into the bootstrap transaction;
    it holds ACCESS EXCLUSIVE / SHARE locks until commit.
- **Related code:** `cloudflare/src/index.js` — `rawSql()`, `ensureSchema()`,
  `ensureSiteRow()`, `sql()`; `vercel/api/index.js` — `ensureSchema()`,
  `ensureSiteRow()`, `getDb()`; `public/package-core.js` (splits `schema.sql`
  into `SCHEMA_STATEMENTS` at build time).

### Rule C3 — `DATABASE_URL` is normalised before it reaches the Neon driver

- **Technical details:** Only `postgres:`/`postgresql:` URLs with a host and a
  database path are accepted. `sslmode` and `channel_binding` parameters are
  stripped (the serverless HTTP driver connects over HTTPS itself), and up to
  three passes of `&amp;` → `&` un-escaping repair URLs copied out of HTML.
  An empty value throws `'Database is not configured. Set DATABASE_URL.'`
- **Implementation rules:** Always obtain clients via `createNeonClient()` /
  `rawSql()` — never call `neon()` directly — and surface a missing
  `DATABASE_URL` as a 503, not a 500 stack.
- **Related code:** `shared/db/connection.js` — `normalizeDatabaseUrl()`,
  `createNeonClient()`, `decodeHtmlEscapedUrl()`.

---

## D. Scheduler (cron)

### Rule D1 — Each target uses its native scheduler, at its documented cadence

| Target | Trigger | Cadence |
|---|---|---|
| Cloudflare | `scheduled()` export | `* * * * *` (every minute) |
| Vercel | `GET /api/internal/payment-sweeps` | `0 0 * * *` (daily 00:00 UTC, Hobby-compatible) |
| Standalone worker | `payment-reminder-worker.js` timers | 90 s reminders / 180 s owner follow-ups |

- **Technical details:** The Vercel route requires
  `Authorization: Bearer <CRON_SECRET>` compared in constant time. The daily
  Vercel cadence means persisted markers can be written up to ~a day late;
  both UIs therefore also compute reminder state from `payment_due_at`
  locally, so what users see is never a day stale. The standalone worker is
  **not** auto-started by either hosted runtime.
- **Implementation rules:** Do not "fix" Vercel to `* * * * *` in the template —
  Hobby rejects sub-daily crons and the deploy fails. The generated README
  documents the Pro-plan change instead. Cadence numbers live in exactly one
  place per target (`wrangler.jsonc`, `vercel.json`, the worker constants) and
  this table must be updated with them.
- **Related code:** `cloudflare/wrangler.jsonc` (`triggers.crons`),
  `cloudflare/src/index.js` — `scheduled()`; `vercel/vercel.json`,
  `vercel/api/index.js` (payment-sweeps route); both
  `payment-reminder-worker.js` files (`REMINDER_INTERVAL_MS = 90_000`,
  `OWNER_FOLLOWUP_INTERVAL_MS = 180_000`, `reminderBusy` / `ownerFollowupBusy`
  overlap guards).

### Rule D2 — The cron sweep must never bootstrap the schema

Schedulers run against the **raw** client. They must not call `sql(env)` /
`getDb()`, `ensureSchema()`, or `ensureSiteRow()`.

- **Technical details:** A cron trigger runs in a fresh isolate, so the
  bootstrap memoisation (Rule C2) is always empty on a tick. Routing the sweep
  through the bootstrapping client re-ran all 59 DDL statements in one
  transaction **every minute**: `ALTER TABLE` (ACCESS EXCLUSIVE) and
  `CREATE INDEX` (SHARE) block writers, and one transaction holds every lock
  until commit. Concurrent registrations, bookings and proof uploads blocked
  and surfaced as intermittent 503s ("Could not create the client account.",
  "We could not reserve this consultation.", "Could not save payment
  proof."). The sweep's two `UPDATE`s need no site row and traverse no foreign
  key, so the raw client changes nothing about their result — schema creation
  is still guaranteed by the first real request.
- **Implementation rules:**
  - Cron/worker code obtains its client from `rawSql(env)` /
    `createNeonClient(process.env.DATABASE_URL)` only.
  - Treat Postgres `42P01` (undefined_table — a deployment nobody has visited
    yet) as a quiet skip, not an error: Cloudflare logs one `info` line;
    Vercel answers `200 { ok: true, reminders: 0, ownerFollowups: 0,
    skipped: 'schema not applied yet' }`.
  - Any future scheduled job inherits this rule: if it needs schema, it must
    tolerate `42P01` and wait for the first request to create it.
- **Related code:** `cloudflare/src/index.js` — `scheduled()`,
  `runPaymentReminderChecks(rawSql(env), SITE_ID)`; `vercel/api/index.js` —
  payment-sweeps route; `shared/lib/payment-reminders.js`; the standalone
  workers (the original correct pattern). Tests: `test/cron-sweep.test.js`.

### Rule D3 — The sweep reminds at 12 minutes, then drops an unpaid booking at 15 (amended 2026-10-15)

- **Technical details:** The sweep is exactly two statements, each an
  `UPDATE tele_appointments` scoped by `site_id`, returning
  `id, client_account_id`, taking row-level locks only, opening no
  transaction, and never deleting:
  - **Client reminder** — `SET payment_reminder_sent_at = now()`, when
    `created_at <= now() - interval '12 minutes'`, status not cancelled,
    payment `awaiting_proof` (or owner-approved awaiting its screenshot), no
    proof row exists, marker still NULL.
  - **Drop** — `SET status = 'cancelled', payment_status = 'expired',
    payment_owner_attention_at = now()`, when
    `payment_due_at <= now()` (booking time + 15 minutes), `awaiting_proof`
    only, both markers still NULL, no proof row. This is the **only automatic
    cancellation in the system**, and `payment_owner_attention_at` doubles as
    the owner-notification marker: the dashboard's Dropped Bookings list
    (`GET /api/admin/payments/dropped`) reads exactly these rows, so the
    owner is notified the moment the drop commits; the client is notified in
    their own list ("Slot released"). `'rejected'` still happens only when
    the owner rejects a proof by hand.

  *(Before 2026-10-15 the second statement only stamped
  `payment_owner_attention_at` and never cancelled; the automatic drop, with
  owner + client notification, replaced it by explicit request.)*
- **Implementation rules:** The drop must stay a single statement that sets
  all three fields together — splitting the cancel from the notification
  stamp reopens a window where a booking is cancelled but the owner is never
  notified. Never let the drop touch a booking that has a proof row or is not
  `awaiting_proof`. Never add a `DELETE`.
- **Related code:** `shared/lib/payment-reminders.js` —
  `markPaymentProofReminders()`, `markDroppedBookings()`,
  `runPaymentReminderChecks()`; dropped route + dashboard tab in both
  runtimes and `shared/public/admin.{js,html}`. Tests:
  `test/cron-sweep.test.js`, `test/cron-workflow.test.js`.

---

## E. Booking and payment

### Rule E1 — A booking is valid only against an open, published, future, untaken slot

- **Technical details:** `POST /api/appointments` requires a signed-in client,
  a UUID `slotId`, a service from the site's configured service list, a
  payment method of `gcash` or `maya`, and a **phone number for the
  consultation** (the booking form requires it and prefills it from the
  account; the server falls back to the account phone and rejects when both
  are empty). The phone is stored on the appointment row — it is the
  practice's fallback number when the video call or internet drops
  mid-consultation, and it is shown to the owner on dropped bookings. The single `INSERT … SELECT` only
  matches a slot that `is_open`, belongs to a `published` monthly schedule, is
  dated today or later (site time zone), starts in the future
  (`(slot_date + slot_time) AT TIME ZONE <zone> > now()`), and has no
  non-cancelled appointment at the same date/time. Zero rows → 409 "That time
  was just taken…". The new row is `confirmed` / `awaiting_proof` with
  `payment_due_at = now() + interval '15 minutes'`.
- **Implementation rules:** Keep the availability checks inside the one atomic
  `INSERT … SELECT` — a check-then-insert split reintroduces a double-booking
  race. New booking fields must be added to that statement in **both**
  runtimes (they are byte-identical by test).
- **Related code:** booking route in `cloudflare/src/index.js` /
  `vercel/api/index.js`; slot/schedule tables in `shared/db/schema.sql`;
  parity asserted in `test/cron-workflow.test.js`.

### Rule E2 — The 15-minute payment window is a real deadline for bookings without proof (amended 2026-10-15)

- **Technical details:** Booking +15 minutes (`payment_due_at`) drives the
  automatic drop (Rule D3) and the client UI countdown. The client UI
  independently shows "reminder due" from `paymentDueAt - 3 minutes`, which is
  the same instant as the server's `created_at + 12 minutes`, so banner and
  marker agree even on Vercel's daily cron (where the drop itself can land up
  to a day late). The deadline applies **only** to bookings still
  `awaiting_proof` with no proof row: one upload, at any minute before the
  drop tick, makes the booking undroppable.
- **Implementation rules:** Never enforce `payment_due_at` in the proof,
  cancel, or booking routes themselves — the deadline must bite in exactly
  one place (the sweep), or late-but-paid clients get inconsistent answers
  from different routes. UI copy must say plainly that bookings without proof
  are released at 15 minutes.
- **Related code:** `shared/public/appointments.js` — `paymentReminderDue()`,
  `formatPaymentFollowup()`; booking route (sets `payment_due_at`); sweep in
  `shared/lib/payment-reminders.js`.

### Rule E3 — One proof per appointment; uploads are type-verified, size-capped, and never deadline-checked

- **Technical details:** `POST /api/client/appointments/:id/payment-proof`
  accepts PNG/JPEG/WebP only, ≤ 3 MB (`MAX_PAYMENT_PROOF_BYTES`), streamed
  with an early-abort size check. The image's magic bytes must match the
  declared `Content-Type` (`detectPaymentProofMime()`), and the stored base64
  must satisfy the database check `length BETWEEN 16 AND 4194304`.
  `UNIQUE (site_id, appointment_id)` guarantees one proof per appointment; a
  second upload answers 409. The upload runs as one CTE (`SELECT … FOR
  UPDATE` → insert proof → flip `awaiting_proof` to `pending_review`) and
  requires only: booking not cancelled, status `awaiting_proof` (or
  owner-approved awaiting screenshot), no existing proof. It never reads
  `payment_due_at` itself — the deadline bites because the sweep cancels the
  booking at 15 minutes (Rule D3), after which the same upload matches
  nothing and the route answers 409 "The practice has released this
  booking…".
- **Implementation rules:** Keep the mime-type allow-list, the magic-byte
  check, and both size caps in sync between the shared lib and the schema
  check. Keep the upload a single statement so the cron's `NOT EXISTS` guard
  and the upload can never interleave into a duplicate.
- **Related code:** `shared/lib/payment-proof.js` —
  `PAYMENT_PROOF_MIME_TYPES`, `MAX_PAYMENT_PROOF_BYTES`,
  `detectPaymentProofMime()`, `paymentProofToBase64()`; proof route CTE in
  both runtimes; proof table in `shared/db/schema.sql`. Tests:
  `test/payment-proof.test.js`, `test/cron-workflow.test.js`.

### Rule E4 — Cancellation and rejection are deliberate human actions with their own guards

- **Technical details:** A client may cancel their **own** booking while it is
  not already cancelled (`PATCH …/appointments/:id`, ownership enforced in
  SQL). The owner may cancel from the dashboard only when the appointment
  starts more than 24 hours from now (`(appointment_date + appointment_time)
  AT TIME ZONE <zone> > now() + interval '24 hours'`). The owner rejecting a
  proof atomically sets the proof `rejected` **and** cancels/releases the
  appointment; approving sets payment `approved`.
- **Implementation rules:** Cancellation rules live in the SQL `WHERE`, not in
  UI hiding — the buttons may hide, but the route must enforce. Rejection must
  stay a single atomic statement (proof update + appointment release).
- **Related code:** client cancel route and owner cancel/review routes in both
  runtimes (owner cancel at the `interval '24 hours'` statement); owner review
  CTE (`WITH reviewed AS … released AS …`).

---

### Rule E5 — The calendar and payment details are account-only (guests see neither)

- **Technical details:** A visitor without a client session gets: no
  appointment calendar (the calendar area shows "Sign in to view appointment
  availability and booking." and `/api/availability` answers 401), and no
  GCash/Maya account details (the footer payment block shows a sign-in note;
  `site.js` only fills the numbers after `/api/auth/me` confirms a client).
  Reading published journal posts stays public (Rule G4). Known limit: the
  compiled `site-config.js` shipped in the package still embeds the payment
  account strings — the UI and API hide them from guests, but they are not a
  secret from someone who reads the file. Treat the numbers as "unlisted",
  and see *To Be Implemented* for removing them from the public config.
- **Implementation rules:** Never re-add payment numbers or slot data to a
  public render path. Guest-facing copies of these blocks must show the
  sign-in prompt, not empty space.
- **Related code:** `/api/availability` in both runtimes;
  `shared/public/appointments.js` — `loadMonth()` guest branch, `initialize()`;
  `shared/public/site.js` — `renderPaymentDetails()`.

---

## F. Content and navigation

### Rule F1 — Menu hrefs are sanitised by one canonical algorithm, copied byte-for-byte to the browser

- **Technical details:** `cleanMenuHref()` trims, rejects values over 2048
  chars and any control characters, rejects protocol-relative (`//host`) and
  backslash-relative (`/\host`) paths, round-trips same-origin paths through
  `URL` against the deployment origin, and accepts absolute URLs only if
  `https:` with a hostname and no embedded credentials. Anything else becomes
  `''` and the menu item is dropped. At most 16 links (`MAX_MENU_LINKS`),
  labels ≤ 60 chars, ids normalised to `[A-Za-z0-9_-]` ≤ 48 chars and
  de-duplicated.
- **Implementation rules:** The browser copies (`site.js:
  safeMenuNavigationHref`, `admin.js: safeMenuDestination`) must remain
  algorithm-identical to the server's `cleanMenuHref()` — a divergence means a
  value saves on one side and is rejected (or worse, navigates) on the other.
  Note `String(value).trim()` runs **before** the control-character check, so
  a trailing newline is trimmed away while an embedded NUL rejects the value.
- **Related code:** `shared/lib/menu-links.js` — `cleanMenuHref()`,
  `cleanMenuLinks()`, `DEFAULT_MENU_LINKS`.

---

## G. Packaging and scaffold (builder-side rules)

### Rule G1 — Scaffold placeholder tokens may appear only where the builder substitutes them

- **Technical details:** `replaceTokens()` globally replaces `__SITE_ID__`,
  `__SITE_CONFIG_JSON__`, `__SCHEMA_STATEMENTS__`, `__BUSINESS_NAME__`,
  `__BRAND_NAME__`, `__LOCATION__`, `__EMAIL__`, `__PHONE__`, `__PAPER_COLOR__`,
  `__THEME_CLASS__`, `__DEPLOY_TARGET__`; `replaceSecretTokens()` replaces
  `__DATABASE_URL__`, `__ADMIN_USERNAME__`, `__ADMIN_EMAIL__`,
  `__ADMIN_PASSWORD_HASH__`, `__CSRF_SECRET__`, `__CRON_SECRET__`;
  `injectWranglerVariables()` replaces the single `__WRANGLER_VARS__`.
  Because replacement is global and literal, writing any of these tokens in a
  comment or doc string inside the scaffold injects real values there —
  including live secret values — and corrupts the generated file.
- **Implementation rules:** Never write a `__TOKEN__` literal anywhere in
  `public/_scaffold/` except its single intended placeholder position. Refer
  to tokens in prose without the double-underscore literal (e.g. "the
  WRANGLER_VARS token"). This applies to comments, READMEs and test fixtures
  embedded in the scaffold.
- **Related code:** `public/package-core.js` — `replaceTokens()`,
  `replaceSecretTokens()`, `injectWranglerVariables()`, `generateBundle()`.

### Rule G2 — The `wrangler.jsonc` `vars` block is intentional and must be preserved

- **Technical details:** The generated Cloudflare package carries its
  production values (`DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_EMAIL`,
  `ADMIN_PASSWORD_HASH`, `CSRF_SECRET`) in the `vars` block of
  `wrangler.jsonc`. This is the deploy-time copy of `.dev.vars`: Wrangler
  never uploads `.dev.vars`, and `wrangler secret put` is a separate
  interactive step, so without `vars` the first deploy would run
  unconfigured. The values are exactly what the operator typed into the
  builder. The generated `.gitignore` covers **both** `wrangler.jsonc` and
  `.dev.vars`, because both carry the same production values.
- **Implementation rules:** Do not remove the `vars` block, do not "move it to
  secrets" by default, and do not treat it as a credential leak. The supported
  hardening path — for operators who want it — is `wrangler secret put
  DATABASE_URL` / `CSRF_SECRET` / `ADMIN_PASSWORD_HASH` followed by deleting
  the matching `vars` entries. Only the comment around the block may be
  edited, and that comment must not contain the literal placeholder token
  (Rule G1).
- **Related code:** `public/_scaffold/templates/cloudflare/wrangler.jsonc`;
  `public/package-core.js` — `injectWranglerVariables()` and the generated
  `.gitignore` (built at `files.set('.gitignore', …)`, covering the env file
  plus `wrangler.jsonc` for the Cloudflare target); rationale also recorded
  in `current_code.md` §6.

### Rule G3 — A fix to a template is not deployed until the package is regenerated

- **Technical details:** Generated ZIPs are self-contained snapshots of the
  scaffold at build time. Runtime fixes (e.g. the Rule D2 cron fix) reach a
  live site only when the operator downloads a fresh package from the builder
  and redeploys it; there is no update channel into already-deployed Workers
  or Vercel projects.
- **Implementation rules:** When reporting a generated-site fix, always state
  that existing deployments must regenerate + redeploy. Builder-side fixes
  (this repository's own Worker) deploy normally and are exempt.
- **Related code:** `public/package-core.js` — `generateBundle()`;
  `public/download.js` — `requestGeneratedPackage()`.

### Rule G4 — The blog CMS is always on in every generated site

- **Technical details:** The builder's blog switch (`#blogToggle`) and the
  quick-wizard's blog switch (`#wizardBlog`) are rendered checked and
  `disabled`; both collect paths in `public/app.js` emit `blog: true`, and
  `normalizeConfig()` in `public/package-core.js` forces
  `features.blog = true`, so no ZIP can be generated with the CMS off. The
  CMS itself is the basic one that already ships: `tele_blog_posts` /
  `tele_blog_post_images`, public `GET /api/posts` and `GET /api/posts/<slug>`,
  owner `GET/POST/PUT/DELETE /api/admin/posts` (+`/<id>`) with
  draft/published states, and the dashboard posts manager.
- **Implementation rules:** Never re-enable the switch or make the flag
  optional again without replacing this rule. Finishing the always-on
  guarantee *inside* deployed sites (runtime config merge, stale database
  rows, no-database messaging) is specified in *To Be Implemented* below.
- **Related code:** `public/app.js`, `public/package-core.js`,
  `public/index.html`; posts routes in both runtimes; tests in
  `test/builder.test.js`, `test/browser-build.test.js`.

---

## Appendix — where each rule is enforced by tests

| Rule | Test file |
|---|---|
| A1 (8–25 passwords) | `test/builder.test.js`, `test/password-security.test.js` |
| A2 (constant-time verification) | `test/password-security.test.js` |
| B1–B2 (CSRF, cookies, headers) | `test/builder.test.js`, `test/deployment-fixes.test.js` |
| C1 (`tele_` prefix, site scoping) | `test/sql-identifiers.test.js` |
| C2/D2 (bootstrap vs raw client) | `test/cron-sweep.test.js` |
| D1 (cadences match config + docs) | `test/cron-sweep.test.js` |
| D3/E1–E3 (sweep/booking/proof workflow on real Postgres) | `test/cron-workflow.test.js` (PGlite) |
| E3 (proof validation) | `test/payment-proof.test.js` |
| E5 (guest gating) / G4 (blog always on) | `test/deployment-fixes.test.js` (availability 401), `test/builder.test.js`, `test/browser-build.test.js` |
| F1 (menu sanitizer parity) | `test/builder.test.js` |
| G1–G2 (tokens, wrangler vars) | `test/deployment-fixes.test.js`, `test/browser-build.test.js` |

---

## To Be Implemented — basic CMS always on (completion plan)

**Status:** builder side done (Rule G4: switches disabled, `features.blog`
forced `true` in `package-core.js`). What remains is finishing "always on"
inside the *generated site*. The full plan — the deployed-site user flow
(owner writes a post in the dashboard → publishes → it appears in the
Journal; visitors read without an account), a plain-words step-by-step for a
junior developer, and a deliberately redundant re-explanation — is written
out at the bottom of `current_code.md` under the same heading. Summary of
the remaining work:

1. Force `features.blog = true` in each runtime's site-config merge (after
   the database merge) and in the owner site-settings save, so a stale
   database row with `blog: false` can no longer hide the Journal menu.
2. In the dashboard posts section, turn the no-database 503 into a clear
   "Connect the appointment database (DATABASE_URL) to save posts" message.
3. Verify both ZIPs end to end as a user: draft hidden → publish visible →
   edit → delete, including against an old database carrying `blog: false`.

**Inconsistencies restricting implementation today:** (1) blog on/off is
stored in three places that can disagree — builder-compiled config (now
always true), the `tele_sites.config` database row merged over it at runtime
(can still say `false` from an old save and hide the menu while the owner
API accepts posts), and the route gates (which read the compiled config);
(2) old deployed packages keep the old switchable behaviour until
regenerated (Rule G3); (3) without `DATABASE_URL` the journal falls back to
compiled demo posts and owner saves fail silently; (4) the owner settings
form can write a stale `blog: false` back; (5) `site-config.js` still embeds
the GCash/Maya account strings, so Rule E5 hides them from guests in the
UI/API but does not make them secret — moving payment details behind the
authenticated availability response is the clean fix.
