const DEFAULT_CONFIG = {
  specialty: 'veterinary',
  businessName: 'Harborlight Veterinary Care',
  location: 'Quezon City, Philippines',
  email: 'hello@harborlight.example',
  phone: '+63 2 8123 4567',
  theme: 'canopy',
  primaryColor: '#376f62',
  accentColor: '#e9b36e',
  paperColor: '#fbf8f1',
  fontStyle: 'serif',
  editorialAccent: 'black',
  deploymentTarget: 'vercel',
  databaseUrl: '',
  payments: { gcashName: 'Harborlight Veterinary Care', gcashNumber: '+63 917 555 0134', mayaName: 'Harborlight Veterinary Care', mayaNumber: '+63 918 555 0142' },
  customPages: [],
  features: { blog: true, gallery: true, scheduling: true }
};
const THEMES = {
  canopy: { primaryColor: '#376f62', accentColor: '#e9b36e', paperColor: '#fbf8f1', label: 'Canopy', mood: 'calm & grounded' },
  clay: { primaryColor: '#ac6550', accentColor: '#e8b897', paperColor: '#fbf6ef', label: 'Soft clay', mood: 'warm & welcoming' },
  coastal: { primaryColor: '#397c87', accentColor: '#dfb75d', paperColor: '#f4f8f7', label: 'Coastal', mood: 'bright & clear' },
  editorial: { primaryColor: '#202522', accentColor: '#c9a45b', paperColor: '#f6f5f1', label: 'Editorial', mood: 'considered & classic' },
  neat: { primaryColor: '#2d8078', accentColor: '#f0b768', paperColor: '#f7faf9', label: 'Neat', mood: 'portfolio & agency' },
  launcher: { primaryColor: '#c33e55', accentColor: '#f0c85c', paperColor: '#fff9f1', label: 'Launcher', mood: 'bold & welcoming' },
  air: { primaryColor: '#dd356e', accentColor: '#fee856', paperColor: '#ffffff', label: 'Air', mood: 'light & vibrant' }
};
const EDITORIAL_ACCENTS = { black: '#202522', teal: '#187c78', forest: '#2e6049' };
const VERTICALS = {
  veterinary: {
    label: 'Veterinary clinic', short: 'Veterinary', eyebrow: 'A LITTLE MORE CARE, EVERY DAY',
    headline: 'Good care for|good companions.', subhead: 'Thoughtful veterinary care, built around the lives you share.',
    services: ['Wellness & prevention', 'Gentle diagnostics', 'Everyday support'],
    email: 'hello@harborlight.example', phone: '+63 2 8123 4567', defaultName: 'Harborlight Veterinary Care', icon: 'i-paw',
    blogTitle: 'From our care team', patient: 'Pet parent'
  },
  dental: {
    label: 'Dental practice', short: 'Dental', eyebrow: 'A BRIGHTER KIND OF DENTAL CARE',
    headline: 'A reason to|smile easier.', subhead: 'Modern, thoughtful dentistry with your comfort at the center.',
    services: ['Preventive care', 'Restorative dentistry', 'Cosmetic treatments'],
    email: 'hello@brightside.example', phone: '+63 2 8123 4567', defaultName: 'Brightside Dental Studio', icon: 'i-tooth',
    blogTitle: 'Notes for a healthier smile', patient: 'Patient'
  }
};
let config = loadConfig();
let nameTouched = Boolean(localStorage.getItem('canopy-name-touched'));
let wizardStep = 0;
let activePageId = '';
let csrfToken = '';
const WIZARD_STEP_COUNT = 5;
const MAX_CUSTOM_PAGES = 8;
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function newPageId() {
  return globalThis.crypto?.randomUUID?.() || `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function normalizeSavedPages(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_CUSTOM_PAGES).map((page) => ({
    id: String(page?.id || newPageId()).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || newPageId(),
    menuName: String(page?.menuName || '').slice(0, 80),
    url: String(page?.url || '').slice(0, 120),
    pageTitle: String(page?.pageTitle || '').slice(0, 120),
    pageContent: String(page?.pageContent || '').slice(0, 6000),
    imageUrl: String(page?.imageUrl || '').slice(0, 2048)
  }));
}
function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem('canopy-site-config') || 'null');
    if (!saved) return structuredClone(DEFAULT_CONFIG);
    return {
      ...structuredClone(DEFAULT_CONFIG), ...saved,
      // The database connection string is a credential, not a site setting:
      // it is kept in memory for this tab only and is never written to
      // localStorage (see saveConfig), so a reload always starts it blank.
      databaseUrl: '',
      payments: { ...DEFAULT_CONFIG.payments, ...(saved.payments || {}) },
      customPages: normalizeSavedPages(saved.customPages),
      deploymentTarget: saved.deploymentTarget === 'cloudflare' ? 'cloudflare' : 'vercel',
      features: { ...DEFAULT_CONFIG.features, ...(saved.features || {}) }
    };
  } catch (_) { return structuredClone(DEFAULT_CONFIG); }
}
function saveConfig() {
  // Persist everything except the database connection string, which can
  // carry a real password and should not linger in localStorage.
  const { databaseUrl: _omit, ...persisted } = config;
  localStorage.setItem('canopy-site-config', JSON.stringify(persisted));
  const indicator = document.querySelector('.autosave');
  if (indicator) indicator.innerHTML = '<span class="status-dot"></span> All changes saved';
}
function slugify(value) {
  return String(value || '').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'my-practice';
}
function vertical() { return VERTICALS[config.specialty] || VERTICALS.veterinary; }
function syncInputs() {
  $('practiceName').value = config.businessName;
  $('practiceLocation').value = config.location;
  $('practiceEmail').value = config.email;
  $('practicePhone').value = config.phone;
  $('gcashName').value = config.payments.gcashName || '';
  $('gcashNumber').value = config.payments.gcashNumber || '';
  $('mayaName').value = config.payments.mayaName || '';
  $('mayaNumber').value = config.payments.mayaNumber || '';
  $('brandColor').value = config.primaryColor;
  $('brandColorLabel').textContent = config.primaryColor.toUpperCase();
  $('fontStyle').value = config.fontStyle;
  $('blogToggle').checked = config.features.blog;
  $('galleryToggle').checked = config.features.gallery !== false;
  $('bookingToggle').checked = config.features.scheduling;
  document.querySelectorAll('[data-specialty]').forEach((button) => button.classList.toggle('selected', button.dataset.specialty === config.specialty));
  document.querySelectorAll('.theme-template-card[data-theme]').forEach((button) => button.classList.toggle('active', button.dataset.theme === config.theme));
  $('editorialAccentRow').hidden = config.theme !== 'editorial';
  $('airPaletteNote').hidden = config.theme !== 'air';
  document.querySelectorAll('[data-editorial-accent]').forEach((button) => button.classList.toggle('active', button.dataset.editorialAccent.toLowerCase() === config.primaryColor.toLowerCase()));
  syncDownloadControls();
}
function renderPreviewMenuLinks() {
  const links = document.querySelector('.preview-nav-links');
  if (!links) return;
  const labels = ['Our care', 'About', 'Journal', ...(config.customPages || []).map((page) => page.menuName).filter(Boolean)];
  links.replaceChildren(...labels.map((label) => {
    const item = document.createElement('span');
    item.textContent = label;
    return item;
  }));
}
function updatePreview() {
  const kind = vertical();
  const business = config.businessName.trim() || kind.defaultName;
  const loc = config.location.trim() || 'Your neighborhood';
  const slug = slugify(business);
  $('siteSlug').textContent = slug;
  $('previewUrl').textContent = `${slug}.yourpractice.site`;
  $('previewBrandName').textContent = business;
  $('previewBrandLocation').textContent = loc.toLocaleUpperCase().slice(0, 25);
  $('previewEyebrow').textContent = kind.eyebrow;
  const headline = kind.headline.split('|');
  $('previewHeadline').innerHTML = `${esc(headline[0])}<br><em>${esc(headline[1])}</em>`;
  $('previewSubhead').textContent = kind.subhead;
  $('serviceOne').textContent = kind.services[0];
  $('serviceTwo').textContent = kind.services[1];
  $('serviceThree').textContent = kind.services[2];
  renderPreviewMenuLinks();
  const logoUse = document.querySelector('.preview-logo use');
  if (logoUse) logoUse.setAttribute('href', `#${kind.icon}`);
  const screen = $('previewScreen');
  screen.style.setProperty('--site-primary', config.primaryColor);
  screen.style.setProperty('--site-accent', config.accentColor);
  screen.style.setProperty('--site-paper', config.paperColor);
  screen.classList.toggle('editorial-sans', config.fontStyle === 'sans');
  screen.classList.toggle('dental-preview', config.specialty === 'dental');
  screen.classList.remove('theme-canopy','theme-clay','theme-coastal','theme-editorial','theme-neat','theme-launcher','theme-air');
  if (THEMES[config.theme]) screen.classList.add(`theme-${config.theme}`);
  $('colorPreview').style.background = config.primaryColor;
  $('brandColorLabel').textContent = config.primaryColor.toUpperCase();
  const shortTheme = THEMES[config.theme]?.label || 'Custom';
  $('summarySpecialty').textContent = kind.label;
  $('summaryTheme').textContent = `${shortTheme} · ${config.fontStyle === 'serif' ? 'editorial serif' : 'modern sans'}`;
  $('summaryModules').textContent = [config.features.blog && 'Blog', config.features.gallery !== false && 'Gallery', config.features.scheduling && 'Scheduling'].filter(Boolean).join(' + ') || 'Core pages only';
  document.querySelectorAll('.preview-brand strong').forEach((node) => node.title = business);
  saveConfig();
}
function setSpecialty(specialty) {
  if (!VERTICALS[specialty]) return;
  const previous = config.specialty;
  if (previous === specialty) return;
  config.specialty = specialty;
  if (!nameTouched || config.businessName === VERTICALS[previous].defaultName) {
    config.businessName = VERTICALS[specialty].defaultName;
    nameTouched = false;
    localStorage.removeItem('canopy-name-touched');
  }
  if (!config.email || config.email === VERTICALS[previous].email) config.email = VERTICALS[specialty].email;
  if (config.payments.gcashName === VERTICALS[previous].defaultName) config.payments.gcashName = VERTICALS[specialty].defaultName;
  if (config.payments.mayaName === VERTICALS[previous].defaultName) config.payments.mayaName = VERTICALS[specialty].defaultName;
  syncInputs();
  updatePreview();
  renderWizard();
}
function setTheme(theme) {
  if (!THEMES[theme]) return;
  config.theme = theme;
  if (theme === 'launcher') config.features.gallery = true;
  const preset = THEMES[theme];
  config.primaryColor = theme === 'editorial' ? (EDITORIAL_ACCENTS[config.editorialAccent] || preset.primaryColor) : preset.primaryColor;
  config.accentColor = preset.accentColor;
  config.paperColor = preset.paperColor;
  syncInputs();
  updatePreview();
  renderWizard();
}
function setEditorialAccent(accent) {
  if (!EDITORIAL_ACCENTS[accent]) return;
  config.theme = 'editorial';
  config.editorialAccent = accent;
  config.primaryColor = EDITORIAL_ACCENTS[accent];
  config.accentColor = THEMES.editorial.accentColor;
  config.paperColor = THEMES.editorial.paperColor;
  syncInputs();
  updatePreview();
  renderWizard();
}
function safeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}
function syncDownloadControls() {
  const target = config.deploymentTarget === 'cloudflare' ? 'cloudflare' : 'vercel';
  const displayName = target === 'cloudflare' ? 'Cloudflare' : 'Vercel';
  document.querySelectorAll('[data-deployment-target]').forEach((button) => {
    const selected = button.dataset.deploymentTarget === target;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
    const state = button.querySelector('.deploy-choice span');
    if (state) state.textContent = selected ? 'Selected' : 'Select';
  });
  const top = $('topGenerate');
  if (top) top.innerHTML = `<svg><use href="#i-download"/></svg> Download ${displayName} ZIP`;
  const main = $('generateButton')?.querySelector('span:first-of-type');
  if (main) main.textContent = `Download ${displayName} ZIP`;
  const envFile = target === 'cloudflare' ? '.dev.vars' : '.env';
  const envExample = target === 'cloudflare' ? '.dev.vars.example' : '.env.example';
  const exampleLabel = $('envFileExampleName');
  if (exampleLabel) exampleLabel.textContent = envExample;
  const readyLabel = $('envFileReadyName');
  if (readyLabel) readyLabel.textContent = envFile;
  const noteLabel = $('envFileNote');
  if (noteLabel) noteLabel.textContent = envFile;
}
function setDeploymentTarget(target) {
  if (!['vercel', 'cloudflare'].includes(target)) return;
  config.deploymentTarget = target;
  syncDownloadControls();
  saveConfig();
}
function toast(title, message, isError = false) {
  const region = $('toastRegion');
  const node = document.createElement('div');
  node.className = `toast${isError ? ' error' : ''}`;
  node.innerHTML = `<span class="toast-icon">${isError ? '!' : '✓'}</span><span><strong>${esc(title)}</strong><small>${esc(message)}</small></span>`;
  region.appendChild(node);
  window.setTimeout(() => node.remove(), 4800);
}
function configForPackage() {
  const kind = vertical();
  const name = config.businessName.trim() || kind.defaultName;
  const slug = slugify(name);
  const pretty = name.replace(/\s+(care|clinic|studio|practice|dental)$/i, '').trim() || name;
  return {
    siteId: slug,
    specialty: config.specialty,
    businessName: name,
    brandName: pretty,
    location: config.location.trim() || 'Your neighborhood',
    email: config.email.trim() || `hello@${slug}.example`,
    phone: config.phone.trim() || '+1 555 010 0000',
    theme: THEMES[config.theme] ? config.theme : 'canopy',
    editorialAccent: Object.hasOwn(EDITORIAL_ACCENTS, config.editorialAccent) ? config.editorialAccent : 'black',
    primaryColor: safeColor(config.primaryColor, '#376f62'),
    accentColor: safeColor(config.accentColor, '#e9b36e'),
    paperColor: safeColor(config.paperColor, '#fbf8f1'),
    fontStyle: config.fontStyle === 'sans' ? 'sans' : 'serif',
    features: { blog: Boolean(config.features.blog), gallery: config.features.gallery !== false, scheduling: Boolean(config.features.scheduling) },
    payments: {
      gcashName: String(config.payments.gcashName || '').trim(), gcashNumber: String(config.payments.gcashNumber || '').trim(),
      mayaName: String(config.payments.mayaName || '').trim(), mayaNumber: String(config.payments.mayaNumber || '').trim()
    },
    customPages: normalizeSavedPages(config.customPages),
    target: config.deploymentTarget === 'cloudflare' ? 'cloudflare' : 'vercel',
    databaseUrl: String(config.databaseUrl || '').trim().slice(0, 2048),
    heroEyebrow: kind.eyebrow,
    heroHeadline: kind.headline.replace('|', '\n'),
    heroText: kind.subhead,
    services: kind.services,
    createdAt: new Date().toISOString()
  };
}
function canonicalPageUrl(value) {
  let raw = String(value || '').trim().replace(/^\/+|\/+$/g, '');
  if (!raw || /[?#:]/.test(raw) || raw.includes('/')) return '';
  raw = raw.replace(/\.html?$/i, '');
  if (!raw) return '';
  const slug = slugify(raw);
  const reserved = new Set(['admin', 'appointments', 'api', 'assets', 'images', 'index']);
  return reserved.has(slug) ? '' : `/${slug}.html`;
}
function safeBannerImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return true;
  if (raw.startsWith('/') && !raw.startsWith('//')) return true;
  try { return new URL(raw).protocol === 'https:'; } catch (_) { return false; }
}
function renderCustomPageList() {
  const list = $('wizardPageList');
  if (!list) return;
  if (!config.customPages.length) {
    list.innerHTML = '<p class="wizard-pages-empty">No custom menu pages yet. Add one to create a new page and a matching link in the site menu.</p>';
    return;
  }
  if (!activePageId || !config.customPages.some((page) => page.id === activePageId)) activePageId = config.customPages[0].id;
  list.innerHTML = config.customPages.map((page, index) => {
    const label = page.menuName.trim() || `Page ${index + 1}`;
    const route = page.url.trim() || 'Set a page URL';
    return `<div class="wizard-page-editor">
      <details data-page-id="${esc(page.id)}" ${page.id === activePageId ? 'open' : ''}>
        <summary><span class="wizard-page-summary"><strong data-page-summary-name>${esc(label)}</strong><small data-page-summary-url>${esc(route)}</small></span><span class="wizard-page-chevron" aria-hidden="true">›</span></summary>
        <div class="wizard-page-fields">
          <label class="form-field"><span>Menu link name</span><input data-page-field="menuName" maxlength="80" value="${esc(page.menuName)}" placeholder="About us" required></label>
          <label class="form-field"><span>Page URL</span><input data-page-field="url" maxlength="120" value="${esc(page.url)}" placeholder="/about-us.html" inputmode="url" required></label>
          <label class="form-field wizard-field-full"><span>Page title</span><input data-page-field="pageTitle" maxlength="120" value="${esc(page.pageTitle)}" placeholder="A little about our practice" required></label>
          <label class="form-field wizard-field-full"><span>Page content</span><textarea data-page-field="pageContent" maxlength="6000" rows="4" placeholder="Write the content visitors will read on this page." required>${esc(page.pageContent)}</textarea></label>
          <label class="form-field wizard-field-full"><span>Banner image URL (optional)</span><input data-page-field="imageUrl" maxlength="2048" value="${esc(page.imageUrl)}" placeholder="https://example.com/banner.jpg" inputmode="url"><small>One HTTPS or same-site image URL is used as the page banner.</small></label>
          <div class="wizard-page-actions">
            <button type="button" data-page-action="up" ${index === 0 ? 'disabled' : ''}>Move earlier</button>
            <button type="button" data-page-action="down" ${index === config.customPages.length - 1 ? 'disabled' : ''}>Move later</button>
            <button type="button" class="wizard-page-remove" data-page-action="remove">Remove page</button>
          </div>
        </div>
      </details>
    </div>`;
  }).join('');
}
function bindCustomPageEditor() {
  const list = $('wizardPageList');
  if (!list) return;
  list.addEventListener('input', (event) => {
    const field = event.target.dataset.pageField;
    const accordion = event.target.closest('details[data-page-id]');
    if (!field || !accordion) return;
    const page = config.customPages.find((item) => item.id === accordion.dataset.pageId);
    if (!page) return;
    page[field] = event.target.value;
    const label = accordion.querySelector('[data-page-summary-name]');
    const route = accordion.querySelector('[data-page-summary-url]');
    if (label) label.textContent = page.menuName.trim() || `Page ${config.customPages.indexOf(page) + 1}`;
    if (route) route.textContent = page.url.trim() || 'Set a page URL';
    renderPreviewMenuLinks();
    saveConfig();
  });
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page-action]');
    if (!button) return;
    const accordion = button.closest('details[data-page-id]');
    const index = config.customPages.findIndex((page) => page.id === accordion?.dataset.pageId);
    if (index < 0) return;
    const action = button.dataset.pageAction;
    if (action === 'remove') {
      config.customPages.splice(index, 1);
      activePageId = config.customPages[Math.min(index, config.customPages.length - 1)]?.id || '';
    } else if (action === 'up' && index > 0) {
      [config.customPages[index - 1], config.customPages[index]] = [config.customPages[index], config.customPages[index - 1]];
      activePageId = config.customPages[index - 1].id;
    } else if (action === 'down' && index < config.customPages.length - 1) {
      [config.customPages[index + 1], config.customPages[index]] = [config.customPages[index], config.customPages[index + 1]];
      activePageId = config.customPages[index + 1].id;
    } else return;
    saveConfig();
    renderCustomPageList();
    updatePreview();
  });
}
function validateCustomPages() {
  const seen = new Set();
  for (let index = 0; index < config.customPages.length; index++) {
    const page = config.customPages[index];
    const accordion = [...document.querySelectorAll('#wizardPageList details[data-page-id]')].find((item) => item.dataset.pageId === page.id);
    for (const [field, message] of [['menuName', 'Add a menu link name.'], ['url', 'Add a page URL.'], ['pageTitle', 'Add a title for this page.'], ['pageContent', 'Add content for this page.']]) {
      if (!String(page[field] || '').trim()) {
        if (accordion) { accordion.open = true; accordion.querySelector(`[data-page-field="${field}"]`)?.focus(); }
        toast('Complete the page details', message, true);
        return false;
      }
    }
    const route = canonicalPageUrl(page.url);
    if (!route) {
      if (accordion) { accordion.open = true; accordion.querySelector('[data-page-field="url"]')?.focus(); }
      toast('Check the page URL', 'Use a unique page path such as /about-us.html. Reserved site paths cannot be used.', true);
      return false;
    }
    if (seen.has(route)) {
      if (accordion) { accordion.open = true; accordion.querySelector('[data-page-field="url"]')?.focus(); }
      toast('Page URLs must be unique', `Another custom page already uses ${route}.`, true);
      return false;
    }
    if (!safeBannerImageUrl(page.imageUrl)) {
      if (accordion) { accordion.open = true; accordion.querySelector('[data-page-field="imageUrl"]')?.focus(); }
      toast('Check the banner image URL', 'Use an HTTPS image URL or a same-site path beginning with one slash.', true);
      return false;
    }
    seen.add(route);
    page.url = route;
    page.menuName = page.menuName.trim();
    page.pageTitle = page.pageTitle.trim();
    page.pageContent = page.pageContent.trim();
    page.imageUrl = page.imageUrl.trim();
  }
  saveConfig();
  updatePreview();
  return true;
}
function renderWizard() {
  const stepLabel = $('wizardStepLabel');
  const progress = $('wizardProgress');
  const content = $('wizardContent');
  if (!content) return;
  stepLabel.textContent = `STEP 0${wizardStep + 1} / 0${WIZARD_STEP_COUNT}`;
  progress.style.width = `${((wizardStep + 1) / WIZARD_STEP_COUNT) * 100}%`;
  document.querySelectorAll('.wizard-step').forEach((node, i) => {
    node.classList.toggle('active', i === wizardStep);
    node.classList.toggle('done', i < wizardStep);
  });
  $('wizardBack').style.visibility = wizardStep === 0 ? 'hidden' : 'visible';
  $('wizardNext').innerHTML = wizardStep === WIZARD_STEP_COUNT - 1 ? 'Finish setup <svg><use href="#i-check"/></svg>' : 'Continue <svg><use href="#i-arrow"/></svg>';
  $('wizardSkip').textContent = wizardStep === WIZARD_STEP_COUNT - 1 ? 'You can download the selected code package' : 'You can change these later';
  if (wizardStep === 0) {
    content.innerHTML = `<h1 class="wizard-title" id="wizardTitle">Who are we building for?</h1><p class="wizard-lede">Choose a starting point. We’ll tailor the sample copy, booking fields and site sections to your practice.</p><div class="wizard-specialty-grid"><button class="wizard-specialty ${config.specialty === 'veterinary' ? 'selected' : ''}" data-wizard-specialty="veterinary"><span class="choice-icon vet-icon"><svg><use href="#i-paw"/></svg></span><span class="wizard-radio"></span><strong>Veterinary</strong><small>Care for pets, built around their people.</small></button><button class="wizard-specialty ${config.specialty === 'dental' ? 'selected' : ''}" data-wizard-specialty="dental"><span class="choice-icon dental-icon"><svg><use href="#i-tooth"/></svg></span><span class="wizard-radio"></span><strong>Dental</strong><small>A calmer, clearer patient experience.</small></button></div><div class="wizard-tip"><svg><use href="#i-spark"/></svg><span>Same reliable site engine. Just the right language and defaults for your specialty.</span></div>`;
    content.querySelectorAll('[data-wizard-specialty]').forEach((button) => button.addEventListener('click', () => setSpecialty(button.dataset.wizardSpecialty)));
  } else if (wizardStep === 1) {
    content.innerHTML = `<h1 class="wizard-title" id="wizardTitle">Let's make it yours.</h1><p class="wizard-lede">Add the essentials. These appear in the site header, contact section and booking confirmations.</p><div class="wizard-form-grid"><label class="form-field wizard-field-full"><span>Practice name</span><input id="wizardBusiness" maxlength="80" value="${esc(config.businessName)}" placeholder="e.g. Harborlight Veterinary Care"></label><label class="form-field wizard-field-full"><span>City or neighborhood</span><input id="wizardLocation" maxlength="100" value="${esc(config.location)}" placeholder="e.g. Quezon City"></label><label class="form-field"><span>Contact email</span><input id="wizardEmail" maxlength="120" type="email" value="${esc(config.email)}"></label><label class="form-field"><span>Phone number</span><input id="wizardPhone" maxlength="30" value="${esc(config.phone)}"></label></div><div class="wizard-tip"><svg><use href="#i-globe"/></svg><span>Your website is white-label. The owner can connect a custom domain after deployment.</span></div>`;
    ['wizardBusiness','wizardLocation','wizardEmail','wizardPhone'].forEach((id) => $(id).addEventListener('input', collectWizardFields));
  } else if (wizardStep === 2) {
    content.innerHTML = `<h1 class="wizard-title" id="wizardTitle">Set a welcoming tone.</h1><p class="wizard-lede">Choose a starting palette and typography. Every color can be changed in the theme studio.</p><div class="wizard-theme-grid">${Object.entries(THEMES).map(([key, theme]) => `<button class="wizard-theme-card ${config.theme === key ? 'selected' : ''}" data-wizard-theme="${key}"><span class="wizard-theme-art" style="--swatch-bg:${theme.paperColor};--swatch-primary:${theme.primaryColor};--swatch-accent:${theme.accentColor}"><span></span><i></i></span><span class="wizard-radio"></span><strong>${theme.label}</strong><small>${theme.mood}</small></button>`).join('')}</div><div class="wizard-preview-tip"><span><svg><use href="#i-palette"/></svg></span><span>Theme settings are owner-editable after launch, without touching the generated code.</span></div>`;
    content.querySelectorAll('[data-wizard-theme]').forEach((button) => button.addEventListener('click', () => setTheme(button.dataset.wizard-theme)));
  } else if (wizardStep === 3) {
    content.innerHTML = `<h1 class="wizard-title" id="wizardTitle">Build your menu links.</h1><p class="wizard-lede">Add custom pages to your site. Each page gets a menu link and its own URL, title, content and optional banner image.</p><div class="wizard-page-manager"><div class="wizard-page-list" id="wizardPageList"></div><button class="wizard-add-page" type="button" id="addWizardPage"><svg><use href="#i-plus"/></svg> Add a page</button><p class="wizard-page-limit">Up to ${MAX_CUSTOM_PAGES} custom pages. Menu order follows the list; use the controls on each page to rearrange or remove it.</p></div>`;
    renderCustomPageList();
    bindCustomPageEditor();
    $('addWizardPage').addEventListener('click', () => {
      if (config.customPages.length >= MAX_CUSTOM_PAGES) { toast('Page limit reached', `You can add up to ${MAX_CUSTOM_PAGES} custom pages.`, true); return; }
      const page = { id: newPageId(), menuName: '', url: '', pageTitle: '', pageContent: '', imageUrl: '' };
      config.customPages.push(page);
      activePageId = page.id;
      saveConfig();
      renderCustomPageList();
      $('wizardPageList').querySelector(`details[data-page-id="${page.id}"] [data-page-field="menuName"]`)?.focus();
    });
  } else {
    content.innerHTML = `<h1 class="wizard-title" id="wizardTitle">Keep the essentials close.</h1><p class="wizard-lede">Choose the practical features most local practices need. No custom CMS blocks or plugin maze.</p><div class="wizard-feature-list"><div class="wizard-feature-card"><span class="feature-icon"><svg><use href="#i-file"/></svg></span><span class="feature-copy"><strong>Blog & updates</strong><small>Fixed post fields for helpful articles and clinic news.</small></span><label class="switch"><input id="wizardBlog" type="checkbox" ${config.features.blog ? 'checked' : ''}><span class="switch-track"></span><span class="sr-only">Enable blog</span></label></div><div class="wizard-feature-card"><span class="feature-icon feature-icon-gallery"><svg><use href="#i-image"/></svg></span><span class="feature-copy"><strong>Work & gallery</strong><small>Fixed image, caption, category and visibility fields.</small></span><label class="switch"><input id="wizardGallery" type="checkbox" ${config.features.gallery !== false ? 'checked' : ''}><span class="switch-track"></span><span class="sr-only">Enable gallery</span></label></div><div class="wizard-feature-card"><span class="feature-icon feature-icon-book"><svg><use href="#i-calendar"/></svg></span><span class="feature-copy"><strong>Appointment requests</strong><small>Request a real time slot and collect contact details.</small></span><label class="switch"><input id="wizardBooking" type="checkbox" ${config.features.scheduling ? 'checked' : ''}><span class="switch-track"></span><span class="sr-only">Enable appointment requests</span></label></div></div><div class="wizard-finish-card"><span><svg><use href="#i-check"/></svg></span><span><strong>Your package is ready to download.</strong><small>Choose Vercel or Cloudflare on the builder and download that code package. No deployment happens automatically.</small></span></div>`;
    $('wizardBlog').addEventListener('change', (event) => { config.features.blog = event.target.checked; syncInputs(); updatePreview(); });
    $('wizardGallery').addEventListener('change', (event) => { config.features.gallery = event.target.checked; syncInputs(); updatePreview(); });
    $('wizardBooking').addEventListener('change', (event) => { config.features.scheduling = event.target.checked; syncInputs(); updatePreview(); });
  }
  content.classList.remove('wizard-enter');
  void content.offsetWidth;
  content.classList.add('wizard-enter');
}
function collectWizardFields() {
  const business = $('wizardBusiness');
  if (!business) return;
  const previousName = config.businessName;
  config.businessName = business.value;
  if (config.payments.gcashName === previousName) config.payments.gcashName = config.businessName;
  if (config.payments.mayaName === previousName) config.payments.mayaName = config.businessName;
  config.location = $('wizardLocation').value;
  config.email = $('wizardEmail').value;
  config.phone = $('wizardPhone').value;
  nameTouched = true;
  localStorage.setItem('canopy-name-touched', 'true');
  syncInputs();
  updatePreview();
}
function openWizard() {
  wizardStep = 0;
  renderWizard();
  const modal = $('walkthroughModal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  window.setTimeout(() => $('wizardNext').focus(), 80);
}
function closeWizard(complete = false) {
  $('walkthroughModal').classList.remove('open');
  $('walkthroughModal').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (complete) {
    localStorage.setItem('canopy-tour-complete', 'true');
    toast('Your setup is ready', 'Choose a hosting target to download its code package. Nothing deploys automatically.');
  }
}
function advanceWizard() {
  if (wizardStep === 1) {
    collectWizardFields();
    if (!config.businessName.trim()) { $('wizardBusiness').focus(); toast('Add a practice name', 'A practice name is needed to create the site address.', true); return; }
  }
  if (wizardStep === 3 && !validateCustomPages()) return;
  if (wizardStep < WIZARD_STEP_COUNT - 1) {
    wizardStep += 1;
    renderWizard();
  } else {
    syncInputs();
    updatePreview();
    closeWizard(true);
  }
}
function retreatWizard() {
  if (wizardStep > 0) {
    if (wizardStep === 1) collectWizardFields();
    wizardStep -= 1;
    renderWizard();
  }
}
async function downloadPackage() {
  const target = config.deploymentTarget === 'cloudflare' ? 'cloudflare' : 'vercel';
  const displayName = target === 'cloudflare' ? 'Cloudflare' : 'Vercel';
  const buttons = [$('generateButton'), $('topGenerate')];
  buttons.forEach((button) => {
    button.dataset.original = button.innerHTML;
    button.disabled = true;
    button.classList.add('loading-button');
    button.innerHTML = '<svg><use href="#i-spark"/></svg> Preparing ZIP…';
  });
  document.querySelectorAll('[data-deployment-target]').forEach((button) => { button.disabled = true; });
  try {
    const csrfResponse = await fetch('/api/csrf', { credentials: 'same-origin' });
    if (!csrfResponse.ok) {
      const error = await csrfResponse.json().catch(() => ({}));
      throw new Error(error.error || 'Could not initialize the secure build session.');
    }
    const csrf = await csrfResponse.json();
    csrfToken = csrf.token;
    const response = await fetch('/api/generate', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ ...configForPackage(), target })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'The code package could not be generated.');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${slugify(config.businessName)}-${target}.zip`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`${displayName} package downloaded`, 'This is a code package only; deploy it yourself on the selected host.');
  } catch (error) {
    toast('Could not download the ZIP', error.message || 'Check the server and try again.', true);
  } finally {
    buttons.forEach((button) => {
      button.classList.remove('loading-button');
      button.disabled = false;
      if (button.dataset.original) button.innerHTML = button.dataset.original;
    });
    document.querySelectorAll('[data-deployment-target]').forEach((button) => { button.disabled = false; });
    syncDownloadControls();
  }
}
function resetTheme() {
  config.theme = 'canopy';
  config.editorialAccent = 'black';
  config.primaryColor = THEMES.canopy.primaryColor;
  config.accentColor = THEMES.canopy.accentColor;
  config.paperColor = THEMES.canopy.paperColor;
  config.fontStyle = 'serif';
  syncInputs(); updatePreview(); toast('Theme reset', 'Canopy green and editorial serif are back.');
}
function resetCopy() {
  const defaults = VERTICALS[config.specialty];
  config.businessName = defaults.defaultName;
  config.location = 'Quezon City, Philippines';
  if (config.payments.gcashName === VERTICALS[config.specialty].defaultName || config.payments.gcashName === 'Harborlight Veterinary Care') config.payments.gcashName = defaults.defaultName;
  if (config.payments.mayaName === VERTICALS[config.specialty].defaultName || config.payments.mayaName === 'Harborlight Veterinary Care') config.payments.mayaName = defaults.defaultName;
  nameTouched = false;
  localStorage.removeItem('canopy-name-touched');
  syncInputs(); updatePreview();
  toast('Sample copy restored', 'Practice name and location are back to the original preview.');
}
function bindEvents() {
  $('vetChoice').addEventListener('click', () => setSpecialty('veterinary'));
  $('dentalChoice').addEventListener('click', () => setSpecialty('dental'));
  $('practiceName').addEventListener('input', (event) => {
    const previousName = config.businessName;
    config.businessName = event.target.value;
    if (config.payments.gcashName === previousName) config.payments.gcashName = config.businessName;
    if (config.payments.mayaName === previousName) config.payments.mayaName = config.businessName;
    $('gcashName').value = config.payments.gcashName; $('mayaName').value = config.payments.mayaName;
    nameTouched = true; localStorage.setItem('canopy-name-touched', 'true'); updatePreview();
  });
  $('practiceLocation').addEventListener('input', (event) => { config.location = event.target.value; updatePreview(); });
  $('practiceEmail').addEventListener('input', (event) => { config.email = event.target.value; saveConfig(); });
  $('practicePhone').addEventListener('input', (event) => { config.phone = event.target.value; saveConfig(); });
  [['gcashName','gcashName'],['gcashNumber','gcashNumber'],['mayaName','mayaName'],['mayaNumber','mayaNumber']].forEach(([id, field]) => $(id).addEventListener('input', (event) => { config.payments[field] = event.target.value; saveConfig(); }));
  $('brandColor').addEventListener('input', (event) => { config.primaryColor = event.target.value; syncInputs(); updatePreview(); });
  $('fontStyle').addEventListener('change', (event) => { config.fontStyle = event.target.value; updatePreview(); });
  $('blogToggle').addEventListener('change', (event) => { config.features.blog = event.target.checked; updatePreview(); });
  $('galleryToggle').addEventListener('change', (event) => { config.features.gallery = event.target.checked; updatePreview(); });
  $('bookingToggle').addEventListener('change', (event) => { config.features.scheduling = event.target.checked; updatePreview(); });
  document.querySelectorAll('.theme-template-card[data-theme]').forEach((button) => button.addEventListener('click', () => setTheme(button.dataset.theme)));
  document.querySelectorAll('[data-editorial-accent]').forEach((button) => button.addEventListener('click', () => setEditorialAccent(button.dataset.editorialAccent)));
  $('resetTheme').addEventListener('click', resetTheme);
  $('resetPreview').addEventListener('click', resetCopy);
  $('generateButton').addEventListener('click', downloadPackage);
  $('topGenerate').addEventListener('click', downloadPackage);
  document.querySelectorAll('[data-deployment-target]').forEach((button) => button.addEventListener('click', () => setDeploymentTarget(button.dataset.deploymentTarget)));
  $('databaseUrl').addEventListener('input', (event) => { config.databaseUrl = event.target.value; });
  $('toggleDatabaseUrl').addEventListener('click', () => {
    const field = $('databaseUrl');
    const reveal = field.type === 'password';
    field.type = reveal ? 'text' : 'password';
    $('toggleDatabaseUrl').textContent = reveal ? 'Hide' : 'Show';
    $('toggleDatabaseUrl').setAttribute('aria-label', reveal ? 'Hide connection string' : 'Show connection string');
  });
  $('openWalkthrough').addEventListener('click', openWizard);
  $('sidebarTour').addEventListener('click', (event) => { event.preventDefault(); openWizard(); });
  $('editPractice').addEventListener('click', () => $('practiceName').focus());
  $('wizardNext').addEventListener('click', advanceWizard);
  $('wizardBack').addEventListener('click', retreatWizard);
  $('wizardSkip').addEventListener('click', () => closeWizard(false));
  $('closeWalkthrough').addEventListener('click', () => closeWizard(false));
  $('walkthroughModal').addEventListener('click', (event) => { if (event.target === $('walkthroughModal')) closeWizard(false); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && $('walkthroughModal').classList.contains('open')) closeWizard(false); });
  document.querySelectorAll('.device-button').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('.device-button').forEach((node) => node.classList.toggle('active', node === button));
    $('browserWindow').classList.toggle('mobile-preview', button.dataset.device === 'mobile');
  }));
  $('menuToggle').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  document.querySelectorAll('.side-nav .nav-link').forEach((link) => link.addEventListener('click', () => {
    document.querySelectorAll('.side-nav .nav-link').forEach((node) => node.classList.toggle('active', node === link));
    if (window.innerWidth <= 860) $('sidebar').classList.remove('open');
  }));
}

syncInputs();
updatePreview();
bindEvents();
if (!localStorage.getItem('canopy-tour-complete')) window.setTimeout(openWizard, 180);
