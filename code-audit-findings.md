# Code audit — hanging implementations

**Date:** 2026-10-13 · **Branch:** `arena/ce69da9b-telepractice-studio` · **Commit:** `d973c66`

Every finding below was derived from the **current source code**, not from `current_code.md` or `README.md`.
Where the documentation and the code disagree, the code is quoted.

## Method

| Check | Result |
|---|---|
| `npm test` | **84/84 pass** |
| `npm run check` (`wrangler deploy --dry-run`) | builds clean, 60 assets |
| Built 8 real ZIPs (2 targets × 4 themes) and parsed them: relative imports, HTML asset refs, `package.json` scripts, wrangler/vercel entrypoints, leftover `__TOKEN__` placeholders, secret leakage into non-env files | **0 problems** |
| Cloudflare ↔ Vercel API route parity | 38 shared routes, no drift; Vercel's extra `GET /api/internal/payment-sweeps` is Cloudflare's `scheduled()` |
| `schema.sql` tables ↔ tables referenced in SQL | 12/12 match — **except one file, see F2** |
| Manifest ↔ scaffold files on disk | all present, none orphaned |
| DOM-id / control wiring (builder, page editor, admin, appointments, both homepages) | no dead controls; every form has a `preventDefault` handler |
| Dead exports, unused payload fields, slug consistency, size caps | see F6–F10 |

---

## F1 · P0 — Live Neon credential is committed to this public repo, and `.gitignore` never ignores `.dev.vars`

`.dev.vars:7` (tracked, **not** ignored, repo is public — `gh repo view` → `isPrivate: false`):

```
DATABASE_URL=postgresql://carlamissiona:yhxjpBia4MA6@ep-round-moon-a1obo7oq-pooler.ap-southeast-1.aws.neon.tech/workers_db
```

Root cause in `.gitignore`: it lists `.env` (line 3) but **never `.dev.vars`**. The only `.dev.vars`
entries are the two negations for the scaffold templates (lines 8–9). So the file the README tells you
to keep out of git is the one file git is guaranteed to track:

> `README.md:31` — "create an **ignored** `.dev.vars` file containing `DATABASE_URL=…`"

Also tracked: `.env` (placeholder CSRF secret only — matched by `.gitignore:3` but already in the index,
so the rule is inert) and **444 KB of local Wrangler state** — 20 files under `.wrangler/state/**`,
including a 168 KB miniflare observability trace DB. `.gitignore:2` only covers `.wrangler/tmp/`.

**Fix:** rotate that Neon password (it is in public history), then `git rm --cached .dev.vars .env`,
add `/.dev.vars` and `/.wrangler/state/` to `.gitignore`, and commit `.dev.vars.example` instead.

---

## F2 · P1 — The payment-reminder sweeps are broken in **every generated site** (the `tele_` migration missed one file)

`public/_scaffold/templates/shared/lib/payment-reminders.js` is the only file in the repository that
queries **unprefixed** table names:

| Line | Query fragment | Table that actually exists |
|---|---|---|
| 3 | `UPDATE appointments AS appointment` | `tele_appointments` |
| 14 | `SELECT 1 FROM appointment_payment_proofs AS proof` | `tele_appointment_payment_proofs` |
| 23 | `UPDATE appointments AS appointment` | `tele_appointments` |
| 31 | `SELECT 1 FROM appointment_payment_proofs AS proof` | `tele_appointment_payment_proofs` |

**Empirically proven**, not inferred. I applied the generated `db/schema.sql` to a real Postgres engine
(PGlite/WASM) exactly the way the runtime does (`splitSqlStatements` → one transaction), seeded a
20-minute-old unpaid booking, and ran the two exported functions through a tagged-template shim:

```
applied 59 schema statements (as the generated runtime does on first request)
tables created: tele_admin_users, tele_appointment_payment_proofs, tele_appointments, …  (12, all prefixed)

✗ markPaymentProofReminders (12-minute client reminder): FAILED
    code=42P01 severity=ERROR   relation "appointments" does not exist
✗ markPaymentOwnerFollowups (15-minute owner follow-up): FAILED
    code=42P01 severity=ERROR   relation "appointments" does not exist

markers after both sweeps: {"payment_reminder_sent_at":null,"payment_owner_attention_at":null}
```

**Blast radius** — all three sweep paths ship in every ZIP and all three fail:

- `cloudflare/src/index.js:1031` `scheduled()` — cron runs `* * * * *` (`wrangler.jsonc:7`), so it logs
  `scheduled payment reminder check failed` **every minute**; `ctx.waitUntil` swallows it.
- `vercel/api/index.js:903` `GET /api/internal/payment-sweeps` — returns **503** on every daily cron run.
- `payment-reminder-worker.js` (both packages, `npm run payments:worker`) — errors every 90 s / 180 s forever.

**Why the 84 green tests missed it:** `test/payment-proof.test.js:55` asserts
`/appointment_payment_proofs/` and `/runPaymentReminderChecks/` against the *runtime* sources — both
match as substrings of the correctly-prefixed names — and against `payment-reminders.js` it only checks
`interval '12 minutes'`, `payment_owner_attention_at = now()` and `payment_due_at <= now()`. No test ever
checks the table identifiers in that file.

**Why users may not have noticed:** both UIs carry a client-side clock fallback that reproduces the same
thresholds — `appointments.js:156` (`dueAt - 3 min` ⇒ 12 min after booking) and `admin.js:534-535`
(`Date.now() >= dueAt` ⇒ 15 min). So the reminder still *appears*, while the durable server-side markers
are never written and the "remind even when the owner manually marked it received" rule can never fire.

**Fix validated.** Prefixing the four identifiers makes both queries succeed and mark exactly the right rows
(booking A unpaid ⇒ reminder + owner attention; booking B manually approved without proof ⇒ reminder only):

```
✓ markPaymentProofReminders -> ran clean    ✓ markPaymentOwnerFollowups -> ran clean
   {"name":"A","reminder":true,"owner_attention":true}
   {"name":"B","reminder":true,"owner_attention":false}
```

Corroborating evidence the rename was done by hand: `shared/lib/db-errors.js:6-7` still cites the
pre-migration name in its own example error (`table "client_accounts"`).

---

## F3 · P1 — Server-side page-edit persistence is write-only: `GET /api/page-editor` has **no client**

The read path is fully implemented, tested and documented — and nothing ever calls it.

- `src/index.js:228` routes `GET /api/page-editor` → `src/index.js:199 loadPageEdits()` →
  `src/page-edits-store.js loadPageEditsFromDatabase()` → `tele_builder_page_edits`.
- `README.md` — "`GET /api/page-editor?siteId=` returns the saved record."
- `test/page-edits.test.js:255-259` covers only the **503 no-database** branch; line 241 calls
  `loadPageEditsFromDatabase()` directly. No test drives a client, because there is no client.

The builder restores edits from **localStorage only** (`public/app.js:105`, inside `loadConfig()`), and
`grep -rn "api/page-editor"` finds exactly one caller — the POST in `editor-bridge.js:23`.

So the stated purpose of the whole Neon table ("persist edits so they survive the editor tab closing")
stops at the tab: another browser, profile, or device never recovers them. Worse, the editor tab actively
promises otherwise — `public/page-editor.js:164`, on the no-builder-tab fallback path:

```js
status.textContent = 'Saved to the server — open the builder to apply the edits.';
```

Opening the builder does **not** apply them.

**Fix:** on builder init, `GET /api/page-editor?siteId=<slug>` and merge/replace `config.pageEdits`
(prefer the newer `updatedAt`), keeping localStorage as the offline cache.

**Status: fixed (2026-10-15).** `public/app.js:64-77` defines `mergePageEditsFromServer` and runs it at startup. `public/editor-bridge.js:72-87` defines `loadPageEditsFromServer(siteId)` (GET with `cache: 'no-store'`, treats 404/503/non-2xx as `null` so the offline cache wins). The merge compares `localStorage.canopy-page-edits-updated-at` to `record.updatedAt`; only the server's newer record replaces `config.pageEdits`, fires `saveConfig(true) + syncInputs() + updatePreview(true)`, and toasts the operator.

---

## F4 · P2 — Save-failure reporting is dead code: `notify` is never passed to the bridge

`editor-bridge.js:65-71` was written to tell the user whether the server save worked:

```js
if (typeof notify === 'function') {
  notify('Page edits applied', outcome?.saved
    ? `${edits.length} edit(s) now show in the preview, are saved on the server, and will be in the next ZIP.`
    : `The preview now shows your ${edits.length} edit(s), but the server save failed — ${outcome?.message}.`);
}
```

The only caller, `public/app.js:844-851`, passes `applyEdits` alone — no `notify`. The branch never runs.

**Impact:** when `POST /api/page-editor` fails (503 no `DATABASE_URL`, 403, network), the builder still
shows the plain success note `Page editor: N edits applied` (`app.js:154-162`). The user is told the
edits are saved when they are not — the exact scenario `savePageEditsToServer()` was made to report
(it deliberately never throws, `editor-bridge.js:12-14`).

**Fix:** pass `notify: (title, body) => toast(title, body, !saved)` from `app.js`, or surface
`outcome.saved` through `syncPageEditorStatus()`.

**Status: fixed (2026-10-15).** `public/app.js:884-893` calls `initPageEditorBridge({ applyEdits, notify: (title, body) => toast(title, body, false) })`. The `notify` callback in `editor-bridge.js:65-71` runs after every `applyEdits` round-trip and now reports the failure path through the builder's `toast(title, body, isError)`.

---

## F5 · P2 — "Clear edits" clears the screen but not the saved record (and there is no DELETE route)

`public/app.js:836-841`:

```js
$('clearPageEdits').addEventListener('click', () => {
  config.pageEdits = [];
  syncInputs();
  updatePreview(true);          // → saveConfig(), so localStorage IS cleared
  toast('Page edits cleared', …);
});
```

No `savePageEditsToServer(siteId, [])`, and `src/index.js:227-228` implements only POST and GET for
`/api/page-editor` — there is no DELETE. The Neon row keeps the cleared edits indefinitely.
Currently invisible only because of F3 (nothing reads it back); the moment F3 is fixed, "Clear edits"
will resurrect on the next load.

**Status: fixed (2026-10-15).** `public/app.js:865-877` now calls `clearPageEditsOnServer(siteId)` after the local clear; `public/editor-bridge.js:44-65` issues a `DELETE /api/page-editor` with CSRF + JSON body, handling 503/404/200. `src/index.js:219-241` defines `clearPageEdits`; `src/page-edits-store.js:46` defines `clearPageEditsFromDatabase(sql, siteId)`; `src/index.js:255` routes `DELETE /api/page-editor` to the handler.

---

## F6 · P2 — The site slug disagrees between the builder and the generator (55 vs 45 characters)

| Place | Limit | Used for |
|---|---|---|
| `public/package-core.js:100` | `.slice(0, 45)` | the real `siteId`: `tele_sites.site_id`, `SITE_ID` in both runtimes, ZIP filename, `wrangler.jsonc` name |
| `public/app.js:121-123` | `.slice(0, 55)` | the "Site address" shown in the UI (`index.html:117`, `app.js:273-274`) and the `tele_builder_page_edits` key (`app.js:849`) |
| `public/page-editor.js:29-31` | `.slice(0, 55)` | the editor tab's fallback siteId |
| `src/index.js:176` | `/^[a-z0-9][a-z0-9-]{0,54}$/` (55) | server-side validation — sized for the wrong one |

**Demonstrated** with a 60-character practice name:

```
builder siteSlug / DB key : harborlight-veterinary-care-and-rehabilitation-center-m   (55)
generated config.siteId   : harborlight-veterinary-care-and-rehabilitatio             (45)
ZIP filename              : harborlight-veterinary-care-and-rehabilitatio-cloudflare.zip
MATCH                     : NO
```

So for any name whose slug exceeds 45 chars the builder displays a site address the generated package
does not use, and page edits are stored under a key that can never match the generated site's `siteId`.

**Fix:** export one `slugify` from `package-core.js` and use it in `app.js`, `page-editor.js` and
`src/index.js`'s validator.

---

## F7 · P2 — The generated Cloudflare package bakes real secrets into a git-tracked file

`package-core.js:338-352` writes the build secrets into `wrangler.jsonc` `vars`, and `package-core.js:865`
generates a `.gitignore` containing only `node_modules/` + `.dev.vars`:

```
--- generated .gitignore ---          --- generated wrangler.jsonc (tracked) ---
node_modules/                         "vars": {
.dev.vars                               "DATABASE_URL": "postgresql://carla:SUPERSECRET@ep-…neon.tech/workers_db",
                                        "ADMIN_PASSWORD_HASH": "pbkdf2$210000$D--n…",
                                        "CSRF_SECRET": "b6b6df34071cebeaf3724f932594596289ea6421…"
                                      }
```

The customer's first `git init && git add . && git push` — the normal "deploy a Worker from a repository"
flow the README points at — commits their production database password and session-signing key.
This contradicts the package's own `.dev.vars` header ("Never commit this file") and
`README.md`'s "The database URL and admin password are only used to build the ZIP in memory".

The trade-off is deliberate (`wrangler.jsonc:12-15` comment: `.dev.vars` is not uploaded by Wrangler),
but it is currently the *only* mechanism, and it is unguarded.

**Fix options:** add `wrangler.jsonc` to the generated `.gitignore` and ship a `wrangler.jsonc.example`
plus a postinstall copy step; or keep the baking but have `set-secrets.mjs` strip `vars` after
`wrangler secret put`, and warn about it in the generated README.

---

## F8 · P3 — Feature toggles have two sources of truth, and the dashboard never hides disabled modules

**Status: fixed (2026-10-15).**

- **API guards read the build-time config:** `DEFAULT_CONFIG` is the compiled-in `__SITE_CONFIG_JSON__`
  (`cloudflare/src/index.js:11`). Guards at the public routes test `DEFAULT_CONFIG.features.*`.
- **The stored config is live and editable:** `cleanSiteConfig` persists `features`
  (`cloudflare/src/index.js:99`), and `site.js:13` + `refreshSiteConfig()` honor the **live** `/api/site`
  value when hiding sections.
- **Owner write routes are now gated** at the same flag the public read route uses. Every
  `/api/admin/posts` (GET/POST/PUT/DELETE), `/api/admin/gallery` (GET/POST/PUT/DELETE),
  `/api/admin/appointments` (GET/PATCH), `/api/admin/appointments/:id/note` (PUT),
  `/api/admin/payments` (GET), `/api/admin/payments/unpaid` (GET/PATCH), `/api/admin/payment-proofs/:id`
  (GET/PATCH), and `/api/admin/payment-proofs/:id/image` (GET) in both runtimes returns `404` with
  `"… is not enabled for this site."` when the matching feature is off.
- **The dashboard now hides disabled pages.** `admin.js` introduces `pagesDisabledByFeatures()` and
  `FEATURE_PAGE_IDS`, which hide the blog/gallery/availability/appointments/payments nav buttons and
  pages, and fall back to the **identity** page when the URL still names a hidden page (e.g. a stale
  bookmark after a feature toggle). `loadSite()` calls `showAdminPage` after merging the live
  `/api/site` config so the page list reacts to the live toggle, not just the build-time flag.

**Why the two sources of truth remain:** the build-time `DEFAULT_CONFIG` is what the runtime can
verify at request time without a database call (and what `site.js` would have to know about on the
client too), and the live `tele_sites.config.features` is the operator's edit. The owner can flip a
toggle from the dashboard, and `site.js` already honors the live value for the public UI; the gap was
that the owner dashboard ignored both. Both now do.

**QA coverage:** `test/deployment-fixes.test.js` — "owner write routes for blog, gallery, and
scheduling are gated by their features" — asserts every blog/gallery/scheduling admin route checks
the matching `features.*` flag and that `admin.js` defines `pagesDisabledByFeatures` and
`FEATURE_PAGE_IDS` in both runtimes.

---

## F9 · P3 — Brivon continuity on functional pages asks for fonts those pages never load

`brivon.css:1347-1360` restyles appointments/custom pages via `body.theme-brivon-*:not(.brivon-shell)`
and sets:

```css
font-family:'Boldonse','Archivo Black',sans-serif !important   /* h1–h8, line 1353 */
font-family:'Inter Tight',Inter,system-ui,sans-serif           /* body,  line 1351 */
```

Only `designs/brivon-index.html:9-11` loads the Google Fonts stack. `appointments.html:7-8`,
`admin.html:6-7` and the generated custom pages (`package-core.js:428-455`) load stylesheets only, and
`brivon.css` contains **no `@font-face`**. So on a Brivon package the colors, surfaces and radii of the
continuity layer apply, but every heading silently falls through `Boldonse` → `Archivo Black` → generic
sans-serif. The typography half of "Brivon continuity for functional appointment and generated custom
pages" cannot take effect.

Related: custom pages are always emitted with the **Illustration** skeleton — `<body class="custom-page">`
(no `brivon-shell`), `.announcement` / `.site-header` / `.custom-page-card` markup, and no `brivon.js`
script (which early-returns without `.brivon-shell` anyway, `brivon.js:6`). A Brivon site's custom pages
therefore have a different header/nav/footer structure from its homepage.

**Fix:** add the fonts `<link>` (or `@font-face` with self-hosted files) to `appointments.html` and to
`generatedCustomPageHtml()` when `theme` starts with `brivon-`.

---

## F10 · P4 — Dead payload, dead exports, latent cap mismatch

**Silently discarded builder payload.** `app.js:433-436` sends `heroEyebrow`, `heroHeadline`, `heroText`
and `services`; `normalizeConfig` ignores all four and re-derives them from its own `VERTICALS` table
(`package-core.js:211`). The two tables happen to agree today, so nothing is visibly wrong — but editing
the hero copy in `app.js` has **zero** effect on the preview or the ZIP. `app.js`'s `VERTICALS` keys
`short`, `icon`, `blogTitle` and `patient` are never read anywhere.

**Exported but never imported** (including by tests): `ADMIN_PASSWORD_ITERATIONS`
(`lib/admin-security.js`), `ADMIN_ANIMALS_BY_MONDAY_FIRST_DAY` (`lib/admin-url.js`), `safeMenuHref`
(`lib/menu-links.js` — the browser files carry their own near-duplicate copies: `site.js:37`
`safeMenuNavigationHref`, `admin.js:148` `safeMenuDestination`), `fetchTemplate` (`package-builder.js`),
`splitSqlStatements` (`package-core.js`), `crc32` (`zip.js`).

**Preview cap vs. editor budget.** `src/index.js:150` caps `/api/preview` at 16 KB, but the page editor
allows `MAX_PAGE_EDITS = 64` × `MAX_PAGE_EDIT_TEXT = 2000` (`package-core.js:620-621`) and
`livePreviewConfig()` ships them in the query (`app.js:192`). Worst case encodes to **132,880 bytes → 413**
on the server-preview fallback. Realistic use is far below (24 typical edits ≈ 4 KB), and the
browser-first preview path hides it — latent, not active. `/api/generate` (256 KB) is unaffected.

**Status: fixed (2026-10-15).** The hero-copy branch in `public/package-core.js:normalizeConfig` now reads `input.heroEyebrow / heroHeadline / heroText / services` with `clean()` (and `slice(0,12)` for the service list); the vertical table is the fallback. The dead exports `safeMenuHref`, `fetchTemplate`, `splitSqlStatements`, `crc32` were removed from their `export { ... }` lists. The `lib/menu-links.js` helper was renamed to `cleanMenuHref(value, baseOrigin)` and given a comment block documenting that `site.js:safeMenuNavigationHref` and `admin.js:safeMenuDestination` must stay byte-for-byte identical (the two browser copies now carry the same "must stay in sync" comment). The preview cap was raised to 128 KB so a 64×2000-byte page-edit list can no longer 413. Tests added: `cleanMenuHref sanitises same-origin paths and https absolute URLs and rejects everything else`, `cleanMenuLinks uses cleanMenuHref to drop bad hrefs but keeps well-formed entries`, `the browser copies of the menu-href sanitizer stay in sync with the server`, `the preview route accommodates the full MAX_PAGE_EDITS * MAX_PAGE_EDIT_TEXT budget`. The `builder live preview rejects missing, invalid or oversized configurations` test was updated to use a 130 KB payload (the new 128 KB cap rejects 130 KB, accepted the previous 17 KB).

---

## Suggested order

1. **F1** — rotate the leaked Neon password; fix `.gitignore`; untrack `.env` / `.dev.vars` / `.wrangler/state`.
2. **F2** — four-word fix in `payment-reminders.js`, plus a test that asserts the *table identifiers*
   (e.g. run the sweep against PGlite, or `assert.doesNotMatch(reminders, /(?:UPDATE|FROM)\s+(?!tele_)/)`).
3. **F3 + F4 + F5** — finish the page-edit round trip: read on load, report failures, clear server-side.
4. **F6** — one shared `slugify`.
5. **F7** — decide the `wrangler.jsonc` secrets story before customers push their first repo.
6. **F8, F9** — feature-flag consistency and Brivon fonts on functional pages.
7. **F10** — cleanup.
