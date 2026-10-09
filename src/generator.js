import { createZip } from './zip.js';
import { createPasswordHash } from '../public/_scaffold/templates/shared/lib/admin-security.js';
import { adminDashboardPath } from '../public/_scaffold/templates/shared/lib/admin-url.js';
import { menuLinksForPages } from '../public/_scaffold/templates/shared/lib/menu-links.js';

const encoder = new TextEncoder();
const DB_URL_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const DB_URL_RUNTIME_ONLY_PARAMS = new Set(['sslmode', 'channel_binding']);
function randomSecret(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function decodeHtmlEscapedUrl(value) {
  let decoded = String(value ?? '').trim();
  // URLs copied out of a dashboard or email can carry escaped ampersands.
  for (let pass = 0; pass < 3; pass += 1) {
    const next = decoded.replace(/&amp;/gi, '&');
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}
// Mirrors the generated app's own db/connection.js normalization so the
// value baked into the downloaded env file already matches what the Neon
// serverless HTTP driver expects: no sslmode/channel_binding query params.
function normalizeDatabaseUrl(value) {
  const raw = decodeHtmlEscapedUrl(value).slice(0, 2048);
  if (!raw) return '';
  let url;
  try { url = new URL(raw); } catch (_) {
    throw new Error('Enter a valid Neon database connection string.');
  }
  if (!DB_URL_PROTOCOLS.has(url.protocol) || !url.hostname || !url.pathname || url.pathname === '/') {
    throw new Error('Enter a valid Neon database connection string.');
  }
  for (const key of [...url.searchParams.keys()]) {
    if (DB_URL_RUNTIME_ONLY_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  return url.toString();
}
const THEME_DEFAULTS = {
  canopy: { primaryColor: '#376f62', accentColor: '#e9b36e', paperColor: '#fbf8f1' },
  clay: { primaryColor: '#ac6550', accentColor: '#e8b897', paperColor: '#fbf6ef' },
  coastal: { primaryColor: '#397c87', accentColor: '#dfb75d', paperColor: '#f4f8f7' },
  editorial: { primaryColor: '#202522', accentColor: '#c9a45b', paperColor: '#f6f5f1' },
  neat: { primaryColor: '#2d8078', accentColor: '#f0b768', paperColor: '#f7faf9' },
  launcher: { primaryColor: '#c33e55', accentColor: '#f0c85c', paperColor: '#fff9f1' },
  air: { primaryColor: '#dd356e', accentColor: '#fee856', paperColor: '#ffffff' },
  'brivon-dark': { primaryColor: '#d4ff3d', accentColor: '#d4ff3d', paperColor: '#0a0a0c' },
  'brivon-light': { primaryColor: '#506f00', accentColor: '#506f00', paperColor: '#f5f5ef' }
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
function normalizeAdminAccount(input = {}) {
  const username = String(input.adminUsername ?? '').trim();
  const email = String(input.adminEmail ?? '').trim();
  const password = String(input.adminPassword ?? '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(username)) {
    throw new Error('Enter an administrator username between 3 and 64 characters using letters, numbers, dots, underscores or hyphens.');
  }
  if (email.length > 254 || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
    throw new Error('Enter a valid administrator email address.');
  }
  const passwordLength = password.length;
  if (passwordLength < 12 || passwordLength > 128
    || !/[a-z]/.test(password) || !/[A-Z]/.test(password)
    || !/[0-9]/.test(password) || !/[^A-Za-z0-9\s]/.test(password)) {
    throw new Error('The administrator password must be 12–128 characters and include a lowercase letter, uppercase letter, number and symbol.');
  }
  return { username, email, password };
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
  const customPages = normalizeCustomPages(input.customPages);
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
    customPages, menuLinks: menuLinksForPages(customPages),
    heroEyebrow: vertical.eyebrow, heroHeadline: vertical.headline, heroText: vertical.heroText,
    services: vertical.services, demoPosts, demoGallery: DEMO_GALLERY.map((item) => ({ ...item })),
    createdAt: clean(input.createdAt, 40, new Date().toISOString())
  };
}
// Kept separate from normalizeConfig's return value on purpose: `config` is
// serialized as-is into __SITE_CONFIG_JSON__ (public site-config.js, the
// public /api/site response, and db/seed.sql). Secrets must never enter
// that object — they are only substituted into the two gitignored-by-default
// env files (.dev.vars / .env) below.
async function buildSecrets(input) {
  const admin = normalizeAdminAccount(input);
  return {
    // The supplied password is never written in plaintext. Only its salted
    // PBKDF2 hash is placed in the generated, gitignored environment file.
    adminUsername: admin.username,
    adminEmail: admin.email,
    adminPasswordHash: await createPasswordHash(admin.password),
    // This random key signs CSRF tokens and short-lived admin sessions; it is
    // separate from the username/password login and is not an admin API key.
    csrfSecret: randomSecret(32),
    // A separate bearer secret protects the Vercel Cron payment reminder route.
    cronSecret: randomSecret(32),
    // Only the Neon connection string is user-provided — the builder has no
    // database of its own and cannot invent one.
    databaseUrl: normalizeDatabaseUrl(input.databaseUrl)
  };
}
function replaceTokens(text, config) {
  const tokens = {
    '__SITE_ID__': config.siteId, '__SITE_CONFIG_JSON__': jsSafeJson(config),
    '__BUSINESS_NAME__': htmlEscape(config.businessName), '__BRAND_NAME__': htmlEscape(config.brandName),
    '__LOCATION__': htmlEscape(config.location), '__EMAIL__': htmlEscape(config.email),
    '__PHONE__': htmlEscape(config.phone), '__PAPER_COLOR__': config.paperColor,
    '__THEME_CLASS__': `theme-${config.theme}`,
    '__DEPLOY_TARGET__': htmlEscape(config.target === 'cloudflare' ? 'Cloudflare Workers' : 'Vercel')
  };
  return text.replace(/__SITE_ID__|__SITE_CONFIG_JSON__|__BUSINESS_NAME__|__BRAND_NAME__|__LOCATION__|__EMAIL__|__PHONE__|__PAPER_COLOR__|__THEME_CLASS__|__DEPLOY_TARGET__/g, (token) => tokens[token]);
}
// Applied only to the generated .dev.vars / .env files. Kept separate from
// replaceTokens() so a real DATABASE_URL or generated secret can never leak
// into a file that also carries __SITE_CONFIG_JSON__ or other public tokens.
function replaceSecretTokens(text, secrets) {
  const placeholder = 'postgresql://USER:PASSWORD@HOST.neon.tech/DB';
  const tokens = {
    '__DATABASE_URL__': secrets.databaseUrl || placeholder,
    '__ADMIN_USERNAME__': secrets.adminUsername,
    '__ADMIN_EMAIL__': secrets.adminEmail,
    '__ADMIN_PASSWORD_HASH__': secrets.adminPasswordHash,
    '__CSRF_SECRET__': secrets.csrfSecret,
    '__CRON_SECRET__': secrets.cronSecret
  };
  return text.replace(/__DATABASE_URL__|__ADMIN_USERNAME__|__ADMIN_EMAIL__|__ADMIN_PASSWORD_HASH__|__CSRF_SECRET__|__CRON_SECRET__/g, (token) => tokens[token]);
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
function generatedReadme(config, secrets) {
  const code = (value) => String.fromCharCode(96) + value + String.fromCharCode(96);
  const targetName = config.target === 'cloudflare' ? 'Cloudflare Workers' : 'Vercel';
  const envFile = ENV_FILE_BY_TARGET[config.target];
  const hasDatabaseUrl = Boolean(secrets?.databaseUrl);
  const currentAdminPath = adminDashboardPath(new Date(), config.timeZone);
  const lines = [
    `# ${config.businessName} — ${targetName} code package`, '',
    `This ZIP contains the ${targetName} project only. It is a source-code package; it does not deploy or publish your website.`, '',
    '## Environment variables',
    `${code(envFile)} is included ready to use — not a ${code('.example')} template. The owner username and email were taken from the builder. The supplied password is stored only as a salted PBKDF2 hash in ${code('ADMIN_PASSWORD_HASH')}; it is never written in plaintext. A unique ${code('CSRF_SECRET')} signs CSRF tokens and short-lived owner sessions; it is not an admin API key. For Vercel, a separate ${code('CRON_SECRET')} protects the scheduled payment-reminder endpoint.`,
    hasDatabaseUrl
      ? `${code('DATABASE_URL')} was filled in from the Neon connection string you entered in the builder. ${code('sslmode')}/${code('channel_binding')} query parameters were removed automatically — the generated runtime uses Neon's secure HTTP transport and does not use them.`
      : `${code('DATABASE_URL')} still has a placeholder value because no database connection string was entered in the builder. Replace it with your pooled Neon URL, for example ${code('postgresql://USER:PASSWORD@HOST.neon.tech/DB')} (leave out ${code('sslmode')}/${code('channel_binding')} — the generated runtime uses Neon's secure HTTP transport and does not use them).`,
    `Treat ${code(envFile)} as a secret: it is already ignored by the included ${code('.gitignore')}, so keep it out of source control.`, '',
    '## Database setup',
    `Create a Neon Postgres database (if you have not already), then run ${code('db/schema.sql')} (safe to rerun; it includes idempotent migrations) and ${code('db/seed.sql')}. The seed file includes the generated site configuration, payment details, custom pages and sample practice content.`, '',
    config.target === 'vercel' ? '## Deploy to Vercel' : '## Deploy to Cloudflare Workers',
    config.target === 'vercel'
      ? `Use Node.js 20.6+ for the standalone worker script, then deploy this folder to Vercel. In the Vercel dashboard, copy the values from ${code('.env')} into the project's Environment Variables (the ${code('.env')} file itself is only read locally). For local development, run ${code('npm install')} and ${code('npm run dev')}.`
      : `Use Node.js 22+ and run ${code('npm install')}. In the Cloudflare dashboard, set the values from ${code('.dev.vars')} under Worker Settings → Variables and Secrets. Store ${code('DATABASE_URL')}, ${code('ADMIN_PASSWORD_HASH')} and ${code('CSRF_SECRET')} as secrets; set ${code('ADMIN_USERNAME')} and ${code('ADMIN_EMAIL')} as variables or secrets. Wrangler does not upload ${code('.dev.vars')} during ${code('npm run deploy')}. For local development, ${code('.dev.vars')} is already in place, so just run ${code('npm run dev')}.`, '',
    '## Owner dashboard and sign-in',
    `The owner dashboard path is generated from the current date in the site's time zone (default ${code(config.timeZone)}). Today, when this package was generated, its path is ${code(currentAdminPath)}; it changes at local midnight. Sign in there using the administrator account configured in the builder. The public sign-in form intentionally starts blank; the raw password is never embedded in public site assets.`,
    `Path scheme: Monday = dog, Tuesday = rat, Wednesday = ant, Thursday = fish, Friday = fly, Saturday = cat, Sunday = cockroach. Take the animal's last letter, append ${code('admin')} and the current calendar day number, then append ${code('/dashboard')}. For example, Tuesday on the 8th is ${code('/tadmin8/dashboard')}. The changing path is only an obscurity measure—the username/password sign-in is the actual access control.`,
    `The Menu links view in the owner dashboard can rename, reorder, add or remove public navigation links. Links accept same-site paths or HTTPS URLs; the site starts with ${config.customPages.length} generated custom menu page${config.customPages.length === 1 ? '' : 's'}. GCash/Maya payment details are also configured in the generated settings.`, '',
    '## Payment reminders and booking release',
    'Bookings remain scheduled after 15 minutes; that is a review threshold, not an automatic cancellation deadline. If no proof is uploaded after 12 minutes, the client dashboard displays a reminder—even if the owner has independently marked the payment received. The client can still upload proof after 15 minutes while the booking remains active; a manually confirmed payment stays confirmed when its screenshot is attached. The owner can mark a payment received or manually release the booking after checking the payment account.',
    `The deployed ${targetName} scheduler is configured for minute-level checks, subject to the hosting plan’s cron limits. An exact Node.js background worker is also included: run ${code('npm run payments:worker')} under a process manager on an always-on Node.js host for 90-second client-reminder checks and 3-minute owner-follow-up checks. The standalone worker is not run inside Vercel serverless functions or Cloudflare Workers; those use their native scheduled triggers.`, '',
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
  <link rel="stylesheet" href="/brivon.css">
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
// --- Live builder preview -------------------------------------------------
// Preview and package generation deliberately select the homepage from the
// same scaffold path. The preview inlines that page's stylesheet and
// pre-renders the regions site.js normally fills, producing a self-contained
// full homepage for every supported design system.
function homeDesignFile(theme) {
  return String(theme || '').startsWith('brivon-')
    ? 'shared/designs/brivon-index.html'
    : 'shared/public/index.html';
}
function homeStylesheetFile(theme) {
  return String(theme || '').startsWith('brivon-')
    ? 'shared/public/brivon.css'
    : 'shared/public/site.css';
}
const MAX_PREVIEW_INLINE_IMAGES = 6;
const GALLERY_ORNAMENTS = ['✳', '⌂', '♡', '✦'];
function previewConfig(input = {}) {
  const theme = Object.hasOwn(THEME_DEFAULTS, input?.theme) ? input.theme : 'canopy';
  const specialty = input?.specialty === 'dental' ? 'dental' : 'veterinary';
  // The preview only renders a page's menu label and route, so the builder
  // sends just those. Accept a page that is still missing its title or body
  // instead of dropping every page from the preview menu.
  const customPages = (Array.isArray(input?.customPages) ? input.customPages : []).map((page) => ({
    ...page,
    pageTitle: clean(page?.pageTitle, 120) || clean(page?.menuName, 80),
    pageContent: clean(page?.pageContent, 6000) || clean(page?.menuName, 80)
  }));
  // Typing in the builder produces transient invalid values (a half-typed
  // email, a custom page with no URL yet). Fall back step by step so the
  // preview keeps showing the practice details instead of resetting.
  for (const attempt of [{ ...input, target: 'vercel', customPages }, { ...input, target: 'vercel', customPages: [] }]) {
    try { return normalizeConfig(attempt); } catch (_) { /* try the next fallback */ }
  }
  return normalizeConfig({ target: 'vercel', specialty, theme });
}
function featureEnabled(config, feature) { return feature ? config.features[feature] !== false : true; }
// Finds the opening tag carrying id="elementId" and returns its bounds.
function findOpeningTag(html, elementId) {
  const idPattern = new RegExp(`id="${elementId}"`);
  const idIndex = html.search(idPattern);
  if (idIndex < 0) return null;
  const start = html.lastIndexOf('<', idIndex);
  const end = html.indexOf('>', idIndex);
  if (start < 0 || end < 0 || !/^<[a-zA-Z]/.test(html.slice(start, end + 1))) return null;
  return { start, end, tag: html.slice(start, end + 1) };
}
function findOpeningTagByName(html, tagName) {
  const marker = `<${tagName.toLowerCase()}`;
  const start = html.toLowerCase().indexOf(marker);
  if (start < 0) return null;
  const end = html.indexOf('>', start);
  if (end < 0) return null;
  return { start, end, tag: html.slice(start, end + 1) };
}
function replaceOpeningTag(html, found, tag) {
  return `${html.slice(0, found.start)}${tag}${html.slice(found.end + 1)}`;
}
function setOpeningTagClass(html, found, className, enabled) {
  if (!found) return html;
  const classAttribute = found.tag.match(/class="([^"]*)"/);
  const classes = (classAttribute?.[1] || '').split(' ').filter(Boolean);
  const has = classes.includes(className);
  if (enabled === has) return html;
  const next = enabled ? [...classes, className] : classes.filter((name) => name !== className);
  let tag = found.tag.replace(/class="[^"]*"/, '').replace(/ +>/, '>');
  const attribute = next.length ? ` class="${next.join(' ')}"` : '';
  tag = tag.replace(/>$/, `${attribute}>`);
  return replaceOpeningTag(html, found, tag);
}
// Replaces the inner HTML of the element with that id, tracking nested tags of
// the same name so nested wrappers (e.g. #footerPayments) stay intact.
function replaceElementContent(html, elementId, content) {
  const found = findOpeningTag(html, elementId);
  if (!found) return html;
  const tagName = /^<\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(found.tag)[1].toLowerCase();
  if (/\/\s*>$/.test(found.tag)) return html;
  const scanner = new RegExp(`<\\/?${tagName}(?=[\\s/>])`, 'gi');
  scanner.lastIndex = found.end + 1;
  let depth = 1;
  let match;
  while ((match = scanner.exec(html)) !== null) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return `${html.slice(0, found.end + 1)}${content}${html.slice(match.index)}`;
  }
  return html;
}
function setElementText(html, elementId, text) {
  return replaceElementContent(html, elementId, htmlEscape(String(text ?? '')));
}
function setElementAttribute(html, elementId, name, value) {
  const found = findOpeningTag(html, elementId);
  if (!found) return html;
  const attribute = `${name}="${htmlEscape(String(value ?? ''))}"`;
  const pattern = new RegExp(`${name}="[^"]*"`);
  const tag = pattern.test(found.tag)
    ? found.tag.replace(pattern, attribute)
    : found.tag.replace(/>$/, ` ${attribute}>`);
  return replaceOpeningTag(html, found, tag);
}
function setPreviewRootVariables(html, config) {
  const found = findOpeningTagByName(html, 'html');
  if (!found) return html;
  const declarations = `--primary:${config.primaryColor};--accent:${config.accentColor};--paper:${config.paperColor}`;
  const existing = found.tag.match(/style="([^"]*)"/);
  const style = existing ? `${existing[1]};${declarations}` : declarations;
  const pattern = /style="[^"]*"/;
  const tag = pattern.test(found.tag)
    ? found.tag.replace(pattern, `style="${style}"`)
    : found.tag.replace(/>$/, ` style="${style}">`);
  return replaceOpeningTag(html, found, tag);
}
function setElementClass(html, elementId, className, enabled) {
  const found = findOpeningTag(html, elementId);
  if (!found) return html;
  const classes = (found.tag.match(/\bclass="([^"]*)"/)?.[1] || '').split(/\s+/).filter(Boolean);
  const has = classes.includes(className);
  if (enabled === has) return html;
  const next = enabled ? [...classes, className] : classes.filter((name) => name !== className);
  const attribute = next.length ? ` class="${next.join(' ')}"` : '';
  const tag = found.tag.replace(/\s*class="[^"]*"/, '').replace(/>$/, `${attribute}>`);
  return `${html.slice(0, found.start)}${tag}${html.slice(found.end + 1)}`;
}
function previewMenuHtml(config) {
  const links = config.menuLinks.filter((link) => featureEnabled(config, link.feature));
  return links.map((link) => `<a href="${htmlEscape(link.href)}">${htmlEscape(link.label)}</a>`).join('\n          ');
}
function previewGalleryHtml(config) {
  if (!featureEnabled(config, 'gallery')) return '<p class="loading-copy">Gallery turned off for this site.</p>';
  return config.demoGallery.map((item, index) => `
            <figure class="gallery-card gallery-card-${index % 4}">
              <div class="gallery-image gallery-placeholder" role="img" aria-label="${htmlEscape(item.altText)}"><span class="gallery-ornament" aria-hidden="true">${GALLERY_ORNAMENTS[index % GALLERY_ORNAMENTS.length]}</span></div>
              <figcaption><span class="gallery-category">${htmlEscape(item.category)}</span><strong>${htmlEscape(item.title)}</strong><p>${htmlEscape(item.caption)}</p></figcaption>
            </figure>`).join('');
}
function previewPostsHtml(config) {
  if (!featureEnabled(config, 'blog')) return '<p class="loading-copy">Journal turned off for this site.</p>';
  return config.demoPosts.map((post, index) => {
    const published = new Date(post.publishedAt);
    const date = Number.isNaN(published.valueOf())
      ? 'A note from our team'
      : published.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `
            <article class="post-card">
              <div class="post-image"><img src="${htmlEscape(post.featureImageUrl)}" alt="${htmlEscape(post.featureImageAlt)}" loading="lazy" decoding="async"></div>
              <div class="post-card-content">
                <span class="post-category">${htmlEscape(post.category)}</span>
                <h3>${htmlEscape(post.title)}</h3>
                <p>${htmlEscape(post.excerpt)}</p>
                <div class="post-meta">${htmlEscape(date)}</div>
              </div>
            </article>`;
  }).join('');
}
function previewPaymentsHtml(config) {
  const methods = [
    { name: 'GCash', account: config.payments.gcashName, number: config.payments.gcashNumber },
    { name: 'Maya', account: config.payments.mayaName, number: config.payments.mayaNumber }
  ].filter((item) => item.account || item.number);
  return methods.map((item) => `<div class="footer-payment-method"><strong>${htmlEscape(item.name)}</strong><span>${htmlEscape(item.account)}</span><span>${htmlEscape(item.number)}</span></div>`).join('');
}
// The generated site serves /images/*.svg itself; the builder does not, so
// inline the few sample illustrations as data URIs to avoid broken images.
async function inlinePreviewImages(html, env, origin) {
  const paths = [...new Set([...html.matchAll(/src="(\/images\/[^"]+\.svg)"/g)].map((match) => match[1]))].slice(0, MAX_PREVIEW_INLINE_IMAGES);
  for (const path of paths) {
    let image;
    try { image = await readScaffold(env, origin, `shared/public${path}`); } catch (_) { continue; }
    html = html.split(path).join(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(image)}`);
  }
  return html;
}
async function buildPreviewDocument(input, env, origin) {
  const config = previewConfig(input);
  const [design, css] = await Promise.all([
    readScaffold(env, origin, homeDesignFile(config.theme)),
    readScaffold(env, origin, homeStylesheetFile(config.theme))
  ]);
  const brivon = String(config.theme).startsWith('brivon-');
  const stylesheetPath = brivon ? '/brivon\\.css' : '/site\\.css';
  const stylesheetPattern = new RegExp(`<link rel="stylesheet" href="${stylesheetPath}">`);
  let html = replaceTokens(design, config)
    .replace(stylesheetPattern, () => `<style>\n${css}\n</style>`)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');

  html = setPreviewRootVariables(html, config);
  html = setOpeningTagClass(html, findOpeningTagByName(html, 'body'), `theme-${config.theme}`, true);
  html = setOpeningTagClass(html, findOpeningTagByName(html, 'body'), 'font-sans', config.fontStyle === 'sans');
  html = setOpeningTagClass(html, findOpeningTagByName(html, 'body'), 'dental-site', config.specialty === 'dental');

  const [firstLine, ...rest] = String(config.heroHeadline).split('\n');
  let serviceIndex = 0;
  html = html.replace(/<h3 class="service-title">[\s\S]*?<\/h3>/g, (match) => {
    const service = config.services[serviceIndex];
    serviceIndex += 1;
    return service ? `<h3 class="service-title">${htmlEscape(service)}</h3>` : match;
  });
  html = replaceElementContent(html, 'siteNav', previewMenuHtml(config));
  html = replaceElementContent(html, 'drawerNav', previewMenuHtml(config));
  html = replaceElementContent(html, 'editorialSiteNav', previewMenuHtml(config));
  html = replaceElementContent(html, 'galleryGrid', previewGalleryHtml(config));
  html = replaceElementContent(html, 'postGrid', previewPostsHtml(config));
  html = replaceElementContent(html, 'paymentDetails', previewPaymentsHtml(config));

  const brand = config.brandName;
  const isDental = config.specialty === 'dental';
  const verticalIcon = isDental ? '✦' : '✳';
  const verticalSubline = isDental ? 'A BRIGHTER KIND OF CARE' : 'CARE THAT FEELS PERSONAL';
  const actionLabel = featureEnabled(config, 'scheduling')
    ? (isDental ? 'Request an appointment' : 'Request a visit')
    : 'Contact our team';
  const actionHref = featureEnabled(config, 'scheduling') ? '#book' : '#contact';
  for (const id of ['brandName', 'footerBrandName', 'editorialBrandName']) html = setElementText(html, id, brand);
  for (const id of ['brandSubline', 'footerBrandSubline']) html = setElementText(html, id, verticalSubline);
  html = setElementText(html, 'editorialBrandLocation', config.location);
  html = setElementText(html, 'footerLegalName', config.businessName);
  html = setElementText(html, 'footerLocation', config.location);
  html = setElementText(html, 'footerEmail', config.email);
  html = setElementText(html, 'footerPhone', config.phone);
  html = setElementText(html, 'yearNow', new Date().getFullYear());
  html = setElementText(html, 'heroEyebrow', config.heroEyebrow);
  html = replaceElementContent(html, 'heroHeadline', `${htmlEscape(firstLine)}<br><em>${htmlEscape(rest.join(' ') || 'good care.')}</em>`);
  html = setElementText(html, 'heroText', config.heroText);
  for (const id of ['brandSymbol', 'footerSymbol', 'labelIcon', 'editorialBrandSymbol']) html = setElementText(html, id, verticalIcon);
  for (const id of ['headerCta', 'heroBook', 'articleBook', 'editorialSidebarCta']) {
    html = replaceElementContent(html, id, `${htmlEscape(actionLabel)} <span>↗</span>`);
    html = setElementAttribute(html, id, 'href', actionHref);
  }
  const telephone = String(config.phone || '').replace(/[^+\d]/g, '');
  html = setElementAttribute(html, 'phoneLink', 'href', `tel:${telephone}`);
  html = setElementAttribute(html, 'footerPhone', 'href', `tel:${telephone}`);
  html = setElementAttribute(html, 'footerEmail', 'href', `mailto:${config.email}`);
  html = setElementClass(html, 'gallery', 'hidden', !featureEnabled(config, 'gallery'));
  html = setElementClass(html, 'journal', 'hidden', !featureEnabled(config, 'blog'));
  html = setElementClass(html, 'book', 'hidden', !featureEnabled(config, 'scheduling'));
  html = setElementClass(html, 'footerPayments', 'hidden', !config.payments.gcashNumber && !config.payments.mayaNumber);

  // Preview URLs resolve within the generated homepage. The builder does not
  // serve a separate appointments or custom-page route inside the iframe.
  html = html.replace(/href="\/(#[^"]*)"/g, (match, target) => `href="${target}"`);
  html = html.replace(/href="\/([^"]*)"/g, 'href="#home"');
  html = await inlinePreviewImages(html, env, origin);
  return { html, theme: config.theme, siteId: config.siteId };
}
const ENV_FILE_BY_TARGET = { cloudflare: '.dev.vars', vercel: '.env' };
async function buildFiles(input, env, origin) {
  const config = normalizeConfig(input);
  const secrets = await buildSecrets(input);
  const target = config.target;
  const manifest = JSON.parse(await readScaffold(env, origin, 'manifest.json'));
  const files = new Map();
  const publicPath = (relative) => target === 'vercel' ? relative.replace(/^public\//, '') : relative;
  files.set('.gitignore', `node_modules/\n${ENV_FILE_BY_TARGET[target]}\n`);

  for (const relative of manifest.sharedPublic) {
    let content = replaceTokens(await readScaffold(env, origin, `shared/${relative}`), config);
    if (relative === 'public/index.html') {
      const homepage = homeDesignFile(config.theme);
      if (homepage !== `shared/${relative}`) content = replaceTokens(await readScaffold(env, origin, homepage), config);
    }
    files.set(publicPath(relative), content);
  }
  for (const relative of manifest.sharedDb) {
    files.set(relative, await readScaffold(env, origin, `shared/${relative}`));
  }
  for (const relative of manifest.sharedRuntime || []) {
    files.set(relative, await readScaffold(env, origin, `shared/${relative}`));
  }
  files.set('db/seed.sql', createSeedSql(config));

  for (const relative of manifest[target]) {
    let content = replaceTokens(await readScaffold(env, origin, `${target}/${relative}`), config);
    if (relative === ENV_FILE_BY_TARGET[target]) content = replaceSecretTokens(content, secrets);
    files.set(relative, content);
  }
  for (const page of config.customPages) {
    const pageFile = `${page.slug}.html`;
    files.set(target === 'vercel' ? pageFile : `public/${pageFile}`, generatedCustomPageHtml(config, page));
  }

  files.set('README.md', generatedReadme(config, secrets));
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
export { buildPreviewDocument, generateBundle, normalizeAdminAccount, normalizeConfig };
