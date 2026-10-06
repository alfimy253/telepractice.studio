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
function validTimeZone(value, fallback = 'Asia/Manila') {
  const candidate = clean(value, 64, fallback) || fallback;
  try { new Intl.DateTimeFormat('en-US', { timeZone: candidate }); return candidate; } catch (_) { return fallback; }
}
function htmlEscape(value) { return String(value).replace(/[&<>"']/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character])); }
function jsSafeJson(value) { return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
function sqlLiteral(value) { return `'${String(value).replace(/'/g, "''")}'`; }
function normalizeConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Send a site configuration object.');
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
    siteId, specialty, specialtyLabel: vertical.label, businessName,
    brandName: clean(input.brandName, 80, businessName.replace(/\s+(care|clinic|studio|practice|dental)$/i, '').trim() || vertical.brandName),
    location: clean(input.location, 100, 'Your neighborhood') || 'Your neighborhood', email,
    phone: clean(input.phone, 30, '+1 555 010 0000') || '+1 555 010 0000', timeZone: validTimeZone(input.timeZone), theme, editorialAccent,
    primaryColor: validColor(input.primaryColor, defaultPrimary), accentColor: validColor(input.accentColor, preset.accentColor),
    paperColor: validColor(input.paperColor, preset.paperColor), fontStyle: input.fontStyle === 'sans' ? 'sans' : 'serif',
    features: { blog: input.features?.blog !== false, gallery: input.features?.gallery !== false, scheduling: input.features?.scheduling !== false },
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
    '__PHONE__': htmlEscape(config.phone), '__PAPER_COLOR__': config.paperColor
  };
  return text.replace(/__SITE_ID__|__SITE_CONFIG_JSON__|__BUSINESS_NAME__|__BRAND_NAME__|__LOCATION__|__EMAIL__|__PHONE__|__PAPER_COLOR__/g, (token) => tokens[token]);
}
function createSeedSql(config) {
  const lines = [
    '-- Run this file once after schema.sql in the same Neon database used by both deployments.',
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
  const lines = [
    `# ${config.businessName} — dual deployment`, '',
    'This white-label website bundle contains a Vercel Node/Express app and a Cloudflare Workers app generated from one practice configuration. Both use the same Neon Postgres schema and SITE_ID.', '',
    '## Neon setup',
    `Run ${code('db/schema.sql')} and then ${code('db/seed.sql')} once. The fixed content model includes practice settings, blog posts, gallery items, client accounts, monthly availability, appointments and consultation notes. Every blog post requires a feature image shown as an article hero; if its URL is left blank, the first post-gallery image by display order becomes the feature image. An optional post-specific gallery renders after the article body and remains separate from the practice-wide gallery.`, '',
    '## Vercel',
    `Deploy the ${code('vercel/')} folder. Set ${code('DATABASE_URL')}, ${code('ADMIN_API_KEY')} and ${code('CSRF_SECRET')} from ${code('.env.example')}.`, '',
    '## Cloudflare Workers',
    `Use Node.js 22+, install in ${code('cloudflare/')}, set ${code('DATABASE_URL')}, ${code('ADMIN_API_KEY')} and ${code('CSRF_SECRET')} as Worker secrets, then run ${code('npm run deploy')}.`, '',
    `Open ${code('/admin.html')} and enter the owner key. It is stored only in this browser tab's sessionStorage. The editor supports practice details, seven site layouts, three Editorial accent choices, fixed-field blog and gallery CMS, monthly availability, appointment management and private consultation notes. Gallery images accept HTTPS URLs or same-site paths.`, '',
    '## Appointments and client accounts', '',
    'Every theme includes an Appointments menu item and dedicated `/appointments.html`. The calendar stays empty until the owner publishes monthly availability. Public visitors can browse open times and a monthly fill meter; its percentage is non-cancelled bookings divided by owner-published slots. Owners set recurring weekly hours in 30-minute intervals plus date-specific openings or closures. Publish next month by two days before the current month ends; a missed month stays unavailable. The default practice timezone is `Asia/Manila`.', '',
    'Clients self-register with email, phone and a password of at least 12 characters. Passwords use salted PBKDF2 hashes and session tokens are stored hashed in the database and sent in HttpOnly, SameSite cookies. A signed-in client reserves a slot immediately, views their own consultations/notes, and can cancel at any time. Owner cancellation requires more than 24 hours’ notice. Email verification and password reset are deferred because no email-delivery provider is configured.', '',
    'An owner may write an optional clinical or non-clinical note per consultation. Notes are visible only to the owner and linked client. This starter is **not a compliant EHR** and provides no compliance guarantee. Clinical information is sensitive; complete a separate privacy/security/legal review, restrict database access, and do not substitute this starter for an appropriately governed health-record system.', '',
    'The Node target uses Express and Helmet with signed double-submit CSRF checks; the Cloudflare Worker applies equivalent security headers and CSRF validation. The generator is stateless.', '',
    `Generated site: **${config.businessName}** (${config.specialtyLabel}) · Site ID: ${code(config.siteId)}`
  ];
  return lines.join('\n') + '\n';
}
async function readScaffold(env, origin, filename) {
  const url = new URL(`/_scaffold/templates/${filename.split('/').map(encodeURIComponent).join('/')}`, origin);
  const response = await env.ASSETS.fetch(new Request(url, { method: 'GET' }));
  if (!response.ok) throw new Error(`Missing build scaffold file: ${filename}`);
  return response.text();
}
async function buildFiles(input, env, origin) {
  const config = normalizeConfig(input);
  const scaffoldPrefix = 'public/_scaffold/templates/';
  const manifest = JSON.parse(await readScaffold(env, origin, 'manifest.json'));
  const files = new Map();
  for (const relative of manifest.sharedPublic) {
    const content = replaceTokens(await readScaffold(env, origin, `shared/${relative}`), config);
    files.set(`vercel/${relative.replace(/^public\//, '')}`, content);
    files.set(`cloudflare/public/${relative.replace(/^public\//, '')}`, content);
  }
  for (const relative of manifest.sharedDb) {
    const content = await readScaffold(env, origin, `shared/${relative}`);
    files.set(`vercel/${relative}`, content); files.set(`cloudflare/${relative}`, content);
  }
  const schema = await readScaffold(env, origin, 'shared/db/schema.sql');
  const seed = createSeedSql(config);
  files.set('vercel/db/schema.sql', schema); files.set('vercel/db/seed.sql', seed);
  files.set('cloudflare/db/schema.sql', schema); files.set('cloudflare/db/seed.sql', seed);
  for (const target of ['vercel', 'cloudflare']) {
    for (const relative of manifest[target]) {
      const content = replaceTokens(await readScaffold(env, origin, `${target}/${relative}`), config);
      files.set(`${target}/${relative}`, content);
    }
  }
  files.set('README.md', generatedReadme(config));
  files.set('manifest.json', JSON.stringify({
    generator: 'Canopy Studio Cloudflare Builder', version: '1.1.0', siteId: config.siteId,
    specialty: config.specialty, generatedAt: new Date().toISOString(), targets: ['vercel-node','cloudflare-workers'],
    database: 'Neon Postgres', features: config.features,
    config: { businessName: config.businessName, location: config.location, theme: config.theme, primaryColor: config.primaryColor, fontStyle: config.fontStyle }
  }, null, 2) + '\n');
  return { config, files };
}
async function generateBundle(input, env, origin) {
  const { config, files } = await buildFiles(input, env, origin);
  const buffer = createZip([...files.entries()]);
  return { config, buffer, filename: `${config.siteId}-vercel-cloudflare.zip` };
}
export { generateBundle, normalizeConfig };
