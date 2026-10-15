# Documentation vs code

**Aligned:** 2026-10-16 against this working tree. Password length is **8–25 for every user type** (`PASSWORD_MIN = 8`). Owner login code bugs from Bug Fix No. 204 are closed (`authenticated: true`, stale dashboard form, forwarded-proto cookies, quoted hashes). `npm test` **135/135**. Live sections of `system-rules.md`, `current_code.md`, and `README.md` match the code. Dated work lists in `current_code.md` stay as history. `code-audit-findings.md` is a 2026-10-13 snapshot.

This file is the leftover list after that pass — not a second copy of the rules.

---

## Still true in the code, and now stated in the live docs

- `PASSWORD_MIN = 8` / `PASSWORD_MAX = 25` for every user type (builder admin, owner sign-in / change-password, client sign-up / sign-in). Client sign-up (`registerProblem()`) uses the same four character classes as the owner; `verifyPasswordHash()` only checks length.
- `ensureSiteRow` is `ON CONFLICT DO UPDATE … WHERE updated_at = created_at`. `db/seed.sql` stays `DO NOTHING`.
- First live URL after deploy inserts owner username/email/password hash into Neon `tele_admin_users` (same database as `tele_client_accounts`). Login reads that row. Cron still does not bootstrap.
- Schema bootstrap is **59** statements (~16.3 KB). Do not treat “12 CREATE / 17 ALTER / 14 INDEX” as the split-statement checklist.
- Guests: empty month grid, `#guestWhatWeDo`, no booking controls; `/api/availability` 401. `#guestWhatWeDo` is Brivon copy on Illustration `.service-card` markup (not a clone of either homepage).
- Preview cap is **128 KB**.
- Builder forces `features.blog = true`; runtime `cleanSiteConfig()` does not, so a stale DB `blog: false` can still hide Journal (*To Be Implemented*).
- Owner dashboard path uses the Monday-first weekday animals (dog/rat/ant/fish/fly/cat/cockroach), not the zodiac. Cloudflare serves the login form on any `*adminN/dashboard` path and 302s a signed-in owner to today; Vercel rewrites any `/:adminSegment/dashboard`. Login JSON includes `authenticated: true`, so `followDashboardPath()` runs after sign-in.
- Cloudflare CSP via `headersWithSecurity()`; Vercel via `helmet()`.
- `.gitignore` lists `.dev.vars` / `.env` / `.wrangler/`; those paths can still be in the git index.
- Owner login remaining **operational** limits: Workers Free 10 ms CPU vs PBKDF2 210,000; a Worker secret named `ADMIN_PASSWORD_HASH` shadows `vars`; forms need `CSRF_SECRET` or `DATABASE_URL`. See Bug Fix No. 204 in `current_code.md`.
- `npm test` in this tree: **135**.

---

## Not updated (on purpose)

### Dated history in `current_code.md`

Work lists and bug records from 2026-10-09 through 2026-10-15 still describe the code as it was then (`PASSWORD_MIN = 7` as an intermediate floor, `INSERT INTO sites … DO NOTHING`, `npm test` 69/72/78/82/106/125/127, public calendar with slots, etc.). Those paragraphs stay as snapshots. Password “now” sentences that would still say 7–25 have a 2026-10-16 current-code note (**8–25**).

### `code-audit-findings.md`

The body is still the 2026-10-13 write-up. The header table records which findings the 2026-10-16 tree contradicts.

---

## Acknowledged gaps (docs and code already agree)

1. Runtime does not force `features.blog = true` after merging `tele_sites.config` (*To Be Implemented*).
2. GCash/Maya numbers still ship in public `site-config.js` (Rule E5 known limit).
3. Template fixes do not reach already-deployed ZIPs (Rule G3).
4. Generated Cloudflare sites on the Workers Free plan cannot complete owner login (PBKDF2 vs 10 ms CPU). Deploy Paid or Vercel.
