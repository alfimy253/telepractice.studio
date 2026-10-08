import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifyPasswordHash } from '../public/_scaffold/templates/shared/lib/admin-security.js';
import worker from '../src/index.js';

const origin = 'https://builder.example';
const adminInput = {
  adminUsername: 'practiceowner',
  adminEmail: 'owner@example.test',
  adminPassword: 'CanopyOwner!8'
};
const assets = {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    return new Response(await readFile(new URL(`../public${path}`, import.meta.url)));
  }
};
async function session(env = {}, base = origin) {
  const response = await worker.fetch(new Request(`${base}/api/csrf`), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const { token } = await response.json();
  const setCookie = response.headers.get('Set-Cookie');
  assert.match(setCookie, /HttpOnly; SameSite=Strict/);
  if (base.startsWith('https:')) {
    assert.match(setCookie, /^__Host-canopy_builder_csrf=/);
    assert.match(setCookie, /; Secure/);
    assert.doesNotMatch(setCookie, /Domain=/i);
  }
  return { token, cookie: setCookie.split(';')[0] };
}
function generate(env, auth, headers = {}, target = 'vercel', adminOverrides = {}) {
  return worker.fetch(new Request(`${origin}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin,
      Cookie: auth.cookie, 'X-CSRF-Token': auth.token, ...headers },
    body: JSON.stringify({ target, businessName: 'Test Practice', ...adminInput, ...adminOverrides })
  }), env);
}
function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const files = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + size;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    files.set(name, decoder.decode(bytes.subarray(dataStart, dataEnd)));
    offset = dataEnd;
  }
  return files;
}
test('builder and owner UI contain edit-page navigation but no admin-key connection flow', async () => {
  const [builderHtml, ownerHtml, ownerJs] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/_scaffold/templates/shared/public/admin.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/_scaffold/templates/shared/public/admin.js', import.meta.url), 'utf8')
  ]);
  assert.match(builderHtml, /id="adminUsername"/);
  assert.match(builderHtml, /id="adminEmail"/);
  assert.match(builderHtml, /id="adminPassword"/);
  for (const pageId of ['identity', 'menu', 'appearance', 'blog', 'gallery', 'availability', 'appointments']) {
    assert.match(ownerHtml, new RegExp(`data-admin-page-link="${pageId}"`));
    assert.match(ownerHtml, new RegExp(`data-admin-page="${pageId}"`));
  }
  assert.doesNotMatch(`${builderHtml}\n${ownerHtml}\n${ownerJs}`, /ADMIN_API_KEY|adminKey|keyForm|sessionStorage|Bearer/i);
});
for (const secret of ['', 'test-only-secret']) {
  for (const target of ['vercel', 'cloudflare']) {
    test(`downloads ${target} ZIP ${secret ? 'with' : 'without'} a configured builder CSRF secret`, async () => {
      const env = { CSRF_SECRET: secret, ASSETS: assets };
      const auth = await session(env);
      const response = await generate(env, auth, {}, target);
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get('Content-Type'), 'application/zip');
      const bytes = new Uint8Array(await response.arrayBuffer());
      assert.deepEqual([...bytes.slice(0, 4)], [80, 75, 3, 4]);
      assert.ok(bytes.length > 1000);
    });
  }
  test(`rejects invalid builder CSRF requests ${secret ? 'with' : 'without'} signing`, async () => {
    const env = { CSRF_SECRET: secret };
    const auth = await session(env);
    for (const headers of [
      { Origin: 'https://evil.example' },
      { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'same-site' },
      { Cookie: '' },
      { Cookie: `canopy_builder_csrf=${auth.token}` },
      { 'X-CSRF-Token': '' },
      { 'X-CSRF-Token': `${auth.token}tampered` }
    ]) assert.equal((await generate(env, auth, headers)).status, 403);
    const invalid = 'invalid';
    assert.equal((await generate(env, { token: invalid, cookie: `__Host-canopy_builder_csrf=${invalid}` })).status, 403);
  });
}
test('generated Vercel and Cloudflare packages include private admin login settings and no admin API key', async () => {
  for (const target of ['vercel', 'cloudflare']) {
    const env = { ASSETS: assets };
    const auth = await session(env);
    const response = await generate(env, auth, {}, target, {
      customPages: [{ id: 'privacy', menuName: 'Privacy', url: '/privacy', pageTitle: 'Privacy policy', pageContent: 'Our privacy policy.' }]
    });
    assert.equal(response.status, 200, await response.clone().text());
    const files = zipEntries(new Uint8Array(await response.arrayBuffer()));
    const envName = target === 'cloudflare' ? '.dev.vars' : '.env';
    const variables = files.get(envName);
    assert.ok(variables, `expected generated ${envName}`);
    assert.match(variables, /^ADMIN_USERNAME="?practiceowner"?$/m);
    assert.match(variables, /^ADMIN_EMAIL="?owner@example\.test"?$/m);
    const passwordHash = variables.match(/^ADMIN_PASSWORD_HASH="?([^\r\n"]+)"?$/m)?.[1];
    assert.ok(passwordHash, 'expected an administrator password hash in the environment file');
    assert.equal(await verifyPasswordHash(adminInput.adminPassword, passwordHash), true);
    if (target === 'vercel') assert.match(variables, /^CRON_SECRET=[A-Za-z0-9]+$/m);
    assert.doesNotMatch(variables, /ADMIN_API_KEY=/);
    assert.doesNotMatch(variables, new RegExp(adminInput.adminPassword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(files.get('.gitignore'), new RegExp(`^${envName.replace('.', '\\.')}\\n`, 'm'));

    const adminHtmlPath = target === 'cloudflare' ? 'public/admin.html' : 'admin.html';
    const adminHtml = files.get(adminHtmlPath);
    assert.ok(adminHtml, 'expected the admin login page');
    assert.match(adminHtml, /id="menuLinksForm"/);
    assert.match(adminHtml, /id="menuLinksList"/);
    assert.match(adminHtml, /action="\/api\/admin\/login"/);
    assert.doesNotMatch(adminHtml, new RegExp(`value="${adminInput.adminUsername}"`));
    assert.doesNotMatch(adminHtml, new RegExp(`value="${adminInput.adminPassword}"`));
    for (const pageId of ['identity', 'menu', 'appearance', 'blog', 'gallery', 'availability', 'appointments', 'payments']) {
      assert.match(adminHtml, new RegExp(`data-admin-page-link="${pageId}"`));
      assert.match(adminHtml, new RegExp(`data-admin-page="${pageId}"`));
    }
    const adminJsPath = target === 'cloudflare' ? 'public/admin.js' : 'admin.js';
    const adminJs = files.get(adminJsPath);
    assert.match(adminJs, /showAdminPage/);
    assert.match(adminJs, /pushState/);
    assert.match(adminJs, /safeMenuDestination/);
    assert.match(adminJs, /menuLinks: links/);
    assert.doesNotMatch(`${adminHtml}\n${adminJs}\n${files.get(target === 'cloudflare' ? 'public/admin.css' : 'admin.css')}`, /ADMIN_API_KEY|adminKey|keyForm|sessionStorage|Bearer/i);

    const publicConfigPath = target === 'cloudflare' ? 'public/site-config.js' : 'site-config.js';
    const publicConfig = files.get(publicConfigPath);
    assert.doesNotMatch(publicConfig, /owner@example\.test|practiceowner/);
    const generatedConfig = JSON.parse(publicConfig.slice(publicConfig.indexOf('=') + 1).trim().replace(/;$/, ''));
    assert.deepEqual(generatedConfig.menuLinks.slice(0, 7).map(({ id }) => id), ['home', 'care', 'about', 'gallery', 'journal', 'appointments', 'contact']);
    assert.deepEqual(generatedConfig.menuLinks.at(-1), { id: 'custom-privacy', label: 'Privacy', href: '/privacy.html' });
    assert.ok(files.has(target === 'cloudflare' ? 'public/privacy.html' : 'privacy.html'));
    assert.match(files.get(target === 'cloudflare' ? 'public/site.js' : 'site.js'), /renderMenuNavigation/);
    assert.ok(files.has('lib/menu-links.js'), 'expected shared safe menu-link normalization');
    assert.ok(files.has('lib/payment-proof.js'), 'expected the private payment proof image helper');
    assert.ok(files.has('lib/payment-reminders.js'), 'expected shared payment reminder queries');
    assert.ok(files.has('payment-reminder-worker.js'), 'expected the standalone Node.js payment reminder worker');
    const siteRuntime = files.get(target === 'cloudflare' ? 'src/index.js' : 'api/index.js');
    assert.match(siteRuntime, /cleanMenuLinks\(merged\.menuLinks, DEFAULT_CONFIG\.menuLinks\)/);
    assert.match(siteRuntime, /\.\.\/lib\/menu-links\.js/);
    assert.doesNotMatch(files.get('db/seed.sql'), /owner@example\.test|practiceowner|ADMIN_PASSWORD_HASH/);
    const siteFiles = [...files.values()].join('\n');
    assert.doesNotMatch(siteFiles, new RegExp(adminInput.adminPassword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(files.get('README.md'), /Tuesday.*rat.*Wednesday.*ant/s);
    assert.match(files.get('README.md'), /\/tadmin8\/dashboard/);
    assert.match(files.get('README.md'), /Menu links view.*rename, reorder, add or remove/s);
    assert.doesNotMatch(files.get('README.md'), /practiceowner|owner@example\.test|CanopyOwner!8/);
    const deployableFiles = [...files.entries()]
      .filter(([path]) => path !== envName && path !== 'README.md' && !path.startsWith('db/'))
      .map(([, contents]) => contents).join('\n');
    assert.doesNotMatch(deployableFiles, /practiceowner|owner@example\.test|CanopyOwner!8/);
    assert.match(files.get(target === 'cloudflare' ? 'src/index.js' : 'api/index.js'), /adminDashboardPath/);
    if (target === 'cloudflare') {
      assert.match(files.get('package.json'), /"sharp": "0\.35\.5"/);
      assert.match(files.get('wrangler.jsonc'), /"run_worker_first": true/);
      assert.match(files.get('wrangler.jsonc'), /"crons": \["\* \* \* \* \*"\]/);
      assert.match(files.get('src/index.js'), /async scheduled\(_controller, env, ctx\)/);
    } else {
      assert.match(files.get('package.json'), /"node": ">=20\.6"/);
      assert.match(files.get('vercel.json'), /:adminSegment\/dashboard/);
      assert.match(files.get('vercel.json'), /payment-sweeps.*\* \* \* \* \*/);
      assert.match(files.get('api/index.js'), /CRON_SECRET/);
    }
    assert.match(files.get('README.md'), /Bookings remain scheduled after 15 minutes/);
    assert.match(files.get('README.md'), /even if the owner has independently marked the payment received/);
    assert.match(files.get('README.md'), /schema\.sql.*safe to rerun/s);
    assert.match(files.get('README.md'), /90-second client-reminder checks and 3-minute owner-follow-up checks/);
  }
});

test('builder rejects weak or incomplete administrator credentials before creating a ZIP', async () => {
  const env = { ASSETS: assets };
  const auth = await session(env);
  const invalidAccounts = [
    { adminPassword: 'Abcdef1!234' },
    { adminPassword: 'ABCDEFGHIJ1!' },
    { adminPassword: 'abcdefghij1!' },
    { adminPassword: 'Abcdefghij!!' },
    { adminPassword: 'Abcdefghij12' },
    { adminUsername: 'x' },
    { adminEmail: 'bad-address' }
  ];
  for (const invalid of invalidAccounts) {
    const response = await generate(env, auth, {}, 'vercel', invalid);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /administrator/i);
  }
});

test('configured signing rejects forged matching CSRF cookie and header', async () => {
  const token = `${'a'.repeat(32)}.${'b'.repeat(43)}`;
  assert.equal((await generate({ CSRF_SECRET: 'secret' }, {
    token, cookie: `__Host-canopy_builder_csrf=${token}`
  })).status, 403);
});
test('builder CSRF token issuance rejects cross-origin requests', async () => {
  const response = await worker.fetch(new Request(`${origin}/api/csrf`, {
    headers: { Origin: 'https://evil.example' }
  }), {});
  assert.equal(response.status, 403);
});
test('builder CSRF tokens are random and HTTP localhost remains supported', async () => {
  const a = await session({}, 'http://localhost:8787');
  const b = await session({}, 'http://localhost:8787');
  assert.notEqual(a.token, b.token);
  assert.match(a.cookie, /^canopy_builder_csrf=/);
});
test('builder rejects oversized streamed JSON bodies without buffering them in full', async () => {
  const env = { ASSETS: assets };
  const auth = await session(env);
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(256 * 1024 + 1));
      controller.close();
    }
  });
  const request = new Request(`${origin}/api/generate`, {
    method: 'POST',
    headers: { Origin: origin, Cookie: auth.cookie, 'X-CSRF-Token': auth.token, 'Content-Type': 'application/json' },
    body,
    duplex: 'half'
  });
  assert.equal(request.headers.get('Content-Length'), null);
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /too large/i);
});

test('builder exposes Brivon in the layout section and guided modal and updates the preview', async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8')
  ]);
  assert.match(html, /<select id="designSystemSelect">[\s\S]*Brivon · Dark[\s\S]*Brivon · Light/);
  assert.match(app, /id="wizardDesignSystem"[\s\S]*Brivon · Dark[\s\S]*Brivon · Light/);
  assert.match(app, /designSystemSelect'\)\.addEventListener\('change',[\s\S]*setDesignSystem/);
  assert.match(app, /wizardDesignSystem'\)\.addEventListener\('change',[\s\S]*setDesignSystem/);
  assert.match(app, /screen\.classList\.add\(`theme-\$\{config\.theme\}`\)/);
  assert.match(styles, /\.preview-screen\.theme-brivon-dark/);
  assert.match(styles, /\.preview-screen\.theme-brivon-light/);
  assert.match(styles, /theme-brivon-dark \.site-hero-preview/);
});

test('Brivon light and dark generate a separate design-system homepage', async () => {
  for (const theme of ['brivon-dark', 'brivon-light']) {
    const env = { ASSETS: assets };
    const auth = await session(env);
    const response = await generate(env, auth, {}, 'vercel', { theme });
    assert.equal(response.status, 200, await response.clone().text());
    const files = zipEntries(new Uint8Array(await response.arrayBuffer()));
    assert.match(files.get('index.html'), new RegExp(`class="brivon-shell theme-${theme}"`));
    assert.match(files.get('index.html'), /href="\/brivon\.css"/);
    assert.match(files.get('index.html'), /src="\/brivon\.js"/);
    assert.match(files.get('brivon.css'), /line-height:calc\(1em \+ 5px\)/);
    assert.match(files.get('appointments.html'), /href="\/brivon\.css"/);
    const config = JSON.parse(files.get('site-config.js').split('=').slice(1).join('=').trim().replace(/;$/, ''));
    assert.equal(config.theme, theme);
  }
});

test('builder downloads still work behind a proxy that changes Host or terminates TLS', async () => {
  const env = { ASSETS: assets };
  const proxyOrigin = 'https://8787-preview.example';
  const cases = [
    { Origin: proxyOrigin, 'Sec-Fetch-Site': 'same-origin' },
    { Origin: proxyOrigin, 'X-Forwarded-Host': '8787-preview.example' },
    { Origin: 'https://builder.example', 'Sec-Fetch-Site': 'same-origin' }
  ];
  for (const headers of cases) {
    const issued = await worker.fetch(new Request(`${origin}/api/csrf`, { headers }), env);
    assert.equal(issued.status, 200, `csrf rejected for ${JSON.stringify(headers)}`);
    const { token } = await issued.json();
    const cookie = issued.headers.get('Set-Cookie').split(';')[0];
    const response = await generate(env, { token, cookie }, { ...headers, 'Sec-Fetch-Site': 'same-origin' }, 'cloudflare');
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('Content-Type'), 'application/zip');
  }
});

test('builder accepts an explicitly allowed origin suffix but not a look-alike', async () => {
  const env = { ASSETS: assets, ALLOWED_ORIGINS: 'https://other.example, *.preview.example' };
  const allowed = await worker.fetch(new Request(`${origin}/api/csrf`, { headers: { Origin: 'https://8787.preview.example' } }), env);
  assert.equal(allowed.status, 200);
  const { token } = await allowed.json();
  const cookie = allowed.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await generate(env, { token, cookie }, { Origin: 'https://8787.preview.example' })).status, 200);
  for (const host of ['https://preview.example.evil', 'https://evilpreview.example']) {
    assert.equal((await worker.fetch(new Request(`${origin}/api/csrf`, { headers: { Origin: host } }), env)).status, 403);
  }
});

async function previewDocument(input) {
  const response = await worker.fetch(
    new Request(`${origin}/api/preview?config=${encodeURIComponent(JSON.stringify(input))}`), { ASSETS: assets }
  );
  assert.equal(response.status, 200, await response.clone().text());
  assert.match(response.headers.get('Content-Type'), /^text\/html/);
  return response.text();
}

test('builder live preview renders the real Brivon service-page layout', async () => {
  for (const theme of ['brivon-dark', 'brivon-light']) {
    const html = await previewDocument({
      theme, businessName: 'Preview Practice', brandName: 'Preview', location: 'Makati, Philippines',
      email: 'hello@preview.example', phone: '+63 2 8000 0000',
      payments: { gcashName: 'Preview Practice', gcashNumber: '+63 900 000 0000', mayaName: 'Preview Practice', mayaNumber: '+63 900 000 0001' },
      customPages: [{ id: 'rates', menuName: 'Rates', url: '/rates.html', pageTitle: 'Rates', pageContent: 'Our rates.' }]
    });
    assert.match(html, new RegExp(`class="brivon-shell theme-${theme}"`));
    // The template's service-page layout, section by section.
    for (const section of ['tier-grid', 'tier-card featured', 'process-grid', 'faq-grid', 'closing-cta', 'site-footer']) {
      assert.match(html, new RegExp(section), `missing ${section}`);
    }
    // Self-contained: the stylesheet is inlined, scripts and tokens are gone.
    assert.match(html, /<style>\n[\s\S]*\.brivon-shell \.tier-grid/);
    assert.doesNotMatch(html, /<script/);
    assert.doesNotMatch(html, /__[A-Z_]+__/);
    // site.js-rendered regions are pre-rendered from the builder settings.
    assert.match(html, /id="siteNav"[\s\S]*?<a href="#home">Rates<\/a>/);
    assert.match(html, /id="drawerNav"[\s\S]*?<a href="#home">Rates<\/a>/);
    // Nothing in the preview can navigate the frame to a page the builder
    // does not serve; same-page anchors survive.
    assert.doesNotMatch(html, /href="\//);
    assert.match(html, /<a href="#care">Our care<\/a>/);
    assert.match(html, /class="gallery-card gallery-card-0"/);
    assert.match(html, /class="post-card"/);
    assert.match(html, /class="footer-payment-method"><strong>GCash<\/strong>/);
    assert.match(html, /data:image\/svg\+xml/);
    assert.doesNotMatch(html, /loading-copy">A few scenes/);
    assert.doesNotMatch(html, /loading-copy">New notes/);
  }
});

test('builder live preview follows the specialty, features and contact details', async () => {
  const html = await previewDocument({
    specialty: 'dental', theme: 'brivon-dark', businessName: 'Brightside Dental Studio',
    email: 'hello@brightside.example', phone: '+63 2 8123 4567',
    features: { blog: false, gallery: true, scheduling: false }
  });
  assert.match(html, /id="heroHeadline">A reason to<br><em>smile easier\.<\/em>/);
  assert.match(html, /<h3 class="service-title">Preventive care<\/h3>/);
  assert.match(html, /<section id="journal" class="hidden">/);
  assert.match(html, /<section id="book" class="closing-cta hidden">/);
  assert.doesNotMatch(html, /Wellness &amp; prevention/);
  assert.match(html, /Brightside Dental Studio/);
});

test('builder live preview keeps working with half-finished input', async () => {
  const html = await previewDocument({ theme: 'brivon-dark', email: 'not-an-email', customPages: [{ menuName: '' }] });
  assert.match(html, /class="brivon-shell theme-brivon-dark"/);
  assert.match(html, /Harborlight Veterinary Care/);
});

test('builder live preview rejects missing, invalid or oversized configurations', async () => {
  const call = (query) => worker.fetch(new Request(`${origin}/api/preview${query}`), { ASSETS: assets });
  assert.equal((await call('')).status, 400);
  assert.equal((await call('?config=%7Bbroken')).status, 400);
  assert.equal((await call(`?config=${encodeURIComponent(JSON.stringify({ businessName: 'a'.repeat(17 * 1024) }))}`)).status, 413);
});

test('builder swaps the preview panel to the generated Brivon homepage', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8')
  ]);
  assert.match(html, /id="previewScreenBrivon" hidden/);
  assert.match(html, /<iframe class="brivon-preview-frame" id="brivonPreviewFrame"[^>]*sandbox=""/);
  assert.match(app, /\/api\/preview\?config=/);
  assert.match(app, /frame\.srcdoc = html/);
  assert.match(app, /syncPreviewSurface\(\);\n  saveConfig\(\);/);
  assert.match(app, /BRIVON_PREVIEW_WIDTHS\[/);
});

test('Brivon continuity rules never restyle the Brivon homepage', async () => {
  // The homepage body is `brivon-shell theme-brivon-dark`, so a compatibility
  // rule written for the site.css pages would also match it and win on
  // specificity, repainting the real template (and turning --paper, and with
  // it --fg, into the page background color).
  const css = await readFile(new URL('../public/_scaffold/templates/shared/public/brivon.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf('Brivon continuity for functional'));
  const selectors = [...block.matchAll(/(?:^|\})\s*((?:body\.theme-brivon-[^{]+))\{/gm)]
    .flatMap((match) => match[1].split(',').map((selector) => selector.trim())).filter(Boolean);
  assert.ok(selectors.length >= 40, `expected to parse the compatibility layer, found ${selectors.length}`);
  for (const selector of selectors) {
    assert.match(selector, /body\.theme-brivon-(dark|light):not\(\.brivon-shell\)/, `unscoped compatibility selector: ${selector}`);
  }
  assert.doesNotMatch(css, /body\.theme-brivon-(dark|light)\s*\{/);
  assert.doesNotMatch(css, /body\.theme-brivon-(dark|light)\s+[a-z]/);
  // The template's own heading spacing must survive on the homepage.
  assert.match(css, /\.brivon-shell \.hero-headline \{[\s\S]{0,120}line-height: 1\.15/);
  assert.match(css, /\.brivon-shell \.hero-headline em \{ color: var\(--lime\)/);
});

test('downloaded Brivon packages scope the continuity layer away from the shell', async () => {
  const env = { ASSETS: assets };
  const auth = await session(env);
  const response = await generate(env, auth, {}, 'vercel', { theme: 'brivon-dark' });
  assert.equal(response.status, 200, await response.clone().text());
  const files = zipEntries(new Uint8Array(await response.arrayBuffer()));
  const css = files.get('brivon.css');
  assert.match(css, /:not\(\.brivon-shell\)/);
  assert.doesNotMatch(css, /body\.theme-brivon-dark\s*\{/);
  // The continuity layer is still there for the site.css pages.
  assert.match(css, /body\.theme-brivon-dark:not\(\.brivon-shell\) \.site-header/);
  assert.match(files.get('appointments.html'), /href="\/brivon\.css"/);
});

test('builder live preview accepts menu-only custom pages and stays within its limit', async () => {
  const pages = Array.from({ length: 8 }, (_, index) => ({ menuName: `Page ${index + 1}`, url: `/page-${index + 1}.html` }));
  const html = await previewDocument({ theme: 'brivon-dark', customPages: pages });
  for (const page of pages) assert.match(html, new RegExp(`<a href="#home">${page.menuName}</a>`), `missing ${page.menuName}`);
  const encoded = encodeURIComponent(JSON.stringify({ theme: 'brivon-dark', customPages: pages }));
  assert.ok(encoded.length < 16 * 1024, `menu-only payload should stay small, was ${encoded.length}`);
  // A page whose title or body is still empty in the wizard must not drop the
  // whole menu from the preview.
  const partial = await previewDocument({ theme: 'brivon-dark', customPages: [{ menuName: 'Grooming', url: '/grooming.html' }] });
  assert.match(partial, /<a href="#home">Grooming<\/a>/);
  // And the builder really does trim page bodies out of the preview request.
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /customPages: normalizeSavedPages\(config\.customPages\)\.map\(\(\{ menuName, url \}\) => \(\{ menuName, url \}\)\)/);
});
