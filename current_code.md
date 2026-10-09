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

Brivon headings `h1` through `h5` default to `line-height: calc(1em + 5px)` to preserve at least five pixels of additional line-box space for wrapped titles; class-qualified display headings from the template (hero, section heads, closing CTA) keep the template's own rhythm. The generated owner appearance editor permits switching between Brivon Dark and Brivon Light on a Brivon package. It hides incompatible Illustration choices because changing from one HTML design-system family to another after generation would require replacing the static homepage structure. Illustration packages likewise keep Brivon choices unavailable in the owner editor.

### Bug record: incomplete theme preview and ZIP generation checks

- **Reported symptoms:** Brivon showed its real full homepage, while Illustration themes showed only a compact mockup; lower sections could not be explored in the preview. The downloaded `index.html` looked different because the preview and ZIP did not share a homepage source for Illustration. Vercel/Cloudflare generation was also suspected of failing at the CSRF step.
- **Root cause:** the browser only called `/api/preview` for Brivon and retained a separate hand-built Illustration preview. The preview endpoint also defaulted non-Brivon input to Brivon Dark. Consequently, selecting an Illustration theme never rendered the actual generated page. The reported CSRF failure was **not reproducible** in local same-origin tests; Vercel and Cloudflare generation both returned ZIPs with newly issued tokens. The client did, however, stop on its first 403, so a defensive one-time fresh-token retry was added. A proxy/cookie race is only a possibility, not a verified production cause.
- **Fix:** both preview and ZIP now call the same theme-to-homepage selector. All nine supported themes render their matching scaffold HTML/CSS in one sandboxed iframe, retain their desktop/mobile breakpoints, and explicitly allow scrolling through the full page. The preview is self-contained (inlined CSS/images, no scripts); ZIPs retain normal linked assets and runtime scripts. The Generate flow uses no-store, same-origin requests and a request-local token, retries once with a fresh token after a generate-route 403, then surfaces the actual failing route/status.
- **QA coverage:** regression tests exercise all theme previews, generated homepage selection and theme classes for both Vercel and Cloudflare ZIPs, and the extracted browser Generate client against the real Worker CSRF/download routes for both targets. Client-level tests simulate a first-request 403 followed by a fresh-token success and verify a second 403 is surfaced without looping. A local Wrangler dev smoke also served the builder shell/assets and all nine previews and returned both ZIP targets through the client helper. Server tests cover optional HMAC signing, reverse-proxy origins, cookie/token mismatches, cross-site rejection, invalid credentials, and ZIP contents. This confirms local request-flow behavior, not a browser-rendered or production-host download.

The implementation was adapted from the user-provided `axelmercer253/brivon` repository. That repository labels the template free in source comments and documents its bundled images as Pexels-licensed, but it does not contain a general code-license file. This implementation does not copy the repository's photo assets; the hero uses original CSS artwork and the gallery/journal use the generated site's existing content assets.

**Status:** Code-derived documentation for the current repository state, updated 2026-10-08. This describes what the implementation does; it is not a deployment record or a claim that a live site/database has been tested. The repository has no separate implementation-plan Markdown file; the root `README.md` and the generated README text in `src/generator.js` were checked against the code.

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

The raw password is used in memory to create a salted PBKDF2-SHA-256 hash (100,000 iterations, the ceiling for one PBKDF2 call on Cloudflare Workers in production; the hash stores its own count, so existing hashes still verify). Generated packages put the hash—not the raw password—in `.env` (Vercel) or `.dev.vars` (Cloudflare). They also receive a fresh `CSRF_SECRET`; Vercel packages receive a separate `CRON_SECRET`. These values go into ignored environment files and are not written into public site configuration or `db/seed.sql`.

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

The repository test suite covers builder CSRF, Vercel/Cloudflare ZIP generation, full-page previews for all nine themes, homepage/template parity, the browser Generate helper's successful and retry paths, admin credentials/session utilities, menu normalization, and payment-proof/reminder rules. The current suite passes 41 tests. `npm audit` reports zero vulnerabilities, `npm run check` passes the root builder's Wrangler dry run, and a local Wrangler dev smoke passed for the builder shell, all nine previews, and both generated ZIP targets. The earlier repository audit also recorded generated-package syntax checks, a generated Cloudflare Wrangler dry run, runtime login/session smoke checks for both generated targets, and a Postgres-compatible PGlite schema/reminder/proof SQL smoke test.

No live Neon database, Vercel deployment, production Cloudflare deployment, or real hosted cron invocation has been tested. Those remain deployment checks, not verified behavior from this repository audit.
