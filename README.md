# Canopy Studio — Cloudflare admin builder

This is a deployable Cloudflare Workers version of the Canopy Studio website builder. It serves the HTML/CSS/JavaScript admin interface and packages a selected Vercel or Cloudflare practice-site project into a ZIP. The builder itself is stateless; it does not need Neon or retain practice data. The generated practice-site packages include a Neon serverless connection helper and keep their database URL in deployment secrets.

## Deploy the builder to Cloudflare

Requires Node.js 22+ for Wrangler 4.147.0.

```bash
npm install
npx wrangler login
npx wrangler secret put CSRF_SECRET
npm run deploy
```

Use a long, unique random value for `CSRF_SECRET`. For local development, copy `.dev.vars.example` to `.dev.vars`, replace the sample secret, and run. If no local vars file exists, `localhost` uses a development-only CSRF fallback so the Generate button still works; deployed Workers still require the secret:

```bash
npm run dev
```

The Worker serves the static interface and handles `/api/csrf` plus `/api/generate`. Choose Vercel or Cloudflare in the builder to download only that runtime's source-code package; generation does not deploy or publish a site. ZIP builds use the versioned scaffold in `public/_scaffold/templates/`, signed HttpOnly SameSite CSRF cookies, origin validation, a bounded JSON body, security headers, and an in-Worker ZIP writer. No customer state or owner key is stored by the builder.

Guided setup supports custom menu pages with their own menu label, URL, title, text content and optional banner image. Site identity includes GCash and Maya payment details; the displayed numbers are sample values and should be replaced before publishing.

Cloudflare dashboard reference: [Create a Worker from a template or repository](https://dash.cloudflare.com/9d8cf0bed724c974cfd216a9e2eafcb6/workers-and-pages/create/deploy-to-workers?repository=https%3A%2F%2Fgithub.com%2Fcloudflare%2Ftemplates%2Ftree%2Fmain%2Fllm-chat-app-template). This project uses the Workers static-assets binding rather than the chat template's Workers AI binding.
