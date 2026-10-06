import { createZip } from './zip.js';

const encoder = new TextEncoder();
const THEME_DEFAULTS = {
  canopy: { primaryColor: '#376f62', accentColor: '#e9b36e', paperColor: '#fbf8f1' },
  clay: { primaryColor: '#ac6550', accentColor: '#e8b897', paperColor: '#fbf6ef' },
  coastal: { primaryColor: '#397c87', accentColor: '#dfb75d', paperColor: '#f4f8f7' },
  editorial: { primaryColor: '#202522', accentColor: '#c9a45b', paperColor: '#f6f5f1' },
  neat: { primaryColor: '#2d8078', accentColor: '#f0b768', paperColor: '#f7faf9' },
  launcher: { primaryColor: '#c33e55', accentColor: '#f0c85c', paperColor: '#fff9f1' },
  air: { primaryColor: '#dd356e', accentColor: '#fee856', paperColor: '#ffffff' }
};
const EDITORIAL_ACCENTS = { black: '#202522', teal: '#187c78', forest: '#2e6049' };
const VERTICALS = {
  veterinary: {
    label: 'Veterinary clinic', brandName: 'Harborlight', eyebrow: 'A LITTLE MORE CARE, EVERY DAY',
    headline: 'Good care for\ngood companions.', heroText: 'Thoughtful veterinary care, built around the lives you share.',
    services: ['Wellness & prevention', 'Gentle diagnostics', 'Everyday support'],
    posts: [
      { title: 'A calmer first visit starts here', slug: 'a-calmer-first-visit', excerpt: 'A few small things can make a new clinic visit feel easier for everyone.', category: 'First visits', body: 'A good first visit starts with a little time and a lot of listening. Bring any questions you have, and let us know what helps your companion feel safe. We will walk you through each step and make a plan together.' },
      { title: 'The little check-ins that matter', slug: 'little-check-ins-that-matter', excerpt: 'Preventive care is less about doing more and more about noticing early.', category: 'Everyday care', body: 'Regular wellness visits give us a chance to notice small changes, answer questions, and keep a simple record of what is normal for your pet. A steady rhythm of care can make the unexpected feel a little less surprising.' },
      { title: 'Making room for a slower hello', slug: 'a-slower-hello', excerpt: 'A visit can begin at your pet’s pace. Here are a few ways we make space.', category: 'Our approach', body: 'Every pet arrives with a different story. We make room for a quiet introduction, a pause when it helps, and a conversation about what works best at home.' }
    ]
  },
  dental: {
    label: 'Dental practice', brandName: 'Brightside', eyebrow: 'A BRIGHTER KIND OF DENTAL CARE',
    headline: 'A reason to\nsmile easier.', heroText: 'Modern, thoughtful dentistry with your comfort at the center.',
    services: ['Preventive care', 'Restorative dentistry', 'Cosmetic treatments'],
    posts: [
      { title: 'A gentler start to your first visit', slug: 'a-gentler-first-visit', excerpt: 'A few simple ways we make a new-patient appointment feel clear and calm.', category: 'First visits', body: 'A first visit should feel like a conversation, not a checklist. We will take time to hear what matters to you, explain what we see, and make room for questions before deciding on any next steps.' },
      { title: 'Small habits for a healthier smile', slug: 'small-habits-healthier-smile', excerpt: 'A steady routine can make looking after your smile feel more manageable.', category: 'Everyday care', body: 'A consistent brush-and-floss routine, regular checkups, and honest conversations can go a long way. If something feels confusing, bring it up at your next visit. Good care starts with understanding.' },
      { title: 'What to expect at a checkup', slug: 'what-to-expect-at-a-checkup', excerpt: 'Knowing what happens next can make a routine appointment feel easier.', category: 'Your visit', body: 'We will review your concerns, explain what we are checking, and pause whenever you need. You will leave with a clear summary and a chance to talk through any options.' }
    ]
  }
};
const SAMPLE_POST_GALLERIES = [
  [
    { imageUrl: '/images/blog-welcome.svg', altText: 'An open, welcoming practice doorway', caption: 'A warm welcome and time to settle in.' },
    { imageUrl: '/images/blog-care-team.svg', altText: 'A care team listening together', caption: 'Questions are always part of the visit.' }
  ],
  [
    { imageUrl: '/images/blog-small-moments.svg', altText: 'A sunlit still life with a flower and warm cup', caption: 'Small routines can make care feel easier.' },
    { imageUrl: '/images/blog-care-team.svg', altText: 'A care team ready to listen', caption: 'A little check-in can open a helpful conversation.' }
  ],
  [
    { imageUrl: '/images/blog-care-team.svg', altText: 'A practice team and companion in a calm room', caption: 'A familiar team makes space for a slower hello.' },
    { imageUrl: '/images/blog-welcome.svg', altText: 'A welcoming room with an open doorway', caption: 'The first moments can move at your pace.' }
  ]
];
const DEMO_GALLERY = [
  { title: 'A warm welcome', imageUrl: '', altText: 'Illustrated gallery placeholder for a welcoming practice space', caption: 'A friendly first impression starts at the door.', category: 'Practice life', sortOrder: 1, status: 'published' },
  { title: 'Care, at every stage', imageUrl: '', altText: 'Illustrated gallery placeholder for a care moment', caption: 'Thoughtful care for the everyday and the unexpected.', category: 'Our approach', sortOrder: 2, status: 'published' },
  { title: 'A little time to listen', imageUrl: '', altText: 'Illustrated gallery placeholder for a conversation with the care team', caption: 'Questions welcome. We will take the time.', category: 'Team', sortOrder: 3, status: 'published' }
];
function clean(value, max, fallback = '') { return String(value ?? fallback).trim().slice(0, max); }
function slugify(value) { return String(value || '').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45) || 'my-practice'; }
function validColor(value, fallback) { return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : fallback; }
const MAX_CUSTOM_PAGES = 8;
const RESERVED_PAGE_SLUGS = new Set(['admin', 'appointments', 'api', 'assets', 'images', 'index']);
function safePageImage(value) {
  const raw = clean(value, 2048);
  if (!raw) return '';
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try { const url = new URL(raw); return url.protocol === 'https:' ? url.href : null; } catch (_) { return null; }
}
function safePageUrl(value) {
  let raw = clean(value, 120).replace(/^\/+|\/+$/g, '');
  if (!raw || /[?#:]/.test(raw) || raw.includes('/')) return null;
  raw = raw.replace(/\.html?$/i, '');
  if (!raw) return null;
  const slug = slugify(raw);
  if (RESERVED_PAGE_SLUGS.has(slug)) return null;
  return { slug, url: `/${slug}.html` };
}
function normalizeCustomPages(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_PAGES) throw new Error(`Add no more than ${MAX_CUSTOM_PAGES} custom pages.`);
  const seen = new Set();
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Each custom page must be a page configuration object.');
    const menuName = clean(item.menuName, 80);
    const pageTitle = clean(item.pageTitle, 120);
    const pageContent = clean(item.pageContent, 6000);
    const route = safePageUrl(item.url);
    if (!menuName || !pageTitle || !pageContent || !route) throw new Error('Each custom page needs a menu name, unique page URL, page title and page content.');
    if (seen.has(route.url)) throw new Error(`Each custom page URL must be unique (${route.url} is repeated).`);
    const imageUrl = safePageImage(item.imageUrl);
    if (imageUrl === null) throw new Error('Use an HTTPS URL or a same-site path for a banner image.');
    seen.add(route.url);
    return {
      id: clean(item.id, 48, route.slug) || route.slug,
      menuName, url: route.url, slug: route.slug, pageTitle, pageContent, imageUrl
    };
  });
}
function normalizeTarget(value) {
  if (value === 'vercel' || value === 'cloudflare') return value;
  throw new Error('Choose either the Vercel or Cloudflare code package.');
}
function validTimeZone(value, fallback = 'Asia/Manila') {
  const candidate = clean(value, 64, fallback) || fallback;
  try { new Intl.DateTimeFormat('en-US', { timeZone: candidate }); return candidate; } catch (_) { return fallback; }
}
function htmlEscape(value) { return String(value).replace(/[&<>"']/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character])); }
function jsSafeJson(value) { return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
function sqlLiteral(value) { return `'${String(value).replace(/'/g, "''")}'`; }
function normalizeConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Send a site configuration object.');
  const target = normalizeTarget(input.target);
  const specialty = input.specialty === 'dental' ? 'dental' : 'veterinary';
  const vertical = VERTICALS[specialty];
  const businessName = clean(input.businessName, 80, `${vertical.brandName}${specialty === 'dental' ? ' Dental Studio' : ' Veterinary Care'}`) || vertical.brandName;
  const siteId = slugify(businessName);
  const theme = Object.hasOwn(THEME_DEFAULTS, input.theme) ? input.theme : 'canopy';
  const editorialAccent = Object.hasOwn(EDITORIAL_ACCENTS, input.editorialAccent) ? input.editorialAccent : 'black';
  const preset = THEME_DEFAULTS[theme];
  const defaultPrimary = theme === 'editorial' ? EDITORIAL_ACCENTS[editorialAccent] : preset.primaryColor;
  const email = clean(input.email, 120, `hello@${siteId}.example`);
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid practice email address.');
  const demoPosts = vertical.posts.map((post, index) => {
    const gallery = SAMPLE_POST_GALLERIES[index].map((image, sortOrder) => ({ ...image, sortOrder }));
    return { ...post, id: `sample-${index + 1}`, featureImageUrl: gallery[0].imageUrl, featureImageAlt: gallery[0].altText, gallery, publishedAt: new Date(Date.now() - (index + 1) * 86400000 * 9).toISOString() };
  });
  return {
    siteId, target, specialty, specialtyLabel: vertical.label, businessName,
    brandName: clean(input.brandName, 80, businessName.replace(/\s+(care|clinic|studio|practice|dental)$/i, '').trim() || vertical.brandName),
    location: clean(input.location, 100, 'Your neighborhood') || 'Your neighborhood', email,
    phone: clean(input.phone, 30, '+1 555 010 0000') || '+1 555 010 0000', timeZone: validTimeZone(input.timeZone), theme, editorialAccent,
    primaryColor: validColor(input.primaryColor, defaultPrimary), accentColor: validColor(input.accentColor, preset.accentColor),
    paperColor: validColor(input.paperColor, preset.paperColor), fontStyle: input.fontStyle === 'sans' ? 'sans' : 'serif',
    features: { blog: input.features?.blog !== false, gallery: input.features?.gallery !== false, scheduling: input.features?.scheduling !== false },
    payments: {
      gcashName: clean(input.payments?.gcashName, 80, businessName) || businessName,
      gcashNumber: clean(input.payments?.gcashNumber, 40, '+63 917 555 0134'),
      mayaName: clean(input.payments?.mayaName, 80, businessName) || businessName,
      mayaNumber: clean(input.payments?.mayaNumber, 40, '+63 918 555 0142')
    },
    customPages: normalizeCustomPages(input.customPages),
    heroEyebrow: vertical.eyebrow, heroHeadline: vertical.headline, heroText: vertical.heroText,
    services: vertical.services, demoPosts, demoGallery: DEMO_GALLERY.map((item) => ({ ...item })),
    createdAt: clean(input.createdAt, 40, new Date().toISOString())
  };
}
function replaceTokens(text, config) {
  const tokens = {
    '__SITE_ID__': config.siteId, '__SITE_CONFIG_JSON__': jsSafeJson(config),
    '__BUSINESS_NAME__': htmlEscape(config.businessName), '__BRAND_NAME__': htmlEscape(config.brandName),
    '__LOCATION__': htmlEscape(config.location), '__EMAIL__': htmlEscape(config.email),
    '__PHONE__': htmlEscape(config.phone), '__PAPER_COLOR__': config.paperColor,
    '__DEPLOY_TARGET__': htmlEscape(config.target === 'cloudflare' ? 'Cloudflare Workers' : 'Vercel')
  };
  return text.replace(/__SITE_ID__|__SITE_CONFIG_JSON__|__BUSINESS_NAME__|__BRAND_NAME__|__LOCATION__|__EMAIL__|__PHONE__|__PAPER_COLOR__|__DEPLOY_TARGET__/g, (token) => tokens[token]);
}
function createSeedSql(config) {
  const lines = [
    '-- Run this file once after schema.sql in the Neon database used by this site package.',
    `INSERT INTO sites (site_id, config) VALUES (${sqlLiteral(config.siteId)}, ${sqlLiteral(JSON.stringify(config))}::jsonb) ON CONFLICT (site_id) DO UPDATE SET config = EXCLUDED.config, updated_at = now();`, ''
  ];
  for (const post of config.demoPosts) {
    lines.push(`INSERT INTO blog_posts (site_id, title, slug, excerpt, body, feature_image_url, feature_image_alt, category, status, published_at) VALUES (${sqlLiteral(config.siteId)}, ${sqlLiteral(post.title)}, ${sqlLiteral(post.slug)}, ${sqlLiteral(post.excerpt)}, ${sqlLiteral(post.body)}, ${sqlLiteral(post.featureImageUrl)}, ${sqlLiteral(post.featureImageAlt)}, ${sqlLiteral(post.category)}, 'published', now()) ON CONFLICT (site_id, slug) DO NOTHING;`);
    for (const [index, image] of (post.gallery || []).entries()) lines.push(`INSERT INTO blog_post_images (site_id, post_id, image_url, alt_text, caption, sort_order) SELECT ${sqlLiteral(config.siteId)}, post.id, ${sqlLiteral(image.imageUrl)}, ${sqlLiteral(image.altText)}, ${sqlLiteral(image.caption)}, ${index} FROM blog_posts AS post WHERE post.site_id = ${sqlLiteral(config.siteId)} AND post.slug = ${sqlLiteral(post.slug)} AND NOT EXISTS (SELECT 1 FROM blog_post_images AS existing WHERE existing.post_id = post.id AND existing.sort_order = ${index});`);
  }
  for (const item of config.demoGallery) lines.push(`INSERT INTO gallery_items (site_id, title, image_url, alt_text, caption, category, status, sort_order) SELECT ${sqlLiteral(config.siteId)}, ${sqlLiteral(item.title)}, ${sqlLiteral(item.imageUrl)}, ${sqlLiteral(item.altText)}, ${sqlLiteral(item.caption)}, ${sqlLiteral(item.category)}, 'published', ${Number(item.sortOrder)} WHERE NOT EXISTS (SELECT 1 FROM gallery_items WHERE site_id = ${sqlLiteral(config.siteId)} AND title = ${sqlLiteral(item.title)});`);
  return lines.join('\n') + '\n';
}
function generatedReadme(config) {
  const code = (value) => String.fromCharCode(96) + value + String.fromCharCode(96);
  const targetName = config.target === 'cloudflare' ? 'Cloudflare Workers' : 'Vercel';
  const lines = [
    `# ${config.businessName} — ${targetName} code package`, '',
    `This ZIP contains the ${targetName} project only. It is a source-code package; it does not deploy or publish your website.`, '',
    '## Database setup',
    `Create a Neon Postgres database, then run ${code('db/schema.sql')} and ${code('db/seed.sql')} once. The seed file includes the generated site configuration, payment details, custom pages and sample practice content.`, '',
    config.target === 'vercel' ? '## Deploy to Vercel' : '## Deploy to Cloudflare Workers',
    config.target === 'vercel'
      ? `Deploy this folder to Vercel. Configure ${code('DATABASE_URL')}, ${code('ADMIN_API_KEY')} and ${code('CSRF_SECRET')} using ${code('.env.example')}. For local development, run ${code('npm install')} and ${code('npm run dev')}.`
      : `Use Node.js 22+, run ${code('npm install')}, set ${code('DATABASE_URL')}, ${code('ADMIN_API_KEY')} and ${code('CSRF_SECRET')} with Wrangler secrets, then run ${code('npm run deploy')}. For local development, copy ${code('.dev.vars.example')} to ${code('.dev.vars')} and run ${code('npm run dev')}.`, '',
    `The public owner editor is ${code('/admin.html')}. Its owner key is stored only in this browser tab's sessionStorage. The site has ${config.customPages.length} custom menu page${config.customPages.length === 1 ? '' : 's'} and GCash/Maya payment details configured in the generated settings.`, '',
    '## Site notes',
    'The starter includes fixed-field blog and gallery content, client accounts and appointment scheduling. Appointment availability remains unpublished until the site owner configures it. Review the privacy and security guidance in the owner editor before adding sensitive information. This starter is not a compliant electronic health record system.', '',
    `Generated practice: **${config.businessName}** (${config.specialtyLabel}) · Site ID: ${code(config.siteId)} · Selected target: **${targetName}**`
  ];
  return lines.join('\n') + '\n';
}
function generatedCustomPageHtml(config, page) {
  const e = htmlEscape;
  const image = page.imageUrl
    ? `<img class="custom-page-banner" src="${e(page.imageUrl)}" alt="${e(page.pageTitle)}" loading="eager" decoding="async" referrerpolicy="no-referrer">`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="${e(config.paperColor)}">
  <meta name="description" content="${e(page.pageTitle)} — ${e(config.businessName)}">
  <title>${e(page.pageTitle)} · ${e(config.businessName)}</title>
  <link rel="stylesheet" href="/site.css">
  <script src="/site-config.js" defer></script>
  <script src="/site.js" defer></script>
</head>
<body class="custom-page">
  <div class="announcement"><span class="announcement-dot"></span><span>Taking new clients</span><span class="announcement-separator">·</span><span>Thoughtful care, close to home</span></div>
  <header class="site-header">
    <a class="site-brand" href="/" aria-label="Home"><span class="brand-symbol" id="brandSymbol">✳</span><span><strong id="brandName">${e(config.brandName)}</strong><small id="brandSubline">CARE THAT FEELS PERSONAL</small></span></a>
    <button class="nav-menu" id="navMenu" aria-label="Open menu"><span></span><span></span></button>
    <nav class="site-nav" id="siteNav" aria-label="Main navigation">
      <a href="/#care">Our care</a><a href="/#about">Our approach</a><a href="/#gallery" id="galleryNav">Gallery</a><a href="/#journal" id="journalNav">Journal</a><a href="/appointments.html" id="appointmentsNav">Appointments</a><a href="/#contact">Contact</a>
    </nav>
    <a class="header-cta" href="/appointments.html" id="headerCta">Request a visit <span>↗</span></a>
  </header>
  <main class="custom-page-main section-wrap">
    <article class="custom-page-card">
      ${image}
      <div class="custom-page-copy">
        <span class="eyebrow"><span></span>${e(page.menuName)}</span>
        <h1>${e(page.pageTitle)}</h1>
        <div class="custom-page-content">${e(page.pageContent)}</div>
      </div>
    </article>
  </main>
  <footer class="site-footer" id="contact">
    <div class="footer-top"><a class="site-brand footer-brand" href="/"><span class="brand-symbol" id="footerSymbol">✳</span><span><strong id="footerBrandName">${e(config.brandName)}</strong><small id="footerBrandSubline">CARE THAT FEELS PERSONAL</small></span></a><p>Thoughtful care. Clear answers.<br>A familiar place to turn.</p><div class="footer-contact"><span id="footerLocation">${e(config.location)}</span><a id="footerEmail" href="mailto:${e(config.email)}">${e(config.email)}</a><a id="footerPhone" href="tel:${e(config.phone)}">${e(config.phone)}</a></div><div class="footer-payments hidden" id="footerPayments"><span class="footer-payments-label">PAYMENT OPTIONS</span><div class="footer-payment-list" id="paymentDetails"></div></div><a class="back-top" href="/">Home ↑</a></div>
    <div class="footer-bottom"><span>© <span id="yearNow"></span> <span id="footerLegalName">${e(config.businessName)}</span>. All rights reserved.</span><span>Privacy · Accessibility</span></div>
  </footer>
  <div class="site-toast" id="siteToast" aria-live="polite"></div>
</body>
</html>
`;
}
async function readScaffold(env, origin, filename) {
  const url = new URL(`/_scaffold/templates/${filename.split('/').map(encodeURIComponent).join('/')}`, origin);
  const response = await env.ASSETS.fetch(new Request(url, { method: 'GET' }));
  if (!response.ok) throw new Error(`Missing build scaffold file: ${filename}`);
  return response.text();
}
async function buildFiles(input, env, origin) {
  const config = normalizeConfig(input);
  const target = config.target;
  const manifest = JSON.parse(await readScaffold(env, origin, 'manifest.json'));
  const files = new Map();
  const publicPath = (relative) => target === 'vercel' ? relative.replace(/^public\//, '') : relative;

  for (const relative of manifest.sharedPublic) {
    const content = replaceTokens(await readScaffold(env, origin, `shared/${relative}`), config);
    files.set(publicPath(relative), content);
  }
  for (const relative of manifest.sharedDb) {
    files.set(relative, await readScaffold(env, origin, `shared/${relative}`));
  }
  files.set('db/seed.sql', createSeedSql(config));

  for (const relative of manifest[target]) {
    const content = replaceTokens(await readScaffold(env, origin, `${target}/${relative}`), config);
    files.set(relative, content);
  }
  for (const page of config.customPages) {
    const pageFile = `${page.slug}.html`;
    files.set(target === 'vercel' ? pageFile : `public/${pageFile}`, generatedCustomPageHtml(config, page));
  }

  files.set('README.md', generatedReadme(config));
  files.set('manifest.json', JSON.stringify({
    generator: 'Canopy Studio Cloudflare Builder', version: '1.2.0', siteId: config.siteId,
    specialty: config.specialty, generatedAt: new Date().toISOString(), target,
    database: 'Neon Postgres', features: config.features,
    customPages: config.customPages.map(({ menuName, url, pageTitle }) => ({ menuName, url, pageTitle })),
    config: { businessName: config.businessName, location: config.location, theme: config.theme, primaryColor: config.primaryColor, fontStyle: config.fontStyle }
  }, null, 2) + '\n');
  return { config, files };
}
async function generateBundle(input, env, origin) {
  const { config, files } = await buildFiles(input, env, origin);
  const buffer = createZip([...files.entries()]);
  return { config, buffer, filename: `${config.siteId}-${config.target}.zip` };
}
export { generateBundle, normalizeConfig };
