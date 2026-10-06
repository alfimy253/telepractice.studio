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
let csrfToken = '';
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem('canopy-site-config') || 'null');
    if (!saved) return structuredClone(DEFAULT_CONFIG);
    return {
      ...structuredClone(DEFAULT_CONFIG), ...saved,
      features: { ...DEFAULT_CONFIG.features, ...(saved.features || {}) }
    };
  } catch (_) { return structuredClone(DEFAULT_CONFIG); }
}
function saveConfig() {
  localStorage.setItem('canopy-site-config', JSON.stringify(config));
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
function toast(title, message, isError = false) {
  const region = $('toastRegion');
  const node = document.createElement('div');
  node.className = `toast${isError ? ' error' : ''}`;
  node.innerHTML = `<span class="toast-icon">${isError ? '!' : '✓'}</span><span><strong>${esc(title)}</strong><small>${esc(message)}</small></span>`;
  region.appendChild(node);
  window.setTimeout(() => node.remove(), 4800);
}
function configForExport() {
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
    heroEyebrow: kind.eyebrow,
    heroHeadline: kind.headline.replace('|', '\n'),
    heroText: kind.subhead,
    services: kind.services,
    createdAt: new Date().toISOString()
  };
}
function renderWizard() {
  const stepLabel = $('wizardStepLabel');
  const progress = $('wizardProgress');
  const content = $('wizardContent');
  if (!content) return;
  stepLabel.textContent = `STEP 0${wizardStep + 1} / 04`;
  progress.style.width = `${(wizardStep + 1) * 25}%`;
  document.querySelectorAll('.wizard-step').forEach((node, i) => {
    node.classList.toggle('active', i === wizardStep);
    node.classList.toggle('done', i < wizardStep);
  });
  $('wizardBack').style.visibility = wizardStep === 0 ? 'hidden' : 'visible';
  $('wizardNext').innerHTML = wizardStep === 3 ? 'Finish setup <svg><use href="#i-check"/></svg>' : 'Continue <svg><use href="#i-arrow"/></svg>';
  $('wizardSkip').textContent = wizardStep === 3 ? 'Your ZIP includes both deploy targets' : 'You can change these later';
  if (wizardStep === 0) {
    content.innerHTML = `<h1 class="wizard-title" id="wizardTitle">Who are we building for?</h1><p class="wizard-lede">Choose a starting point. We’ll tailor the sample copy, booking fields and site sections to your practice.</p><div class="wizard-specialty-grid"><button class="wizard-specialty ${config.specialty === 'veterinary' ? 'selected' : ''}" data-wizard-specialty="veterinary"><span class="choice-icon vet-icon"><svg><use href="#i-paw"/></svg></span><span class="wizard-radio"></span><strong>Veterinary</strong><small>Care for pets, built around their people.</small></button><button class="wizard-specialty ${config.specialty === 'dental' ? 'selected' : ''}" data-wizard-specialty="dental"><span class="choice-icon dental-icon"><svg><use href="#i-tooth"/></svg></span><span class="wizard-radio"></span><strong>Dental</strong><small>A calmer, clearer patient experience.</small></button></div><div class="wizard-tip"><svg><use href="#i-spark"/></svg><span>Same reliable site engine. Just the right language and defaults for your specialty.</span></div>`;
    content.querySelectorAll('[data-wizard-specialty]').forEach((button) => button.addEventListener('click', () => setSpecialty(button.dataset.wizardSpecialty)));
  } else if (wizardStep === 1) {
    content.innerHTML = `<h1 class="wizard-title" id="wizardTitle">Let's make it yours.</h1><p class="wizard-lede">Add the essentials. These appear in the site header, contact section and booking confirmations.</p><div class="wizard-form-grid"><label class="form-field wizard-field-full"><span>Practice name</span><input id="wizardBusiness" maxlength="80" value="${esc(config.businessName)}" placeholder="e.g. Harborlight Veterinary Care"></label><label class="form-field wizard-field-full"><span>City or neighborhood</span><input id="wizardLocation" maxlength="100" value="${esc(config.location)}" placeholder="e.g. Quezon City"></label><label class="form-field"><span>Contact email</span><input id="wizardEmail" maxlength="120" type="email" value="${esc(config.email)}"></label><label class="form-field"><span>Phone number</span><input id="wizardPhone" maxlength="30" value="${esc(config.phone)}"></label></div><div class="wizard-tip"><svg><use href="#i-globe"/></svg><span>Your website is white-label. The owner can connect a custom domain after deployment.</span></div>`;
    ['wizardBusiness','wizardLocation','wizardEmail','wizardPhone'].forEach((id) => $(id).addEventListener('input', collectWizardFields));
  } else if (wizardStep === 2) {
    content.innerHTML = `<h1 class="wizard-title" id="wizardTitle">Set a welcoming tone.</h1><p class="wizard-lede">Choose a starting palette and typography. Every color can be changed in the theme studio.</p><div class="wizard-theme-grid">${Object.entries(THEMES).map(([key, theme]) => `<button class="wizard-theme-card ${config.theme === key ? 'selected' : ''}" data-wizard-theme="${key}"><span class="wizard-theme-art" style="--swatch-bg:${theme.paperColor};--swatch-primary:${theme.primaryColor};--swatch-accent:${theme.accentColor}"><span></span><i></i></span><span class="wizard-radio"></span><strong>${theme.label}</strong><small>${theme.mood}</small></button>`).join('')}</div><div class="wizard-preview-tip"><span><svg><use href="#i-palette"/></svg></span><span>Theme settings are owner-editable after launch, without touching the generated code.</span></div>`;
    content.querySelectorAll('[data-wizard-theme]').forEach((button) => button.addEventListener('click', () => setTheme(button.dataset.wizardTheme)));
  } else {
    content.innerHTML = `<h1 class="wizard-title" id="wizardTitle">Keep the essentials close.</h1><p class="wizard-lede">Choose the practical features most local practices need. No custom CMS blocks or plugin maze.</p><div class="wizard-feature-list"><div class="wizard-feature-card"><span class="feature-icon"><svg><use href="#i-file"/></svg></span><span class="feature-copy"><strong>Blog & updates</strong><small>Fixed post fields for helpful articles and clinic news.</small></span><label class="switch"><input id="wizardBlog" type="checkbox" ${config.features.blog ? 'checked' : ''}><span class="switch-track"></span><span class="sr-only">Enable blog</span></label></div><div class="wizard-feature-card"><span class="feature-icon feature-icon-gallery"><svg><use href="#i-image"/></svg></span><span class="feature-copy"><strong>Work & gallery</strong><small>Fixed image, caption, category and visibility fields.</small></span><label class="switch"><input id="wizardGallery" type="checkbox" ${config.features.gallery !== false ? 'checked' : ''}><span class="switch-track"></span><span class="sr-only">Enable gallery</span></label></div><div class="wizard-feature-card"><span class="feature-icon feature-icon-book"><svg><use href="#i-calendar"/></svg></span><span class="feature-copy"><strong>Appointment requests</strong><small>Request a real time slot and collect contact details.</small></span><label class="switch"><input id="wizardBooking" type="checkbox" ${config.features.scheduling ? 'checked' : ''}><span class="switch-track"></span><span class="sr-only">Enable appointment requests</span></label></div></div><div class="wizard-finish-card"><span><svg><use href="#i-check"/></svg></span><span><strong>Two deploy targets, one shared setup.</strong><small>We’ll package Vercel and Cloudflare apps together in one ZIP.</small></span></div>`;
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
  config.businessName = business.value;
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
    toast('Your setup is ready', 'Review the live preview, then generate the paired app bundle.');
  }
}
function advanceWizard() {
  if (wizardStep === 1) {
    collectWizardFields();
    if (!config.businessName.trim()) { $('wizardBusiness').focus(); toast('Add a practice name', 'A practice name is needed to create the site address.', true); return; }
  }
  if (wizardStep < 3) {
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
async function generateApps() {
  const buttons = [$('generateButton'), $('topGenerate')];
  buttons.forEach((button) => { button.classList.add('loading-button'); button.dataset.original = button.innerHTML; button.innerHTML = '<svg><use href="#i-spark"/></svg> Preparing ZIP…'; });
  try {
    const csrfResponse = await fetch('/api/csrf', { credentials: 'same-origin' });
    if (!csrfResponse.ok) throw new Error('Could not initialize the secure build session.');
    const csrf = await csrfResponse.json();
    csrfToken = csrf.token;
    const response = await fetch('/api/generate', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(configForExport())
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'The build could not be generated.');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${slugify(config.businessName)}-vercel-cloudflare.zip`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast('Your apps are packaged', 'The ZIP includes deploy-ready Vercel and Cloudflare projects, plus Neon setup files.');
  } catch (error) {
    toast('Could not build the ZIP', error.message || 'Check the server and try again.', true);
  } finally {
    buttons.forEach((button) => { button.classList.remove('loading-button'); if (button.dataset.original) button.innerHTML = button.dataset.original; });
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
  nameTouched = false;
  localStorage.removeItem('canopy-name-touched');
  syncInputs(); updatePreview();
  toast('Sample copy restored', 'Practice name and location are back to the original preview.');
}
function exportSummary() {
  const data = JSON.stringify(configForExport(), null, 2);
  navigator.clipboard?.writeText(data).then(() => toast('Setup copied', 'Site configuration JSON copied to your clipboard.')).catch(() => toast('Clipboard unavailable', 'Your browser did not allow clipboard access.', true));
}
function bindEvents() {
  $('vetChoice').addEventListener('click', () => setSpecialty('veterinary'));
  $('dentalChoice').addEventListener('click', () => setSpecialty('dental'));
  $('practiceName').addEventListener('input', (event) => { config.businessName = event.target.value; nameTouched = true; localStorage.setItem('canopy-name-touched', 'true'); updatePreview(); });
  $('practiceLocation').addEventListener('input', (event) => { config.location = event.target.value; updatePreview(); });
  $('practiceEmail').addEventListener('input', (event) => { config.email = event.target.value; saveConfig(); });
  $('practicePhone').addEventListener('input', (event) => { config.phone = event.target.value; saveConfig(); });
  $('brandColor').addEventListener('input', (event) => { config.primaryColor = event.target.value; syncInputs(); updatePreview(); });
  $('fontStyle').addEventListener('change', (event) => { config.fontStyle = event.target.value; updatePreview(); });
  $('blogToggle').addEventListener('change', (event) => { config.features.blog = event.target.checked; updatePreview(); });
  $('galleryToggle').addEventListener('change', (event) => { config.features.gallery = event.target.checked; updatePreview(); });
  $('bookingToggle').addEventListener('change', (event) => { config.features.scheduling = event.target.checked; updatePreview(); });
  document.querySelectorAll('.theme-template-card[data-theme]').forEach((button) => button.addEventListener('click', () => setTheme(button.dataset.theme)));
  document.querySelectorAll('[data-editorial-accent]').forEach((button) => button.addEventListener('click', () => setEditorialAccent(button.dataset.editorialAccent)));
  $('resetTheme').addEventListener('click', resetTheme);
  $('resetPreview').addEventListener('click', resetCopy);
  $('generateButton').addEventListener('click', generateApps);
  $('topGenerate').addEventListener('click', generateApps);
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
  $('copySetup').addEventListener('click', exportSummary);
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
