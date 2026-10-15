# Canopy Studio — Cloudflare admin builder

This is a deployable Cloudflare Workers version of the Canopy Studio website builder.........  It serves the HTML/CSS/JavaScript admin interface and packages a selected Vercel or Cloudflare practice-site project into a ZIP. The builder needs no database for ZIP generation; when configured with Neon, it uses a small table to persist page-editor edits. Generated practice-site packages also include a Neon serverless connection helper and keep their database URL in deployment secrets.

## Deploy the builder to Cloudflare

Requires Node.js 22+ for Wrangler 4.147.0.

```bash
npm install
npx wrangler login
npm run deploy
```

The builder works without deployment secrets for package generation. To persist page-editor edits across sessions, set `DATABASE_URL` on the builder Worker to a pooled Neon PostgreSQL connection URL:

```bash
npx wrangler secret put DATABASE_URL
```

The Worker creates its `tele_builder_page_edits` table automatically (renaming an older `builder_page_edits` table in place) and upserts edits there. This can use the same Neon database as a generated practice site; the builder table is separate from the generated app's tables. Without `DATABASE_URL`, page edits still apply to the current builder preview and ZIP, but server-side persistence returns 503. KV is not used.

To optionally sign the builder's CSRF tokens as an additional check, run `npx wrangler secret put CSRF_SECRET` and enter a long, unique random value (for example, generate one with `openssl rand -hex 32`). Do not commit secrets.

For local development:

```bash
npm run dev
```

For local page-edit persistence, create an ignored `.dev.vars` file containing `DATABASE_URL=your-pooled-neon-url`; add `CSRF_SECRET=your-random-secret` there if you want optional signing. Local variables are not automatically uploaded to the deployed Worker.

### ZIP download / CSRF troubleshooting

Older deployments return “Set CSRF_SECRET as a Worker secret before using the builder” when the builder's runtime secret is missing. Deploy this updated builder with `npm run deploy`, or configure that secret on the existing builder Worker (not just in its build environment). Refresh the page and retry the download.

**Workers Free plan and “error on /api/generate”.** Cloudflare's Workers Free plan caps each request at 10 ms of CPU. A server-side ZIP build needs far more (the PBKDF2 password hash alone runs 210,000 iterations), so on the Free plan Cloudflare kills `/api/generate` with error 1102 / HTTP 503 before it can answer — `wrangler dev` does not enforce this limit, which is why the failure only shows on a deployed Worker. The Generate buttons now fall back to assembling the identical package **in the browser** from the same shared build core (`public/package-core.js`) whenever the server build is refused, so downloads keep working on the Free plan. For server-side builds (programmatic use of `/api/generate`, or to avoid the fallback), deploy the builder on Workers Paid (30 s of CPU per request by default) or raise `limits.cpu_ms` there. Do not set `limits.cpu_ms` in `wrangler.jsonc` on a Free-plan account — Cloudflare rejects the deployment (API error 100328). Live previews are likewise assembled in the browser first, with `/api/preview` as the fallback.

While a Generate is running, every builder control is locked and a “Preparing package — controls locked” chip appears, so the selections on screen cannot change between the click and the saved ZIP. The configuration is snapshotted once at click time and both build paths use that same snapshot.

The builder uses random double-submit tokens, an HttpOnly SameSite=Strict cookie (host-prefixed and Secure on HTTPS), and origin/fetch-metadata validation. It verifies HMAC signatures when `CSRF_SECRET` is configured, but the builder itself can also run without a secret because it is a public, stateless ZIP service. This optional builder secret is separate from the generated sites' CSRF/session secret: a generated deployment uses `CSRF_SECRET` when it is set and otherwise derives a private, stable secret from `DATABASE_URL`, so client sign-up and booking forms work on a Worker whose secrets were never uploaded. No permissive CORS headers are enabled.

Downloads are validated by host, not by a byte-for-byte URL match, so the builder keeps working behind a reverse proxy (a preview host, a load balancer or a custom domain) that terminates TLS or rewrites the `Host` header. A request is accepted when the `Origin` host is one the Worker sees, is announced through `X-Forwarded-Host`, or the browser's own unforgeable `Sec-Fetch-Site: same-origin` header confirms the call came from a builder tab. `Sec-Fetch-Site: same-site` and `cross-site` requests, and any `Origin` from another host without that assertion, are still rejected with 403. Deployments behind a proxy that also strips `Sec-Fetch-*` can list their public hosts explicitly with an `ALLOWED_ORIGINS` variable (comma separated, wildcards allowed, for example `https://builder.example,*.preview.example`). The builder UI reports which endpoint refused the request, so a 403 on `/api/csrf` points at proxy/host configuration rather than at the ZIP build.

Run regression tests with `npm test` — the suite includes a 40-concurrent-user stress test of `/api/generate` (every user gets their own CSRF session and a distinct, valid ZIP with their own freshly generated secrets).

### Page editor

The "Page editor" text link in the site layout section opens `/page-editor.html` in a new tab. That tab shows the exact document the builder preview is rendering (the builder stashes it in localStorage on every render) and lets you edit plain-text elements inline — click a heading, paragraph, list item or label to edit it. Edits are recorded as `selector + position + text` pairs against a restricted selector grammar, so they address the same element in the preview and in the packaged source.

The "Export to builder" button posts the edits to the builder tab over a `BroadcastChannel`. The builder applies them to its configuration (the preview re-renders immediately, and the next prepared ZIP carries them in the homepage `index.html` — or the Brivon design file that replaces it), persists them through `POST /api/page-editor` (Neon-backed when `DATABASE_URL` is configured, CSRF-protected), shows an "N edits applied" note next to the layout controls, and acknowledges so the editor tab closes itself. `GET /api/page-editor?siteId=` returns the saved record. A "Clear edits" button removes the applied edits.

Regions the preview regenerates from the builder configuration (menu, gallery, journal, payments, CTAs, article modal, toast) are not editable, so an edit always survives into the packaged homepage source. Editing any builder control re-renders the preview, and Generate always snapshots the current configuration — the prepared ZIP always reflects the latest UI state, including page edits.

The Worker serves the static builder interface and handles `/api/csrf`, `/api/preview` plus `/api/generate`. Choose Vercel or Cloudflare in the builder to download only that runtime's source-code package; generation does not deploy or publish a site. ZIP builds use the versioned scaffold in `public/_scaffold/templates/`, origin validation, a bounded JSON body, security headers, and an in-Worker ZIP writer. The builder does not store the admin credentials supplied for a generated site, a customer database, or practice data.

### Full generated-page preview

Every design system now previews the actual generated homepage, not a hand-drawn approximation. `GET /api/preview?config=<json>` and ZIP generation share the same homepage selector: Illustration themes use `public/_scaffold/templates/shared/public/index.html` with `site.css`; Brivon Dark/Light use `public/_scaffold/templates/shared/designs/brivon-index.html` with `brivon.css`. The preview inlines the selected stylesheet, removes executable scripts, pre-renders the identity/menu/services/gallery/journal/payment regions that the generated runtime normally fills, and inlines the sample SVGs. One sandboxed iframe presents the complete page for every theme. It is laid out at 1440px (or 390px in the phone preview), scaled to fit the panel, and remains internally scrollable so lower sections are reachable. The ZIP keeps its normal linked CSS and runtime scripts; its homepage structure comes from that same selected scaffold. The endpoint is public and stateless, carries no secrets, and accepts at most a 128 KB configuration (`MAX_PREVIEW_CONFIG_BYTES` in `src/index.js`).

The Generate buttons request a fresh, no-store builder CSRF token for each download and send it with same-origin credentials. If the `/api/generate` request is refused once with 403, the UI retries with a second fresh token before reporting the endpoint and status.

Guided setup supports custom menu pages with their own menu label, URL, title, text content and optional banner image. Site identity includes GCash and Maya payment details; the displayed numbers are sample values and should be replaced before publishing.

### Generated package administrator and environment variables

Each downloaded ZIP includes a ready-to-use environment file — `.dev.vars` for the Cloudflare target, `.env` for the Vercel target — plus a `.gitignore` entry for that file. The builder asks for an administrator username, email, and password. Passwords must be 8–25 characters and contain a lowercase letter, uppercase letter, number, and symbol — the same 8–25 range the generated site enforces for every user type (builder admin password, owner sign-in and change-password, client sign-up and client sign-in). The raw password is used only while the ZIP is built in memory; the environment file contains a salted PBKDF2 password hash. `ADMIN_API_KEY` is no longer used.

For every generated ZIP:

- `ADMIN_USERNAME` and `ADMIN_EMAIL` come from the builder's administrator fields.
- `ADMIN_PASSWORD_HASH` contains only a salted PBKDF2 hash of the chosen password.
- `CSRF_SECRET` is freshly generated for that download and signs CSRF tokens and short-lived, HTTP-only owner sessions. It is not a login credential. A generated deployment that never receives this value still works: the runtime derives a stable secret from `DATABASE_URL` (changing that URL invalidates outstanding tokens). An explicit value always wins.
- `DATABASE_URL` is filled in from the optional "Database connection" field in the builder's Deployment step. Pasted Neon URLs have `sslmode`/`channel_binding` query parameters stripped automatically (the generated app's Neon serverless driver uses HTTPS and does not need them). If the field is left blank, a clearly marked placeholder is written instead.

### Generated database layout and owner sign-in

Every packaged app uses **only `tele_`-prefixed tables**, in the generated site and in the builder alike. The package creates them itself: the first live URL after deploy (homepage, dashboard page, CSRF, or any API that touches Neon) applies `db/schema.sql`, upserts `tele_sites`, and **inserts the owner username / email / password hash into `tele_admin_users`** — the same Neon database as client registration (`tele_client_accounts`). The seed uses `ON CONFLICT DO UPDATE` only while `updated_at = created_at`, so an owner save is kept. A fresh Neon database therefore needs no manual SQL at all — connecting it and deploying is enough. `db/schema.sql` is still shipped for operators who prefer to pre-provision the schema or who must apply it with a migration tool, and `db/seed.sql` remains optional sample content (it never overwrites owner edits).

The owner username, email and password hash live in `tele_admin_users`, one row per site. The deployment's `ADMIN_*` variables are only the initial seed: once the row exists the database is authoritative, and the owner can change the username, email or password from the dashboard's **Sign-in** panel (`PUT /api/admin/account`, which requires the current password). Re-deploying never overwrites a changed account.

The same table names apply to the builder Worker's own storage (`tele_builder_page_edits`), and each package ships `npm run secrets` — `scripts/set-secrets.mjs` pushes `DATABASE_URL`, `ADMIN_*`, `CSRF_SECRET` and `CRON_SECRET` from `.dev.vars` / `.env` to Cloudflare (`wrangler secret put`) or Vercel (`vercel env add`) without printing them, with `--dry-run` for a preview.

Calendar capacity — how many slots are published, how many are reserved, and the percentage filled — is **owner-only**. Guests do not receive slot data: `GET /api/availability` answers 401 without a client session, and the appointments page shows an empty month grid plus `#guestWhatWeDo` (Brivon “What we do” copy on Illustration `.service-card` markup) with booking controls hidden. A signed-in client sees the month, which days have open times, and the open slots; that payload still has no published/reserved totals. The numbers appear in the owner dashboard only.

The owner dashboard URL is computed at request time in the generated site's configured time zone (default `Asia/Manila`) using this Monday-first animal sequence: Monday dog, Tuesday rat, Wednesday ant, Thursday fish, Friday fly, Saturday cat, Sunday cockroach. Take that day's animal's last character, append `admin` and the current day-of-month, then `/dashboard`. For example, Tuesday the 8th produces `/tadmin8/dashboard`, so the full URL is the site root plus `/tadmin8/dashboard`. The URL rotates at local midnight. Use the generated package README to find the path for the build date. A yesterday URL still shows the sign-in form; after a successful login the page moves to today's path. There is no owner-dashboard link in the public navigation. Vercel redirects `/admin.html` to the public home page; the Cloudflare Worker returns 404 for it. Unauthenticated session checks do not reveal the current path. The changing path is obscurity only; the username/password login and signed owner session are the access control. The login form is intentionally blank—credentials are never embedded in the public page. Owner login on a generated Cloudflare Worker needs Workers Paid: the sign-in request runs PBKDF2 at 210,000 iterations, which exceeds the Workers Free 10 ms CPU cap.

The database URL and admin password are only used to build the ZIP in memory for that request. The builder does not log or retain them, and the account username, email, password hash, and secrets never flow into the generated site's public config (`site-config.js`, `/api/site`, or `db/seed.sql`).

Cloudflare dashboard reference: [Create a Worker from a template or repository](https://dash.cloudflare.com/9d8cf0bed724c974cfd216a9e2eafcb6/workers-and-pages/create/deploy-to-workers?repository=https%3A%2F%2Fgithub.com%2Fcloudflare%2Ftemplates%2Ftree%2Fmain%2Fllm-chat-app-template). This project uses the Workers static-assets binding rather than the chat template's Workers AI binding.

## To Be Implemented — basic CMS always on (completion plan)

The builder side is done: the blog switch is disabled and always on, and every generated package forces `features.blog = true`, so every site ships with the basic CMS (posts with title, category, excerpt, body, optional feature image, draft/published). Remaining work, specified in full at the bottom of `current_code.md` (and summarised in `system-rules.md` under the same heading): force `blog: true` in each generated runtime's config merge and in the owner settings save so a stale database row cannot hide the Journal menu; show a clear "connect DATABASE_URL" message when post saves fail without a database; and verify both ZIPs end to end (draft hidden → publish visible → edit → delete). Known inconsistencies that restrict this: blog on/off is still stored in the database site config and can override the compiled config; pre-change deployed packages keep the old switch until regenerated; without `DATABASE_URL` the journal falls back to compiled demo posts; and the compiled public `site-config.js` still embeds the GCash/Maya account strings (hidden from guests in the UI/API, but not secret).
