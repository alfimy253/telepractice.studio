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
- view the public monthly appointment calendar, open 30-minute slots, and available consultation services (how many slots are published or reserved is owner-only); and
- create a client account or sign in from the appointments page.

A visitor may inspect availability without signing in, but must use a client account to reserve a slot or view private consultation information. The public availability response carries the month, whether any times exist, per-day open counts and the open slots themselves; it exposes no published/reserved totals and no fill percentage.

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

Feature toggles can hide blog, gallery, or scheduling UI in a generated site, and account/scheduling/CMS persistence requires a configured Neon database — the runtime applies its own `tele_`-prefixed schema on first use, so no manual SQL is required.

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

The implementation was adapted from the user-provided `axelmercer253/brivon` repository. That repository labels the template free in source comments and documents its bundled images as Pexels-licensed, but it does not contain a general code-license file. This implementation does not copy the repository's photo assets; the hero uses original CSS artwork and the gallery/journal use the generated site's existing content assets.

## Page editor (builder)

The builder's site layout section ("Choose a Site Layout") has a **Page editor** text link that opens `/page-editor.html` in a new tab. The editor tab loads the exact document the builder preview is currently rendering — the builder stashes the rendered preview HTML plus the applied edit list in localStorage on every render (`canopy-preview-html`, `canopy-preview-meta`) — and falls back to building the preview locally from the saved builder configuration when no builder tab stashed one. Plain-text elements (headings `h1`–`h8`, paragraphs, list items, spans, labels and similar) can be clicked and edited inline. Elements carrying inner markup (icons, links) are never editable, so an edit cannot destroy markup, and newlines in the edited text become `<br>` so line structure survives.

Each edit is recorded as `{ selector, index, text }`: a restricted simple selector (`#id`, `tag`, `tag.class`, `.class`, up to three classes) plus the element's position among that selector's matches **outside the excluded live-data regions** (`siteNav`, `drawerNav`, `editorialSiteNav`, `galleryGrid`, `postGrid`, `paymentDetails`, `footerPayments`, the CTA ids `headerCta`/`heroBook`/`articleBook`/`editorialSidebarCta`, `articleModal`, `siteToast`). Those regions are regenerated from the builder configuration in the preview and re-rendered by the generated site at runtime, so their content differs between the preview document and the packaged homepage. Excluding them from both the editor's index computation and the core's `applyPageEdits` matcher (one shared `PAGE_EDIT_EXCLUDED_IDS` list in `public/package-core.js`) is what makes a selector+index pair mean the same element in the editor, the preview and the ZIP.

The **Export to builder** button posts the edits to the builder tab over a `BroadcastChannel` (`canopy-page-editor`). The builder validates them (`normalizePageEdits`), applies them to its configuration, persists the configuration (localStorage) and re-renders the preview immediately, saves them server-side, shows an "N edits applied" note with a "Clear edits" button next to the layout controls, and acknowledges the message so the editor tab closes itself. If no builder tab answers within six seconds, the editor saves directly through the same endpoint and reports that the builder should be opened to apply the edits.

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
- Password: 12–128 characters with at least one lowercase letter, uppercase letter, number, and symbol.

The raw password is used in memory to create a salted PBKDF2-SHA-256 hash (210,000 iterations). Generated packages put the hash—not the raw password—in `.env` (Vercel) or `.dev.vars` (Cloudflare). They also receive a fresh `CSRF_SECRET`; Vercel packages receive a separate `CRON_SECRET`. These values go into ignored environment files and are not written into public site configuration or `db/seed.sql`.

### Builder CSRF and request size

The builder uses an HttpOnly, SameSite=Strict double-submit CSRF cookie and checks the request origin/fetch metadata. Each Generate-button click requests a fresh token using same-origin credentials and no-store caching; the client retries once with a second fresh token if `/api/generate` returns 403, then reports the refusing endpoint and status. HMAC signing is optional for the builder deployment; it is not the same secret as a generated site's required `CSRF_SECRET`. There is no permissive CORS configuration. Builder JSON requests are capped at 256 KiB while being read, not only after buffering the full body.

## 3. Generated site owner access

Owner access is implemented in both generated targets; it is not a link in the public site's navigation. Each generated package includes the owner dashboard HTML, CSS and JavaScript, plus backend login/session routes. The generated package's `README.md` prints the dashboard path for the date it was built, and explains how to calculate the new path after local midnight. Vercel redirects `/admin.html` to the public home page, and Cloudflare returns 404 for it. Unauthenticated session checks and stale Cloudflare dashboard paths do not disclose the current path; the session route returns the current path only after authentication, so a signed-in owner can follow it when the date changes.

The owner signs in with the username and password entered in the builder. The runtime resolves the account from the `tele_admin_users` row for the site, which the first database request seeds from the deployment's `ADMIN_USERNAME`/`ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH` values; after the row exists the database is authoritative, so the owner can change the username, email or password from the dashboard's Sign-in panel and a redeploy never overwrites a changed account. Password checks use the stored salted PBKDF2 hash; credentials are never prefilled into the login form. A signed owner session is stored in an HttpOnly, SameSite=Strict cookie. The session lasts 12 hours and is bound to the normalized username, password hash, and `CSRF_SECRET`; changing any of those values invalidates existing sessions. HTTPS uses a Secure host-prefixed owner cookie. Sign-in requires a seeded `tele_admin_users` row, so a deployment needs either the generated `ADMIN_USERNAME`/`ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH` values (the seed) or an account already saved in the database. `CSRF_SECRET` is optional: when it is unset the runtime derives a stable private secret from `DATABASE_URL`, and forms report a configuration error only when neither value exists. Owner changes to site settings and CMS data require a working `DATABASE_URL`; the schema is applied by the runtime itself on first use, so an empty database is enough.

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

The path is `/<animal's last letter>admin<day-of-month>/dashboard`; for example, Tuesday the 8th is `/tadmin8/dashboard`. This rotating path is an obscurity measure, **not** authentication. Username/password login and the signed session are the access control. On Vercel, the generated rewrite serves the dashboard shell at the dated path and `/admin.html` redirects to the public home page. On Cloudflare, the Worker only serves the dashboard shell at the current dated path, returns 404 for stale paths unless the owner is authenticated, and never serves `/admin.html` directly.

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

### Fifteen-minute owner follow-up and release

At or after `payment_due_at` (15 minutes after booking), an active appointment that is still awaiting proof and has no proof receives the one-shot `payment_owner_attention_at` marker. This makes it due for owner attention; it does not cancel the appointment. From the owner payment view, the owner can:

- **Mark received:** only for an active booking with no uploaded proof; keeps the booking active and marks payment approved.
- **Release booking:** cancels the appointment so the slot can be offered again.

The schema contains the payment columns, private proof table, indexes, and idempotent migrations. `db/schema.sql` is safe to rerun; `db/seed.sql` loads generated site configuration and starter content.

## 6. Schedulers and deployment behavior

The two hosted runtimes use their native scheduled triggers. Their cadence differs by target and plan:

- **Vercel:** `vercel.json` schedules `GET /api/internal/payment-sweeps` **once daily at `0 0 * * *` (00:00 UTC)** — not every minute — so the package can deploy on the Vercel Hobby plan, which only allows daily cron jobs. The endpoint requires `Authorization: Bearer <CRON_SECRET>`. With that cadence the persisted 12-minute client-reminder and 15-minute owner-follow-up markers are written up to about a day late; the client and owner UIs still show those states on time because both compute them from `payment_due_at` as well as from the markers. On Vercel Pro/Enterprise, change the schedule to `* * * * *` for minute-level checks (the generated package README says the same).
- **Cloudflare Workers:** `wrangler.jsonc` registers a `* * * * *` cron trigger; the export's `scheduled()` handler runs the reminder checks every minute.

A standalone `payment-reminder-worker.js` is included in both target packages. Run `npm run payments:worker` under a process manager on an always-on Node.js host for 90-second client-reminder checks and 180-second owner-follow-up checks. This script is not automatically started by Vercel serverless functions or Cloudflare Workers. Native scheduler frequency and availability still depend on the hosting plan. The Vercel worker script uses Node's `--env-file` flag (package engine `>=20.6`); the Cloudflare package specifies Node `>=22` for Wrangler.

## 7. Security and operational boundaries

- For deployment, set the values from the generated environment file in the host's environment/secrets settings. Wrangler does not upload `.dev.vars`; the Vercel `.env` file is for local use and its values must be configured in Vercel.
- Proof image reads are behind owner authentication and use private/no-store response headers.
- The generated Cloudflare package pins a `sharp` override to 0.35.5; the root dependency tree uses the same override.
- Payment account names/numbers in starter configurations are sample values and must be replaced before publishing.
- This starter is not a compliant electronic health record system.

## 8. Verification status

The repository test suite covers builder CSRF, Vercel/Cloudflare ZIP generation, full-page previews for all nine themes, homepage/template parity, the browser Generate helper's successful and retry paths, the Generate buttons' download click flow under a DOM stub (lockout guard versus the programmatic download anchor, for both build paths and targets), page-edit normalization/application (preview and packaged-homepage parity for every target and theme), the `/api/page-editor` save/load routes (CSRF enforcement, Neon-store round-trip through a tagged-SQL test double, error paths, and missing-`DATABASE_URL` 503), the page editor bridge (link, export apply + server save + acknowledgement, invalid payloads, clear edits), the Brivon h1–h8 heading rule in both the package and the preview, a 40-concurrent-user stress test of `/api/generate`, admin credentials/session utilities, menu normalization, and payment-proof/reminder rules. The suite passed 82 tests when re-run on 2026-10-12 (see the work-list verification below; 72 at the 2026-10-11 scan). `npm audit` reports zero vulnerabilities, and `npm run check` passes the root builder's Wrangler dry run; that config reports the `ASSETS` binding only. Local Wrangler smoke coverage is recorded for the builder shell, all nine previews, both generated ZIP targets, and the page editor assets. No live Neon page-edit persistence round-trip is claimed here. The earlier repository audit also recorded generated-package syntax checks, a generated Cloudflare Wrangler dry run, runtime login/session smoke checks for both generated targets, and a Postgres-compatible PGlite schema/reminder/proof SQL smoke test.

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

**Fix:** both runtimes now create the row themselves, once per isolate/instance, before the first query — `INSERT INTO sites (site_id, config) VALUES (…) ON CONFLICT (site_id) DO NOTHING`. `DO NOTHING` is deliberate: an existing (owner-edited) row is never modified. In the Cloudflare runtime the shared `sql(env)` helper guarantees it, and in the Vercel runtime `getDb()` does, so no route — present or future — can skip it. A failed bootstrap clears the memo so the next request retries.

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

**The owner username and password now live in the database**, in `tele_admin_users` (one row per site: `username`, `email`, `password_hash`, timestamps). The first database request also creates the `tele_sites` configuration row (`INSERT … ON CONFLICT (site_id) DO NOTHING`, so owner-edited settings are never overwritten) and seeds the admin row from `ADMIN_USERNAME`/`ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH` (`ON CONFLICT (site_id) DO NOTHING`). The database copy is authoritative afterwards: sign-in resolves the row first and falls back to the environment values only when no row exists. A new dashboard **Sign-in** panel (`PUT /api/admin/account`, CSRF + session + current password) changes the username, email or password and re-issues the session; redeploying never overwrites a changed account.

**Database errors now explain themselves** (`shared/lib/db-errors.js`, shipped in every package): `42P01` → run `db/schema.sql` (or check schema permissions), `23503` → the setup record is missing, `3D00`/`28P01`/`42501` → check the `DATABASE_URL` database, password or grants, `57P03`/`53300` → the database is unavailable or the direct connection string was used instead of the pooled one. Messages are public-safe: no SQL, host, user or password.

### Verification (2026-10-12, after the fixes)

- **End-to-end harness on the rebuilt packages, real PostgreSQL (PGlite), 10 combinations:** Cloudflare and Vercel × {schema applied, `db/seed.sql` applied, **empty database (no schema at all)**, no `CSRF_SECRET`, empty database + no `CSRF_SECRET`} → **57/57, 57/57, 58/58, 58/58, 59/59** per target. Coverage: public reads → client signup (201), duplicate email 409, logout, re-login with no `CSRF_SECRET` configured → owner wrong password 401, sign-in, session/dashboard path, `/admin.html` 404 → identity/menu/appearance save → article with gallery images created/updated/published (and a draft hidden publicly) → gallery item created/updated → availability published → four bookings, payment-proof upload, client cancellation → owner unpaid list, mark received, release, approve proof, private image `no-store`, appointment list, private consultation note, owner cancellation → account rotation through `PUT /api/admin/account` (old password 401, new email + password 200, the new hash read back from `tele_admin_users`).
- **Schema bootstrap on an empty database:** the harness applies **no SQL at all** for the `--empty-db` runs and the runtime's own bootstrap creates all 12 `tele_*` tables, the site row and the seeded admin row, after which the whole flow passes (58/58 and 59/59).
- **Capacity is owner-only, proven end to end:** the public `/api/availability` payload is asserted to contain none of `totalSlots`, `bookedSlots`, `fillPercent`, `availableSlots`; the public summary route answers 404; the owner route still returns totals to a signed-in owner and refuses an anonymous caller; the packaged client page carries no meter markup or `renderMeter` code.
- **Packaging:** 45 propagation checks per target × design combination (all four green, no leftover placeholders), and **14/14 ZIP checks per target** including "deterministic entries byte-identical" between the server build and the browser build of the same configuration (only the env file differs, by design).
- **`npm test`: 82/82.** Four tests were added for this round — reproducible packages, the `tele_` schema bootstrap embedded in the runtime, the owner account stored in and resolved from `tele_admin_users`, and the absence of any public capacity meter — and the packaged-README assertions were updated to the new setup story.
- **Not verified here:** a live Neon round-trip, a hosted Cloudflare/Vercel deployment, or a real cron invocation. The operator's own Worker could not be inspected (no credentials); every claim above is from the generated packages running locally against real SQL.
