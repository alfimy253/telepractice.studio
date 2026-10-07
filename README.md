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

The builder now uses random double-submit tokens, an HttpOnly SameSite=Strict cookie (host-prefixed and Secure on HTTPS), and origin/fetch-metadata validation. It continues to verify HMAC signatures when `CSRF_SECRET` is configured. This secret-free mode is only for the public, stateless ZIP builder; the generated practice apps' secret requirements are unchanged. No permissive CORS headers are enabled.

Run regression tests with `npm test`.

The Worker serves the static interface and handles `/api/csrf` plus `/api/generate`. Choose Vercel or Cloudflare in the builder to download only that runtime's source-code package; generation does not deploy or publish a site. ZIP builds use the versioned scaffold in `public/_scaffold/templates/`, HttpOnly SameSite CSRF cookies with optional signing, origin validation, a bounded JSON body, security headers, and an in-Worker ZIP writer. No customer state or owner key is stored by the builder.

Guided setup supports custom menu pages with their own menu label, URL, title, text content and optional banner image. Site identity includes GCash and Maya payment details; the displayed numbers are sample values and should be replaced before publishing.

### Generated package environment variables

Each downloaded ZIP includes a ready-to-use environment file — `.dev.vars` for the Cloudflare target, `.env` for the Vercel target — instead of a `.example` template that has to be copied and renamed first. For every generated ZIP:

- `ADMIN_API_KEY` and `CSRF_SECRET` are freshly generated random values, unique to that download.
- `DATABASE_URL` is filled in from the optional "Database connection" field in the builder's Deployment step. Pasted Neon URLs have `sslmode`/`channel_binding` query parameters stripped automatically (the generated app's Neon serverless driver uses HTTPS and does not need them). If the field is left blank, a clearly marked placeholder is written instead.

The pasted database URL and the generated secrets are only used to build the ZIP in memory for that single request; the stateless builder does not log, store, or otherwise retain them, and they never flow into the generated site's public config (`site-config.js`, `/api/site`, or `db/seed.sql`).

Cloudflare dashboard reference: [Create a Worker from a template or repository](https://dash.cloudflare.com/9d8cf0bed724c974cfd216a9e2eafcb6/workers-and-pages/create/deploy-to-workers?repository=https%3A%2F%2Fgithub.com%2Fcloudflare%2Ftemplates%2Ftree%2Fmain%2Fllm-chat-app-template). This project uses the Workers static-assets binding rather than the chat template's Workers AI binding.
