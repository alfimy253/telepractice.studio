# Current Code Logic and Operational Rules

## Current UI functionality by user type

The repository has four practical UI roles. Only **client** and **practice owner** are authenticated account types in a generated site; the builder operator and public visitor do not create accounts.

### 1. Builder operator (no account)

Through the Canopy Studio builder UI, a person can:

- choose a veterinary or dental starting point and enter the practice name, location, email, phone, GCash details, and Maya details;
- choose the Illustration design system with one of seven layouts, or the separate Brivon design system in dark or light mode; change supported colors and typography; and see an immediate desktop or mobile preview;
- enable or disable the blog, gallery, and appointment features;
- use guided setup to add, reorder, edit, or remove up to eight generated custom pages, each with a menu label, URL, title, text, and optional banner-image URL;
- choose either a Vercel or Cloudflare Workers package;
- provide the initial owner username, owner email, owner password, and optional Neon database URL; and
- download the selected deploy-ready ZIP. The UI does **not** deploy or publish the package.

Non-secret builder settings are autosaved in the browser's local storage. The database URL and owner password are kept out of that saved configuration. The builder has no sign-up, login, hosted-project list, or cloud deployment account UI.

### 2. Public visitor (no account)

On a deployed generated site, a visitor can:

- browse the public home page, enabled navigation links, generated custom pages, published blog posts, and published gallery items;
- view practice contact and payment-account information;
- view the public monthly appointment calendar, open 30-minute slots, schedule capacity, and available consultation services; and
- create a client account or sign in from the appointments page.

A visitor may inspect availability without signing in, but must use a client account to reserve a slot or view private consultation information.

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

The owner UI does not manage owner credentials, create additional staff/owner roles, edit client profiles, issue refunds, process money directly, upload local CMS images, configure domains/hosting, or deploy code. CMS images are entered as HTTPS or same-site URLs; payment proofs are the separate private image-upload flow.

### UI/account implementation cross-check

The capability list above was checked against the rendered controls and their corresponding handlers/routes in:

- builder UI: `public/index.html`, `public/app.js`, `src/index.js`, and `src/generator.js`;
- generated public/client UI: `public/_scaffold/templates/shared/public/index.html`, `site.js`, `appointments.html`, and `appointments.js`;
- generated owner UI: `public/_scaffold/templates/shared/public/admin.html` and `admin.js`; and
- both generated backends: `public/_scaffold/templates/vercel/api/index.js` and `public/_scaffold/templates/cloudflare/src/index.js`.

Feature toggles can hide blog, gallery, or scheduling UI in a generated site, and account/scheduling/CMS persistence requires a configured Neon database with the schema installed.

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

Brivon headings `h1` through `h8` default to `line-height: calc(1em + 5px)` to preserve five pixels of additional line-box space for wrapped titles, so wrapped heading lines keep 4–8px of breathing room between them. The rule lives in the shared `brivon.css` template and therefore covers Brivon Dark and Brivon Light in both the prepared ZIP and the live preview (which inlines the same file); the functional-page continuity rule (appointments, custom pages) covers `h1`–`h8` for both theme classes as well. Class-qualified display headings from the template (hero, section heads, closing CTA) keep the template's own rhythm. The generated owner appearance editor permits switching between Brivon Dark and Brivon Light on a Brivon package. It hides incompatible Illustration choices because changing from one HTML design-system family to another after generation would require replacing the static homepage structure. Illustration packages likewise keep Brivon choices unavailable in the owner editor.

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

The implementation was adapted from the user-provided `axelmercer253/brivon` repository. That repository labels the template free in source comments and documents its bundled images as Pexels-licensed, but it does not contain a general code-license file. This implementation does not copy the repository's photo assets; the hero uses original CSS artwork and the gallery/journal use the generated site's existing content assets.

## Page editor (builder)

The builder's site layout section ("Choose a Site Layout") has a **Page editor** text link that opens `/page-editor.html` in a new tab. The editor tab loads the exact document the builder preview is currently rendering — the builder stashes the rendered preview HTML plus the applied edit list in localStorage on every render (`canopy-preview-html`, `canopy-preview-meta`) — and falls back to building the preview locally from the saved builder configuration when no builder tab stashed one. Plain-text elements (headings `h1`–`h8`, paragraphs, list items, spans, labels and similar) can be clicked and edited inline. Elements carrying inner markup (icons, links) are never editable, so an edit cannot destroy markup, and newlines in the edited text become `<br>` so line structure survives.

Each edit is recorded as `{ selector, index, text }`: a restricted simple selector (`#id`, `tag`, `tag.class`, `.class`, up to three classes) plus the element's position among that selector's matches **outside the excluded live-data regions** (`siteNav`, `drawerNav`, `editorialSiteNav`, `galleryGrid`, `postGrid`, `paymentDetails`, `footerPayments`, the CTA ids `headerCta`/`heroBook`/`articleBook`/`editorialSidebarCta`, `articleModal`, `siteToast`). Those regions are regenerated from the builder configuration in the preview and re-rendered by the generated site at runtime, so their content differs between the preview document and the packaged homepage. Excluding them from both the editor's index computation and the core's `applyPageEdits` matcher (one shared `PAGE_EDIT_EXCLUDED_IDS` list in `public/package-core.js`) is what makes a selector+index pair mean the same element in the editor, the preview and the ZIP.

The **Export to builder** button posts the edits to the builder tab over a `BroadcastChannel` (`canopy-page-editor`). The builder validates them (`normalizePageEdits`), applies them to its configuration, persists the configuration (localStorage) and re-renders the preview immediately, saves them server-side, shows an "N edits applied" note with a "Clear edits" button next to the layout controls, and acknowledges the message so the editor tab closes itself. If no builder tab answers within six seconds, the editor saves directly through the same endpoint and reports that the builder should be opened to apply the edits.

Server side, `POST /api/page-editor` (CSRF-protected like `/api/generate`, bounded 256 KiB body) validates the site id and the edit list and stores `{ siteId, edits, updatedAt }` in the `PAGE_EDITOR` KV namespace under `page-edits:<siteId>`; `GET /api/page-editor?siteId=` returns the saved record (404 when none). Without the KV binding the routes answer 503 with a clear message and the builder keeps working — exports apply locally, only the persistence is skipped. `wrangler.jsonc` declares the binding with placeholder ids; deployment creates the namespace once (`npx wrangler kv namespace create PAGE_EDITOR`) and copies the id into `kv_namespaces[0].id`.

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

The builder normalizes the practice identity, specialty, theme, features, payment details, custom pages, menu links, and time zone before creating a package. A database URL is optional at ZIP-generation time. If omitted, the generated environment file contains a clearly marked placeholder; database-backed scheduling and account features require a real Neon connection string and the schema to be installed.

The builder removes `sslmode` and `channel_binding` query parameters from a pasted PostgreSQL URL because the generated Neon serverless client uses HTTPS. The database URL is held in browser memory for the current tab and is excluded from the builder's saved local-storage configuration. The owner password is collected from form fields and is not part of that saved configuration.

### Owner credentials

Before building a ZIP, the builder enforces these rules:

- Username: 3–64 characters; starts with a letter or number; otherwise letters, numbers, dots, underscores, or hyphens.
- Email: valid email format, up to 254 characters.
- Password: 12–128 characters with at least one lowercase letter, uppercase letter, number, and symbol.

The raw password is used in memory to create a salted PBKDF2-SHA-256 hash (210,000 iterations). Generated packages put the hash—not the raw password—in `.env` (Vercel) or `.dev.vars` (Cloudflare). They also receive a fresh `CSRF_SECRET`; Vercel packages receive a separate `CRON_SECRET`. These values go into ignored environment files and are not written into public site configuration or `db/seed.sql`.

### Builder CSRF and request size

The builder uses an HttpOnly, SameSite=Strict double-submit CSRF cookie and checks the request origin/fetch metadata. Each Generate-button click requests a fresh token using same-origin credentials and no-store caching; the client retries once with a second fresh token if `/api/generate` returns 403, then reports the refusing endpoint and status. HMAC signing is optional for the builder deployment; it is not the same secret as a generated site's required `CSRF_SECRET`. There is no permissive CORS configuration. Builder JSON requests are capped at 256 KiB while being read, not only after buffering the full body.

## 3. Generated site owner access

The owner signs in with the generated username and password. The password hash is checked by the runtime; a signed owner session is stored in an HttpOnly, SameSite=Strict cookie. The session lasts 12 hours and is bound to the normalized username, password hash, and `CSRF_SECRET`; changing any of those values invalidates existing sessions. HTTPS uses a Secure host-prefixed owner cookie.

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

The path is `/<animal's last letter>admin<day-of-month>/dashboard`; for example, Tuesday the 8th is `/tadmin8/dashboard`. This rotating path is an obscurity measure, **not** authentication. Username/password login and the signed session are the access control. Vercel redirects the legacy `/admin.html` entry to the current path; the Cloudflare Worker does not serve `/admin.html` directly.

The owner dashboard exposes the site identity, menu, appearance, blog, gallery, availability, appointments, and payments areas. Owner write actions use CSRF protection and an authenticated session.

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

### Fifteen-minute owner follow-up and release

At or after `payment_due_at` (15 minutes after booking), an active appointment that is still awaiting proof and has no proof receives the one-shot `payment_owner_attention_at` marker. This makes it due for owner attention; it does not cancel the appointment. From the owner payment view, the owner can:

- **Mark received:** only for an active booking with no uploaded proof; keeps the booking active and marks payment approved.
- **Release booking:** cancels the appointment so the slot can be offered again.

The schema contains the payment columns, private proof table, indexes, and idempotent migrations. `db/schema.sql` is safe to rerun; `db/seed.sql` loads generated site configuration and starter content.

## 6. Schedulers and deployment behavior

The two hosted runtimes use native minute-level schedules:

- **Vercel:** `vercel.json` schedules `GET /api/internal/payment-sweeps` every minute. The endpoint requires `Authorization: Bearer <CRON_SECRET>`.
- **Cloudflare Workers:** `wrangler.jsonc` registers a `* * * * *` cron trigger; the export's `scheduled()` handler runs the reminder checks.

A standalone `payment-reminder-worker.js` is included in both target packages. Run `npm run payments:worker` under a process manager on an always-on Node.js host for 90-second client-reminder checks and 180-second owner-follow-up checks. This script is not automatically started by Vercel serverless functions or Cloudflare Workers. Native scheduler frequency and availability still depend on the hosting plan. The Vercel worker script uses Node's `--env-file` flag (package engine `>=20.6`); the Cloudflare package specifies Node `>=22` for Wrangler.

## 7. Security and operational boundaries

- For deployment, set the values from the generated environment file in the host's environment/secrets settings. Wrangler does not upload `.dev.vars`; the Vercel `.env` file is for local use and its values must be configured in Vercel.
- Proof image reads are behind owner authentication and use private/no-store response headers.
- The generated Cloudflare package pins a `sharp` override to 0.35.5; the root dependency tree uses the same override.
- Payment account names/numbers in starter configurations are sample values and must be replaced before publishing.
- This starter is not a compliant electronic health record system.

## 8. Verification status

The repository test suite covers builder CSRF, Vercel/Cloudflare ZIP generation, full-page previews for all nine themes, homepage/template parity, the browser Generate helper's successful and retry paths, the Generate buttons' download click flow under a DOM stub (lockout guard versus the programmatic download anchor, for both build paths and targets), page-edit normalization/application (preview and packaged-homepage parity for every target and theme), the `/api/page-editor` save/load routes (CSRF enforcement, KV round-trip, error paths, missing-binding 503), the page editor bridge (link, export apply + server save + acknowledgement, invalid payloads, clear edits), the Brivon h1–h8 heading rule in both the package and the preview, a 40-concurrent-user stress test of `/api/generate`, admin credentials/session utilities, menu normalization, and payment-proof/reminder rules. The current suite passes 68 tests. `npm audit` reports zero vulnerabilities, `npm run check` passes the root builder's Wrangler dry run (including the `PAGE_EDITOR` KV binding), and a local Wrangler dev smoke passed for the builder shell, all nine previews, both generated ZIP targets, the page editor assets, and the page-editor save/get round-trip. The earlier repository audit also recorded generated-package syntax checks, a generated Cloudflare Wrangler dry run, runtime login/session smoke checks for both generated targets, and a Postgres-compatible PGlite schema/reminder/proof SQL smoke test.

No live Neon database, Vercel deployment, production Cloudflare deployment, or real hosted cron invocation has been tested. Those remain deployment checks, not verified behavior from this repository audit.

## QA record — page editor, Brivon heading spacing, stress test (2026-10-09)

QA'd on branch `arena/ec85247e-telepractice-studio` for the page-editor / heading-spacing / stress-test work:

- `npm test`: **68/68 pass** — including the new page-edits, page-editor bridge, Brivon h1–h8, Generate-download regression and 40-user stress tests.
- `npx wrangler deploy --dry-run`: passes with the new `PAGE_EDITOR` KV binding.
- Live `wrangler dev` smoke: builder shell, `/page-editor.html` + `/page-editor.js`, the builder's "Page editor" link; `POST /api/page-editor` save + `GET` round-trip through the local KV namespace (403 without a CSRF token); `/api/preview` and both `/api/generate` targets apply page edits; the browser fallback build is byte-size-identical to the server build; the packaged `brivon.css` carries the h1–h8 rule.
- Live 40-user stress over real HTTP: 40/40 valid ZIPs in ~2.5 s wall (numbers in the stress-test section above).
- Generated-package checks: ZIP homepages carry the exported edits for Vercel, Cloudflare and Brivon; the env file carries only the PBKDF2 hash; the raw password appears nowhere in the ZIP.
