# Current Code Logic and Operational Rules

**Code is the source of truth.** Dated work lists and bug records below are snapshots of earlier trees. Facts that still hold in this working tree (2026-10-16, `npm test` **135/135**): passwords **8–25** for every user type (builder admin, owner sign-in / change-password, client sign-up / sign-in) with four character classes at creation; `PASSWORD_MIN = 8`; `ensureSiteRow` refreshes an untouched `tele_sites` seed (`updated_at = created_at`) and keeps owner-edited rows; guests get an empty calendar and 401 on `/api/availability`; preview cap **128 KB**; owner login JSON includes `authenticated: true` and Cloudflare stale dashboard URLs show the sign-in form.

## Summary — user flow and the rules that matter most

**What this system is.** Canopy Studio is a builder that produces a self-contained, deploy-ready ZIP of a white-label practice website (Cloudflare Workers or Vercel) backed by one Neon Postgres database. The builder never deploys anything — the operator downloads the ZIP and deploys it. A generated site has exactly two authenticated account types, the practice **owner** and public **clients**, plus unauthenticated visitors. The companion file `system-rules.md` states each rule below as an invariant with its implementation rules and enforcing code; this summary is the map, not a substitute.

### User flow

1. **Build (builder operator, no account).** The operator enters the practice details, picks a design system/theme and a target (Cloudflare or Vercel), sets the initial owner username, email and password plus the Neon `DATABASE_URL`, and downloads the ZIP. The raw password exists only in memory during the build; the ZIP carries a salted PBKDF2 hash.
2. **Deploy (operator).** Unzip and deploy (`wrangler deploy` or a Vercel import). No manual secret step is needed: on Cloudflare the production values ride in the `wrangler.jsonc` `vars` block, which is intentional and documented in §6 (Rule G2) — it is the deploy-time copy of `.dev.vars`, which Wrangler never uploads.
3. **First contact (automatic).** The first live URL after deploy creates the schema (all 59 statements), upserts the site's `tele_sites` row, and **inserts the owner username / email / PBKDF2 hash into `tele_admin_users`** in the same Neon database as client registration. An untouched seed (`updated_at = created_at`) is refreshed from the compiled package; an owner-edited row is kept. From then on the database owner row is authoritative.
4. **Owner setup.** The owner signs in at a **date-rotating dashboard URL** (Rule A3), publishes the monthly schedule and open slots, and edits pages and content.
5. **Visitor browsing (no account).** Anyone can read the public pages, blog and gallery. The appointments page shows an empty calendar and `#guestWhatWeDo` (Brivon “What we do” copy on Illustration `.service-card` markup); reserving a slot requires a client account (Rule E5, Bug Fix No. 204).
6. **Client booking.** The client registers (email + password — the same 8–25 complexity policy as the owner, Rule A1 as amended), signs in, picks an open slot and a GCash or Maya payment method, and enters a **required phone number for the consultation** (prefilled from the account; it is the practice's fallback number if the video call or internet drops). One atomic insert creates the booking as `confirmed` / `awaiting_proof` with a payment window of **booking time + 15 minutes** (Rule E1). Guests see an empty calendar chrome and no payment numbers or slot data (Rule E5).
7. **Client payment.** The client pays off-platform (GCash/Maya) and clicks **Upload payment proof** to attach the transaction screenshot. The upload flips the booking to `pending_review`, and from that moment the booking can no longer be dropped. The 15-minute window **is** a deadline for bookings without proof: at 15 minutes the cron drops the booking (step 8), after which an upload is rejected with a 409 (Rules E2–E3, as amended).
8. **Cron reminders and drop (automatic).** On Cloudflare a cron ticks every minute (Rule D1): it stamps a **client reminder** once a booking is 12 minutes old without proof, and **drops the booking** once the 15-minute window passes without proof (`status = 'cancelled'`, `payment_status = 'expired'`), stamping the owner-notification marker in the same statement. **Both sides are notified on site**: the owner sees the drop under **Dropped Bookings** in the dashboard (that list *is* the notification), and the client sees "Slot released" with a re-book message in their own appointment list (Rule D3, as amended 2026-10-15).
9. **Owner review.** The owner approves the proof (`approved`) or rejects it (proof `rejected` and the booking is released), or marks payment received manually — in which case the client can still attach the screenshot afterwards (Rule E4).

### The important system rules

- **Passwords are 8–25 characters for every user type** (owner and client alike), and since 2026-10-15 the character-class requirement is the same for everyone too: one lowercase letter, one uppercase letter, one number and one symbol. One definition — `PASSWORD_MIN`/`PASSWORD_MAX` in `shared/lib/admin-security.js` — is imported by both runtimes and the builder (Rule A1).
- **Password verification is constant-time.** Every verifier always runs the PBKDF2 derivation and compares digests with `constantEqual`/`timingSafeEqual`; both client sign-in routes verify against a dummy hash for unknown emails, so sign-in timing cannot enumerate accounts (Rule A2). Passwords exist only as PBKDF2 hashes (210,000 iterations); error logs never carry credentials and full error causes are gated behind `DEBUG_OWNER=1`/`WORKER_DEBUG=1` (Rule B3).
- **Every mutating request needs CSRF validation**, and session cookies are `HttpOnly` + `SameSite=Strict` under a strict CSP (Rules B1–B2).
- **All tables are `tele_`-prefixed and every query is scoped by `site_id`**; ownership checks live in the SQL, not in JavaScript after the fact (Rule C1).
- **Requests use the bootstrapping DB client; the cron never does.** The first request creates schema + site row through `sql(env)`/`getDb()`. A cron tick runs in a fresh isolate where that bootstrap would re-run all 59 DDL statements in one transaction every minute and lock out registrations, bookings and uploads — so schedulers use the raw client and treat a missing schema (`42P01`) as a quiet skip (Rules C2, D2).
- **Scheduler cadence differs by target:** Cloudflare every minute, Vercel once daily (`0 0 * * *`, Hobby-compatible), standalone worker every 90 s / 180 s (Rule D1).
- **Booking is one atomic `INSERT … SELECT`** against an open, published, future, untaken slot — no check-then-insert race — and now stores a **required consultation phone number** (the fallback if the video call drops) (Rule E1). **Proof upload** is one proof per appointment, PNG/JPEG/WebP verified by magic bytes, ≤ 3 MB (Rule E3). **Manual cancellation is a deliberate human action** with its own guards (client: own booking; owner: starts more than 24 hours away) (Rule E4); the one automatic cancellation is the cron drop at 15 minutes without proof (Rule D3).
- **Menu links** pass one canonical sanitizer, copied byte-for-byte to the browser (Rule F1). **Scaffold `__TOKEN__` placeholders** may appear only where the builder substitutes them — the same token in a comment injects real values, including secrets (Rule G1).
- **Template fixes reach live sites only by regenerating the ZIP and redeploying**; already-deployed packages never update themselves (Rule G3).

## Current UI functionality by user type

The repository has four practical UI roles. Only **client** and **practice owner** are authenticated account types in a generated site; the builder operator and public visitor do not create accounts.

### 1. Builder operator (no account)

Through the Canopy Studio builder UI, a person can:

- choose a veterinary or dental starting point and enter the practice name, location, email, phone, GCash details, and Maya details;
- choose the Illustration design system with one of seven layouts, or the separate Brivon design system in dark or light mode; change supported colors and typography; and see an immediate desktop or mobile preview;
- enable or disable the gallery and appointment features (the blog/CMS is always on — its builder switch is disabled, and every package ships with it; see *To Be Implemented* at the bottom for the basic-CMS completion plan);
- use guided setup to add, reorder, edit, or remove up to eight generated custom pages, each with a menu label, URL, title, text, and optional banner-image URL;
- choose either a Vercel or Cloudflare Workers package;
- provide the initial owner username, owner email, owner password, and optional Neon database URL; and
- download the selected deploy-ready ZIP. The UI does **not** deploy or publish the package.

Non-secret builder settings are autosaved in the browser's local storage. The database URL and owner password are kept out of that saved configuration. The builder has no sign-up, login, hosted-project list, or cloud deployment account UI.

### 2. Public visitor (no account)

On a deployed generated site, a visitor can:

- browse the public home page, enabled navigation links, generated custom pages, published blog posts, and published gallery items;
- view practice contact information (GCash/Maya payment-account details are **not** shown to guests);
- **not** see booking UI controls or any payment details — the appointments page shows an empty month grid, hides month navigation / slots / the reservation form (`data-booking-control` under `body.guest-calendar-view`), and places `#guestWhatWeDo` immediately below that empty calendar (Brivon “What we do” / “Focused care. Built around you.” copy on Illustration `.service-card` markup — not a clone of either homepage); `/api/availability` answers 401 to guests; and
- create a client account or sign in from the appointments page.

A visitor cannot inspect open slots without signing in. The signed-in availability response carries the month, whether any times exist, per-day open counts and the open slots themselves; it exposes no published/reserved totals and no fill percentage.

### 3. Client account

From the appointments UI, a signed-in client can:

- create an account with name, email, phone, and password; sign in; refresh their appointment list; and sign out;
- reserve an available consultation slot, choose a service and GCash or Maya, add an optional short context note, and accept the payment-window acknowledgement;
- view only their own appointments, statuses, payment state, and owner-written consultation notes;
- upload one private PNG, JPEG, or WebP payment-proof image of up to 3 MiB for an eligible appointment;
- see the in-dashboard missing-proof reminder after the reminder marker is recorded; and
- cancel their own active appointment from their account UI.

The UI does not provide client profile editing, password reset/change, email verification, or account deletion. Reminders are shown in the account dashboard; this code does not send client email, SMS, or push notifications.

### 4. Practice owner account

From the date-rotating owner dashboard, an authenticated owner can:

- sign in with the builder-created username and password, view the configured owner email, view the public site, and sign out;
- change the owner username, email or password from the Sign-in panel (requires the current password; the new hash is written to `tele_admin_users` and the session is re-issued);
- edit practice name, location, contact email, and phone;
- add, rename, reorder, retarget, or remove public menu links, up to 16 links;
- change appearance settings within the generated design-system family (Illustration layouts, or Brivon light/dark), including supported brand/accent/background colors and typography;
- create, edit, publish/draft, and delete blog posts, including a feature image and optional article gallery;
- create, edit, publish/draft, order, and delete gallery items;
- publish a month's 30-minute availability from weekly hours plus date-specific opening or closure exceptions;
- review recent and upcoming appointments, cancel eligible appointments, and add or update a private client-visible consultation note;
- review bookings awaiting payment proof, manually mark an eligible payment received, or release the booking;
- privately preview uploaded payment screenshots, approve proof, or reject proof and release the slot; and
- manually refresh appointment and payment lists.

The owner UI manages the single owner account only; it does not create additional staff/owner roles, edit client profiles, issue refunds, process money directly, upload local CMS images, configure domains/hosting, or deploy code. CMS images are entered as HTTPS or same-site URLs; payment proofs are the separate private image-upload flow.

### UI/account implementation cross-check

The capability list above was checked against the rendered controls and their corresponding handlers/routes in:

- builder UI: `public/index.html`, `public/app.js`, `src/index.js`, and `src/generator.js`;
- generated public/client UI: `public/_scaffold/templates/shared/public/index.html`, `site.js`, `appointments.html`, and `appointments.js`;
- generated owner UI: `public/_scaffold/templates/shared/public/admin.html` and `admin.js`; and
- both generated backends: `public/_scaffold/templates/vercel/api/index.js` and `public/_scaffold/templates/cloudflare/src/index.js`.

Feature toggles can hide gallery or scheduling UI in a generated site. The blog/CMS switch is disabled in the builder and `package-core.js` forces `features.blog = true` in every ZIP (Rule G4); the generated runtime's `cleanSiteConfig()` still merges the database `features` object without forcing `blog: true`, so a stale `tele_sites.config` with `blog: false` can hide Journal until that merge is finished (see *To Be Implemented*). Account/scheduling/CMS persistence requires a configured Neon database — the runtime applies its own `tele_`-prefixed schema on first use, so no manual SQL is required.

## Design-system selection and Brivon behavior

### Builder controls

The builder exposes the same three-way design-system choice in both setup paths:

| Location | Control | Options |
|---|---|---|
| Main builder, **Choose a Site Layout** | `#designSystemSelect` | Illustration theme (current), Brivon Dark, Brivon Light |
| Guided setup modal, Appearance step | dynamically rendered `#wizardDesignSystem` | Illustration theme (current), Brivon Dark, Brivon Light |

Selecting Illustration shows the seven existing Illustration layout cards: Canopy, Soft clay, Coastal, Editorial, Neat, Launcher, and Air. Selecting either Brivon option hides those Illustration cards because Brivon is a separate design system rather than another card-level color preset. Both controls call `setDesignSystem()`, which delegates to `setTheme()`, synchronizes inputs, updates the preview, rerenders the active wizard step when needed, and saves the non-secret configuration to local storage.

### Builder preview

The preview uses one sandboxed iframe for every design system. `GET /api/preview?config=<json>` selects its source through `homeDesignFile(theme)`: Illustration uses `shared/public/index.html` + `shared/public/site.css`; Brivon Dark/Light use `shared/designs/brivon-index.html` + `shared/public/brivon.css`. ZIP generation uses the same homepage selector, so theme changes cannot preview one design while packaging another.

The preview inlines the selected stylesheet, removes scripts, and pre-renders the identity, theme class and color variables, services, menu (including partial custom pages), gallery, journal, contact/payment details, and feature visibility that the generated runtime otherwise fills. Sample SVGs are inlined so the iframe makes no local-asset requests. The page is laid out at 1440 CSS pixels on desktop or 390 on mobile and scaled to the panel while keeping the iframe at viewport height; the iframe scrolls internally to expose the full page. The ZIP intentionally retains linked CSS and scripts for a normal deployable runtime, so the preview is self-contained rather than byte-for-byte identical to the packaged `index.html`.

Brivon Dark uses a near-black background and electric-lime accent; Brivon Light uses off-white and dark olive. Illustration previews now use the generated Illustration HTML/CSS as well, instead of the former compact mockup that only changed a few theme-specific colors.

### Generated Brivon package

When `theme` is `brivon-dark` or `brivon-light`, `src/generator.js` replaces the normal shared homepage with `public/_scaffold/templates/shared/designs/brivon-index.html`. The homepage follows the Brivon template's **service page layout** (`services.html` in `axelmercer253/brivon`), using the template's own structure and class names: sticky `site-header` with `nav`/`nav-links`/`nav-cta-row` plus the fullscreen `mobile-drawer`, the `hero` with `hero-grid` (`hero-text` eyebrow/headline/sub/CTA row/meta beside `hero-media` with floating tags), the three `tier-card` services grid (`tier-grid`, with the middle card `featured`), the `process-grid` approach section, the reverse-tile FAQ (`tile-section` + `faq-grid`/`faq-card`), the lime `closing-cta` booking block, and the multi-column `site-footer`. Practice content is mapped onto that skeleton: the three configured services fill the tier cards (`.service-title`), the generated gallery and journal render in Brivon-styled grids, and the closing CTA is the `#book` section that site.js hides when scheduling is disabled. The package includes:

- `brivon.css`, which is the real template stylesheet scoped under the `.brivon-shell` body class (so it never leaks into appointment, custom or owner pages that also load the file), followed by an adaptation layer: practice-specific components rendered by `site.js` (menu, gallery, journal, article modal, toast), the `theme-brivon-light` token remap and hardcoded-color overrides, and functional-page compatibility rules;
- `brivon.js`, the template's mobile-drawer, scroll-reveal and sticky-header-shadow behavior, extended to mirror the generated menu into the mobile drawer;
- the template's Google Fonts stack (Boldonse display, Inter Tight body, Geist Mono captions) loaded from the homepage head;
- the existing `site.js`, so practice identity, safe menu links, feature toggles, public posts, public gallery data, contact details, and payment details still use the generated site's configuration; and
- Brivon continuity styles on appointments and generated custom pages without replacing their account, booking, or security behavior.

Brivon headings `h1` through `h8` default to `line-height: calc(1em + 5px)` to preserve five pixels of additional line-box space for wrapped titles, so wrapped heading lines keep 4–8px of breathing room between them. The rule lives in the shared `brivon.css` template and therefore covers Brivon Dark and Brivon Light in both the prepared ZIP and the live preview (which inlines the same file); the functional-page continuity rule (appointments, custom pages) covers `h1`–`h8` for both theme classes as well. Class-qualified display headings from the template (hero, section heads, closing CTA) keep the template's own rhythm. The generated owner appearance editor permits switching between Brivon Dark and Brivon Light on a Brivon package. It hides incompatible Illustration choices because changing from one HTML design-system family to another after generation would require replacing the static homepage structure; both generated runtimes also normalize stored settings to the package's design-system family so an older database theme cannot override the Brivon homepage. Illustration packages likewise keep Brivon choices unavailable in the owner editor and runtime.

### Bug record: incomplete theme preview and ZIP generation checks

- **Reported symptoms:** Brivon showed its real full homepage, while Illustration themes showed only a compact mockup; lower sections could not be explored in the preview. The downloaded `index.html` looked different because the preview and ZIP did not share a homepage source for Illustration. Vercel/Cloudflare generation was also suspected of failing at the CSRF step.
- **Root cause:** the browser only called `/api/preview` for Brivon and retained a separate hand-built Illustration preview. The preview endpoint also defaulted non-Brivon input to Brivon Dark. Consequently, selecting an Illustration theme never rendered the actual generated page. The reported CSRF failure was **not reproducible** in local same-origin tests; Vercel and Cloudflare generation both returned ZIPs with newly issued tokens. The client did, however, stop on its first 403, so a defensive one-time fresh-token retry was added. A proxy/cookie race is only a possibility, not a verified production cause.
- **Fix:** both preview and ZIP now call the same theme-to-homepage selector. All nine supported themes render their matching scaffold HTML/CSS in one sandboxed iframe, retain their desktop/mobile breakpoints, and explicitly allow scrolling through the full page. The preview is self-contained (inlined CSS/images, no scripts); ZIPs retain normal linked assets and runtime scripts. The Generate flow uses no-store, same-origin requests and a request-local token, retries once with a fresh token after a generate-route 403, then surfaces the actual failing route/status.
- **QA coverage:** regression tests exercise all theme previews, generated homepage selection and theme classes for both Vercel and Cloudflare ZIPs, and the extracted browser Generate client against the real Worker CSRF/download routes for both targets. Client-level tests simulate a first-request 403 followed by a fresh-token success and verify a second 403 is surfaced without looping. A local Wrangler dev smoke also served the builder shell/assets and all nine previews and returned both ZIP targets through the client helper. Server tests cover optional HMAC signing, reverse-proxy origins, cookie/token mismatches, cross-site rejection, invalid credentials, and ZIP contents. This confirms local request-flow behavior, not a browser-rendered or production-host download.

### Bug record: `/api/generate` failures on CPU-capped deployments and mid-generation UI edits

- **Reported symptoms:** the Cloudflare-package download kept failing on the deployed builder with “an error on api/generate”, while local Wrangler runs were fine. Editing builder controls (functionality toggles, design choices) also felt like the code “took time to prepare” again, and the Generate window allowed further edits while a ZIP was being prepared.
- **Root cause:** the builder Worker was deployed on the **Workers Free plan**, which hard-caps every request at 10 ms of CPU. The server-side ZIP build needs roughly 60 ms of CPU (210,000-iteration PBKDF2 hashing ≈ 40 ms plus template/ZIP work ≈ 20 ms), so Cloudflare kills `/api/generate` with error 1102 / HTTP 503 before it can respond. `wrangler dev` never enforces the CPU cap, which is why every local test and smoke passed. `limits.cpu_ms` cannot fix this on Free (the deploy itself is rejected with API error 100328). Two UI defects compounded the experience: the Editorial accent buttons carried swatch colors in `data-editorial-accent` while `setEditorialAccent()` only accepted key names, so Black/Teal/Dark green clicks were silently dropped; and the Generate flow disabled only the two Generate buttons, leaving every other control editable while the snapshot behind the ZIP was already fixed.
- **Fix:** the whole build pipeline moved into `public/package-core.js`, shared verbatim by the Worker (`src/generator.js` supplies an ASSETS-backed template reader) and the builder tab (`public/package-builder.js` supplies a fetch-backed reader over the now-public `/_scaffold/templates/` files, which hold only placeholder tokens and already ship in every ZIP). Generate tries `/api/generate` first and, whenever that fails, assembles the identical package in the browser from the same click-time snapshot; the live preview likewise builds in the browser first and falls back to `/api/preview`. While a Generate runs, every builder control (inputs, selects, toggles, buttons, links) is locked and a “Preparing package — controls locked” chip is shown, and exact disabled states are restored afterwards. `setEditorialAccent()` now accepts either the accent key or the button's swatch color. Unexpected `/api/generate` and `/api/preview` failures return the underlying error string, and `download.js` surfaces plain-text platform errors (e.g. “error code: 1102”) instead of a generic message. Discrete controls (toggles, themes, selects) now refresh the preview immediately; typing stays debounced, and stale preview responses are aborted.
- **QA coverage:** new tests in `test/browser-build.test.js` prove the Worker serves `/_scaffold/templates/` to the browser build (and hides the rest of `/_scaffold/`), that a package built through those served templates matches the Worker ZIP's entry list and deterministic file contents for both targets, that generate failures report the real cause, that `download.js` surfaces plain-text platform errors, and that the snapshot/lockout/accent-mapping/immediate-refresh client changes are in place. The full suite (48 tests) passes, and a local Wrangler smoke served the new template route and built both targets through the browser path.

### Bug record: Generate locked the controls but never saved the ZIP

- **Reported symptoms:** clicking either Generate button (Vercel or Cloudflare) locked every builder control and showed the "Preparing package — controls locked" chip, the build completed and the success toast appeared, but no file was downloaded — on the local Wrangler dev server and on the CPU-capped deployment alike.
- **Root cause:** the lockout installs a capture-phase click guard on `document` that calls `preventDefault()` on every anchor activation while a package is prepared, so no navigation can race the download. `saveBlobDownload()` however clicks its own programmatic `<a download>` anchor while the lock is still held (the unlock only happens in the `finally` afterwards). The guard's `event.target.closest('a')` matches that download anchor too, so `preventDefault()` cancelled the click and the browser never performed the download. The server build and the browser fallback both end in the same swallowed click, which is why both targets failed on every host while all server-side, download-client and ZIP tests stayed green — the suite exercised the Worker, `download.js` and the shared core, but only source-inspected `app.js`'s lockout.
- **Fix:** `saveBlobDownload()` marks its anchor with `data-package-download`, and the lockout guard skips marked anchors. The programmatic download click now reaches the browser uncancelled, while ordinary builder links stay swallowed for the whole preparation window.
- **QA coverage:** `test/generate-download.test.js` runs the real `public/app.js` Generate flow under a minimal DOM stub for both targets and both build paths (a server-built ZIP from `/api/generate`, and the browser-built fallback after a simulated `error code: 1102` 503). It asserts the download anchor's click is not `preventDefault()`-ed, that a regular builder link still is while locked, that the captured blob is the complete ZIP for the selected target (the env file carries only the salted PBKDF2 hash, never the raw password), and that the lockout is released and the password field cleared afterwards. The full suite passes 52 tests.

### Bug record: password policy lowered to 7–25 and PBKDF2 error logs are debug-only

- **Reported symptoms:** the owner and client sign-in forms forced 12–128-character passwords, and every server-side catch site around `tele_admin_users` (read, seed, verify) called `console.error('…', cause)` with the full cause object. On a deployment that mis-seeded a row (e.g. a hash that wouldn't re-parse) the Workers log carried the full stack with the cause attached, and shorter passwords that a real practice was comfortable with were rejected before they ever reached the hash step.
- **Root cause:** the policy came from a single set of constants — `12`/`128` literals in the builder's `ADMIN_PASSWORD_POLICY` regex, in `ownerPasswordProblem` and `registerProblem` in both runtimes, in the `<input minlength="12" maxlength="128">` attributes on `admin.html` and `appointments.html`, in the shared `admin-security.js` `verifyPasswordHash` length guard, and in the `current_code.md` policy line. The error-log shape was always `console.error(label, cause)`, so on any transient failure the entire cause (including any underlying message) was emitted to the platform log.
- **Fix (historical):** the password floor was then **7 characters** and the ceiling **25** for every sign-in form. **Current code (2026-10-16): 8–25** (`PASSWORD_MIN = 8`; amendment later in this record). The rest of that pass: owner sign-in, the owner "change password" panel, public client sign-up, and the client sign-in. The owner policy still requires a lowercase letter, an uppercase letter, a number and a symbol; the client policy enforces length only *(superseded 2026-10-15: client passwords now require the same four character classes as the owner — Rule A1 in `system-rules.md`)*. The 7/25 values are the named constants `PASSWORD_MIN`/`PASSWORD_MAX`, and since the 2026-10-15 follow-up below they are defined **once** in `public/_scaffold/templates/shared/lib/admin-security.js` and imported by both runtimes, so every validation site and the shared `verifyPasswordHash` guard read one definition. The generated site's HTML `minlength`/`maxlength` attributes (`admin.html`, `appointments.html`) and the builder `setCustomValidity` text were updated in step; the builder's own `index.html` was missed and is corrected in the follow-up bug record below. The owner seed write was also moved from `ON CONFLICT (site_id) DO NOTHING` to `ON CONFLICT (site_id) DO UPDATE … WHERE tele_admin_users.updated_at = tele_admin_users.created_at`, so a redeploy with a new builder password no longer leaves the first build's hash in place; the dashboard's account panel still stamps `updated_at = now()` on every owner change, so an owner-changed password is still never overwritten. PBKDF2 error logs now go through a `debugError(label, cause)` helper that prints a one-line summary by default (`label` + `cause.name`/`cause.code`) and only emits the full cause object when `DEBUG_OWNER=1` (or `WORKER_DEBUG=1`) is set on the Worker (Cloudflare) or in the Vercel environment. The helper is used at every password-related catch site: the `tele_admin_users` read, the seed write, and the shared `admin-security.js` length guard.
- **QA coverage (that pass):** 7 characters was accepted, 6 rejected, 25 accepted, 26 rejected, the owner seed re-applied on redeploy, an owner-changed password was preserved, and `npm test` was green. **Current code (2026-10-16):** 8 is the floor (7 is rejected). The debug helper is unit-tested to assert that without the flag the log entry contains only the safe summary, and with the flag the full cause is included.

### Bug record: the builder's own admin-password form still enforced the retired 12–128 range (2026-10-15)

- **Reported symptom:** a re-audit of every site that states a password length found the rule was **not** uniform. The JavaScript had moved to 7–25, but the builder form the operator actually types into — `public/index.html` — still carried `minlength="12" maxlength="128"` on both `#adminPassword` and `#adminPasswordConfirm`, and its visible label still read "Admin password **(12–128 characters)**". `README.md` still documented "Passwords must be 12–128 characters".
- **Why it mattered:** native HTML constraint validation runs **before** any JavaScript, so `validateAdminAccount()` in `public/app.js` never got a chance to run. An operator who typed a valid 7-character password such as `Abcde1!` was blocked by the browser with "Please use at least 12 characters" and could not submit the form at all, while the server (`public/package-core.js`) and both generated runtimes would have accepted it. Conversely `maxlength="128"` let an operator type up to 128 characters that `ADMIN_PASSWORD_POLICY` (`.{7,25}`) then rejected with a message contradicting the label directly above the field. The builder was therefore the one place where the documented rule and the enforced rule disagreed.
- **Root cause:** the 7–25 change updated the two *generated-site* templates (`admin.html`, `appointments.html`) and all the JavaScript, but the builder's own `index.html` was not part of that sweep. Nothing in the test suite read the builder form's password attributes, so the stale values survived unnoticed. A second, related weakness: `PASSWORD_MIN`/`PASSWORD_MAX` were declared **independently** in `cloudflare/src/index.js` and `vercel/api/index.js`, and `shared/lib/admin-security.js` hard-coded `7`/`25` as literals — three copies that could each drift.
- **Fix (historical):** `public/index.html` then used `minlength="7" maxlength="25"` and the label "(7–25 characters)"; helper text "Use 7–25 characters…". **Current code (2026-10-16): `minlength="8"` and "(8–25 characters)".** At that pass the helper text matched `setCustomValidity`, `README.md` documented 7–25 as the same range the generated site enforces for owner sign-in and client sign-up. The constants were consolidated in that pass as `PASSWORD_MIN = 7` / `PASSWORD_MAX = 25`, exported **once** from `public/_scaffold/templates/shared/lib/admin-security.js`. **Current code (2026-10-16): `PASSWORD_MIN = 8`.** `verifyPasswordHash` uses the constants instead of literals, and both runtimes import them (`import { createAdminSession, PASSWORD_MAX, PASSWORD_MIN, verifyAdminSession, verifyPasswordHash } from '../lib/admin-security.js';`) with no local `const PASSWORD_MIN` / `PASSWORD_MAX`. Changing the rule is a one-line edit in one file for the generated runtimes.
- **Canonical inventory (seven sites; that pass 7–25, current code 8–25):** `public/app.js` `ADMIN_PASSWORD_POLICY` regex `.{8,25}` (builder client) · `public/package-core.js` `passwordLength < PASSWORD_MIN || passwordLength > PASSWORD_MAX` (builder worker) · `public/index.html` `minlength="8"` / `maxlength="25"` on `#adminPassword` + `#adminPasswordConfirm` · `shared/lib/admin-security.js` `PASSWORD_MIN`/`PASSWORD_MAX` + `verifyPasswordHash` guard (**single source of truth**) · `cloudflare/src/index.js` and `vercel/api/index.js` `ownerPasswordProblem` + `registerProblem`, both reading the imported constants · `shared/public/admin.html` login form, account panel, and `shared/public/appointments.html` client sign-in + sign-up attributes. Owner and client **creation** require one lowercase letter, one uppercase letter, one number and one symbol; `verifyPasswordHash` checks length only. There is no separate client range.
- **QA coverage (that pass):** three tests in `test/builder.test.js` then pinned 7–25 (`minlength="7"`, reject 6 and 26, **106/106**). **Current code (2026-10-16):** those tests pin **8–25** (`minlength="8"`, reject 7 and 26). `npm test` is **135/135**.

- **Amendment (2026-10-15, later): password floor raised to 8 and verification made constant-time throughout.** The range is now **8–25** for every user type. The change is one line at the source of truth (`PASSWORD_MIN = 8` in `shared/lib/admin-security.js`) plus every surface that re-states the rule: the `ADMIN_PASSWORD_POLICY` regex and `setCustomValidity` text in `public/app.js`, the builder form's `minlength` attributes and "(8–25 characters)" label in `public/index.html`, the `minlength` attributes and placeholders in `admin.html` / `appointments.html`, `README.md`, and — closing the last literal copy — `public/package-core.js`, whose `normalizeAdminAccount` previously hard-coded `passwordLength < 7 || passwordLength > 25` and now imports `PASSWORD_MIN`/`PASSWORD_MAX` from `admin-security.js` like everyone else. **Migration consequence, deliberate:** `verifyPasswordHash` enforces the range at verification time, so an account created under the 7–25 rule with a 7-character password can no longer sign in after redeploying a regenerated package; that account needs a password reset (owner: rebuild with a new builder password or change it from a still-valid session; client: re-register/reset through the practice). **Constant-time verification** was then audited across all three implementations — `verifyPasswordHash` in the shared lib (owner), and each runtime's local `passwordMatches` (clients). All three already compared digests in constant time (`constantEqual`, or `timingSafeEqual` on Vercel), but all three *early-returned* on a malformed stored hash or an out-of-policy candidate, skipping the PBKDF2 derivation entirely — so response timing revealed which check failed. They now always derive (with a fixed dummy salt and the default iteration count standing in when the stored parameters are unusable) and always run the constant-time comparison; the well-formedness and length guards still decide the result afterwards. The two client sign-in routes additionally verify against a `DUMMY_PASSWORD_HASH` when the email has no account, so an unknown email and a wrong password cost the same PBKDF2 and return the same 401 — sign-in timing no longer reveals whether an account exists. `constantEqual` is now exported from `admin-security.js` so the comparison itself is unit-testable. **QA coverage:** the three builder tests above were re-pinned to 8–25 (the boundary test now builds with an 8-character password and rejects 7 and 26 through the real `/api/generate` route), and new `test/password-security.test.js` (7 tests) asserts the constants, accept/reject behaviour at both boundaries, rejection of wrong passwords at any length, verification-time rejection of 7- and 26-character candidates even against hashes genuinely created from them, rejection of ten malformed hash shapes plus non-string candidates, `constantEqual` semantics, and — structurally, not by clock — that both runtimes' `passwordMatches` derive before deciding, use the constant-time comparators, contain no early return before the derivation, and wire the dummy hash into the client sign-in route. `npm test` was green at **125/125**. **Current suite (2026-10-16): 135/135**, `PASSWORD_MIN = 8` for every user type.

The implementation was adapted from the user-provided `axelmercer253/brivon` repository. That repository labels the template free in source comments and documents its bundled images as Pexels-licensed, but it does not contain a general code-license file. This implementation does not copy the repository's photo assets; the hero uses original CSS artwork and the gallery/journal use the generated site's existing content assets.

## Page editor (builder)

The builder's site layout section ("Choose a Site Layout") has a **Page editor** text link that opens `/page-editor.html` in a new tab. The editor tab loads the exact document the builder preview is currently rendering — the builder stashes the rendered preview HTML plus the applied edit list in localStorage on every render (`canopy-preview-html`, `canopy-preview-meta`) — and falls back to building the preview locally from the saved builder configuration when no builder tab stashed one. Plain-text elements (headings `h1`–`h8`, paragraphs, list items, spans, labels and similar) can be clicked and edited inline. Elements carrying inner markup (icons, links) are never editable, so an edit cannot destroy markup, and newlines in the edited text become `<br>` so line structure survives.

Each text edit is recorded as `{ selector, index, text }`; a paragraph/section deletion is `{ selector, index, remove: true }`: a restricted simple selector (`#id`, `tag`, `tag.class`, `.class`, up to three classes) plus the element's position among that selector's matches **outside the excluded live-data regions** (`siteNav`, `drawerNav`, `editorialSiteNav`, `galleryGrid`, `postGrid`, `paymentDetails`, `footerPayments`, the CTA ids `headerCta`/`heroBook`/`articleBook`/`editorialSidebarCta`, `articleModal`, `siteToast`). Those regions are regenerated from the builder configuration in the preview and re-rendered by the generated site at runtime, so their content differs between the preview document and the packaged homepage. Excluding them from both the editor's index computation and the core's `applyPageEdits` matcher (one shared `PAGE_EDIT_EXCLUDED_IDS` list in `shared/public/page-edits.js`, re-exported by `public/package-core.js`) is what makes a selector+index pair mean the same element in the editor, the preview and the ZIP.

The **Export to builder** button first stores the validated edits in the local builder configuration (without a database URL), then posts the edits to the builder tab over a `BroadcastChannel` (`canopy-page-editor`). The builder validates them (`normalizePageEdits`), applies them to its configuration, persists the configuration (localStorage) and re-renders the preview immediately, saves them server-side, shows an "N edits applied" note with a "Clear edits" button next to the layout controls, and acknowledges the message so the editor tab closes itself. If no builder tab answers within six seconds, the editor attempts a backup through the same builder endpoint; the edits already remain in local configuration for the next Generate. Missing BroadcastChannel support or failed server backup cannot silently discard that local export. **This button does not save to or deploy an existing practice website.** Deployed-site page editing instead uses the owner dashboard’s **Pages → Save page** workflow below; blog articles use **Save post**.

Server side, `POST /api/page-editor` (CSRF-protected like `/api/generate`, bounded 256 KiB body) validates the site id and edit list, then stores `{ siteId, edits, updatedAt }` in the `builder_page_edits` PostgreSQL table through Neon when `DATABASE_URL` is configured. `GET /api/page-editor?siteId=` returns the saved record (404 when none). Without `DATABASE_URL`, the routes return 503 with a clear message and the builder keeps working — exports apply locally, only server-side persistence is skipped. The root Wrangler config does not declare a KV binding.

The same validated edit list flows into both build paths of the shared core (`public/package-core.js`): `buildPreviewDocument` applies it last (an edited element wins over config-derived text), and `buildFiles` applies it to the packaged homepage — `index.html`, or the Brivon design file that replaces it for `brivon-dark`/`brivon-light` — so the downloaded source code carries exactly the text the preview showed. `configForPackage` snapshots the edits at Generate click time and `livePreviewConfig` carries them to the preview, so the prepared ZIP always reflects the latest UI state: any control change re-renders the preview, and the next Generate packages that state.

## Stress test — 40 concurrent generation users

`test/stress-generate.test.js` fires **40 simultaneous users** at the real Worker fetch handler: each user gets their own CSRF session (cookie + token), half build the Vercel target and half the Cloudflare target, and all 40 `POST /api/generate` requests run concurrently. The test asserts that concurrency corrupts nothing: 40/40 return 200 with a valid ZIP, every ZIP carries its own user's practice name and site id, and every build gets its own freshly generated `CSRF_SECRET` and `ADMIN_PASSWORD_HASH` (no shared state between concurrent builds). It reports per-build p50/p95/max latency and fails if the wave exceeds 120 s.

Results (2026-10-09, Node 22): **in-process Worker — 40/40 ok in ~1.3–1.5 s wall, p50 ~1.2–1.4 s, p95 ~1.4 s, max ~1.4 s per build. Live `wrangler dev` over real HTTP — 40/40 ok in ~2.5 s wall, p50 ~1.9 s, p95 ~2.1 s, max ~2.1 s per build, ~423 KiB average ZIP.**

Scope note: on the deployed Workers Free plan the platform kills each server-side build that exceeds 10 ms of CPU (error 1102) — a per-request platform cap, not a concurrency defect. The builder's browser fallback absorbs those refusals; on Workers Paid the server path serves concurrent users directly. The stress test proves the Worker code itself is safe under 40-way concurrency (stateless builds, per-session CSRF, distinct outputs).

**Status:** Code-derived documentation for the current repository state, updated 2026-10-09. This describes what the implementation does; it is not a deployment record or a claim that a live site/database has been tested. The repository has no separate implementation-plan Markdown file; the root `README.md` and the generated README text in `public/package-core.js` were checked against the code.

## 1. What this repository builds

Canopy Studio is a stateless website builder. It serves its browser UI and accepts a configuration to produce a ZIP containing one practice-site runtime: **Vercel** or **Cloudflare Workers**. Generating a ZIP does not deploy or publish the site. The builder itself does not use Neon or retain practice appointments.

Main implementation points:

- `src/index.js` serves the builder assets, issues builder CSRF tokens, and handles `POST /api/generate`.
- `src/generator.js` validates the setup, normalizes the site configuration, creates deployment secrets, reads the scaffold templates, and builds the ZIP.
- `public/app.js` controls the builder and live preview; `public/download.js` implements the testable Generate-button CSRF and ZIP-fetch flow.
- `public/_scaffold/templates/manifest.json` lists the files included in each generated target.
- Shared site code lives under `public/_scaffold/templates/shared/`; runtime-specific code lives under `.../vercel/` and `.../cloudflare/`.

## 2. Builder input, validation, and secret handling

### Site setup

The builder normalizes the practice identity, specialty, theme, features, payment details, custom pages, menu links, and time zone before creating a package. The practice identity panel accepts an IANA time-zone identifier (default `Asia/Manila`); it is saved with the other non-secret builder settings, controls local appointment dates and dashboard-path rotation, and is included in both Vercel and Cloudflare ZIP configurations. Invalid time zones are rejected before generating a package. A database URL is optional at ZIP-generation time. If omitted, the generated environment file contains a clearly marked placeholder; database-backed scheduling and account features require a real Neon connection string and the schema to be installed.

The builder removes `sslmode` and `channel_binding` query parameters from a pasted PostgreSQL URL because the generated Neon serverless client uses HTTPS. The database URL is held in browser memory for the current tab and is excluded from the builder's saved local-storage configuration. The owner password is collected from form fields and is not part of that saved configuration.

### Owner credentials

Before building a ZIP, the builder enforces these rules:

- Username: 3–64 characters; starts with a letter or number; otherwise letters, numbers, dots, underscores, or hyphens.
- Email: valid email format, up to 254 characters.
- Password: 8–25 characters with at least one lowercase letter, uppercase letter, number, and symbol.

The 8–25 range is identical for **every** user type — the builder operator's admin password, the generated site's owner sign-in and "change password" panel, and public client sign-up and client sign-in. Since the 2026-10-15 amendment below, the character-class requirement is identical too: **every** password (owner and client alike) must contain one lowercase letter, one uppercase letter, one number and one symbol; the runtimes' `registerProblem` enforces the same four classes for client sign-up that `ownerPasswordProblem` enforces for the owner. The two numbers are defined once as `PASSWORD_MIN` / `PASSWORD_MAX` in `public/_scaffold/templates/shared/lib/admin-security.js` and imported by both generated runtimes **and** by the builder's `public/package-core.js`; the builder additionally enforces the same range through the `ADMIN_PASSWORD_POLICY` regex in `public/app.js` and the `minlength`/`maxlength` attributes on the two password inputs in `public/index.html`. Password verification is constant-time everywhere (see the 8–25 amendment in the bug record below): verifiers always run the PBKDF2 derivation and compare digests with `constantEqual`/`timingSafeEqual`, and the client sign-in routes verify against a dummy hash when the email has no account so sign-in timing cannot reveal whether an account exists. See the bug record *"the builder's own admin-password form still enforced the retired 12–128 range"* for the full inventory of all seven enforcement sites and the regression tests that keep them aligned.

The raw password is used in memory to create a salted PBKDF2-SHA-256 hash (210,000 iterations). Generated packages put the hash—not the raw password—in `.env` (Vercel) or `.dev.vars` (Cloudflare). They also receive a fresh `CSRF_SECRET`; Vercel packages receive a separate `CRON_SECRET`. These values go into ignored environment files and are not written into public site configuration or `db/seed.sql`.

### Builder CSRF and request size

The builder uses an HttpOnly, SameSite=Strict double-submit CSRF cookie and checks the request origin/fetch metadata. Each Generate-button click requests a fresh token using same-origin credentials and no-store caching; the client retries once with a second fresh token if `/api/generate` returns 403, then reports the refusing endpoint and status. HMAC signing is optional for the builder deployment; it is not the same secret as a generated site's `CSRF_SECRET` (optional there too: when unset, the runtime derives a secret from `DATABASE_URL`). There is no permissive CORS configuration. Builder JSON requests are capped at 256 KiB while being read, not only after buffering the full body.

## 3. Generated site owner access

Owner access is implemented in both generated targets; it is not a link in the public site's navigation. Each generated package includes the owner dashboard HTML, CSS and JavaScript, plus backend login/session routes. The generated package's `README.md` prints the dashboard path for the date it was built, and explains how to calculate the new path after local midnight. Vercel redirects `/admin.html` to the public home page, and Cloudflare returns 404 for it. Unauthenticated session checks and stale Cloudflare dashboard paths do not disclose the current path; the session route returns the current path only after authentication, so a signed-in owner can follow it when the date changes.

The owner signs in with the username and password entered in the builder. The runtime resolves the account from the `tele_admin_users` row for the site, which the first database request seeds from the deployment's `ADMIN_USERNAME`/`ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH` values; after the row exists the database is authoritative, so the owner can change the username, email or password from the dashboard's Sign-in panel and a redeploy never overwrites a changed account. Password checks use the stored salted PBKDF2 hash; credentials are never prefilled into the login form. A signed owner session is stored in an HttpOnly, SameSite=Strict cookie. The session lasts 12 hours and is bound to the normalized username, password hash, and the CSRF secret (explicit `CSRF_SECRET` or the value derived from `DATABASE_URL`); changing any of those invalidates existing sessions. HTTPS is detected from the request URL, `X-Forwarded-Proto`, Vercel `req.secure`, or Cloudflare `CF-Visitor`. On HTTPS the runtime sets both `__Host-canopy_owner` (Secure) and `canopy_owner` (Secure); on HTTP only `canopy_owner`. `ownerSessionToken()` reads either name. `POST /api/admin/login` returns `authenticated: true` and `dashboardPath` so the UI can move to today's path. Password hashes strip wrapping quotes before verify; a malformed database hash falls back to a well-formed `ADMIN_PASSWORD_HASH`. If the database read fails, sign-in falls back to the `ADMIN_*` environment values when they are complete. `CSRF_SECRET` is optional: when it is unset the runtime derives a stable private secret from `DATABASE_URL`, and forms report a configuration error only when neither value exists. Owner changes to site settings and CMS data require a working `DATABASE_URL`; the schema is applied by the runtime itself on first use, so an empty database is enough.

The dashboard path rotates by local date in the practice site's configured time zone (default `Asia/Manila`). The Monday-first sequence is:

| Day | Animal | Path prefix character |
|---|---|---|
| Monday | dog | g |
| Tuesday | rat | t |
| Wednesday | ant | t |
| Thursday | fish | h |
| Friday | fly | y |
| Saturday | cat | t |
| Sunday | cockroach | h |

The path is `/<animal's last letter>admin<day-of-month>/dashboard`; for example, Tuesday the 8th is `/tadmin8/dashboard`. This rotating path is an obscurity measure, **not** authentication. Username/password login and the signed session are the access control. On Vercel, the generated rewrite serves the dashboard shell at any dated path and `/admin.html` redirects to the public home page. On Cloudflare, any `*adminN/dashboard` path serves the login/dashboard shell (so a yesterday bookmark still shows the form); a signed-in owner on a stale path is redirected to today. Direct `/admin.html` is never served.

The owner dashboard exposes the site identity, menu, appearance, blog, gallery, availability, appointments, and payments areas. Owner write actions use CSRF protection and an authenticated session. `test/builder.test.js` verifies that both generated ZIP targets include the login page, dashboard sections, and private admin settings; `test/admin.test.js` covers the dashboard-path calculation and validation. This package-level and helper coverage is not a claim that a production deployment or live database has been tested.

## 4. Menu and custom-page rules

The default public navigation has seven links. The owner can rename, reorder, add, or remove links, up to 16. Generated custom pages receive corresponding menu links. Menu settings are saved with the site's configuration in Neon.

Allowed destinations are same-site paths or HTTPS URLs. Protocol-relative URLs, non-HTTPS external URLs, URLs containing credentials, control characters, and unsafe schemes are rejected. Optional feature links (gallery, blog, scheduling) are hidden when that feature is disabled.

## 5. Appointments and payment-proof lifecycle

Database-backed client accounts and appointments are served by both generated runtimes. Client passwords are stored as password hashes; session tokens are stored hashed in the database. A client must sign in to reserve a slot and view their consultations.

### Booking and proof

1. A successful reservation creates a confirmed appointment with `payment_status = 'awaiting_proof'`, the selected GCash or Maya method, and `payment_due_at = now() + 15 minutes`.
2. The 15-minute point is a **review threshold**, not an automatic cancellation deadline. The appointment and its time slot remain reserved unless the client or owner cancels/releases it.
3. Clients can upload PNG, JPEG, or WebP proof images up to 3 MiB. The server checks the image signature against the declared MIME type and stores the image privately as base64 in `appointment_payment_proofs`; it is not put in public site assets. There is at most one proof per appointment.
4. A normal upload changes the appointment to `pending_review`. The owner can approve it (payment becomes approved) or reject it (payment is marked rejected and the booking is cancelled/released).
5. If the booking is still active and awaiting proof, upload is not blocked just because 15 minutes have passed.

### Twelve-minute client reminder

If proof is still missing after 12 minutes, a one-shot `payment_reminder_sent_at` timestamp is recorded. The client dashboard uses that timestamp and the appointment's due time to show a reminder; it refreshes while the dashboard is visible. This is an in-dashboard reminder, not email or push delivery.

If the owner manually marks a payment received before proof is uploaded, the appointment is still eligible for that reminder. The owner action sets `payment_status = 'approved'` and `payment_manual_received_at`; if the proof is still missing at 12 minutes, the client sees the reminder and can attach a screenshot while the booking remains active. That late attachment is recorded as approved and does not undo the owner's payment confirmation.

### Fifteen-minute automatic drop and owner notification (amended 2026-10-15)

At or after `payment_due_at` (15 minutes after booking), an active appointment that is still awaiting proof and has no proof is **dropped by the scheduler**: `status` becomes `'cancelled'`, `payment_status` becomes `'expired'`, and `payment_owner_attention_at` is stamped in the same statement. That stamp is the **owner notification** — the dashboard's **Dropped Bookings** list (`GET /api/admin/payments/dropped`) is built from exactly these rows, so the owner sees the drop, with the client's booking phone number, the moment the sweep commits. The **client is notified on site too**: the booking appears in their appointment list as "Slot released" with the message that the time is no longer reserved and they should choose another open time. (Before this amendment the 15-minute mark only stamped the owner marker and never cancelled; the automatic drop was requested explicitly and replaces that behaviour. On Vercel's daily cron the drop lands up to a day late — see §6.) Before the window closes, from the owner payment view the owner can still:

- **Mark received:** only for an active booking with no uploaded proof; keeps the booking active and marks payment approved.
- **Release booking:** cancels the appointment so the slot can be offered again.

The schema contains the payment columns, private proof table, indexes, and idempotent migrations. `db/schema.sql` is safe to rerun; `db/seed.sql` loads generated site configuration and starter content.

## 6. Schedulers and deployment behavior

The two hosted runtimes use their native scheduled triggers. Their cadence differs by target and plan:

- **Vercel:** `vercel.json` schedules `GET /api/internal/payment-sweeps` **once daily at `0 0 * * *` (00:00 UTC)** — not every minute — so the package can deploy on the Vercel Hobby plan, which only allows daily cron jobs. The endpoint requires `Authorization: Bearer <CRON_SECRET>`. With that cadence the persisted 12-minute client-reminder marker — and, since the 2026-10-15 amendment, the 15-minute automatic drop — are applied up to about a day late; the client and owner UIs still show the reminder state on time because both compute it from `payment_due_at` as well as from the markers. On Vercel Pro/Enterprise, change the schedule to `* * * * *` for minute-level checks (the generated package README says the same).
- **Cloudflare Workers:** `wrangler.jsonc` registers a `* * * * *` cron trigger; the export's `scheduled()` handler runs the reminder checks every minute. It runs them against the **raw** Neon client (`rawSql(env)`) and deliberately does **not** bootstrap the schema — see the subsection below for why that distinction matters.

A standalone `payment-reminder-worker.js` is included in both target packages. Run `npm run payments:worker` under a process manager on an always-on Node.js host for 90-second client-reminder checks and 180-second dropped-booking checks. This script is not automatically started by Vercel serverless functions or Cloudflare Workers. Native scheduler frequency and availability still depend on the hosting plan. The Vercel worker script uses Node's `--env-file` flag (package engine `>=20.6`); the Cloudflare package specifies Node `>=22` for Wrangler.

### The cron sweep must never bootstrap the schema (undocumented until 2026-10-15, and it was a live bug)

Both runtimes expose two different database clients, and the difference is load-bearing for the schedulers:

- **`sql(env)` / `getDb()` — the bootstrapping client.** Every query first `await`s `ensureSiteRow()` → `ensureSchema()`, which runs the whole of `db/schema.sql` — **59 statements, ~16.3 KB** after `splitSqlStatements()` (mixed `CREATE TABLE` / `ALTER TABLE` / `CREATE INDEX` / `DO $$`; the file text has 12 `CREATE TABLE` lines, some inside `DO` bodies) — inside **one transaction**. `ensureSiteRow()` then upserts `tele_sites` with `ON CONFLICT (site_id) DO UPDATE SET config = EXCLUDED.config WHERE updated_at = created_at`. This is what request handlers use, so a fresh deployment creates its own tables on first contact.
- **`rawSql(env)` / `createNeonClient(process.env.DATABASE_URL)` — the raw client.** No bootstrap, no site row. This is what the schedulers use.

**Why the schedulers must use the raw one.** A Cloudflare cron trigger (and a Vercel cron invocation) runs in a **fresh isolate / cold start**, so the module-level memos that make the bootstrap cheap — `schemaReady`, `schemaFailures`, `siteRowReady` — are **always empty on a cron tick**. They only persist for the lifetime of one isolate, which for a request handler is long enough to matter and for a once-a-minute cron is not. The consequence of routing the sweep through the bootstrapping client was that **all 59 DDL statements re-ran, in a single transaction, every 60 seconds, forever.**

That is not merely wasteful, it is a correctness bug, and it is the cause of the reported "error in cron when registering a user":

1. `ALTER TABLE` takes an **ACCESS EXCLUSIVE** lock and `CREATE INDEX` takes a **SHARE** lock; both conflict with the **ROW EXCLUSIVE** lock an `INSERT` needs.
2. Because the statements run inside one transaction, every lock is held until the transaction commits — so for the whole duration of the bootstrap the tables are write-blocked.
3. A client registering at that moment issued `INSERT INTO tele_client_accounts …` and **blocked behind the cron's DDL lock**. Nothing in `db/connection.js` sets a `lock_timeout` or `statement_timeout`, so the wait ran until the Neon HTTP driver gave up and `/api/auth/register` answered **503 "Could not create the client account. Check that the appointment database is reachable."**
4. On the every-minute Cloudflare cadence that collision window recurred continuously, so signup failed intermittently on an otherwise healthy deployment with a correct `DATABASE_URL`.
5. The `schemaFailures > 1` "give up after two failures" guard never engaged on the cron path either, because the counter is module state and the isolate is new each tick.

**The fix (2026-10-15).** Both schedulers now use the raw client:

- Cloudflare `scheduled()` calls `runPaymentReminderChecks(rawSql(env), SITE_ID)`.
- The Vercel `/api/internal/payment-sweeps` route calls `runPaymentReminderChecks(createNeonClient(process.env.DATABASE_URL), SITE_ID)` instead of `getDb()`.

This is safe because the sweep is only two `UPDATE tele_appointments … SET payment_*_at = now()` statements scoped by `site_id`. They need no `tele_sites` row and traverse no foreign key, so skipping `ensureSiteRow()` changes nothing about their result — they simply take row-level locks like any other write. Schema creation is still guaranteed: the **first real request** (a registration, a booking, an owner save) goes through the bootstrapping client and creates the tables, exactly as before. The standalone `payment-reminder-worker.js` already used the raw client, which is the pattern the two cron handlers were corrected to follow.

**Missing-schema handling.** On a deployment nobody has visited yet the tables genuinely do not exist and the sweep raises Postgres `42P01` (`undefined_table`). That is a *state*, not a failure, so it is now reported quietly instead of as an error every minute: Cloudflare logs `[payment-reminders] schema not applied yet; skipping this sweep` at `info` level, and the Vercel route answers `200 { ok: true, reminders: 0, ownerFollowups: 0, skipped: 'schema not applied yet' }` so the cron dashboard stays green. Any other error still logs and (on Vercel) answers 503.

**Rules the sweep obeys** (as amended 2026-10-15, asserted in `test/cron-sweep.test.js`): it issues exactly two statements, both `UPDATE tele_appointments`, both parameterised with a single `site_id`, both returning `appointment.id, appointment.client_account_id`; it opens **no transaction** and never deletes a row. The first statement only stamps `payment_reminder_sent_at` and never cancels. The second — `markDroppedBookings` — is the **only automatic cancellation in the system**: it sets `status = 'cancelled'`, `payment_status = 'expired'` **and** `payment_owner_attention_at = now()` in one statement (the stamp is the owner notification; see the timeline below). Both statements exclude `status = 'cancelled'` and skip any appointment that already has a row in `tele_appointment_payment_proofs` — a booking with a proof can never be dropped. The client reminder keys off `created_at <= now() - interval '12 minutes'` and covers `awaiting_proof` **or** an owner-approved booking with `payment_manual_received_at IS NOT NULL`; the drop keys off `payment_due_at <= now()` and covers `awaiting_proof` only.

**QA coverage:** `test/cron-sweep.test.js` (8 tests). It models Postgres' lock-conflict matrix and runs the real `runPaymentReminderChecks` through a recording fake client, asserting every statement takes only `ROW EXCLUSIVE` and that a registration `INSERT` interleaved with a sweep is never blocked; a companion test replays the *old* DDL-in-one-transaction behaviour through the same model and asserts it **does** block, so the conflict is demonstrated rather than merely described. Two static tests pin each cron handler to the raw client and assert that `rawSql` contains no `ensureSchema`/`ensureSiteRow` while `sql(env)` does, and that both handle `42P01`. Two more pin the documented cadences to the shipped config — `* * * * *` in `wrangler.jsonc`, `0 0 * * *` in `vercel.json`, `90_000`/`180_000` in both standalone workers — and cross-check the same numbers against this file, so the documentation and the code cannot drift apart silently.

### When the cron actually fires against a booking (firing timeline, verified 2026-10-15)

The sweep *ticks* on the cadence above (every minute on Cloudflare), but it only *touches* a booking when that booking crosses one of two ages. Relative to a booking created at **T+0** (the booking `INSERT` sets `payment_status = 'awaiting_proof'` and `payment_due_at = now() + interval '15 minutes'`):

| Booking age | What the sweep does | Effect on the client |
|---|---|---|
| T+0 to T+12 min | Nothing. Neither condition matches: the reminder needs `created_at <= now() - interval '12 minutes'`, the drop needs `payment_due_at <= now()`. | Booking returns 201; the Upload payment proof panel is shown immediately (it is gated on `payment_status`, not on any cron marker). |
| T+12 min | Stamps `payment_reminder_sent_at` (client reminder), if no proof exists yet. | None on the pay button. The client UI also computes "reminder due" locally as `Date.now() >= paymentDueAt - 3 min` — the same instant by arithmetic — so banner and marker agree. |
| T+15 min | **Drops the booking** if still `awaiting_proof` with no proof: `status = 'cancelled'`, `payment_status = 'expired'`, and `payment_owner_attention_at` stamped in the same statement (**amended 2026-10-15**; previously this tick only stamped the owner marker and never cancelled). | The slot is released. **Owner notified:** the booking appears under **Dropped Bookings** in the dashboard with the client's phone number. **Client notified:** the booking shows "Slot released — this appointment time is no longer reserved. Choose another open time to book again." |
| Any time after | No-op for that booking: both conditions also require the marker `IS NULL` and `NOT EXISTS` a proof row. | — |
| Client uploads proof before the drop | The sweep stops matching the booking from that tick on (proof exists; the upload also flips `payment_status` to `'pending_review'`, leaving both conditions false), so it can never be dropped afterwards. | Upload returns 201 `{ status: 'pending_review' }`. |
| Client uploads proof after the drop | The booking is already `cancelled`/`expired`; the proof statement matches nothing. | Upload rejected **409** — "The practice has released this booking. Contact the practice if you already sent payment." |

Two properties make the pay button safe at every point on this timeline, and both are now exercised against a real Postgres rather than argued from the SQL:

1. **The proof route enforces the deadline only through the drop.** `POST /api/client/appointments/:id/payment-proof` requires `status <> 'cancelled'`, `payment_status = 'awaiting_proof'` (or owner-approved with `payment_manual_received_at`), and no existing proof row. It never reads `payment_due_at` itself — the deadline bites because the cron has already cancelled the booking at T+15 min, so a proof uploaded after the drop matches nothing and is answered 409, while any proof uploaded *before* the drop (even at T+14 min, after the reminder stamp) is accepted and makes the booking undroppable.
2. **The booking route has no interaction with the sweep.** `POST /api/appointments` inserts a brand-new row; the sweep only `UPDATE`s rows that are already 12+ minutes old, takes row-level locks, and never holds a table lock — so under the fixed raw-client cron a booking cannot collide with a tick. (Under the *old* bootstrapping cron it could: the DDL transaction's `ALTER TABLE tele_appointments` blocked the booking `INSERT` the same way it blocked the registration `INSERT`, producing the 503 *"We could not reserve this consultation"*; the same window blocked the proof upload's `UPDATE`, producing *"Could not save payment proof."* Packages generated before the 2026-10-15 fix still contain that behaviour — regenerate the ZIP and redeploy to pick up the fix.)

**QA coverage:** `test/cron-workflow.test.js` (5 tests, PGlite — a real in-process Postgres, added as a devDependency for this). It extracts the actual booking and payment-proof statements from the shipped Cloudflare template, applies the generated package's own 59 `SCHEMA_STATEMENTS`, and walks the timeline above: book → tick at T+0 matches nothing → age to 13 min → reminder stamps → upload succeeds as `pending_review` → further ticks no-op. A second test ages a booking past *both* thresholds so one sweep stamps the reminder and drops the booking with the owner-notification marker set, then asserts a late upload matches nothing (the route's 409) and further sweeps no-op. A third runs a due sweep concurrently with a fresh booking and asserts both succeed. A fourth syntax-checks both shipped runtime templates (a duplicated trailing fragment once left both unparseable while the suite stayed green). A fifth asserts the Vercel template ships byte-identical booking and proof SQL (modulo parameter placeholders), so the timeline holds on both targets.

### `wrangler.jsonc` `vars` block is intentional — it is the production copy of `.dev.vars`

The Cloudflare scaffold at `public/_scaffold/templates/cloudflare/wrangler.jsonc` carries a `vars` block (placeholder `__WRANGLER_VARS__` in the source, replaced at build time with the actual JSON object). That block **is intentional** and must not be removed or "moved to secrets" by default:

1. **Cloudflare Workers need real values at deploy time.** `wrangler deploy` does not read `.dev.vars`; `wrangler secret put` is a separate interactive step that asks the operator to type each value into the terminal. Baking the values into `vars` makes the first deploy zero-config and keeps the owner dashboard's CSRF protection functional immediately after `npm run deploy`.
2. **The values are the same ones the operator already typed into the builder.** Treating them as "secrets" only at deploy time and then committing them to a public repo would be a worse failure mode than the current one — there is no "secret" phase in the first-deploy path.
3. **The generated `.gitignore` covers `wrangler.jsonc`** (F7 fix), so a customer's first `git init && git add . && git push` does NOT commit the file. The on-disk file ships only so the Worker can read it. `wrangler.jsonc` is gitignored *alongside* `.dev.vars` precisely because both carry the same production values; ignoring only `.dev.vars` would create a false sense of security.
4. **Operators who want true secret management have an escape hatch.** Run `wrangler secret put DATABASE_URL`, `wrangler secret put CSRF_SECRET`, `wrangler secret put ADMIN_PASSWORD_HASH`, etc., delete the matching `vars` entries from `wrangler.jsonc`, and commit. The builder keeps the simpler default so the common case is "one `npm run deploy` and it works".

The token `__WRANGLER_VARS__` is replaced at build time by the builder with: `{ DATABASE_URL, ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD_HASH, CSRF_SECRET }`. The token is interpolated alongside the rest of the secret map (`replaceSecretTokens` in `public/package-core.js`), so the values are also written into `.dev.vars` in the same package — `.dev.vars` is gitignored for local development, `wrangler.jsonc vars` is the deploy-time read path.

## 7. Security and operational boundaries

- For deployment, set the values from the generated environment file in the host's environment/secrets settings. Wrangler does not upload `.dev.vars`; the Vercel `.env` file is for local use and its values must be configured in Vercel.
- Proof image reads are behind owner authentication and use private/no-store response headers.
- The generated Cloudflare package pins a `sharp` override to 0.35.5; the root dependency tree uses the same override.
- Payment account names/numbers in starter configurations are sample values and must be replaced before publishing.
- This starter is not a compliant electronic health record system.

## 8. Verification status

The repository test suite covers builder CSRF, Vercel/Cloudflare ZIP generation, full-page previews for all nine themes, homepage/template parity, the browser Generate helper's successful and retry paths, the Generate buttons' download click flow under a DOM stub (lockout guard versus the programmatic download anchor, for both build paths and targets), page-edit normalization/application (preview and packaged-homepage parity for every target and theme), the `/api/page-editor` save/load routes (CSRF enforcement, Neon-store round-trip through a tagged-SQL test double, error paths, and missing-`DATABASE_URL` 503), the page editor bridge (link, export apply + server save + acknowledgement, invalid payloads, clear edits), the Brivon h1–h8 heading rule in both the package and the preview, a 40-concurrent-user stress test of `/api/generate`, admin credentials/session utilities, menu normalization, payment-proof/reminder rules, the menu-href sanitizer parity between the shared lib and its two browser copies, the scheduler lock-safety and cadence rules in §6, the real-Postgres cron/booking/payment-proof workflow timeline in §6, the 8–25 password bounds with constant-time verification, and Bug Fix No. 204 packaging assertions. The suite passed **135 tests** when re-run on 2026-10-16 (`node --test test/*.test.js`). Earlier snapshots in the dated work lists below (69, 72, 78, 82, 106, 125, 127, 134) are historical. `npm audit` reports zero vulnerabilities, and `npm run check` passes the root builder's Wrangler dry run; that config reports the `ASSETS` binding only. Local Wrangler smoke coverage is recorded for the builder shell, all nine previews, both generated ZIP targets, and the page editor assets. No live Neon page-edit persistence round-trip is claimed here. The earlier repository audit also recorded generated-package syntax checks, a generated Cloudflare Wrangler dry run, runtime login/session smoke checks for both generated targets, and a Postgres-compatible PGlite schema/reminder/proof SQL smoke test.

No live Neon database, Vercel deployment, production Cloudflare deployment, or real hosted cron invocation has been tested. Those remain deployment checks, not verified behavior from this repository audit.

## QA record — page editor, Brivon heading spacing, stress test (2026-10-09)

QA'd on branch `arena/ec85247e-telepractice-studio`, commit `83ab2e4` ("Fix Generate download guard, add page editor, Brivon h1-h8 spacing, 40-user stress test"), for the page-editor / heading-spacing / stress-test work:

- `npm test`: **69/69 pass** in the current run — including page-edit behavior, page-editor bridge, Brivon h1–h8, Generate-download regression and 40-user stress tests.
- `npx wrangler deploy --dry-run`: passes; the root config exposes the `ASSETS` binding and does not require a KV namespace.
- Automated page-editor persistence tests exercise the Neon-backed SQL store with a tagged-SQL test double and verify that missing `DATABASE_URL` returns 503. No live Neon database round-trip is claimed. The test suite also verifies `/api/preview` and both `/api/generate` targets apply page edits, and that the packaged `brivon.css` carries the h1–h8 rule.
- Live 40-user stress over real HTTP: 40/40 valid ZIPs in ~2.5 s wall (numbers in the stress-test section above).
- Generated-package checks: ZIP homepages carry the exported edits for Vercel, Cloudflare and Brivon; the env file carries only the PBKDF2 hash; the raw password appears nowhere in the ZIP.

## Verification record — functionality scan (2026-10-11)

Scanned branch `arena/921a26d1-telepractice-studio` (from commit `09307c8`) to check every documented capability against a working implementation. Executed, not just read:

- `npm test`: **72/72 pass**, including the 40-concurrent-user stress test (40/40 valid ZIPs, ~1.5 s wall, p50 ~1.4 s).
- `npx wrangler deploy --dry-run`: passes and reports the `ASSETS` binding only. `npm audit`: zero vulnerabilities.
- Live builder over `wrangler dev`: builder shell and assets served; `/api/health` 200; all nine `GET /api/preview` themes return 200 with the matching `theme-*` class on a self-contained document (no `<script>`, no local asset URLs, sample SVGs inlined, Brivon linking Google Fonts); `/_scaffold/templates/**` is readable while every other `/_scaffold/` path and a traversal attempt return 404.
- `POST /api/generate` through the real CSRF route returned a 34-entry Vercel ZIP and a 33-entry Cloudflare ZIP. Both carried the Brivon homepage when `brivon-dark` was selected, the page edit, custom pages, `db/seed.sql`, the dated dashboard path in `README.md`, the PBKDF2 hash (never the raw password) in `.env`/`.dev.vars`, the Neon URL with `sslmode`/`channel_binding` stripped, a fresh `CSRF_SECRET` and (Vercel only) `CRON_SECRET`.
- Browser build path: `public/package-builder.js` over the served `/_scaffold/templates/` files produced the same entry list as the server build with byte-identical deterministic contents — only per-build secrets, `generatedAt`, `createdAt` and demo-post timestamps differ.
- Generated packages: every ESM file passes `node --check`; every relative import and every local `src`/`href` asset reference inside both ZIPs resolves.
- Both generated runtimes were started locally (Node 22): Vercel `node dev.js`, Cloudflare `wrangler dev`. Without a reachable Neon database they still served the public homepage, `/api/site` with no secrets, an unauthenticated `/api/admin/session` that omits the dashboard path, authenticated login with the builder credentials returning the dated path, Cloudflare 404 for `/admin.html` and for stale dashboard paths (302 to the current path once signed in), and a Vercel cron endpoint that answers 401 without a valid `Authorization: Bearer <CRON_SECRET>`.
- Every `/api/...` path called by the builder UI, the generated client UI and the generated owner UI exists in the server that must serve it; both generated runtimes expose the same route set apart from the Vercel-only sweep endpoint.

One documented claim did not match the code and was corrected in §6: the Vercel cron is scheduled `0 0 * * *` (daily, Hobby-compatible), not every minute. The suite count in §8 was also stale (69 → 72). `README.md`'s CSRF troubleshooting paragraph still quotes a builder message ("Set CSRF_SECRET as a Worker secret before using the builder") that no current code path can emit; it is explicitly scoped to older deployments, so it was left as a legacy note.

Not verified by this scan: any live Neon round-trip, a hosted Vercel or Cloudflare deployment, or a real cron invocation.

## Work list — deploy packaging, client signup and owner editing (2026-10-12)

Operator-reported items, with the root cause found for each and what was changed. All three were reproduced locally against real PostgreSQL (PGlite) running the *generated packages*, then re-verified after the fix.

### To-do list as reported

1. **"Fix the zipping of the packed code once the code deploy type is chosen."**
2. **"Double-check why the user can't sign up when the deployed code was pushed to the Cloudflare platform."**
3. **"Fix the signup and the functionality of admin login to edit the web app on the website admin page."**

### 1. Packaging / zipping — status: verified, two packaging defects fixed

The ZIP plumbing for the selected target was already correct: `public/zip.js` writes a standard store-method archive with a CRC-32 per entry, a proper central directory and a rejection of `..` path segments, and only the chosen runtime reaches the archive. Re-verified on the rebuilt packages — **14/14 ZIP checks per target**: server build returns `application/zip` under a filename matching the target; only the target's env file is present (`api/.env` for Vercel, `.dev.vars` for Cloudflare); the browser build and the server build produce the **same entry list in the same order**, with every deterministic entry byte-identical; no raw password; `lib/db-errors.js` shipped; `ensureSiteRow` and `articleGalleryRows` compiled into the runtime; `db/seed.sql` non-destructive; manifest `target` correct; the page edit applied and the custom page shipped; `DATABASE_URL` normalized (no `sslmode`/`channel_binding`). The five entries that differ between the two builds of the same configuration are volatile by design (fresh `CSRF_SECRET`, timestamps), not nondeterminism.

Two genuine packaging defects were found and fixed:

- **`db/seed.sql` was destructive on re-run.** It wrote the site row with `ON CONFLICT (site_id) DO UPDATE SET config = EXCLUDED.config`, so re-running the seed after the owner had edited the site silently reverted the live configuration to the build-time values. It is now `ON CONFLICT (site_id) DO NOTHING`, with a header explaining that it is optional starter content and safe to rerun (`public/package-core.js` → `createSeedSql`).
- **The ZIP manifest claimed the wrong runtime.** Every package (including Vercel ones) said `"generator": "Canopy Studio Cloudflare Builder"`. It is now target-neutral — `"generator": "Canopy Studio Builder"`, `version 1.3.0` — with `target` carrying the runtime.

The packaged `README.md` now states that `db/schema.sql` is required and safe to rerun, that the deployed site creates its own configuration row on first use, that `db/seed.sql` is optional sample content, and (Cloudflare) lists the exact `npx wrangler secret put …` commands with the message each missing value produces.

### 2. Why signup failed on the deployed Cloudflare package — status: root-caused and fixed

**Reproduced:** with a fresh Neon database that has `db/schema.sql` applied but not `db/seed.sql`, `POST /api/auth/register` answered **HTTP 503 `{"error":"Could not create the client account."}`** and the server log showed:

```
error: insert or update on table "client_accounts" violates foreign key constraint "client_accounts_site_id_fkey"
detail: Key (site_id)=(…) is not present in table "sites".
```

**Root cause:** the package's public configuration lives in one row of `sites`, and that row was only ever created by `db/seed.sql` or by the owner saving `PUT /api/site`. Eight tables — `blog_posts`, `gallery_items`, `client_accounts`, `client_sessions`, `monthly_schedules`, `appointments`, `appointment_payment_proofs`, `consultation_notes` — reference `sites(site_id)` by foreign key, so without seed.sql the *entire* database-backed surface failed: client signup 503, bookings impossible, CMS and availability writes refused. The public site itself still rendered (the config read falls back to the build-time configuration), which is why the site looked healthy while signup was broken. Running the seed by hand, or opening the dashboard and saving details once, made signup work — that was the workaround, not the expected setup.

**Fix (historical):** both runtimes create the row themselves, once per isolate/instance, before the first query. That pass used `INSERT INTO sites (site_id, config) VALUES (…) ON CONFLICT (site_id) DO NOTHING` (unprefixed name in the write-up). **Current code (2026-10-16):** table is `tele_sites`; conflict action is `DO UPDATE SET config = EXCLUDED.config WHERE tele_sites.updated_at = tele_sites.created_at` (Bug Fix No. 204). An owner-edited row (`updated_at <> created_at`) is still never overwritten. Optional `db/seed.sql` remains `DO NOTHING`. In the Cloudflare runtime the shared `sql(env)` helper guarantees it, and in the Vercel runtime `getDb()` does, so no route — present or future — can skip it. A failed bootstrap clears the memo so the next request retries.

**Also fixed:** the failure was unhelpful to diagnose. New shared library `public/_scaffold/templates/shared/lib/db-errors.js` (shipped in every package, listed in `manifest.json` → `sharedRuntime`) maps driver error codes to actionable, secret-free messages — `42P01` "run db/schema.sql", `23503` "the site record is missing…", `3D00_`, `28P01`, `42501`, `57P03`, `53300` — and is now wired into registration, appointments, payment-proof upload, owner CMS writes, availability publish, consultation notes and site settings in both runtimes.

### 3. Owner sign-in and editing the web app — status: one real bug fixed, whole surface verified

Owner sign-in itself was sound: wrong password → 401, correct builder credentials → session + dated `dashboardPath`, unauthenticated session never discloses the path, `/admin.html` → 404, and a stale Cloudflare path redirects (302) to the current path once signed in. A deployed site that cannot sign in is missing Worker secrets — the runtime answers `503 "Owner sign-in is not configured. Set ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD_HASH and CSRF_SECRET."`, and Wrangler does not upload `.dev.vars`. The packaged README now spells out the five `wrangler secret put` commands and the message each missing value produces.

**Real editing bug found and fixed — articles with gallery images could not be saved.** `POST/PUT /api/admin/posts` passed the dashboard's gallery rows straight into `jsonb_to_recordset(…) AS incoming(image_url text, alt_text text, caption text, sort_order integer)`, but `articlePostPayload` builds camelCase items (`imageUrl`, `altText`, `caption`, `sortOrder`). Every column therefore arrived `NULL` and the insert failed with `null value in column "image_url" of relation "blog_post_images"`, answered as **503 "Could not save the post."** Any article that carried at least one gallery image was unsavable in both runtimes (articles without gallery images worked, which is why it went unnoticed). New `articleGalleryRows()` maps the fields explicitly in both the insert and the update statement of both runtimes.

### Verification (2026-10-12)

- **End-to-end harness, real PostgreSQL (PGlite), packages built from the current templates:** Cloudflare **47/47**, Vercel **47/47**, each also **47/47 with `db/seed.sql` applied**. Coverage: public reads → client signup, duplicate-email 409, logout, re-login → owner wrong-password 401, sign-in, session/dashboard path, `/admin.html` 404 → identity + menu + appearance save and public re-read → article with a gallery image created, read back (admin list and public article endpoint), updated to draft, second article published → gallery item created and updated → availability published (next month) → four bookings, payment-proof upload, client cancellation → owner unpaid list, mark received, release booking (`slotReleased: true`), approve proof, private image `no-store`, appointment list, private consultation note visible to the client, owner cancellation → draft hidden publicly while the owner still sees it → no secret material in `/api/site`.
- **Before/after, same 37–47 check suite on the pre-fix package:** 18/37, with signup 503, article-with-gallery 503 and every booking/payment check failing as a consequence. After: 47/47.
- **ZIP checks:** 14/14 per target (see above), including server-vs-browser build equality.
- **`npm test`: 78/78** (72 existing + 6 new in `test/deployment-fixes.test.js` covering the site-record bootstrap, the camelCase→snake_case mapping, the database-error mapping, the non-destructive seed, the target-neutral manifest and packaged shared libraries).
- **Live `wrangler dev` on the rebuilt Cloudflare package:** boots, serves `/`, `/api/health`, `/api/csrf` and `/api/site` (generated fallback when the database is unreachable), and answers database-backed reads with a clean 503 instead of crashing.
- **Deployment caveats confirmed, not changed:** the availability publisher accepts a month only until its deadline (the 28th of the previous month), so the dashboard defaults to *next* month and the API answers `409 "This month's schedule deadline was …"` for a closed month; Vercel's cron remains daily on Hobby (see §6).

Still not verified here: a live Neon round-trip, a hosted Vercel or Cloudflare deployment, or a real cron invocation. The fixes were proven against the generated packages running on a Postgres-compatible engine plus live `wrangler dev`, not on the operator's account.

## Work list — parameterized packages, CSRF initialization, owner-only capacity, `tele_` database (2026-10-12)

Operator-reported items, each reproduced locally against real PostgreSQL (PGlite) running the *generated packages* (both targets), fixed, then re-verified. The packages under test were rebuilt from the current templates for every run.

### To-do list as reported

1. **"Check the code again for any parameterized error when the user changes a setting on builder; the zip package must list the configurations and apply the setting as parameters to the code that will be zipped and deployed — then fix these."**
2. **"When I deployed the Cloudflare app, the client-side register function says the security token can't initialize. Fix it."**
3. **"Remove the calendar meter functionality on server side and client side — first check `current_code.md` and the code about a non-signed-in user seeing an appointment bar meter — then remove all those; only the site owner will see those, not his clients."**
4. **"Fix the database: the connection was provided but there is no table yet for the admin, the admin username and password must be stored in the DB, and on the Cloudflare deployment there are no tables yet. The tables must also be prefixed `tele_`."**

### 1. Parameterized settings and the package's configuration list — status: audited, one real defect fixed

Every builder setting is parameterized into the package through one token map in `public/package-core.js` (`replaceTokens`: `__SITE_ID__`, `__SITE_CONFIG_JSON__`, `__SCHEMA_STATEMENTS__`, `__BUSINESS_NAME__`, `__BRAND_NAME__`, `__LOCATION__`, `__EMAIL__`, `__PHONE__`, `__PAPER_COLOR__`, `__THEME_CLASS__`, `__DEPLOY_TARGET__`, applied to every shared-public file and the target files, including the Brivon homepage design that is not part of the shared list) and one secret map (`replaceSecretTokens`, applied only to the generated `.dev.vars`/`.env`: `__DATABASE_URL__`, `__ADMIN_USERNAME__`, `__ADMIN_EMAIL__`, `__ADMIN_PASSWORD_HASH__`, `__CSRF_SECRET__`, `__CRON_SECRET__`). A packaging audit now asserts, for **both targets × both design families** (Cloudflare/Vercel × canopy/brivon-dark, 45 checks per combination), that:

- no placeholder survives anywhere in the ZIP (a literal `__…__` would be the parameterized error the operator suspected);
- identity, time zone, payment details, features, theme class and the page edit reach the packaged homepage, `site-config.js`, the runtime's compiled-in defaults (`DEFAULT_CONFIG`) and `db/seed.sql`;
- `manifest.json` lists the configurations this ZIP was generated with under `config` — all 19 keys (`siteId, specialty, specialtyLabel, businessName, brandName, location, email, phone, timeZone, theme, editorialAccent, primaryColor, accentColor, paperColor, fontStyle, features, payments, menuLinks, createdAt`) with the builder's values — and leaks no secret and no connection string;
- the schema is embedded as parameters (`const SCHEMA_STATEMENTS = [ … 59 statements … ]`, `CREATE TABLE IF NOT EXISTS tele_sites`) rather than shipped as a token, and the runtime seeds `tele_admin_users` and reads the owner account back from it.

**Fixed: the ZIP was not reproducible.** `generatedAt`, `createdAt`, `db/seed.sql`, `db/apply-config.sql` and the demo-article dates were stamped from the clock inside the generator, so two builds of *identical* settings produced different bytes; the operator could not tell a settings change from a timestamp change. Generation now anchors every generated date to the payload's `createdAt` (the moment the builder snapshotted the controls) — `public/package-core.js` `createdStamp`. Two builds of the same settings are now byte-identical apart from the freshly generated env file (new CSRF/CRON secrets and PBKDF2 salt), which the ZIP check confirms entry by entry.

### 2. "Security token can't initialize" on the deployed Cloudflare app — status: root-caused and fixed

**Root cause:** the generated runtime's CSRF layer required the `CSRF_SECRET` Worker secret, and Wrangler does not upload `.dev.vars` on deploy. A Worker deployed with only `DATABASE_URL` (and the `ADMIN_*` values) therefore answered `GET /api/csrf` with `503 "Set a CSRF_SECRET Worker secret before using forms."`, so the appointments page could not initialize a token and client registration could never start. The register route itself (`POST /api/auth/register`) was healthy — the failure was in the token handshake in front of it.

**Fix:** `csrfSecret(env)` now falls back to a stable, private secret derived on the server — `HMAC-SHA256(DATABASE_URL, 'canopy-csrf-v1:' + SITE_ID)`, memoized per isolate — so a deployment with a database connection always has working forms; an explicit `CSRF_SECRET` always wins, and rotating `DATABASE_URL` simply invalidates outstanding tokens. The error message now names both options. Registered CSRF verification is unchanged (double-submit cookie plus HMAC signature over a 24-byte nonce, one-hour token lifetime).

**Verified:** with `CSRF_SECRET` removed from `.dev.vars`/`.env`, the full end-to-end flow passes on both packages — `GET /api/csrf` issues a token and `POST /api/auth/register` answers 201 (58/58 Cloudflare and 58/58 Vercel checks; with an empty database too, 59/59 each). The packaged README now states that `CSRF_SECRET` is optional and why, and each package ships `npm run secrets` (`scripts/set-secrets.mjs`) to push `DATABASE_URL`, the `ADMIN_*` values, `CSRF_SECRET` and `CRON_SECRET` from `.dev.vars`/`.env` to Cloudflare (`wrangler secret put`) or Vercel (`vercel env add`) without printing them, with `--dry-run`.

### 3. Calendar capacity meter removed from the public site — status: removed on both sides, owner keeps the numbers

**Server side (both runtimes):** the public `GET /api/availability/summary` route is gone, and `GET /api/availability` now answers exactly `{ month, published, hasTimes, days, slots }` — `days` carries a per-day open count, `slots` the open 30-minute times, `hasTimes` distinguishes "the owner has not opened any times" from "no future times remain". No published/reserved totals, no fill percentage, no summary endpoint. The owner route `GET /api/admin/availability` keeps `totalSlots`/`bookedSlots` (and the publish response keeps its totals) behind owner authentication.

**Client side:** the "this month at a glance" capacity card is deleted from `appointments.html`, `renderMeter()` is gone from `appointments.js`, and the calendar is now single-column in all three breakpoints. The dead meter rules were also pruned from the shipped `site.css`/`brivon.css` (21 rules + 27 selectors), and a stale `renderMeter({})` call left in the calendar error path — which would have thrown a `ReferenceError` and masked the real error — was removed.

**Owner view:** the availability panel in the dashboard shows the metric for the owner: `N published slots · M reserved · P% filled` (plus a month-locked note), computed from the owner-only payload.

### 4. Database tables, the `tele_` prefix, and the owner account stored in the database — status: implemented and verified on an empty database

**All tables are now prefixed `tele_`** — 12 tables (`tele_sites`, `tele_admin_users`, `tele_blog_posts`, `tele_blog_post_images`, `tele_gallery_items`, `tele_client_accounts`, `tele_client_sessions`, `tele_monthly_schedules`, `tele_consultation_slots`, `tele_appointments`, `tele_appointment_payment_proofs`, `tele_consultation_notes`) in the generated schema, the builder's own `tele_builder_page_edits`, and every query in both runtimes, `db/seed.sql` and `db/apply-config.sql`. `shared/db/schema.sql` still renames any pre-existing un-prefixed table in place (`DO $$ … ALTER TABLE … RENAME TO tele_…`), so an older deployment keeps its data. The builder's page-edit store renames `builder_page_edits` the same way.

**The schema is no longer something the operator must run.** Both runtimes embed the schema (`const SCHEMA_STATEMENTS = [ … ]`, substituted from the same generated `db/schema.sql`) and apply it in one transaction on the first database request (`ensureSchema`), best-effort with a fallback message if the database user cannot create tables. That is what the operator's "Cloudflare deployment has no tables yet" hit: a fresh Neon database received no tables, so registration failed on the missing schema.

**The owner username and password now live in the database**, in `tele_admin_users` (one row per site: `username`, `email`, `password_hash`, timestamps). The first database request also creates the `tele_sites` configuration row. **Current code (2026-10-16):** `ON CONFLICT (site_id) DO UPDATE SET config = EXCLUDED.config WHERE updated_at = created_at` (untouched seed refreshed; owner-edited row kept). The 2026-10-12 write-up recorded `DO NOTHING`. The admin row is still seeded from `ADMIN_USERNAME`/`ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH` (`ON CONFLICT` only while `updated_at = created_at`). The database copy is authoritative afterwards: sign-in resolves the row first and falls back to the environment values only when no row exists. A new dashboard **Sign-in** panel (`PUT /api/admin/account`, CSRF + session + current password) changes the username, email or password and re-issues the session; redeploying never overwrites a changed account.

**Database errors now explain themselves** (`shared/lib/db-errors.js`, shipped in every package): `42P01` → run `db/schema.sql` (or check schema permissions), `23503` → the setup record is missing, `3D00`/`28P01`/`42501` → check the `DATABASE_URL` database, password or grants, `57P03`/`53300` → the database is unavailable or the direct connection string was used instead of the pooled one. Messages are public-safe: no SQL, host, user or password.

### Verification (2026-10-12, after the fixes)

- **End-to-end harness on the rebuilt packages, real PostgreSQL (PGlite), 10 combinations:** Cloudflare and Vercel × {schema applied, `db/seed.sql` applied, **empty database (no schema at all)**, no `CSRF_SECRET`, empty database + no `CSRF_SECRET`} → **57/57, 57/57, 58/58, 58/58, 59/59** per target. Coverage: public reads → client signup (201), duplicate email 409, logout, re-login with no `CSRF_SECRET` configured → owner wrong password 401, sign-in, session/dashboard path, `/admin.html` 404 → identity/menu/appearance save → article with gallery images created/updated/published (and a draft hidden publicly) → gallery item created/updated → availability published → four bookings, payment-proof upload, client cancellation → owner unpaid list, mark received, release, approve proof, private image `no-store`, appointment list, private consultation note, owner cancellation → account rotation through `PUT /api/admin/account` (old password 401, new email + password 200, the new hash read back from `tele_admin_users`).
- **Schema bootstrap on an empty database:** the harness applies **no SQL at all** for the `--empty-db` runs and the runtime's own bootstrap creates all 12 `tele_*` tables, the site row and the seeded admin row, after which the whole flow passes (58/58 and 59/59).
- **Capacity is owner-only, proven end to end:** the public `/api/availability` payload is asserted to contain none of `totalSlots`, `bookedSlots`, `fillPercent`, `availableSlots`; the public summary route answers 404; the owner route still returns totals to a signed-in owner and refuses an anonymous caller; the packaged client page carries no meter markup or `renderMeter` code.
- **Packaging:** 45 propagation checks per target × design combination (all four green, no leftover placeholders), and **14/14 ZIP checks per target** including "deterministic entries byte-identical" between the server build and the browser build of the same configuration (only the env file differs, by design).
- **`npm test`: 82/82.** Four tests were added for this round — reproducible packages, the `tele_` schema bootstrap embedded in the runtime, the owner account stored in and resolved from `tele_admin_users`, and the absence of any public capacity meter — and the packaged-README assertions were updated to the new setup story.
- **Not verified here:** a live Neon round-trip, a hosted Cloudflare/Vercel deployment, or a real cron invocation. The operator's own Worker could not be inspected (no credentials); every claim above is from the generated packages running locally against real SQL.

## To Be Implemented — basic CMS always on (completion plan)

**Status (2026-10-15):** the builder side is done — the blog switch in the builder is disabled and always on, the wizard switch is disabled, and `package-core.js` forces `features.blog = true` for every generated package, so every ZIP now ships with the basic CMS. What remains below is finishing the job inside the *generated site* so "always on" is true end to end, not just at build time. It is deliberately **basic**: posts with fixed fields, nothing more.

### User flow — basic CMS on a deployed site

**Owner (writing and publishing):**

1. The owner opens the site's dashboard URL (the date-rotating one from Rule A3) and signs in.
2. The owner opens the **Journal / Posts** section of the dashboard.
3. The owner clicks "new post", fills the fixed fields — title, category, short excerpt, body text, optional feature-image URL and alt text — and picks **Draft** or **Published**.
4. The owner saves. A draft is stored but invisible to the public; a published post appears immediately in the site's Journal section and gets its own article page (`/api/posts/<slug>` behind the page).
5. The owner can edit or delete any post later from the same list. Editing the title re-suggests the slug; the slug stays stable once published unless the owner changes it on purpose.

**Visitor (reading):**

1. A visitor opens the home page and clicks **Journal** in the menu (the link is always present now).
2. The visitor sees the published posts, newest first, and opens one to read the full article with its gallery images.
3. Drafts never appear. No account is needed to read — this part stays public, unlike the calendar and payment details (Rule E5).

### How to implement it — simple words for a junior web developer

Most of the machine already exists. Work through these steps in order; each is small.

1. **Know where the data lives.** Posts are rows in `tele_blog_posts` (title, slug, excerpt, body, feature image, category, `status` of `draft` or `published`); extra article images are rows in `tele_blog_post_images`. You do not need a new table. (`shared/db/schema.sql`)
2. **Know the two doors.** The public reads through `GET /api/posts` and `GET /api/posts/<slug>` (published only). The owner writes through `GET/POST /api/admin/posts` and `PUT/DELETE /api/admin/posts/<id>`. Both doors already exist in both runtimes — do not build a second CMS next to them.
3. **Remove the last places "blog off" can sneak back in.** Force the flag at *runtime*, not only at build time: in each runtime's site-config merge (Cloudflare `src/index.js`, Vercel `api/index.js`), after merging the database config, set `features.blog = true` unconditionally — the same way `gallery` is normalised a few lines away. Do the same in the owner site-settings save, so an old saved settings row with `blog: false` is rewritten to `true` the next time the owner saves anything.
4. **Make the menu follow.** The Journal menu item is filtered by the runtime site config in `site.js`. After step 3 the config can never say `blog: false`, so the link always renders. Verify by loading the home page signed out: Journal must be in the menu.
5. **Say so when the database is missing.** Without `DATABASE_URL` the public journal shows the compiled demo posts and the owner cannot save. In the dashboard posts section, catch the save error and show "Connect the appointment database (DATABASE_URL) to save posts" instead of a generic failure. (The API already answers 503; this step is only about the message.)
6. **Leave the route gates alone.** The `features.blog` checks on the admin post routes stay as harmless defence; after steps 1–5 they simply always pass. Do not delete them as "cleanup" — deleting them is a bigger change than this task needs.
7. **Test it like a user.** Generate both ZIPs. On each: sign in as owner → create a draft → confirm it is *not* on the public journal → publish it → confirm it *is* → edit it → delete it. Then repeat with an old database whose saved site config still contains `blog: false` (step 3 is what fixes that database).

### Redundant explanation (the same thing, said again slowly)

Every practice needs to post announcements — holiday hours, a new service, a price change. If the CMS can be switched off, some owners will switch it off without realising what it is, then ask where their announcements page went; some generated sites will have a Journal menu link pointing at an empty, disabled section; and every future change has to be tested twice, once with the CMS and once without. Making the CMS always on removes a whole category of "where did my feature go?" problems for the price of one unused switch. That is why the builder switch is now disabled instead of merely defaulted on: a default can be changed by accident, a disabled switch cannot. The CMS stays *basic* on purpose — a title, a category, a short summary, the article text, an optional picture, draft-or-published. No page builder, no plugins, no comments. If it is not in that list, it is not part of this task.

Said once more, in one sentence: **from now on, if a site came out of this builder, it has a working journal the owner can post to — there is no configuration, old or new, that turns it off.**

### Inconsistencies present today that restrict this implementation

1. **"Blog on/off" is stored in three places that can disagree.** (a) The builder config, compiled into the package as `DEFAULT_CONFIG` — now forced `true` at build. (b) The database row `tele_sites.config`, which the runtime merges over the compiled config when answering `/api/site` — an old row saved while the switch still worked can carry `blog: false` and hide the Journal menu in the browser even in a brand-new package (this is the restriction step 3 above removes). (c) The route gates, which read the *compiled* config — so today the menu can be hidden by (b) while the owner API happily accepts posts: the owner can publish articles nobody can navigate to.
2. **Old deployed packages keep the old behaviour.** A site deployed from a ZIP generated before the switch was disabled still has a working off-switch in its compiled config and database. Nothing reaches into a deployed site (Rule G3) — those owners get the always-on CMS only when they regenerate and redeploy.
3. **Without `DATABASE_URL` the CMS is read-only and does not say why.** Public reads fall back to the compiled demo posts; owner saves fail with a database 503. Until step 5 is done, an owner on a database-less deploy sees a CMS that silently refuses to save.
4. **The owner settings form can still write `blog: false`.** The dashboard's site-settings payload historically round-tripped the features object; if it writes a stale `false` back, restriction 1(b) returns. The save path must force `blog: true` just like the read merge does (step 3).
5. **Documentation drift.** Older passages (including parts of this file's history and the audit file) describe the blog as an optional module the operator enables. Those are historical records of earlier behaviour; the current rule is this section plus Rule G4 in `system-rules.md`. Do not "fix" the history — add, don't rewrite.

## Bug Fix No. 204 — Brivon Light deploy, owner login, guest calendar (2026-10-15)

**Status:** owner login **code bugs closed** (2026-10-16). Theme and guest-calendar work remain. Live sites pick the login fixes up only by regenerating the ZIP and redeploying (Rule G3). Remaining operational limits (Workers Free CPU, a Worker **secret** shadowing `vars`, neither `CSRF_SECRET` nor `DATABASE_URL`) are listed at the end of this record.

### Requirements

1. A site built as **Brivon Light** must deploy as Brivon Light, not Brivon Dark.
2. The **site owner dashboard login** must succeed with the builder credentials. A wrong username and a wrong password must be reported as such (`The username is incorrect.` / `The password is incorrect.`), not as one generic message.
3. **Guest visitors** must not see booking UI controls. The appointments page shows an empty calendar; the section immediately below that empty calendar is `#guestWhatWeDo` (Brivon welcome copy on Illustration service-card markup).

### Root causes

1. **Theme.** The generated HTML, `site-config.js` and compiled `DEFAULT_CONFIG` already carried `brivon-light`, but `ensureSiteRow` used `INSERT … ON CONFLICT (site_id) DO NOTHING`. An earlier Brivon Dark seed (or the first request against an empty database while a Dark ZIP was live) stayed in `tele_sites.config`. `/api/site` merged that stored Dark theme over the Light package. `site.js` `setTheme()` then stripped every `theme-*` class and, when the API theme was missing or from the wrong family, left `.brivon-shell` on its Dark default tokens. Appointments and custom pages did not bake `__THEME_CLASS__` onto `<body>`, so they could not keep Light without the API.
2. **Owner login.** Several independent faults could all look like “login fails”:
   - The Vercel `.env` left `ADMIN_PASSWORD_HASH=pbkdf2$210000$…` unquoted, so `$210000` was interpolated away and the stored hash no longer verified.
   - CSRF compared `Origin` to `Host` and ignored `X-Forwarded-Host`, so a TLS-terminated proxy 403’d a valid sign-in.
   - The session cookie was written as `__Host-canopy_owner` or `canopy_owner` depending on `https`/`req.secure`, but later GETs only read the name implied by the current request, so a protocol-detection flip dropped a just-issued session.
   - The login username field was `maxlength="64"`, which rejects an email the owner might type; the 401 copy was the generic “Username or password is incorrect.”, so the operator could not tell which field was wrong.
3. **Guest calendar.** Guests already received 401 from `/api/availability` and an empty slot list, but month navigation, legends and the reservation area still rendered, and nothing from the welcome “What we do” section appeared under the calendar.

### Solution

**Theme (Light ZIP overwrites an untouched Dark seed, never an owner save):**

- Both runtimes: `ensureSiteRow` now `INSERT INTO tele_sites (site_id, config) VALUES (…) ON CONFLICT (site_id) DO UPDATE SET config = EXCLUDED.config WHERE tele_sites.updated_at = tele_sites.created_at`. The same `updated_at = created_at` predicate already protects `tele_admin_users`. Owner appearance/identity saves stamp `updated_at` and are kept. Optional `db/seed.sql` still uses `DO NOTHING`.
- `shared/lib/site-theme.js` exports `packageThemeClass()` and `SITE_THEMES`. `normalizeSiteTheme()` still refuses a stored Illustration theme on a Brivon package and vice versa.
- `site.js` `setTheme()` keeps a baked `theme-*` class when the API theme is missing instead of stripping it to nothing.
- `appointments.html` body is `appointments-page __THEME_CLASS__ guest-calendar-view`. Custom pages from `generatedCustomPageHtml()` now include `theme-${config.theme}`.

**Owner login:**

- `ownerLoginError(usernameMatches, passwordMatches)` in `shared/lib/admin-security.js` — both checks still run (constant-time username compare + full PBKDF2) so the message does not change the crypto cost. A wrong username wins even if the password happened to match.
- Both runtimes read `__Host-canopy_owner` **or** `canopy_owner`. CSRF `requestOriginAllowed` accepts an Origin whose host matches `X-Forwarded-Host` / `x-forwarded-host` (first hop).
- Vercel `.env` quotes every secret value. Login username field is `maxlength="254"` and labelled “Username or email”. Successful login returns `{ username, email }` and `admin.js` fills the Sign-in panel.

**Guest calendar (Rule E5 as amended):**

- `appointments.html`: empty-calendar default class, `data-booking-control` on month buttons / legend / slots / reservation area, `#guestWhatWeDo` copied from the welcome service grid.
- `appointments.js`: `renderEmptyGuestCalendar()` draws the current month with no open times; `setGuestBookingView()` toggles the class and the What we do section; `chooseSlot()` returns immediately without a client.
- `site.css`: `body.guest-calendar-view [data-booking-control] { display: none !important }`. Signed-in clients keep the existing calendar, slots, reservation form and payment flow.

### Compatibility cross-check

| Surface | Still true after 204 |
|---|---|
| Owner-edited `tele_sites.config` | Kept — `updated_at <> created_at` skips the seed refresh |
| Optional `db/seed.sql` reruns | Still `DO NOTHING` |
| Owner-edited `tele_admin_users` | Unchanged seed predicate |
| Client booking / payment proof / cron drop | Unchanged; guests never reach those routes |
| `/api/availability` 401 without a client | Unchanged |
| CSRF double-submit + HMAC | Unchanged; only the Origin host check grew the forwarded-host alias |
| Password policy 8–25 + PBKDF2 210,000 | Unchanged; `ownerLoginError` does not skip PBKDF2 |
| Brivon vs Illustration family lock | `normalizeSiteTheme` still rejects a cross-family stored theme |
| Rule G3 | Already-deployed ZIPs do not self-update |

### Verification (2026-10-15)

- `test/bug-fix-204.test.js` — Light packages bake `theme-brivon-light` on the homepage, appointments page, `site-config.js`, `seed.sql` and compiled `DEFAULT_CONFIG`; runtime `ensureSiteRow` uses the `updated_at = created_at` refresh; `ownerLoginError` names the field; both cookie names are read; Vercel `.env` quotes the PBKDF2 hash; guest markup/JS/CSS hide booking controls and keep What we do; `setTheme` will not strip a baked class without a replacement.
- `test/deployment-fixes.test.js` bootstrap assertion updated to the new `ON CONFLICT` clause; `seed.sql` still asserts `DO NOTHING`.
- Full `node --test test/*.test.js`: **135/135** (2026-10-16 login follow-up). `test/bug-fix-204.test.js` plus the existing builder, packaging, password, cron, page-editor and stress suites.

Not verified here: a live Neon round-trip or a hosted Cloudflare/Vercel deploy of a regenerated ZIP. Rule G3 still requires the operator to regenerate and redeploy.

### Owner login follow-up (2026-10-16) — code bugs closed

Requirement 2's **code** faults are closed. `POST /api/admin/login` now returns `authenticated: true` with `dashboardPath`, so `followDashboardPath()` moves a stale Vercel/Cloudflare URL to today. Cloudflare serves the login shell on any `*adminN/dashboard` path (404 only for raw `/admin.html`). Session cookies honour `X-Forwarded-Proto` / `CF-Visitor` / `req.secure` and are written as both `__Host-canopy_owner` and `canopy_owner` on HTTPS. Quoted `ADMIN_PASSWORD_HASH` values verify; a malformed database hash falls back to a well-formed env hash. CSRF origin matching uses every `X-Forwarded-Host` hop and compares hostnames without ports.

**Still true, not a code bug in this tree:**

1. **Workers Free CPU.** Owner login still runs PBKDF2-SHA-256 at 210,000 iterations. Cloudflare Workers Free caps a request at 10 ms of CPU, so a Free generated Worker can still die with 1102/503 before `Set-Cookie`. Deploy the generated site on **Workers Paid** (or Vercel).
2. **`wrangler secret put` overrides `vars`.** An old Worker secret named `ADMIN_PASSWORD_HASH` wins over a new ZIP's `wrangler.jsonc` `vars`. Delete the secret or `wrangler secret put` the new hash.
3. **Neither `CSRF_SECRET` nor `DATABASE_URL`.** Forms cannot issue tokens; that is configuration, not a login-form defect.
4. **7-character owner passwords.** The floor is 8 (Rule A1). Those accounts need a reset.

**What this pass did not re-test:** a live hosted Cloudflare/Vercel login. Rule G3 still requires regenerate + redeploy.

---


## Bug Fix Session #209 — basic CMS completion (2026-10-16)

### Study-first rules guide and documentation cross-check

Derived from the code before changes (not assumed from the plan):

1. This repository serves a **builder**, not an already-generated practice site. `src/index.js` serves assets, previews, page-edit persistence and ZIP generation; practice CMS APIs live in the two runtime templates. Changing templates affects newly generated ZIPs, not existing deployments (G3).
2. Browser and Worker builds share `public/package-core.js` and the scaffold manifest. Keep both target packages functional; no second CMS or new content model is needed.
3. Compiled config already forces blog on, but both `cleanSiteConfig()` functions trust database `features.blog`. Reads and owner settings writes both use that function. Force the invariant there without changing gallery/scheduling or overwriting owner settings (G4/C2).
4. Owner CRUD is cookie-authenticated; mutations also require signed double-submit CSRF. Public reads filter by site and published status. Keep these guards and the existing compiled route gates (A/B/C rules).
5. Posts and optional article galleries already use `tele_blog_posts` / `tele_blog_post_images`, with site-scoped SQL, stable explicit slugs and database uniqueness. Preserve these contracts and database bootstrap. The schema requires a nonempty feature image: optional owner image input must use the existing bundled cover fallback rather than break old database constraints.
6. No database means public demo content, not successful persistence. Owner post operations must explain `DATABASE_URL` explicitly; do not mislabel arbitrary database outages as missing configuration.
7. Follow existing password hashing, date-rotating dashboard paths and secret boundaries. Do not use production credentials or mutate production data during testing.

Cross-check: existing `system-rules.md` G3/G4 and the completion plans agree with items 1–4 and 6. The older image-required implementation/UI conflicts with the plan's **optional** feature image. `README.md`, `inconsistency.md`, and the historical plan above accurately describe the pre-session gaps, but must be read with this appended session record for current status. Per request, solution records are kept **only in this file**; earlier history and other Markdown files are not rewritten.

### Pre-change testing and scope

- `npm ci`: successful; 0 audit vulnerabilities reported.
- `npm test`: **135 passed, 0 failed** before implementation (about 25 seconds). Existing coverage includes auth/security, builder/ZIP parity, page editor, booking/payment/cron, schema identifiers and concurrent generation.
- Attempted an HTTPS HEAD request to `https://telepractice-studio.missiona-carla.workers.dev/`: TLS connection failed (`curl` exit 35). This sandbox permits outbound traffic only to approved GitHub/package-registry hosts, **not workers.dev**. No live page, login, deployed version or production workflow was verified. This is a testing limitation, not evidence of a production bug.
- Confirmed code findings: stale `blog: false` survives runtime config normalization; missing-database CMS operations give generic errors; text-only posts are rejected despite the completion plan. Regression tests and implementation results follow below.

### Confirmed fixes and implementation record

**Completion status:** the remaining CMS code work in the earlier “To Be Implemented — basic CMS always on (completion plan)” is implemented for **newly generated Cloudflare and Vercel packages**. Package-level integration tests pass; production deployment/browser acceptance remains unverified. This session supersedes the earlier pending-status statements; they are retained as history.

| Finding | Root cause | Solution |
|---|---|---|
| Journal could disappear with a legacy saved `blog: false` | Both runtimes merged the database feature object over compiled defaults without reasserting G4 | Set `blog: true` after the feature spread in both `cleanSiteConfig()` implementations. Public `/api/site` reads and authenticated `PUT /api/site` saves use that function, so the next owner settings save also repairs the stored flag. No bulk database overwrite; owner identity/menu/theme settings remain intact. |
| Database-less CMS was not actionable | Reads/writes tried creating a Neon client; Cloudflare returned generic 503s and some Vercel operations fell through the generic 500 handler | All four owner post operations now explicitly return **503**, “Connect the appointment database (DATABASE_URL) to save posts.” Guards run **after** owner authentication/CSRF and the existing blog route gates. Configured database failures still use the existing diagnostic paths rather than falsely claiming configuration is missing. |
| Basic text-only posts failed validation | Historical validator required a feature image or at least one gallery image, despite the completion plan's optional image input | Both article payload validators now choose explicit image → first gallery image → existing `/images/blog-welcome.svg`. This makes owner image input optional while keeping the existing schema's nonempty image constraint and article/card rendering compatible. Unsafe supplied URLs still fail. No schema/table changes. Dashboard copy explains the fallback. |
| Draft title changes did not re-suggest the slug after opening an existing draft | `beginPostEdit()` locked every slug, regardless of status | Shared dashboard slug helper matches the runtime's normalization/160-character cap. Auto-generated draft slugs follow title input; custom draft slugs and published slugs stay stable unless explicitly edited. |
| Save failures appeared only in a temporary toast | Post form catch had no persistent error location | Add an accessible `postFormMessage` status region and fill it with the API error via `textContent`. It remains visible after the toast disappears and clears at the next submit. Post-list errors no longer automatically blame the owner's session for database setup failures. |

Changed code: `public/_scaffold/templates/cloudflare/src/index.js`, `vercel/api/index.js`, `shared/public/admin.js`, `shared/public/admin.html`; new regression suite: `test/cms-209.test.js`. No changes to booking, payments, cron, password policy, content tables or route-gate contracts. No new dependencies. Solution documentation changed only in `current_code.md`.

### Testing record / reproducible verification

The four initial generated-package regression tests were run **before** runtime changes and failed for both targets: stale database blog flag remained false, and missing-database operations did not return the actionable response (Vercel's read threw to the generic handler). After the fixes, all pass. Additional editor coverage was then added.

`test/cms-209.test.js` builds and reads **both actual ZIPs**, evaluates their generated runtime code, substitutes PGlite (real PostgreSQL) only for the Neon transport, and exercises real authentication, CSRF, config and post route handlers. Cloudflare uses its actual Request/Response `fetch()` entry point. Vercel uses a small Express route adapter that executes the generated handlers/middleware; it is **not a full Express HTTP-server or browser test**. Both apply the generated schema through bootstrap. Public navigation and owner-editor functions are exercised with small DOM stubs, not a visual browser.

Verified per target:

- Owner CSRF initialization and username/password sign-in.
- Owner-edited legacy `blog: false` row: public config returns true, practice name/scheduling settings preserved, guest Journal navigation renders, owner settings save persists true even when sent false.
- Anonymous owner reads rejected (401); missing cookies/CSRF mutations rejected (403).
- Text-only draft creation succeeds, bundled cover exists in ZIP, draft absent from public list and direct-slug read (404).
- Publish → public list and article visible; edit title/body with stable explicit slug → article updated.
- Duplicate slug rejected (409); unsafe feature-image URL rejected (400).
- Gallery insert/replacement at the same sort order works; deleting the post cascades gallery rows; deleted article/list entry gone.
- No database: public demo posts remain readable; authenticated owner list/create/update/delete all return the explicit database 503.
- Owner editor: auto draft slug remains editable by title; published/custom slug protected; persistent accessible error location present.

Final commands/results:

- `npm test`: **140 tests passed, 0 failed, 0 skipped** (about 36 seconds). Includes all 135 pre-existing tests plus 5 new session tests. Existing broad coverage checks builder/browser-fallback ZIP parity, previews/page editor, auth/security, themes, guest calendar, booking, payment proofs, cron workflows, database schema and 40 concurrent builds.
- `npm run check`: **passed**, Wrangler production build dry run; **no deployment performed**.
- `git diff --check`: **passed**.

### Deployment and remaining acceptance limits

No live site or database was modified. The supplied workers.dev URL could not be reached under sandbox network restrictions, so “the entire live site passed” is **not** a claim of this session. Visual/responsive/accessibility browser acceptance, actual Express/Neon network integration and production settings must still be checked in a reachable environment. Deploy this builder update, then **regenerate and redeploy practice ZIPs** to update existing practice sites. Saving owner settings in the updated runtime repairs a stale database blog flag; it cannot patch old deployed JavaScript. Owners may still intentionally customize their menu links—the fix prevents the feature flag hiding Journal, not restoration of a manually deleted navigation item. Public demo fallback without `DATABASE_URL` remains deliberate and is not persistent CMS storage.

## Bug Fix #214 — one-image CMS URLs, dynamic articles, working page-editor text (2026-10-16)

**Status:** implemented and tested locally. This record supersedes Session #209's automatic bundled-cover fallback and the older multi-image article-gallery workflow. It does not change the independent practice **Gallery** feature or private payment-proof uploads. No production deployment was performed.

### Requested behavior and current rules

1. **One optional image URL per blog post.** The CMS has one plain-text URL field (HTTPS or same-site path), plus alt text. No local upload control or article gallery. Its image preview sits above the post fields, updates on URL/alt input and when an existing post opens, and reports inaccessible/invalid URLs. Blank means **no image**, not an automatically assigned bundled cover. Demo posts may still explicitly reference their bundled illustration URLs.
2. **One dynamic article route:** `/blog/<slug>`. No per-post HTML file or deployment is generated when the owner publishes. The CMS shows the resulting path beside the editable slug field; blank/whitespace slug input is generated from the title. Normalization lowercases, removes accents, replaces punctuation/spacing with hyphens, caps at 160 characters, and uses `practice-note` if normalization has no letters/numbers. Duplicate site-scoped slugs return 409 with an actionable message. Published/custom slugs stay stable during title edits; explicitly changing or clearing the slug changes the URL. Old URLs then return 404 (no automatic redirect aliases).
3. **Page-editor plain-text edits must reach the preview, saved edit list, next ZIP and running generated homepage.** Existing live-data exclusions and escaping remain intact; this is not an arbitrary HTML/block editor.

### Root causes and fixes

**CMS images:** the old dashboard supported up to 12 gallery images and article payloads inferred a cover from them. #209 then added a bundled-cover fallback. Removed the article-gallery controls/editor code and public rendering from both homepage designs. Both API validators now accept only the single `featureImageUrl`; nonempty legacy `gallery` payloads are rejected. Images use safe HTTPS/same-site URLs; protocol-relative/backslash paths, script/data schemes and URL credentials are rejected. A blank image URL is stored as an empty string and hidden publicly. The existing `tele_blog_posts_feature_image_nonempty` constraint is removed by an idempotent schema migration; NOT NULL and other constraints remain. The legacy `tele_blog_post_images` table is retained for database compatibility, but extra images are no longer exposed and are cleared when that post is saved. Demo config/seed generation no longer creates per-post galleries. The separate practice Gallery remains unchanged.

**Dynamic URLs:** public articles previously only opened in an in-page modal, without changing the address or supporting direct links. Public cards now contain real `/blog/<slug>` anchors, ordinary clicks update browser history, direct links fetch the requested article, and Back/Forward/Close synchronize the article view. Failed article fetches show an unavailable message rather than stale content. Both target runtimes gate HTML deep links through the same site-scoped **published-only** article lookup used by their public API: drafts/missing posts return 404. Cloudflare serves the shared `/index.html` asset after the gate. Vercel rewrites `/blog/:slug` to its runtime, serves the shared HTML with `sendFile`, and explicitly includes `index.html` in the function artifact. Root-absolute assets keep working at nested URLs. Slug fallback now trims input before using the title, fixing whitespace-only slugs.

**Page-editor text — reproduced, not guessed:**

- **Iframe realm mismatch:** `event.target instanceof Element` compared an iframe node to the parent window's `Element`. It returned false, so clicking text never entered edit mode. Replaced this with node/capability-based targeting and covered it with two actual DOM realms in JSDOM.
- **Export timing:** edits were recorded only on focusout. Input now records edits immediately, and export explicitly captures the active editable node before preparing the payload. Edit-budget errors are shown in the editor instead of failing silently. Links inside the editor no longer navigate away from the editable document.
- **Losing pre-existing edits:** restoring text to the session's initial value used to delete even a previously saved edit. A separate seed map restores that saved value instead of dropping it.
- **Fallback/race:** the locally rebuilt preview now receives saved page edits and seeds from the corresponding saved config; iframe load handlers are installed before assigning `srcdoc`.
- **Deployment overwrite:** even when edited HTML appeared in the ZIP, `site.js` immediately replaced hero/service/identity text from site config, then did so again after `/api/site`. Packaged edited nodes now get `data-page-edited` markers. Runtime text/headline/service setters preserve marked nodes and their marked descendants, including nested emphasis, through initial rendering and config refresh. Nonedited fields still update normally. Markers contain no executable content; edited text stays escaped and line breaks stay `<br>`.

### Files and compatibility

- CMS: both runtime templates; shared `admin.html`, `admin.js`, `admin.css`; `db/schema.sql`.
- Public article URLs: shared `site.js`, both homepage designs, both runtime templates, Vercel routing/function config.
- Page editor: `public/page-editor.js`, `public/package-core.js`, shared generated `site.js`.
- Tests: added `test/bug-fix-214.test.js`; extended `test/cms-209.test.js`; updated the obsolete multi-image mapper assertion in `test/deployment-fixes.test.js` to enforce the new single-image contract. Auth/CSRF/published-only assertions were retained and expanded, not removed.
- Added **JSDOM 26** as a test-only development dependency (and updated the lockfile). Generated sites have no new dependencies from this change.
- The site still bootstraps its schema automatically; no blog-content migration or new post tables are needed. Existing primary feature-image URLs are preserved. Existing gallery rows are retained until the corresponding post is saved, when only those rows are cleared. Do not drop the legacy table manually while older packages may still be using it.
- As with G3, deploy the updated builder, then regenerate/redeploy existing practice ZIPs. Page-editor changes need a rebuilt ZIP to change already deployed source. Neither this session nor the builder reaches into existing production deployments.

### Test record

**Before implementation:** `npm test` **140 passed, 0 failed**. The first five #214 regression cases were then added and run against the old code; **all five failed**, reproducing iframe edit rejection, deployed text overwrite in both targets, remaining gallery controls, and missing deep-link article loading.

**After implementation:**

- `npm test`: **148 passed, 0 failed, 0 skipped** (about 36 seconds).
- `test/bug-fix-214.test.js`: **8 passed** — actual iframe-realm click/input events and seeded-edit restoration; generated runtime text survival/escaping for **both targets × Canopy and Brivon Light**; complete dashboard script binding for URL-only preview, unsafe URL handling, failed-image feedback and clearing; deep-link loading and real article anchors; Vercel route/artifact configuration.
- Extended generated-ZIP/PGlite integration tests pass on both targets: owner login; text-only posts; one-URL image edits; rejection of additional gallery images; retirement of legacy rows; title-derived whitespace-slug fallback; custom slug changes; duplicate slug rejection; draft/deleted/renamed HTML URL 404 and published URL 200; preserved CSRF/session protection. Also re-applied the generated schema over an installed legacy nonempty-image constraint and verified text-only saves succeed after migration.
- **Real Express HTTP smoke test**, separate from the route adapter: generated/unzipped a Vercel package under ignored `preview-out/session214-vercel`, installed its own declared dependencies, started its actual app on an ephemeral local HTTP port and closed it after testing. Verified health 200; published demo `/blog/<slug>` returns themed HTML 200 and `Cache-Control: no-store`; HEAD 200 with no body; nonexistent slug 404; public article JSON has no extra gallery. No Neon connection or production data was used.
- `npm run check`: **passed**, Wrangler production build dry run.
- `git diff --check`: **passed**.

**Limits:** JSDOM tests exercise DOM/event/runtime behavior, not browser layout, real image-host reachability, or native contenteditable rendering. The HTTP smoke used compiled demo content; database behavior was exercised against PGlite, not production Neon. The supplied workers.dev production URL remains outside the sandbox's outbound allowlist. No claim is made that the live deployment has received these changes or passed browser acceptance.

## Bug Fix Session #219 — one gallery per post/page, images after paragraphs (2026-10-16)

**Status:** implemented and locally tested for both generated targets. This session **supersedes #214's no-article-gallery restriction**. It retains URL-only image entry, dynamic `/blog/<slug>` URLs, draft privacy and the page-editor text fixes. No production deployment was performed.

### Required rules

1. **Exactly one gallery bank per post or page, when a gallery is used.** A gallery is a required nonblank **gallery title** plus a dynamically expandable list of image-URL text inputs. No local image uploads or second gallery bank in the same document. Different posts/pages have independent galleries.
2. **Two newlines create a paragraph boundary.** A single newline is a line break in the same paragraph. CRLF is normalized. The link appears immediately after entering two newlines, including a newly-created empty trailing paragraph; saving must not trim that paragraph away.
3. **“Add image From A Gallery”** appears after an eligible paragraph. It opens the gallery modal even if no gallery exists; that modal is where the first gallery can be created. In the iframe page editor, these controls appear in the **Paragraphs & page gallery** panel beside the selected text block. They also appear directly below the CMS body/custom-page content fields.
4. **“Create gallery” / “Save gallery” remains disabled** until the title is filled and at least one nonempty URL has a successfully loaded preview. Every filled URL row must be valid, successfully previewed and unique. Empty additional rows do not count. Failed/unsafe URLs show feedback and cannot enable Save. “Add image URL” adds another input row dynamically.
5. Below each preview is **“Add Image Next To Paragraph”**. It inserts that image after the paragraph whose link opened the modal. Already placed images cannot be selected again. Opening the modal through the general Create/Edit gallery button allows bank management; select a paragraph link or the modal’s paragraph destination selector to enable insertion.
6. **At most two individually placed gallery images after any one paragraph.** A **single image fills 100%** of the content width; **two images are side by side at 50% each**, with no gap reducing that width. There is no small-screen stacking override. A whole-gallery set is the explicit exception described in rule 9, not an extra placement alongside individually reused images.
7. A gallery image has **one placement or is unused**. Once all images are placed, every paragraph's “Add image From A Gallery” link disappears. A full two-image paragraph also hides its link even when other unused images exist. The general **Edit gallery** button remains available so more URLs can be added or the entire set can be moved/restyled. A placed whole set consumes every image in the bank and likewise hides paragraph insertion links. Removing an image from a paragraph returns it to the same bank and eligible links reappear.
8. Modal changes are staged until Save/Create or insertion; **Cancel/Escape does not change the document**. Those actions update the surrounding editor. Finish with **Save post**, builder save/export, or **Export to builder** for the document's normal persistence flow. This is stated in the modal; there is no hidden second gallery-save service.

9. The modal provides **“Add entire gallery after this paragraph”**, a paragraph destination selector, and a gallery-set layout selector. It places **all bank images together once**, directly after the selected paragraph. This converts/removes any existing individual assignments; it does not duplicate images or create a second gallery. The set may include all 24 allowed bank images.
10. **Two gallery-set CSS/layout variants:** **Grid** (two equal columns) and **Horizontal strip** (scrollable, scroll-snapping cards). A one-image set fills **100%** in either layout. Edit gallery can change layout or move the set; **Remove gallery set** returns the images to the unused bank without deleting their URLs.
11. Clicking an inserted gallery image, editor preview, or successfully loaded modal preview opens a **full-viewport image lightbox**. Enter/Space also opens it; Previous/Next and arrow keys navigate its group, with wraparound. Close, Escape or backdrop dismissal restores focus and the previous body scroll state. The viewer traps Tab focus and does not close an underlying article/gallery dialog when Escape dismisses it. This is viewport fullscreen, not a forced browser Fullscreen API session.

### Data model, implementation and compatibility

- Added shared native-ESM `shared/public/content-gallery.js`: paragraph splitting, safe URL/HTML handling, singleton gallery normalization, layout CSS and the reusable `GalleryEditor` modal/paragraph UI. The builder copies the same canonical code into each package's public assets and `lib/content-gallery.js`; the source-tree library file is only an alias. The scaffold manifest includes both. CMS/site scripts now load as modules, including appointments/custom pages which also consume `site.js`.
- Canonical document data is `contentGallery: { title, images: [{ id, url, alt, paragraph }] }`. `paragraph` is a zero-based index or `null` for unused. One object, not a list of galleries. URLs and image IDs must be unique in that bank. The shared validator rejects missing titles/images, unsafe URLs, invalid paragraph indexes and a third image in the same paragraph. Whole-set mode adds optional `setPlacement: { paragraph, style: "grid" | "strip" }`; all image `paragraph` values must then be `null`. The shared validator rejects mixed individual/set assignments and unsupported styles. Existing galleries without this field remain individual-placement galleries. A bounded **24-image bank** and 120-character title limit keep the existing request/config budgets practical; URL inputs are capped at 2048 characters.
- **Posts:** a new `tele_blog_posts.content_gallery` JSONB column, defaulting to an empty gallery. It is added idempotently inside the runtime's existing schema migration block, preserving the schema statement count and bootstrapping flow. Both Cloudflare and Vercel validate the same model before saving and return it on owner reads and public article reads. Existing owner session/CSRF/site scoping/published-only guards remain intact. The retired bare `gallery: [...]` payload is not the new contract; a titled `contentGallery` object is required. Legacy `tele_blog_post_images` rows remain retired and are cleared on parent save, as in #214; this change does not revive/import that old table.
- **Custom pages:** `customPages[i].contentGallery` survives builder local storage, input normalization, generated config, owner settings normalization and ZIP generation. The page content editor uses the same modal and paragraph controls. Generated custom-page HTML places only assigned images after their matching paragraphs. Builder-authored package/source changes require regeneration/redeployment. After the page-save correction below is deployed, an owner can also edit an existing deployed page directly: its saved title/body/gallery are loaded from `/api/site` and rendered on public-page reload, without rebuilding its static shell.
- **Iframe homepage page editor:** one shared `pageGallery` is carried on the first item of the existing page-edit list. Its image records additionally identify the text-block target (`selector::index`), so individual placements can span several selected blocks without creating a second gallery. A whole-set placement carries its destination in `pageGallery.setPlacement.target` instead. Unchanged text targets containing a set are retained when switching to another block, so export normalization cannot orphan the set. Target/index and paragraph limits are validated against the edited texts. This metadata travels through the existing BroadcastChannel, local cache, server edit JSON, preview and ZIP—no new unauthenticated persistence endpoint.
- The new paragraph panel edits the selected preview text and exposes gallery controls after its paragraphs. It shares one bank across blocks, captures text changes, and preserves two-newline boundaries. Selecting text alone does not create an unnecessary saved edit. Edits with images carry stable `data-page-edit-key` markers so reopening the editor can restore plain editable text without counting rendered gallery spans as source elements.
- **Rendering/index fix:** gallery markup adds span elements. `applyPageEdits()` now resolves all original targets before inserting markup and applies changes in reverse document order; otherwise a gallery in the first `span` could shift a later `span` selector and change the wrong text. Packaged edit markers continue to prevent `site.js` overwriting exported text/images.
- **Gallery-only restore fix:** builder server hydration used to compare only selector/index/text. It now compares the complete normalized edit data, so a newer server gallery is restored even when all text stayed the same.
- Public rendering escapes text/attributes and permits only HTTPS or safe same-site image URLs. It renders **placed images only**, never automatically appends unused gallery images. The optional pre-existing **cover/banner image** remains separate from this single paragraph-gallery bank. The independent practice Gallery feature and private payment-proof upload flow are unchanged; paragraph galleries work even when the practice Gallery feature is off.
- Image positions are paragraph-index based. If the text is shortened so a placement no longer has a paragraph, the editor returns that image—or the entire set—to the bank instead of silently dropping it. When reorganizing paragraphs, owners should review/reposition images in the paragraph preview.
- The modal includes accessible dialog labeling, initial focus, keyboard focus trapping, Escape/cancel and failed-image feedback. Remote image loading happens only in the browser; the server validates URLs without fetching arbitrary remote hosts.

### Testing record

- The first test attempt in this restored sandbox encountered missing development packages. `npm ci` restored the lockfile dependencies (0 audit vulnerabilities); this was an environment issue, not a production-site finding.
- **Pre-change baseline after install:** `npm test` **148 passed, 0 failed**.
- **Initial #219 suite:** `npm test` **160 passed, 0 failed, 0 skipped** (about 36 seconds); the follow-up verification below supersedes this total.
- New `test/content-gallery-219.test.js`: **10 tests** covering paragraph/CRLF/trailing-empty behavior; one titled gallery and safe unique URLs; two-per-paragraph enforcement; inline order and 50% layout; modal creation without an existing gallery; successful-preview/title gating; adding URL rows; failed previews; cancel; reuse prevention; exhausted-link hiding; returning removed/orphaned images; both-target custom-page HTML; one shared page gallery across selector targets; stable selector indexes; and actual iframe-panel insertion/export into both ZIPs.
- Extended both-target generated-runtime/PGlite tests in `test/cms-209.test.js`: save/publish/reload gallery JSON, owner/public reads, reject third image/missing title/unsafe URL, preserve an empty trailing paragraph with its image, and retain custom-page gallery data through owner settings saves. Existing draft/URL/auth/CSRF checks still pass.
- Added a builder bridge regression in `test/editor-bridge.test.js` for **gallery-only** newer-server restoration when text is unchanged.
- Added a store/API-validation regression in `test/page-edits.test.js`: gallery metadata round-trips through the existing database store; invalid paragraph references fail validation before attempting a database write.
- Updated the prior single-image deployment assertion to enforce the new singleton-JSON contract rather than an obsolete no-gallery restriction. Prior #214 iframe text, image-URL preview and dynamic-link tests remain passing with the module-aware harness.
- **Builder dry run:** `npm run check` **passed**.
- **Generated Cloudflare package dry run:** generated/unzipped a fresh package under ignored `preview-out/session219-cloudflare`; Wrangler dry run of that package **passed**, including the canonical gallery module and assets.
- **Generated Vercel HTTP smoke:** installed the generated package's own declared dependencies under ignored `preview-out/session219-vercel`, ran the real Express app on an ephemeral local port, then closed it. Verified health 200; published dynamic article HTML 200; importing `site.js` served correctly; `content-gallery.js` served as JavaScript and exported the component; missing article 404. Production credentials/databases were not used.
- `git diff --check`: **passed**. No new dependencies were needed for #219.

### Deployment/testing limits

No production site or database was changed. Existing deployments receive the runtime/UI/schema changes only after deploying the updated builder and regenerating/redeploying their packages. Browser image-host availability is host-dependent; tests simulate image load/error events rather than claiming remote hosts were contacted. JSDOM covers DOM/event logic, not native contenteditable/layout screenshots. Database integration uses real PostgreSQL via PGlite, not live Neon. The workers.dev production URL remains outside this sandbox's outbound allowlist; production acceptance is not claimed.


### Follow-up verification — whole-gallery sets, two layouts and fullscreen (2026-10-16)

The additional request is implemented in this same **Bug Fix Session #219**. Rule 6 above supersedes the initial single-image 50% behavior; rules 9–11 extend the initial individual-placement workflow.

Implementation remains centralized in the canonical shared `content-gallery.js`, copied into both generated runtimes. The modal’s destination/layout controls and dedicated set action use the same title/unique-URL/successful-preview validation as Save/Create. Save gallery retains an existing set and updates its layout/bank; the dedicated insertion action converts or moves the complete set. Cancel and failed previews do not persist partial changes. No additional database column, endpoint, package or upload mechanism was introduced: optional placement metadata travels in the existing gallery JSONB/config/page-edit data.

`site.js` now installs an idempotent delegated lightbox binding once, so both exported page images and subsequently fetched article images open the viewer. `GalleryEditor` installs the same behavior for editor and modal previews. Separate group markers keep navigation inside the clicked paragraph, whole set, or modal bank. Singleton viewers disable Previous/Next. Failed full-size loads show recoverable feedback. Paragraph changes reconcile orphaned sets back to the unused bank; the iframe capture path explicitly keeps unchanged targets with whole-set metadata.

QA performed:

- **Before the enhancement:** full baseline **160 passed, 0 failed**. The first seven new focused cases all failed against the old implementation, reproducing the missing behavior before changes.
- **New focused file `test/gallery-set-219.test.js`: 15 passed, 0 failed.** Covers computed 100%/50% width contracts; one-image sets in both layouts; exclusive set validation and invalid destinations/styles; modal preview gating, cancellation, conversion from already-used images, bank removal/update, move/restyle/remove-set flows; orphan recovery; modal-preview fullscreen without saving; keyboard navigation, focus trapping/restoration, scroll restoration, dismissal and listener idempotence; actual iframe-panel insertion and cross-block target retention.
- The focused suite generates both **Cloudflare and Vercel** ZIPs with **both Grid and Horizontal strip**. It checks exported custom-page and homepage set position/count and runs the shipped public script to open their viewers. It also loads a fetched article via its dynamic URL, opens its set’s viewer, and verifies Escape closes only the viewer—not the article or its URL.
- **Both-target real PGlite/API tests** now save/publish/reload a three-image whole set through owner/public reads, reject unsupported layouts and mixed individual/set placements, and retain set metadata through custom-page owner settings saves/reloads. Existing authentication, draft visibility, validation and individual-placement regressions remain passing.
- **Final full suite:** `npm test` **175 passed, 0 failed, 0 skipped** (about 39 seconds).
- **Builder dry run:** `npm run check` passed again.
- **Fresh generated Cloudflare dry run:** passed using ignored `preview-out/session219-set-cloudflare`, not the earlier pre-enhancement fixture.
- **Fresh generated Vercel HTTP smoke:** passed using ignored `preview-out/session219-set-vercel` and its real Express runtime/static assets: health 200; whole-set custom page 200; updated public lightbox binding; JavaScript MIME and identical canonical public/library modules; dynamic article shell 200; missing article 404. The ephemeral test server was closed afterward.
- `git diff --check` passed. Verification logs are local scratch artifacts, not repository deliverables.

No production deployment was performed. The existing testing limits still apply: simulated image load/error events and JSDOM DOM/computed-style contracts are not real-browser screenshots or proof that every remote image host permits embedding. Full-viewport rendering is implemented in CSS; native browser visual acceptance remains a deployment/browser check.


### Follow-up — page/section deletion and correct Export versus Save (2026-10-16)

**Status:** implemented and locally verified as an extension of **Bug Fix Session #219**. The existing Page editor section above has been corrected, not just supplemented with a contradictory save rule.

#### Required behavior and button meanings

- **Builder Page editor:** click a paragraph/text block or section in the preview. Context controls expose **× Delete paragraph** and **× Delete section**. A deletion is staged immediately and hides that selected element; it is not a text replacement with an empty string. **Export to builder** transfers text and deletion records into the builder configuration/preview, and the next **Generate** writes them into both target packages’ homepage source code. Export alone does not deploy anything or update a separate live site.
- Export also keeps the normalized payload in the local builder configuration before opening the BroadcastChannel handshake. With no connected builder tab, the next builder load/Generate can still use the edits; a server backup is attempted when supported. Error/warning messages distinguish local retention from failed backup. The database connection URL is not added to local storage.
- **Deployed owner dashboard:** a new **Pages** navigation item opens an existing homepage/custom page. Homepage text is edited in a sandboxed, script-free iframe with the same paragraph/section delete controls. Custom-page title/body and the existing gallery controls are editable in fields. **Save page** directly writes the existing authenticated, CSRF-protected `PUT /api/site` endpoint, once per pending save. It never exports to a builder, opens a BroadcastChannel, requires a ZIP, or claims that a static file was rewritten.
- **Deployed posts:** **Save post** directly creates/updates the article through the existing owner post endpoint, including the current text and gallery. Editing an existing post also uses the Save post label. Duplicate submissions are blocked while the request is pending. Success is reported only after the API succeeds; a failed save leaves the draft fields intact and re-enables Save.
- Paragraph previews in CMS/custom-page/builder gallery editors now include **Delete paragraph** for individual two-newline-delimited paragraphs. Removing one reindexes later image/set placements, returns images from that paragraph to the same bank, and does not reuse or lose URLs. Deleting a whole text element/section similarly releases placements within it and keeps the page’s bank.
- Deleting the last custom-page paragraph may leave an intentionally empty content area; the page route/title are retained rather than silently dropping the whole page. Builder/runtime validation now permits that empty page body and no longer trims away trailing paragraph boundaries. Existing post title/body validation and published/draft rules remain unchanged.
- Save failures do not masquerade as successful exports or saves. The deployed page editor keeps the draft available, shows **Not saved**, and allows retry. Opening another page with unsaved changes asks before discarding. The editor reads current site settings before a save so unrelated current settings/custom pages are preserved. If typing continues during an in-flight save, its status distinguishes the saved snapshot from newer unsaved edits.

#### Implementation and persistence

- Extracted the canonical page-edit normalizer, restricted selector matcher and HTML applier into native ESM **`shared/public/page-edits.js`**. The builder core re-exports the original public API; both generated runtimes receive an identical `lib/page-edits.js` copy, and the public renderer/editor use the same public module. The source-tree library is an alias, just like the gallery module.
- Deletion has an explicitly validated boolean `remove: true`; unsupported selectors/tags, malformed flags and existing size limits remain enforced. `<section>` is allowed for deletion only, not arbitrary plain-text replacement. Live-data region exclusions remain shared by the editor and appliers. Deleted text targets are excluded from gallery placement validation.
- Deletions remove the target’s inner HTML and leave a **hidden, empty outer tombstone** (`data-page-deleted`), with a CSS hiding rule; original deleted content is not left in that element. Original target identities are stamped before a section removal changes sibling indexes. The editor and runtime resolve these markers when reopening/saving, so a later paragraph does not accidentally inherit an earlier paragraph’s edit. Equivalent selector aliases resolving to one source element are handled without corrupting markup; the last supplied edit wins.
- **Builder:** the existing `pageEdits` list still travels through local config, preview, BroadcastChannel/server backup and both ZIP-generation paths. No editor toolbar/contenteditable markup is packaged: only validated content/removal metadata and the actual rendered source changes are generated. Builder “Clear edits” can reset these source overrides as before.
- **Live homepage:** normalized `pageEdits` now survive generated default configuration, both runtime `cleanSiteConfig` functions, owner settings writes and public configuration reads. The existing `tele_sites.config` JSONB stores them—no new table or migration. `site.js` applies saved edits/removals after refreshing config, so runtime defaults cannot overwrite saved text or resurrect deleted content.
- **Live custom pages:** public `site.js` now refreshes an existing route’s title/content/gallery from saved configuration, instead of leaving the generated static copy unchanged after an owner save. This updates existing deployed pages in JavaScript-enabled browsers after config refresh; it does not create new static routes or rewrite deployment assets. Creating additional routes or changing the underlying template/package still requires regeneration/deployment.
- New **`shared/public/owner-pages.js`** implements deployed-page editing; the dashboard mounts it through its ordinary signed-in workspace. The iframe strips scripts/event attributes and has no script permission. Server authentication, CSRF, site scoping and database requirements remain unchanged. Invalid page-edit requests return validation 400; anonymous attempts cannot write. A missing/unavailable database is a save failure, not a silent local-only success.

#### Verification

- **Before implementation:** full baseline **175 passed, 0 failed** (`npm test`).
- New **`test/page-editor-save-delete.test.js`: 11 tests**. Covers explicit deletion validation; paragraph/section context controls in the actual builder iframe; local Export without a builder tab; removed content and stable sibling identity; selector-alias safety; Cloudflare/Vercel packaged source and saved runtime text on both Canopy/Brivon-light; live custom-page saving, final-paragraph deletion and failed-draft retention; actual deployed homepage controls and one direct Save; gallery placement reindex/release; and the actual dashboard’s one-click post save, CSRF header, duplicate-submit lock and failed-draft retention.
- Extended the existing builder bridge regression: a real export message now includes a section deletion alongside text edits, and asserts local/server config, acknowledgement and refreshed preview carry it.
- Extended both-target generated-runtime **PGlite/API integration**: save/reload homepage text and section-deletion flags; reject malformed flags with 400; reject anonymous writes; verify failed writes do not overwrite saved content; and retain an empty custom-page body/route with its unused image bank.
- The existing #209/#214/#219 gallery, editor, draft privacy, security and packaging regressions remain part of the full suite. Module-evaluation DOM harnesses load the new shared imports rather than suppressing validation or rendering behavior.
- **Final full suite:** `npm test` **186 passed, 0 failed, 0 skipped**.
- **Builder `npm run check`: passed.** Fresh generated Cloudflare dry run and generated Vercel HTTP smoke passed, including the new page-editor runtime/public modules. `git diff --check` passed.

**Deployment/testing limits:** no production deployment or production database was changed. Existing sites need one regenerated/redeployed package to receive this new dashboard/runtime code; subsequent page/post content saves use the deployed database and do not need another build. Local tests use JSDOM and real PostgreSQL via PGlite; they do not claim native-browser screenshots, live Neon acceptance, or production-worker verification outside the sandbox’s network allowlist.

## Inconsistency #011

**Audit date:** 2026-10-16. **Result: not every documented invariant is fully implemented, and some present-tense Markdown claims are stale.** This section is the current cross-check, not a claim that the findings below have been fixed.

**Scope and method:** compared the requirements and implementation claims in `current_code.md`, `system-rules.md`, `README.md`, `inconsistency.md`, and `code-audit-findings.md` with the builder, shared package core, scaffold manifest, both generated runtimes, shared public modules, SQL and tests. Explicitly dated history and superseded #209/#214 behavior were treated as history, not instructions to undo #219. Confirmed edge cases were reproduced locally without changing application code or contacting a production database. This is a source/requirements audit, not formal proof of every deployment behavior.

### 1. Requirements already present in source

| Area | Source check / outcome |
|---|---|
| Basic CMS always on (#209 / G4) | **Implemented.** Both runtime `cleanSiteConfig()` functions force `features.blog = true`, including owner settings saves; missing-database owner operations explain `DATABASE_URL`. Draft/publish/edit/delete and stale `blog: false` have both-target API/PGlite coverage. The old pending plan is not an outstanding implementation task. |
| Dynamic post URLs and optional cover (#214) | **Implemented.** Owner-editable/title-derived slugs, `/blog/<slug>` routing, URL-only optional cover, and published-only public reads are in the runtime/UI and tests. |
| Gallery rules (#219) | **Implemented for the tested flows.** One titled URL-backed bank, successful-preview gating, individual placements, whole-set insertion, Grid/Horizontal strip, full-viewport viewer, singleton 100% / individual pair 50% widths, paragraph controls, and JSON/config/ZIP persistence are present. Do not reinstate #214's superseded gallery prohibition. See A05–A07 for remaining validation/budget edges. |
| Deletion and Export versus Save (#219 follow-up) | **Implemented for ordinary tested flows.** Builder deletion records reach preview/package code; deployed Pages/Save page and Save post use their authenticated APIs. Empty custom-page content is retained, and failed writes retain drafts. A01–A03 are remaining edges, not evidence that these controls are absent. |
| Other rule groups | Date-rotating owner access (A3), CSRF/cookie/header checks (B1–B2), `tele_` tables/site scoping/bootstrap/URL normalization (C1–C3), target-specific schedulers and raw-client sweeps (D1–D3), atomic booking/proof/review/cancellation guards (E1–E4), shared menu sanitization (F1), and token/vars/ZIP deployment rules (G1–G3) have implementation and existing regression coverage. This does not imply live-host acceptance or eliminate the explicit exceptions below. |

### 2. Requirements or guarantees not fully implemented in code

**A01 — P2: selector-alias order differs between exported HTML and live rendering.**
- **Requirement:** the latest #219 follow-up says equivalent selectors resolving to the same element use the last supplied edit.
- **Evidence:** `shared/public/page-edits.js:applyPageEdits()` deduplicates resolved source positions with a Map; `applyPageEditsToDocument()` instead applies the unresolved edit list in reverse without deduplicating elements.
- **Reproduction:** edits for `#title` → `Earlier`, then `h1` → `Latest`, against `<h1 id="title">Original</h1>` produce **Latest** in the HTML applier but **Earlier** in the DOM applier.
- **Still needed:** one consistent resolved-target conflict rule and a regression covering both appliers, not only exported HTML.

**A02 — P2: “sections may only be deleted” validation is bypassed by an ID/class selector.**
- **Requirement:** the deletion follow-up allows section deletion, not replacement of a section's structured markup with plain text.
- **Evidence/reproduction:** `normalizePageEdits()` rejects `{selector:'section', text:...}` but checks only the selector's explicit tag. `{selector:'#content', index:0, text:'Replacement allowed'}` is accepted and `applyPageEdits()` replaces the contents of a `<section id="content">` with that text. The DOM applier also lacks a resolved-element section check.
- **Still needed:** enforce the actual target-element restriction when resolving HTML/DOM targets, or explicitly narrow the documented guarantee. This is a validation gap; the ordinary UI already avoids offering section text editing.

**A03 — P1: a locally retained Export can be overwritten by an older server copy.**
- **Requirement:** the latest Export flow promises that an offline/no-builder-tab export remains usable by the next builder load/Generate.
- **Evidence:** `public/page-editor.js:exportToBuilder()` saves configuration/meta but does not advance `canopy-page-edits-updated-at`. `public/app.js:mergePageEditsFromServer()` uses that separate timestamp to decide whether server data wins. The connected-builder bridge does update it, so the gap concerns the disconnected/local-only path.
- **Reproduction:** retain a new local export with no timestamp; supply an older server record dated 2026-10-15; startup hydration replaces the new local text with that older record.
- **Still needed:** persist local edit recency with every Export and test hydration after failed/missing server backup, including in-flight hydration races.

**A04 — P1: malformed stored hashes can skip PBKDF2 despite the always-derive guarantee.**
- **Requirement:** A2 and the password amendments promise dummy parameters for unusable hashes and derivation/comparison before deciding; malformed database hashes should not block the documented environment fallback.
- **Evidence:** `shared/lib/admin-security.js:passwordHashWellFormed()` / `verifyPasswordHash()` and the runtime client verifiers check nonempty salt/digest fields, not decoded salt/digest validity. Shared/Cloudflare base64 decoding can throw before `deriveBits`. Boolean short-circuit returns also skip the comparison for some rejected inputs.
- **Reproduction:** a dummy `pbkdf2$210000$@$<nonempty dummy digest>` is classified well-formed; owner verification returns false with **zero** instrumented PBKDF2 `deriveBits` calls. No real password/hash was used in this probe.
- **Still needed:** validate decoded hash components, use valid dummy parameters for unusable hashes, consistently perform the prescribed comparison, and expand malformed-hash tests. This finding does not assert an authentication bypass or a measured production timing exploit.

**A05 — P1: invalid custom-page gallery data can silently remove a page instead of rejecting the save.**
- **Requirement:** gallery validation and Save-page failure handling should not turn an invalid draft into an apparently successful destructive save.
- **Evidence:** both runtime `cleanCustomPages()` functions catch `normalizeContentGallery()` failures and return `[]` for that page; `PUT /api/site` can then persist the filtered config and return success.
- **Reproduction:** a valid page is retained, but the same page with an unsupported gallery-set layout disappears from the cleaner's result in both targets instead of causing a validation error.
- **Still needed:** reject invalid submitted page/gallery data before writing any site configuration; test that a failed save preserves the prior page and its route.

**A06 — P2: builder banner-image validation and generated runtime validation disagree.**
- **Requirement:** an accepted builder page should survive generated-runtime reads/settings saves with the same URL-only image contract.
- **Evidence:** `public/package-core.js:safePageImage()` accepts credential-bearing HTTPS URLs (and is looser for root-relative paths); runtime `cleanBannerImage()` rejects credentials and some unsafe paths.
- **Reproduction:** a page with a dummy credential-bearing HTTPS banner is accepted by `normalizeConfig()` but discarded by both runtime custom-page cleaners. Combined with A05, this is silent page loss, not merely a missing image.
- **Still needed:** one shared banner URL policy across builder/runtime validation and a save/read round-trip test. No actual credential URL is reproduced here.

**A07 — P2: accepted per-field edit/gallery limits can exceed the server preview budget.**
- **Requirement/claim:** the preview-budget notes, including `code-audit-findings.md` F10, imply the full edit allowance fits the 128 KiB preview cap; #219 adds gallery metadata to the same payload.
- **Evidence/reproduction:** a normalized bank of 24 valid long image URLs plus 64 × 2000-character ASCII text edits serializes to **178,291 bytes**, above the **131,072-byte** server preview cap but below the 256 KiB generation request cap. Unicode can increase byte usage further.
- **Still needed:** coordinate aggregate byte limits with supported gallery/edit payloads or document/enforce the lower combined budget. Browser-local preview can work, so this is specifically a server preview/fallback guarantee gap, not a claim that every preview fails.

**A08 — P1: credential-path error logging is not fully DEBUG-gated.**
- **Requirement:** B3 explicitly requires every owner-account/credential error to use `debugError()` rather than logging a raw cause.
- **Evidence:** both runtimes still call `console.error('owner account save failed', cause/error)` from the account-update catch. Client-registration catches and generic API error handlers also log raw errors on paths that can involve credentials. Seed/read paths using `debugError()` do not cover these other exits.
- **Still needed:** audit/redact auth-path errors consistently and test default versus DEBUG logging. Raw database error objects can carry sensitive context; no production log exposure is claimed or printed in this audit.

**A09 — P2, previously acknowledged limit: guest payment-account privacy is incomplete.**
- **Requirement:** E5's broad summary says guests receive no GCash/Maya account details; its detailed text already acknowledges an exception.
- **Evidence:** `shared/public/site-config.js` embeds the full public config, and `normalizeConfig()` includes payment names/numbers. Hiding them in the UI and gated API responses does not remove them from a readable script.
- **Still needed if strict guest privacy remains the goal:** separate private payment configuration from publicly shipped assets and deliver account details only through an authenticated response. Keep this marked as an accepted limitation until explicitly resolved; do not describe it as complete secrecy.

**A10 — P1, security hygiene still outstanding: credential-bearing files/history remain tracked.**
- **Requirement:** README's “Do not commit secrets,” A2/B3 secret boundaries, and audit F1's cleanup action.
- **Evidence:** `git ls-files` still lists root `.dev.vars`, `.env`, and `.wrangler/state/**`. Both `.dev.vars` and the F1 body in `code-audit-findings.md` contain credential-shaped PostgreSQL URLs. The repository is currently public. `.gitignore` does not remove existing index/history entries.
- **Still needed:** verify/perform credential rotation as appropriate, untrack local environment/state artifacts, and sanitize exposed material/history under the owner's repository policy. Credential validity and prior rotation were not tested. No URL, password, token or hash value is copied into this report; existing source findings are not newly disclosed as examples.

**A11 — P3: the “single password-bound definition, no literals” invariant is only partial.**
- **Requirement:** `system-rules.md` A1 says never duplicate literal bounds and says changing the shared definition alone changes the policy.
- **Evidence:** server validators import the constants, but `public/app.js:ADMIN_PASSWORD_POLICY` still embeds `{8,25}`, and builder/generated HTML still embeds `minlength="8"` / `maxlength="25"` and related copy. Those values currently agree; this is not a present-day length mismatch.
- **Still needed:** derive browser constraints/patterns from shared bounds, or explicitly document the manual UI-update exception instead of promising a one-definition-only change.

### 3. Inconsistent or stale facts in the Markdown files

| ID | Location / inconsistent fact | Current source-backed interpretation |
|---|---|---|
| D01 | `current_code.md` introductory capability cross-check; README's final “To Be Implemented”; `system-rules.md` G4/completion plan; `inconsistency.md` remaining-gaps list still say runtime blog forcing, missing-database messaging and CMS verification are unfinished. | #209 implemented these in both runtimes and `test/cms-209.test.js`. The dated 2026-10-15 plan may stay as history, but unqualified present-tense pending claims are stale. Old deployments still need regeneration/redeployment. |
| D02 | `current_code.md` opening/§8/password recap, `inconsistency.md` header/list, `system-rules.md` A1 and the later status table in `code-audit-findings.md` refer to **135** as the current suite. | The current rerun is **186 passed, 0 failed, 0 skipped**. Earlier explicitly dated counts (84/135/160/175 etc.) are historical results, not bugs or evidence that tests were removed. |
| D03 | `current_code.md` §1 says the builder “does not use Neon”; other sections describe its Neon page-edit store. | ZIP generation needs no database, but optional builder page-edit persistence does use Neon through `src/database.js`, `src/page-edits-store.js` and `/api/page-editor`. “No practice appointments database in the builder” is different from “no database use.” |
| D04 | `current_code.md` Page editor paragraph names `builder_page_edits`; §5 proof storage names `appointment_payment_proofs`; older CMS overviews emphasize `tele_blog_post_images` without the active #219 JSON contract. | Active tables are `tele_builder_page_edits` and `tele_appointment_payment_proofs`; unprefixed names are migration inputs/history. New paragraph galleries use `tele_blog_posts.content_gallery` JSONB / `contentGallery`, with optional `setPlacement`; the legacy images table is not the active new-gallery write model. |
| D05 | `current_code.md` §5 “Booking and proof,” item 2, says 15 minutes is only a review threshold and never automatic cancellation, while its amended drop section says the opposite. | The sweep in `shared/lib/payment-reminders.js` cancels/expires unpaid, proofless bookings when due. E2/D3 and the amended section are authoritative; actual timing depends on the target's documented cron cadence. Proof upload itself does not independently enforce the deadline. |
| D06 | README's Page editor overview describes text-only records and the earlier channel-first flow; early owner/dashboard summaries omit the new Pages editor, while later #219 records describe it. | Source has deletion records/context controls, local-first builder Export, and deployed Pages/Save page. The latest #219 record describes the intended distinction, subject to A01–A03. This is incomplete/stale overview documentation, not a missing Pages panel. |
| D07 | A1's “change the single source of truth only” wording conflicts with the manual regex/HTML inventory already acknowledged in `current_code.md`'s password amendment. | Current values agree at 8–25, but browser literals still need separate updates. See A11; do not claim those UI constraints are already generated from the shared constants. |

**Not counted as new inconsistencies:** the explicitly dated 2026-10-13 audit body and old work lists are snapshots; #209's cover fallback was superseded by #214, and #214's no-gallery rule by #219. The one-gallery-set exception and single-image 100% correction already have explicit current rules. Workers plan/cron latency, required database configuration, no automatic update of deployed templates, lack of live-host acceptance, and lack of native-browser visual verification remain documented operational/testing limits—not newly missing features.

### 4. Verification and disposition

- The first test invocation in this restored workspace could not load missing development/runtime packages. `npm ci` restored the lockfile dependencies (**80 packages, 0 reported vulnerabilities**); this was an environment issue, not a newly found source regression.
- **`npm test`: 186 passed, 0 failed, 0 skipped** after installation; **`npm run check`: passed** (root Worker dry run); **`git diff --check`: passed**.
- Seven focused scratch probes reproduced A01–A07 (including both-target cleaner behavior for A05/A06). They assert the observed defects, not that the behavior is correct. A08–A11 were confirmed by source/index checks. The existing passing suite does not cover all of these newly identified edges.
- Only `current_code.md` was edited for this audit. The other Markdown files were reviewed and their discrepancies listed here, not silently rewritten. Application changes from completed #209/#214/#219 work remain included for the requested source commit; **none of A01–A11 was implemented/fixed by this audit**. Scratch probes, logs, generated fixtures and dependencies are not repository deliverables.
- No production deployment/database/logging/credential-rotation action was performed. The session remains on `arena/6b41a2a7-telepractice-studio`; any integration into `main` must use a pull request from that branch, not a direct branch switch or push to `main`.
