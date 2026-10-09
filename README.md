# Canopy Studio — Cloudflare admin builder

This is a deployable Cloudflare Workers version of the Canopy Studio website builder. It serves the HTML/CSS/JavaScript admin interface and packages a selected Vercel or Cloudflare practice-site project into a ZIP. The builder itself is stateless; it does not need Neon or retain practice data. The generated practice-site packages include a Neon serverless connection helper and keep their database URL in deployment secrets.

## Deploy the builder to Cloudflare

Requires Node.js 22+ for Wrangler 4.147.0.

```bash
npm install
npx wrangler login
npm run deploy
```

The stateless builder works without deployment secrets. To optionally sign its CSRF tokens as an additional check, run `npx wrangler secret put CSRF_SECRET` and enter a long, unique random value (for example, generate one with `openssl rand -hex 32`). Do not commit secrets.

For local development:

```bash
npm run dev
```

If you want optional signing locally, create an ignored `.dev.vars` file containing `CSRF_SECRET=your-random-secret`. Local variables are not automatically uploaded to the deployed Worker.

### ZIP download / CSRF troubleshooting

Older deployments return “Set CSRF_SECRET as a Worker secret before using the builder” when the builder's runtime secret is missing. Deploy this updated builder with `npm run deploy`, or configure that secret on the existing builder Worker (not just in its build environment). Refresh the page and retry the download.

The builder uses random double-submit tokens, an HttpOnly SameSite=Strict cookie (host-prefixed and Secure on HTTPS), and origin/fetch-metadata validation. It verifies HMAC signatures when `CSRF_SECRET` is configured, but the builder itself can also run without a secret because it is a public, stateless ZIP service. This optional builder secret is separate from the generated sites' required CSRF/session secret. No permissive CORS headers are enabled.

Downloads are validated by host, not by a byte-for-byte URL match, so the builder keeps working behind a reverse proxy (a preview host, a load balancer or a custom domain) that terminates TLS or rewrites the `Host` header. A request is accepted when the `Origin` host is one the Worker sees, is announced through `X-Forwarded-Host`, or the browser's own unforgeable `Sec-Fetch-Site: same-origin` header confirms the call came from a builder tab. `Sec-Fetch-Site: same-site` and `cross-site` requests, and any `Origin` from another host without that assertion, are still rejected with 403. Deployments behind a proxy that also strips `Sec-Fetch-*` can list their public hosts explicitly with an `ALLOWED_ORIGINS` variable (comma separated, wildcards allowed, for example `https://builder.example,*.preview.example`). The builder UI reports which endpoint refused the request, so a 403 on `/api/csrf` points at proxy/host configuration rather than at the ZIP build.

Run regression tests with `npm test`.

The Worker serves the static builder interface and handles `/api/csrf`, `/api/preview` plus `/api/generate`. Choose Vercel or Cloudflare in the builder to download only that runtime's source-code package; generation does not deploy or publish a site. ZIP builds use the versioned scaffold in `public/_scaffold/templates/`, origin validation, a bounded JSON body, security headers, and an in-Worker ZIP writer. The builder does not store the admin credentials supplied for a generated site, a customer database, or practice data.

### Full generated-page preview

Every design system now previews the actual generated homepage, not a hand-drawn approximation. `GET /api/preview?config=<json>` and ZIP generation share the same homepage selector: Illustration themes use `public/_scaffold/templates/shared/public/index.html` with `site.css`; Brivon Dark/Light use `public/_scaffold/templates/shared/designs/brivon-index.html` with `brivon.css`. The preview inlines the selected stylesheet, removes executable scripts, pre-renders the identity/menu/services/gallery/journal/payment regions that the generated runtime normally fills, and inlines the sample SVGs. One sandboxed iframe presents the complete page for every theme. It is laid out at 1440px (or 390px in the phone preview), scaled to fit the panel, and remains internally scrollable so lower sections are reachable. The ZIP keeps its normal linked CSS and runtime scripts; its homepage structure comes from that same selected scaffold. The endpoint is public and stateless, carries no secrets, and accepts at most a 16 KB configuration.

The Generate buttons request a fresh, no-store builder CSRF token for each download and send it with same-origin credentials. If the `/api/generate` request is refused once with 403, the UI retries with a second fresh token before reporting the endpoint and status.

Guided setup supports custom menu pages with their own menu label, URL, title, text content and optional banner image. Site identity includes GCash and Maya payment details; the displayed numbers are sample values and should be replaced before publishing.

### Generated package administrator and environment variables

Each downloaded ZIP includes a ready-to-use environment file — `.dev.vars` for the Cloudflare target, `.env` for the Vercel target — plus a `.gitignore` entry for that file. The builder asks for an administrator username, email, and password. Passwords must be 12–128 characters and contain a lowercase letter, uppercase letter, number, and symbol. The raw password is used only while the ZIP is built in memory; the environment file contains a salted PBKDF2 password hash. `ADMIN_API_KEY` is no longer used.

For every generated ZIP:

- `ADMIN_USERNAME` and `ADMIN_EMAIL` come from the builder's administrator fields.
- `ADMIN_PASSWORD_HASH` contains only a salted PBKDF2 hash of the chosen password.
- `CSRF_SECRET` is freshly generated for that download and signs CSRF tokens and short-lived, HTTP-only owner sessions. It is not a login credential.
- `DATABASE_URL` is filled in from the optional "Database connection" field in the builder's Deployment step. Pasted Neon URLs have `sslmode`/`channel_binding` query parameters stripped automatically (the generated app's Neon serverless driver uses HTTPS and does not need them). If the field is left blank, a clearly marked placeholder is written instead.

The owner dashboard URL is computed at request time in the generated site's configured time zone (default `Asia/Manila`) using this Monday-first animal sequence: Monday dog, Tuesday rat, Wednesday ant, Thursday fish, Friday fly, Saturday cat, Sunday cockroach. Take that day's animal's last character, append `admin` and the current day-of-month, then `/dashboard`. For example, Tuesday the 8th produces `/tadmin8/dashboard`, so the full URL is the site root plus `/tadmin8/dashboard`. The URL rotates at local midnight. The old `/admin.html` entry redirects to the current dynamic path on Vercel and is not served directly by the Cloudflare Worker. The changing path is obscurity only; the username/password login and signed owner session are the access control. The login form is intentionally blank—credentials are never embedded in the public page.

The database URL and admin password are only used to build the ZIP in memory for that request. The builder does not log or retain them, and the account username, email, password hash, and secrets never flow into the generated site's public config (`site-config.js`, `/api/site`, or `db/seed.sql`).

Cloudflare dashboard reference: [Create a Worker from a template or repository](https://dash.cloudflare.com/9d8cf0bed724c974cfd216a9e2eafcb6/workers-and-pages/create/deploy-to-workers?repository=https%3A%2F%2Fgithub.com%2Fcloudflare%2Ftemplates%2Ftree%2Fmain%2Fllm-chat-app-template). This project uses the Workers static-assets binding rather than the chat template's Workers AI binding.
