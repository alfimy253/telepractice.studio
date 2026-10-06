# Canopy Studio — Cloudflare admin builder

This folder is a deployable Cloudflare Workers version of the Canopy Studio builder. It serves the same plain HTML/CSS/JavaScript admin interface and builds the same paired Vercel + Cloudflare practice-site ZIPs at the edge. The builder itself is stateless; it does not need Neon or retain practice data.

## Deploy to Cloudflare

Requires Node.js 22+ for Wrangler 4.147.0.

```bash
npm install
npx wrangler login
npx wrangler secret put CSRF_SECRET
npm run deploy
```

Use a long, unique random value for `CSRF_SECRET`. For local development, copy `.dev.vars.example` to `.dev.vars` and replace the sample secret, then run:

```bash
npm run dev
```

The Worker serves the static interface and handles `/api/csrf` plus `/api/generate`. ZIP builds are assembled from the versioned scaffold in `public/_scaffold/templates/`; direct requests for those internal scaffold assets return 404. The build endpoint uses a signed, HttpOnly, SameSite CSRF cookie, origin validation, a bounded JSON body, security headers, and an in-Worker ZIP writer. No customer state or owner key is stored by the builder.

The Node/Express builder at the project root remains available for local hosting. Use this Worker project when the builder/admin site itself should run on Cloudflare.

Cloudflare dashboard reference: [Create a Worker from a template or repository](https://dash.cloudflare.com/9d8cf0bed724c974cfd216a9e2eafcb6/workers-and-pages/create/deploy-to-workers?repository=https%3A%2F%2Fgithub.com%2Fcloudflare%2Ftemplates%2Ftree%2Fmain%2Fllm-chat-app-template). This project uses the Workers static-assets binding rather than the chat template's Workers AI binding.
