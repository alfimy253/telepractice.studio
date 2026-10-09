(() => {
  const fallback = window.SITE_CONFIG || {};
  let site = { ...fallback, features: { ...(fallback.features || {}) } };
  let csrfToken = '';
  let signedIn = false;
  let paymentsRefreshTimer = null;
  const ADMIN_PAGE_IDS = new Set(['identity', 'menu', 'appearance', 'blog', 'gallery', 'availability', 'appointments', 'payments']);
  const MAX_MENU_LINKS = 16;
  const $ = (id) => document.getElementById(id);
  const isSignedIn = () => signedIn;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  function showAdminPage(pageId) {
    const activePage = ADMIN_PAGE_IDS.has(pageId) ? pageId : 'identity';
    document.querySelectorAll('[data-admin-page]').forEach((page) => { page.hidden = page.dataset.adminPage !== activePage; });
    document.querySelectorAll('[data-admin-page-link]').forEach((button) => {
      const active = button.dataset.adminPageLink === activePage;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    return activePage;
  }
  function syncAdminPageFromHash() {
    const requestedPage = window.location.hash.slice(1);
    const activePage = showAdminPage(requestedPage);
    if (requestedPage && requestedPage !== activePage) {
      const url = new URL(window.location.href);
      url.hash = activePage;
      window.history.replaceState(null, '', url);
    }
  }
  function toast(message, detailOrError = false, isError = false) {
    const node = $('adminToast'); if (!node) return;
    const detail = typeof detailOrError === 'string' ? detailOrError : '';
    const hasError = typeof detailOrError === 'boolean' ? detailOrError : isError;
    node.textContent = [message, detail].filter(Boolean).join(' · '); node.classList.toggle('error', hasError); node.classList.add('visible');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('visible'), 4400);
  }
  function status(message, error = false) {
    const node = $('saveIndicator'); node.innerHTML = `<i></i> ${esc(message)}`; node.classList.toggle('is-error', error);
  }
  async function getCsrf() {
    const response = await fetch('/api/csrf', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Unable to initialize CSRF protection.');
    const data = await response.json(); csrfToken = data.token; return csrfToken;
  }
  async function api(path, options = {}) {
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (options.method && !['GET','HEAD'].includes(options.method.toUpperCase())) {
      if (!csrfToken) await getCsrf();
      headers['X-CSRF-Token'] = csrfToken;
      if (options.body && typeof options.body !== 'string') { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(options.body); }
    }
    const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }
  function applyToForm() {
    const siteForm = $('siteForm');
    for (const field of ['businessName','location','email','phone']) siteForm.elements[field].value = site[field] || '';
    const themeForm = $('themeForm');
    for (const field of ['primaryColor','accentColor','paperColor']) {
      themeForm.elements[field].value = site[field] || ({ primaryColor:'#376f62',accentColor:'#e9b36e',paperColor:'#fbf8f1' })[field];
      $(field === 'primaryColor' ? 'colorReadout' : field === 'accentColor' ? 'accentReadout' : 'paperReadout').textContent = themeForm.elements[field].value.toUpperCase();
    }
    themeForm.elements.fontStyle.value = site.fontStyle || 'serif';
    const brivonSystem = String(site.theme || '').startsWith('brivon-');
    [...themeForm.elements.theme.options].forEach((option) => {
      const optionIsBrivon = option.value.startsWith('brivon-');
      option.hidden = optionIsBrivon !== brivonSystem;
      option.disabled = optionIsBrivon !== brivonSystem;
    });
    themeForm.elements.theme.value = site.theme || 'canopy';
    themeForm.elements.editorialAccent.value = site.editorialAccent || 'black';
    $('editorialAccentField').hidden = themeForm.elements.theme.value !== 'editorial';
    $('adminBrandName').textContent = site.brandName || site.businessName || 'Practice studio';
    $('themePreviewName').textContent = site.businessName || 'Practice name';
    $('themePreviewLayout').textContent = `${themeForm.elements.theme.options[themeForm.elements.theme.selectedIndex]?.text.split(' · ')[0] || 'Canopy'} layout · fixed content system`;
    const isDental = site.specialty === 'dental';
    $('adminSymbol').textContent = isDental ? '✦' : '✳'; $('themeMiniMark').textContent = isDental ? '✦' : '✳';
  }
  function newMenuLinkId() {
    const random = window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return `custom-${random}`;
  }
  function readMenuLinks() {
    return [...$('menuLinksList').querySelectorAll('[data-menu-link-row]')].map((row) => {
      const feature = row.dataset.menuLinkFeature || '';
      return {
        id: row.dataset.menuLinkId,
        label: row.querySelector('[data-menu-link-field="label"]').value.trim(),
        href: row.querySelector('[data-menu-link-field="href"]').value.trim(),
        ...(feature ? { feature } : {})
      };
    });
  }
  function updateMenuLinkPositions() {
    const rows = [...$('menuLinksList').querySelectorAll('[data-menu-link-row]')];
    rows.forEach((row, index) => {
      row.querySelector('.admin-menu-link-position').textContent = String(index + 1).padStart(2, '0');
      row.querySelector('[data-menu-action="up"]').disabled = index === 0;
      row.querySelector('[data-menu-action="down"]').disabled = index === rows.length - 1;
    });
  }
  function renderMenuLinks(items = site.menuLinks) {
    const list = $('menuLinksList');
    if (!list) return;
    list.replaceChildren();
    (Array.isArray(items) ? items.slice(0, MAX_MENU_LINKS) : []).forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'admin-menu-link-row';
      row.dataset.menuLinkRow = 'true';
      row.dataset.menuLinkId = String(item?.id || newMenuLinkId()).slice(0, 48);
      row.dataset.menuLinkFeature = ['gallery', 'blog', 'scheduling'].includes(item?.feature) ? item.feature : '';
      const position = document.createElement('span');
      position.className = 'admin-menu-link-position';
      position.setAttribute('aria-label', `Menu position ${index + 1}`);
      const label = document.createElement('label');
      label.className = 'admin-menu-link-field';
      const labelTitle = document.createElement('span'); labelTitle.textContent = 'Link label';
      const labelInput = document.createElement('input');
      labelInput.type = 'text'; labelInput.maxLength = 60; labelInput.required = true;
      labelInput.autocomplete = 'off'; labelInput.placeholder = 'e.g. Our care'; labelInput.value = String(item?.label || '');
      labelInput.dataset.menuLinkField = 'label';
      label.append(labelTitle, labelInput);
      const destination = document.createElement('label');
      destination.className = 'admin-menu-link-field admin-menu-link-destination';
      const destinationTitle = document.createElement('span'); destinationTitle.textContent = 'Destination';
      const destinationInput = document.createElement('input');
      destinationInput.type = 'text'; destinationInput.inputMode = 'url'; destinationInput.maxLength = 2048;
      destinationInput.required = true; destinationInput.autocomplete = 'url'; destinationInput.spellcheck = false;
      destinationInput.placeholder = '/appointments.html or https://example.com';
      destinationInput.value = String(item?.href || ''); destinationInput.dataset.menuLinkField = 'href';
      destination.append(destinationTitle, destinationInput);
      const actions = document.createElement('div'); actions.className = 'admin-menu-link-actions';
      for (const [action, glyph, accessibleName] of [['up', '↑', 'Move link up'], ['down', '↓', 'Move link down'], ['remove', '×', 'Remove link']]) {
        const button = document.createElement('button');
        button.type = 'button'; button.dataset.menuAction = action; button.textContent = glyph;
        button.setAttribute('aria-label', accessibleName); button.title = accessibleName;
        actions.appendChild(button);
      }
      row.append(position, label, destination, actions);
      list.appendChild(row);
    });
    updateMenuLinkPositions();
  }
  function safeMenuDestination(value) {
    const raw = String(value ?? '').trim();
    if (!raw || raw.length > 2048 || /[\u0000-\u001f\u007f]/.test(raw)) return false;
    if (raw.startsWith('/')) {
      if (raw.startsWith('//') || raw.startsWith('/\\')) return false;
      try { return new URL(raw, window.location.origin).origin === window.location.origin; } catch (_) { return false; }
    }
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
    } catch (_) { return false; }
  }
  function previewTheme() {
    const form = $('themeForm');
    const primary = form.elements.primaryColor.value;
    const accent = form.elements.accentColor.value;
    const paper = form.elements.paperColor.value;
    document.documentElement.style.setProperty('--primary', primary);
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--paper', paper);
    document.body.classList.toggle('font-sans', form.elements.fontStyle.value === 'sans');
    const previewBox = $('themePreviewBox');
    previewBox.classList.remove('theme-canopy','theme-clay','theme-coastal','theme-editorial','theme-neat','theme-launcher','theme-air','theme-brivon-dark','theme-brivon-light');
    if (['canopy','clay','coastal','editorial','neat','launcher','air','brivon-dark','brivon-light'].includes(form.elements.theme.value)) previewBox.classList.add(`theme-${form.elements.theme.value}`);
    $('editorialAccentField').hidden = form.elements.theme.value !== 'editorial';
    $('themeMiniMark').style.background = primary;
    $('colorReadout').textContent = primary.toUpperCase(); $('accentReadout').textContent = accent.toUpperCase(); $('paperReadout').textContent = paper.toUpperCase();
    $('themePreviewLayout').textContent = `${form.elements.theme.options[form.elements.theme.selectedIndex]?.text.split(' · ')[0] || 'Canopy'} layout · fixed content system`;
  }
  function applyThemePreset() {
    const form = $('themeForm');
    const presets = {
      canopy: ['#376f62','#e9b36e','#fbf8f1'], clay: ['#ac6550','#e8b897','#fbf6ef'], coastal: ['#397c87','#dfb75d','#f4f8f7'],
      editorial: ['#202522','#c9a45b','#f6f5f1'], neat: ['#2d8078','#f0b768','#f7faf9'], launcher: ['#c33e55','#f0c85c','#fff9f1'], air: ['#dd356e','#fee856','#ffffff'],
      'brivon-dark': ['#d4ff3d','#d4ff3d','#0a0a0c'], 'brivon-light': ['#506f00','#506f00','#f5f5ef']
    };
    const palette = presets[form.elements.theme.value] || presets.canopy;
    if (form.elements.theme.value === 'editorial') palette[0] = ({ black:'#202522', teal:'#187c78', forest:'#2e6049' })[form.elements.editorialAccent.value] || palette[0];
    ['primaryColor','accentColor','paperColor'].forEach((field, index) => { form.elements[field].value = palette[index]; });
    previewTheme();
  }
  async function loadSite() {
    try {
      const response = await fetch('/api/site', { headers: { Accept: 'application/json' } });
      if (response.ok) { const data = await response.json(); if (data.config) site = { ...site, ...data.config, features: { ...site.features, ...(data.config.features || {}) } }; }
    } catch (_) {}
    applyToForm(); previewTheme(); renderMenuLinks(site.menuLinks);
  }
  function setSignedIn(value, email = '') {
    signedIn = Boolean(value);
    $('loginPanel').hidden = signedIn;
    $('adminWorkspace').hidden = !signedIn;
    $('adminFooter').hidden = !signedIn;
    $('ownerIdentity').hidden = !signedIn;
    $('logoutButton').hidden = !signedIn;
    $('ownerEmail').textContent = signedIn ? `SIGNED IN · ${email}` : '';
    if (signedIn && !paymentsRefreshTimer) paymentsRefreshTimer = window.setInterval(() => {
      if (signedIn && document.visibilityState === 'visible') loadPayments();
    }, 60_000);
    else if (!signedIn && paymentsRefreshTimer) { window.clearInterval(paymentsRefreshTimer); paymentsRefreshTimer = null; }
  }
  function followDashboardPath(session) {
    if (!session.authenticated || !session.dashboardPath || window.location.pathname === session.dashboardPath) return false;
    const dashboardUrl = new URL(session.dashboardPath, window.location.href);
    dashboardUrl.hash = window.location.hash;
    window.location.replace(dashboardUrl);
    return true;
  }
  async function loadAdminWorkspace() {
    await loadSite();
    await loadPosts();
    await loadGallery();
    await loadAppointments();
    await loadAvailabilitySchedule();
    await loadPayments();
  }
  async function initializeAdmin() {
    try {
      const session = await api('/api/admin/session');
      if (followDashboardPath(session)) return;
      syncAdminPageFromHash();
      setSignedIn(session.authenticated, session.email || '');
      if (session.authenticated) await loadAdminWorkspace();
    } catch (error) {
      setSignedIn(false);
      $('loginMessage').textContent = error.message || 'Could not check the owner session. Refresh and try again.';
    }
  }
  function addPostGalleryRow(image = {}) {
    const rows = $('postGalleryRows');
    if (!rows || rows.children.length >= 12) { toast('A post can have up to 12 gallery images.', true); return; }
    const usedOrders = new Set([...rows.querySelectorAll('[data-gallery-field="sortOrder"]')].map((input) => Number(input.value)));
    const nextOrder = Array.from({ length: 12 }, (_unused, index) => index).find((index) => !usedOrders.has(index)) ?? rows.children.length;
    const row = document.createElement('div'); row.className = 'post-gallery-row';
    const fields = [
      ['imageUrl', 'Image URL', 'https://example.com/photo.jpg', 2048, 'text'],
      ['altText', 'Alt text', 'Describe this image', 180, 'text'],
      ['caption', 'Caption', 'Optional caption', 300, 'text'],
      ['sortOrder', 'Order', '', 4, 'number']
    ];
    for (const [name, labelText, placeholder, maxLength, type] of fields) {
      const label = document.createElement('label');
      const title = document.createElement('span'); title.textContent = labelText;
      const input = document.createElement('input'); input.type = type; input.dataset.galleryField = name;
      if (type === 'number') { input.min = '0'; input.max = '11'; input.value = String(Number.isInteger(Number(image.sortOrder)) ? Number(image.sortOrder) : nextOrder); }
      else { input.maxLength = maxLength; input.placeholder = placeholder; input.value = image[name] || ''; if (name === 'imageUrl') input.inputMode = 'url'; }
      label.append(title, input); row.appendChild(label);
    }
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-post-gallery'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', 'Remove gallery image');
    remove.addEventListener('click', () => row.remove()); row.appendChild(remove); rows.appendChild(row);
  }
  function readPostGallery() {
    return [...$('postGalleryRows').querySelectorAll('.post-gallery-row')].map((row) => {
      const value = (name) => row.querySelector(`[data-gallery-field="${name}"]`)?.value.trim() || '';
      return { imageUrl: value('imageUrl'), altText: value('altText'), caption: value('caption'), sortOrder: Number(value('sortOrder') || 0) };
    }).filter((image) => image.imageUrl || image.altText || image.caption);
  }
  function beginPostEdit(post) {
    const form = $('postForm');
    form.elements.id.value = post.id || '';
    for (const field of ['title','slug','excerpt','body','category','status']) form.elements[field].value = post[field] || (field === 'category' ? 'Practice notes' : field === 'status' ? 'draft' : '');
    const gallery = Array.isArray(post.gallery) ? [...post.gallery].sort((left, right) => Number(left.sortOrder) - Number(right.sortOrder)) : [];
    const inheritedFeature = gallery[0] && post.featureImageUrl === gallery[0].imageUrl;
    form.elements.featureImageUrl.value = inheritedFeature ? '' : post.featureImageUrl || '';
    form.elements.featureImageAlt.value = inheritedFeature ? '' : post.featureImageAlt || '';
    $('postGalleryRows').replaceChildren();
    gallery.forEach((image) => addPostGalleryRow(image));
    form.elements.slug.dataset.edited = 'true';
    form.querySelector('[type="submit"]').textContent = 'Update post';
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    form.elements.title.focus({ preventScroll: true });
  }
  function beginGalleryEdit(item) {
    const form = $('galleryForm');
    form.elements.id.value = item.id || '';
    for (const field of ['title','imageUrl','altText','caption','category','status']) form.elements[field].value = item[field] || (field === 'category' ? 'Practice life' : field === 'status' ? 'draft' : '');
    form.elements.sortOrder.value = Number.isInteger(Number(item.sortOrder)) ? Number(item.sortOrder) : 0;
    form.querySelector('[type="submit"]').textContent = 'Update gallery item';
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    form.elements.title.focus({ preventScroll: true });
  }
  async function loadPosts() {
    const list = $('postsList');
    if (!isSignedIn()) { list.innerHTML = '<p class="empty-posts">Sign in to manage blog posts.</p>'; return; }
    try {
      const data = await api('/api/admin/posts');
      const posts = data.posts || [];
      $('postCount').textContent = `${posts.length} ${posts.length === 1 ? 'post' : 'posts'}`;
      list.replaceChildren();
      if (!posts.length) { list.innerHTML = '<p class="empty-posts">No posts yet. Use the form above to write your first one.</p>'; return; }
      posts.forEach((post) => {
        const row = document.createElement('div'); row.className = 'admin-post-row';
        const icon = document.createElement('span'); icon.className = 'admin-post-dot'; icon.textContent = '▤';
        const copy = document.createElement('span'); copy.className = 'admin-post-copy';
        const title = document.createElement('strong'); title.textContent = post.title;
        const details = document.createElement('small'); details.textContent = `${post.category || 'Practice notes'} · ${post.status || 'draft'} · ${post.gallery?.length || 0} gallery images`;
        copy.append(title, details);
        const state = document.createElement('span'); state.className = `post-status${post.status === 'draft' ? ' draft' : ''}`; state.textContent = post.status || 'draft';
        const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'edit-post'; edit.textContent = 'Edit'; edit.setAttribute('aria-label', `Edit ${post.title}`);
        edit.addEventListener('click', () => beginPostEdit(post));
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete-post'; remove.setAttribute('aria-label', `Delete ${post.title}`); remove.textContent = '×';
        remove.addEventListener('click', async () => {
          if (!window.confirm(`Delete “${post.title}”?`)) return;
          try { await api(`/api/admin/posts/${encodeURIComponent(post.id)}`, { method: 'DELETE' }); toast('Post deleted', 'The article has been removed.'); await loadPosts(); }
          catch (error) { toast(error.message, true); }
        });
        row.append(icon, copy, state, edit, remove); list.appendChild(row);
      });
    } catch (error) { list.innerHTML = `<p class="empty-posts">${esc(error.message)} — check your sign-in session.</p>`; }
  }
  async function loadGallery() {
    const list = $('galleryList');
    if (!isSignedIn()) { list.innerHTML = '<p class="empty-posts">Sign in to manage gallery items.</p>'; return; }
    try {
      const data = await api('/api/admin/gallery');
      const items = data.items || [];
      $('galleryCount').textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
      list.replaceChildren();
      if (!items.length) { list.innerHTML = '<p class="empty-posts">No gallery items yet. Add a title, image and caption above.</p>'; return; }
      items.forEach((item) => {
        const row = document.createElement('div'); row.className = 'admin-gallery-row';
        const icon = document.createElement('span'); icon.className = 'admin-gallery-thumb'; icon.textContent = '▧';
        const copy = document.createElement('span'); copy.className = 'admin-post-copy';
        const title = document.createElement('strong'); title.textContent = item.title;
        const details = document.createElement('small'); details.textContent = `${item.category || 'Practice life'} · order ${item.sortOrder ?? 0}`;
        copy.append(title, details);
        const state = document.createElement('span'); state.className = `post-status${item.status === 'draft' ? ' draft' : ''}`; state.textContent = item.status || 'draft';
        const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'edit-post'; edit.textContent = 'Edit'; edit.setAttribute('aria-label', `Edit ${item.title}`);
        edit.addEventListener('click', () => beginGalleryEdit(item));
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete-post'; remove.setAttribute('aria-label', `Delete ${item.title}`); remove.textContent = '×';
        remove.addEventListener('click', async () => {
          if (!window.confirm(`Delete “${item.title}”?`)) return;
          try { await api(`/api/admin/gallery/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); toast('Gallery item deleted'); await loadGallery(); }
          catch (error) { toast(error.message, true); }
        });
        row.append(icon, copy, state, edit, remove); list.appendChild(row);
      });
    } catch (error) { list.innerHTML = `<p class="empty-posts">${esc(error.message)} — check your sign-in session.</p>`; }
  }
  function monthInTimeZone(date = new Date()) {
    const zone = site.timeZone || 'Asia/Manila';
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit' }).formatToParts(date);
    return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
  }
  function shiftMonth(value, amount) {
    const [year, month] = value.split('-').map(Number); const date = new Date(Date.UTC(year, month - 1 + amount, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  function setScheduleExceptions(items = []) {
    const container = $('availabilityExceptions'); container.replaceChildren();
    if (!items.length) { const empty = document.createElement('p'); empty.className = 'schedule-empty'; empty.textContent = 'No date-specific changes.'; container.appendChild(empty); return; }
    items.forEach((item) => addScheduleException(item));
  }
  function addScheduleException(item = {}) {
    const container = $('availabilityExceptions');
    container.querySelector('.schedule-empty')?.remove();
    if (container.querySelectorAll('.schedule-exception-row').length >= 31) { toast('A month can have at most 31 date exceptions.', true); return; }
    const row = document.createElement('div'); row.className = 'schedule-exception-row';
    const dateLabel = document.createElement('label'); dateLabel.innerHTML = '<span>Date</span>';
    const date = document.createElement('input'); date.type = 'date'; date.required = true; date.dataset.exceptionDate = ''; date.value = item.date || ''; dateLabel.appendChild(date);
    const modeLabel = document.createElement('label'); modeLabel.innerHTML = '<span>Change</span>';
    const mode = document.createElement('select'); mode.dataset.exceptionMode = '';
    mode.add(new Option('Open these hours', 'open')); mode.add(new Option('Close this day', 'closed')); mode.value = item.mode || 'open'; modeLabel.appendChild(mode);
    const startLabel = document.createElement('label'); startLabel.innerHTML = '<span>From</span>';
    const start = document.createElement('input'); start.type = 'time'; start.step = '1800'; start.dataset.exceptionStart = ''; start.value = item.startTime || '09:00'; startLabel.appendChild(start);
    const endLabel = document.createElement('label'); endLabel.innerHTML = '<span>Until</span>';
    const end = document.createElement('input'); end.type = 'time'; end.step = '1800'; end.dataset.exceptionEnd = ''; end.value = item.endTime || '17:00'; endLabel.appendChild(end);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-schedule-exception'; remove.textContent = '×'; remove.setAttribute('aria-label', 'Remove date exception');
    const updateMode = () => { const open = mode.value === 'open'; start.disabled = !open; end.disabled = !open; };
    mode.addEventListener('change', updateMode); remove.addEventListener('click', () => { row.remove(); if (!container.querySelector('.schedule-exception-row')) setScheduleExceptions([]); });
    row.append(dateLabel, modeLabel, startLabel, endLabel, remove); container.appendChild(row); updateMode();
  }
  function readSchedulePayload() {
    const weeklyRules = [...$('weeklyRulesRows').querySelectorAll('.schedule-day-row')].map((row) => ({
      weekday: Number(row.dataset.weekday), enabled: row.querySelector('[data-enabled]').checked,
      startTime: row.querySelector('[data-start]').value, endTime: row.querySelector('[data-end]').value
    }));
    const exceptions = [...$('availabilityExceptions').querySelectorAll('.schedule-exception-row')].map((row) => ({
      date: row.querySelector('[data-exception-date]').value, mode: row.querySelector('[data-exception-mode]').value,
      startTime: row.querySelector('[data-exception-start]').value, endTime: row.querySelector('[data-exception-end]').value
    })).filter((item) => item.date);
    return { weeklyRules, exceptions };
  }
  async function loadAvailabilitySchedule() {
    const month = $('availabilityMonth')?.value; if (!month || !isSignedIn()) return;
    const button = $('publishAvailabilityButton'); if (button) button.disabled = true;
    try {
      const data = await api(`/api/admin/availability?month=${encodeURIComponent(month)}`);
      const rules = Array.isArray(data.schedule?.weeklyRules) ? data.schedule.weeklyRules : [];
      document.querySelectorAll('.schedule-day-row').forEach((row) => {
        const weekday = Number(row.dataset.weekday); const rule = rules.find((item) => Number(item.weekday) === weekday);
        row.querySelector('[data-enabled]').checked = Boolean(rule?.enabled);
        row.querySelector('[data-start]').value = rule?.startTime || '09:00';
        row.querySelector('[data-end]').value = rule?.endTime || '17:00';
      });
      setScheduleExceptions(Array.isArray(data.schedule?.exceptions) ? data.schedule.exceptions : []);
      $('scheduleDeadline').textContent = data.locked ? `Deadline passed · ${data.deadline}` : `${data.schedule?.status === 'published' ? 'Published' : 'Due'} by ${data.deadline}`;
      $('scheduleDeadline').classList.toggle('is-locked', Boolean(data.locked));
      $('availabilityScheduleMessage').textContent = `${data.totalSlots || 0} published slots · ${data.bookedSlots || 0} reserved${data.locked ? ' · month locked' : ''}`;
      $('availabilityScheduleMessage').classList.remove('is-error');
      if (button) { button.disabled = Boolean(data.locked); button.textContent = data.schedule?.status === 'published' ? 'Update published schedule' : 'Publish availability'; }
    } catch (error) { $('availabilityScheduleMessage').textContent = error.message; $('availabilityScheduleMessage').classList.add('is-error'); if (button) button.disabled = false; }
  }
  async function submitAvailability(event) {
    event.preventDefault();
    if (!isSignedIn()) { toast('Sign in first', true); return; }
    const month = $('availabilityMonth').value;
    const button = $('publishAvailabilityButton'); button.disabled = true;
    try {
      await api(`/api/admin/availability/${encodeURIComponent(month)}`, { method: 'PUT', body: readSchedulePayload() });
      $('availabilityScheduleMessage').textContent = 'Schedule published. The public calendar is updated.';
      $('availabilityScheduleMessage').classList.remove('is-error');
      status('Availability published'); toast('Monthly availability published');
      await loadAvailabilitySchedule();
    } catch (error) { $('availabilityScheduleMessage').textContent = error.message; $('availabilityScheduleMessage').classList.add('is-error'); toast(error.message, true); button.disabled = false; }
  }
  async function loadAppointments() {
    const list = $('appointmentsList');
    if (!isSignedIn()) { list.innerHTML = '<p class="empty-posts">Sign in to review consultations.</p>'; return; }
    try {
      const data = await api('/api/admin/appointments');
      const appointments = data.appointments || [];
      $('appointmentCount').textContent = `${appointments.length} ${appointments.length === 1 ? 'consultation' : 'consultations'} · past and next 90 days`;
      list.replaceChildren();
      if (!appointments.length) { list.innerHTML = '<p class="empty-posts">No consultations in this date range yet.</p>'; return; }
      appointments.forEach((appointment) => {
        const item = document.createElement('article'); item.className = 'admin-appointment-item';
        const row = document.createElement('div'); row.className = 'appointment-row';
        const date = document.createElement('span'); date.className = 'appointment-date';
        const parsedDate = new Date(`${String(appointment.date).slice(0,10)}T12:00:00Z`);
        const dateStrong = document.createElement('strong'); dateStrong.textContent = Number.isNaN(parsedDate.valueOf()) ? '—' : parsedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
        const dateSmall = document.createElement('small'); dateSmall.textContent = Number.isNaN(parsedDate.valueOf()) ? '' : parsedDate.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
        date.append(dateStrong, dateSmall);
        const copy = document.createElement('span'); copy.className = 'appointment-copy';
        const name = document.createElement('strong'); name.textContent = `${appointment.name} · ${appointment.service}`;
        const detail = document.createElement('small'); detail.textContent = `${appointment.timeLabel || appointment.time} · ${appointment.email} · ${appointment.phone}${appointment.context ? ` · ${appointment.context}` : ''}`;
        copy.append(name, detail);
        const actions = document.createElement('span'); actions.className = 'appointment-actions';
        const state = document.createElement('span'); state.className = `appointment-state ${appointment.status === 'confirmed' ? 'confirmed' : appointment.status === 'cancelled' ? 'cancelled' : ''}`; state.textContent = appointment.status === 'confirmed' ? 'reserved' : appointment.status || 'requested';
        actions.appendChild(state);
        if (appointment.status !== 'cancelled') {
          if (appointment.status !== 'confirmed') {
            const confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = 'Confirm';
            confirm.addEventListener('click', () => updateAppointment(appointment.id, 'confirmed'));
            actions.appendChild(confirm);
          }
          const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'cancel-appointment'; cancel.textContent = 'Cancel';
          cancel.title = 'Owner cancellation requires at least 24 hours’ notice';
          cancel.addEventListener('click', () => updateAppointment(appointment.id, 'cancelled'));
          actions.appendChild(cancel);
        }
        row.append(date, copy, actions); item.appendChild(row);
        if (appointment.clientId) {
          const editor = document.createElement('div'); editor.className = 'consultation-note-editor';
          const label = document.createElement('label'); label.textContent = 'Private consultation note (clinical or non-clinical)';
          const textarea = document.createElement('textarea'); textarea.rows = 3; textarea.maxLength = 12000; textarea.placeholder = 'Add optional consultation or follow-up notes…'; textarea.value = appointment.noteBody || '';
          const noteActions = document.createElement('div'); noteActions.className = 'consultation-note-actions';
          const noteStatus = document.createElement('small'); noteStatus.textContent = appointment.noteUpdatedAt ? `Last updated ${new Date(appointment.noteUpdatedAt).toLocaleDateString()}` : 'Only this client account can view the note.';
          const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Save private note';
          save.addEventListener('click', async () => {
            save.disabled = true;
            try { await api(`/api/admin/appointments/${encodeURIComponent(appointment.id)}/note`, { method: 'PUT', body: { noteBody: textarea.value } }); toast(textarea.value.trim() ? 'Private note saved' : 'Private note removed'); await loadAppointments(); }
            catch (error) { toast(error.message, true); save.disabled = false; }
          });
          noteActions.append(noteStatus, save); label.appendChild(textarea); editor.append(label, noteActions); item.appendChild(editor);
        } else {
          const legacy = document.createElement('p'); legacy.className = 'legacy-appointment-note'; legacy.textContent = 'This older booking is not connected to a client account, so a private account note cannot be sent.'; item.appendChild(legacy);
        }
        list.appendChild(item);
      });
    } catch (error) { list.innerHTML = `<p class="empty-posts">${esc(error.message)} — check your sign-in session.</p>`; }
  }
  async function updateAppointment(id, status) {
    const action = status === 'confirmed' ? 'Confirm this appointment?' : 'Cancel this reserved consultation? Owner cancellation requires at least 24 hours’ notice.';
    if (!window.confirm(action)) return;
    try { await api(`/api/admin/appointments/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } }); toast(status === 'confirmed' ? 'Consultation confirmed' : 'Consultation cancelled'); await loadAppointments(); }
    catch (error) { toast(error.message, true); }
  }
  function relativeElapsed(value) {
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return 'time unavailable';
    const elapsed = Math.max(0, Date.now() - timestamp);
    if (elapsed < 60_000) return 'just now';
    if (elapsed < 3_600_000) { const minutes = Math.floor(elapsed / 60_000); return `${minutes} minute${minutes === 1 ? '' : 's'} ago`; }
    if (elapsed < 86_400_000) { const hours = Math.floor(elapsed / 3_600_000); return `${hours} hour${hours === 1 ? '' : 's'} ago`; }
    const days = Math.floor(elapsed / 86_400_000); return `${days} day${days === 1 ? '' : 's'} ago`;
  }
  function bookingFirstName(record) {
    const name = String(record.clientName || record.name || '').trim();
    return name ? name.split(/\s+/)[0] : 'Client';
  }
  function paymentBookingSummary(record, timestampField) {
    const booked = `Booked ${relativeElapsed(record[timestampField])}`;
    const date = record.date ? new Date(`${String(record.date).slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
    const slot = [date, record.timeLabel || record.time].filter(Boolean).join(' · ');
    return [booked, record.service, slot].filter(Boolean).join(' · ');
  }
  function renderUnpaidBookings(bookings) {
    const list = $('unpaidBookingsList'); list.replaceChildren();
    $('unpaidBookingsCount').textContent = String(bookings.length);
    if (!bookings.length) { const empty = document.createElement('p'); empty.className = 'empty-posts'; empty.textContent = 'No bookings are waiting for payment proof.'; list.appendChild(empty); return; }
    bookings.forEach((booking) => {
      const item = document.createElement('article'); item.className = 'payment-review-item';
      const summary = document.createElement('div'); summary.className = 'payment-review-summary';
      const person = document.createElement('span'); person.className = 'payment-review-person';
      const name = document.createElement('strong'); name.textContent = `${bookingFirstName(booking)} · ${booking.username || 'Email unavailable'}`;
      const detail = document.createElement('small'); detail.textContent = paymentBookingSummary(booking, 'createdAt'); person.append(name, detail);
      const meta = document.createElement('div'); meta.className = 'payment-review-meta';
      const method = document.createElement('span'); method.className = 'payment-review-status'; method.textContent = booking.paymentMethod === 'maya' ? 'Maya' : 'GCash';
      const dueAt = new Date(booking.paymentDueAt).getTime();
      const reminderDue = Boolean(booking.paymentReminderSentAt) || (Number.isFinite(dueAt) && Date.now() >= dueAt - 3 * 60_000);
      const ownerCheckDue = Boolean(booking.paymentOwnerAttentionAt) || (Number.isFinite(dueAt) && Date.now() >= dueAt);
      const timer = document.createElement('span'); timer.className = `payment-review-status payment-time-left${ownerCheckDue ? ' needs-owner-review' : ''}`;
      timer.textContent = ownerCheckDue ? '15+ min · check payment' : reminderDue ? 'Reminder sent · awaiting proof' : 'Awaiting proof';
      const actions = document.createElement('div'); actions.className = 'payment-review-actions';
      const received = document.createElement('button'); received.type = 'button'; received.className = 'approve-payment'; received.textContent = 'Mark received';
      const release = document.createElement('button'); release.type = 'button'; release.className = 'reject-payment'; release.textContent = 'Release booking';
      received.addEventListener('click', () => updateUnpaidBooking(booking.id, 'received', received, release));
      release.addEventListener('click', () => updateUnpaidBooking(booking.id, 'release', received, release));
      actions.append(received, release); meta.append(method, timer, actions); summary.append(person, meta); item.appendChild(summary); list.appendChild(item);
    });
  }
  async function updateUnpaidBooking(id, action, receivedButton, releaseButton) {
    const confirmation = action === 'received'
      ? 'Mark this payment as received? Confirm that you checked your GCash or Maya account.'
      : 'Release this booking and reopen its appointment time? Confirm that you checked and did not receive the payment.';
    if (!window.confirm(confirmation)) return;
    receivedButton.disabled = true; releaseButton.disabled = true;
    try {
      await api(`/api/admin/payments/unpaid/${encodeURIComponent(id)}`, { method: 'PATCH', body: { action } });
      toast(action === 'received' ? 'Payment marked received' : 'Booking released · time is open again');
      await Promise.all([loadPayments(), loadAppointments()]);
    } catch (error) { toast(error.message, true); receivedButton.disabled = false; releaseButton.disabled = false; }
  }
  function renderPayments(payments) {
    const list = $('paymentsList'); list.replaceChildren();
    $('paymentsCount').textContent = String(payments.length);
    if (!payments.length) { const empty = document.createElement('p'); empty.className = 'empty-posts'; empty.textContent = 'No payment proofs have been uploaded.'; list.appendChild(empty); return; }
    payments.forEach((payment) => {
      const item = document.createElement('article'); item.className = 'payment-review-item'; item.dataset.paymentId = payment.id;
      const summary = document.createElement('div'); summary.className = 'payment-review-summary';
      const person = document.createElement('span'); person.className = 'payment-review-person';
      const name = document.createElement('strong'); name.textContent = `${bookingFirstName(payment)} · ${payment.username || 'Email unavailable'}`;
      const detail = document.createElement('small'); detail.textContent = `${paymentBookingSummary(payment, 'bookedAt')} · Proof uploaded ${relativeElapsed(payment.uploadedAt)}`; person.append(name, detail);
      const meta = document.createElement('div'); meta.className = 'payment-review-meta';
      const method = document.createElement('span'); method.className = 'payment-review-status'; method.textContent = payment.paymentMethod === 'maya' ? 'Maya' : 'GCash';
      const state = document.createElement('span'); state.className = `payment-review-status ${payment.status === 'pending_review' ? '' : payment.status}`; state.textContent = payment.status === 'pending_review' ? 'Needs review' : payment.status || 'Unknown';
      if (payment.appointmentStatus === 'cancelled') { state.classList.add('cancelled'); state.textContent += ' · slot released'; }
      const actions = document.createElement('div'); actions.className = 'payment-review-actions';
      const previewButton = document.createElement('button'); previewButton.type = 'button'; previewButton.textContent = 'View proof';
      previewButton.addEventListener('click', () => togglePaymentPreview(item, previewButton, payment)); actions.appendChild(previewButton);
      if (payment.status === 'pending_review' && payment.appointmentStatus !== 'cancelled') {
        const approve = document.createElement('button'); approve.type = 'button'; approve.className = 'approve-payment'; approve.textContent = 'Approve';
        approve.addEventListener('click', () => reviewPaymentProof(payment.id, 'approved', approve, reject));
        const reject = document.createElement('button'); reject.type = 'button'; reject.className = 'reject-payment'; reject.textContent = 'Reject & release';
        reject.addEventListener('click', () => reviewPaymentProof(payment.id, 'rejected', approve, reject));
        actions.append(approve, reject);
      }
      meta.append(method, state, actions); summary.append(person, meta); item.appendChild(summary); list.appendChild(item);
    });
  }
  function togglePaymentPreview(item, button, payment) {
    const existing = item.querySelector('.payment-proof-preview-wrap');
    if (existing) { existing.remove(); item.classList.remove('is-expanded'); button.textContent = 'View proof'; return; }
    const wrap = document.createElement('div'); wrap.className = 'payment-proof-preview-wrap';
    const image = document.createElement('img'); image.className = 'payment-proof-preview'; image.alt = `Private ${payment.paymentMethod === 'maya' ? 'Maya' : 'GCash'} transaction proof for ${bookingFirstName(payment)}`;
    image.loading = 'lazy'; image.src = `/api/admin/payment-proofs/${encodeURIComponent(payment.id)}/image`;
    image.addEventListener('error', () => { image.remove(); const error = document.createElement('p'); error.className = 'empty-posts'; error.textContent = 'The private screenshot could not be loaded. Refresh and sign in again.'; wrap.appendChild(error); }, { once: true });
    wrap.appendChild(image); item.appendChild(wrap); item.classList.add('is-expanded'); button.textContent = 'Hide proof';
  }
  async function reviewPaymentProof(id, decision, approveButton, rejectButton) {
    if (decision === 'rejected' && !window.confirm('Reject this screenshot and release the appointment time? The client will need to book another slot.')) return;
    approveButton.disabled = true; rejectButton.disabled = true;
    try {
      await api(`/api/admin/payment-proofs/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: decision } });
      toast(decision === 'approved' ? 'Payment approved' : 'Payment rejected · slot released');
      await Promise.all([loadPayments(), loadAppointments()]);
    } catch (error) { toast(error.message, true); approveButton.disabled = false; rejectButton.disabled = false; }
  }
  async function loadUnpaidBookings() {
    const list = $('unpaidBookingsList');
    if (!isSignedIn()) return;
    try { const data = await api('/api/admin/payments/unpaid'); renderUnpaidBookings(data.bookings || []); }
    catch (error) { $('unpaidBookingsCount').textContent = '0'; list.innerHTML = `<p class="empty-posts">${esc(error.message)} — refresh to try again.</p>`; }
  }
  async function loadPaymentsWithProof() {
    const list = $('paymentsList');
    if (!isSignedIn()) return;
    try { const data = await api('/api/admin/payments'); renderPayments(data.payments || []); }
    catch (error) { $('paymentsCount').textContent = '0'; list.innerHTML = `<p class="empty-posts">${esc(error.message)} — refresh to try again.</p>`; }
  }
  async function loadPayments() {
    if (!isSignedIn()) return;
    await Promise.all([loadUnpaidBookings(), loadPaymentsWithProof()]);
  }
  function showPaymentTab(tab) {
    const activeTab = tab === 'payments' ? 'payments' : 'unpaid';
    document.querySelectorAll('[data-payment-tab]').forEach((button) => {
      const active = button.dataset.paymentTab === activeTab;
      button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll('[data-payment-panel]').forEach((panel) => { panel.hidden = panel.dataset.paymentPanel !== activeTab; });
  }
  function bind() {
    document.querySelectorAll('[data-admin-page-link]').forEach((button) => button.addEventListener('click', () => {
      const pageId = button.dataset.adminPageLink;
      if (!ADMIN_PAGE_IDS.has(pageId)) return;
      showAdminPage(pageId);
      if (window.location.hash !== `#${pageId}`) {
        const url = new URL(window.location.href);
        url.hash = pageId;
        window.history.pushState(null, '', url);
      }
    }));
    window.addEventListener('popstate', syncAdminPageFromHash);
    window.addEventListener('hashchange', syncAdminPageFromHash);
    $('menuLinksList').addEventListener('click', (event) => {
      const button = event.target.closest('[data-menu-action]');
      if (!button) return;
      const row = button.closest('[data-menu-link-row]');
      if (!row) return;
      const action = button.dataset.menuAction;
      if (action === 'remove') row.remove();
      else if (action === 'up' && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
      else if (action === 'down' && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
      updateMenuLinkPositions();
      status('Unsaved menu changes');
    });
    $('menuLinksList').addEventListener('input', (event) => {
      if (event.target.matches('[data-menu-link-field]')) status('Unsaved menu changes');
    });
    $('addMenuLink').addEventListener('click', () => {
      const links = readMenuLinks();
      if (links.length >= MAX_MENU_LINKS) { toast(`A menu can have up to ${MAX_MENU_LINKS} links.`, true); return; }
      links.push({ id: newMenuLinkId(), label: 'New link', href: '' });
      renderMenuLinks(links);
      const labelInput = $('menuLinksList').lastElementChild?.querySelector('[data-menu-link-field="label"]');
      labelInput?.focus(); labelInput?.select(); status('Unsaved menu changes');
    });
    $('menuLinksForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!isSignedIn()) { toast('Sign in first', 'Only a site owner can change menu links.', true); return; }
      const form = event.currentTarget;
      const rows = [...$('menuLinksList').querySelectorAll('[data-menu-link-row]')];
      rows.forEach((row) => row.querySelector('[data-menu-link-field="href"]').setCustomValidity(''));
      if (!form.reportValidity()) return;
      const links = readMenuLinks();
      const invalidIndex = links.findIndex((link) => !safeMenuDestination(link.href));
      if (invalidIndex >= 0) {
        const input = rows[invalidIndex].querySelector('[data-menu-link-field="href"]');
        input.setCustomValidity('Use a same-site path starting with / or a complete HTTPS URL.');
        input.reportValidity();
        $('menuLinksMessage').textContent = 'Check the highlighted destination. Use a same-site path or HTTPS URL.';
        return;
      }
      const submitButton = form.querySelector('[type="submit"]');
      submitButton.disabled = true;
      $('menuLinksMessage').textContent = 'Saving menu links…';
      try {
        const update = { ...site, menuLinks: links };
        const data = await api('/api/site', { method: 'PUT', body: update });
        site = data.config || update;
        renderMenuLinks(site.menuLinks);
        $('menuLinksMessage').textContent = 'Menu saved. Your public navigation will use these links.';
        status('Menu saved');
        toast('Menu links updated', 'The order and destinations are saved to your website.');
      } catch (error) {
        $('menuLinksMessage').textContent = error.message || 'Could not save menu links.';
        status('Could not save', true);
        toast(error.message || 'Could not save menu links.', true);
      } finally { submitButton.disabled = false; }
    });
    $('loginForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const username = $('adminUsername').value.trim();
      const password = $('adminPassword').value;
      const button = $('loginButton');
      $('loginMessage').textContent = '';
      button.disabled = true;
      try {
        const session = await api('/api/admin/login', { method: 'POST', body: { username, password } });
        $('adminPassword').value = '';
        setSignedIn(true, session.email || '');
        if (followDashboardPath(session)) return;
        toast('Owner signed in', 'Your session is protected and will expire automatically.');
        await loadAdminWorkspace();
      } catch (error) {
        $('adminPassword').value = '';
        $('loginMessage').textContent = error.message || 'Username or password is incorrect.';
        setSignedIn(false);
        toast('Sign-in failed', error.message || 'Check your username and password.', true);
      } finally {
        button.disabled = false;
      }
    });
    $('logoutButton').addEventListener('click', async () => {
      try { await api('/api/admin/logout', { method: 'POST' }); }
      catch (error) { toast('Could not sign out cleanly', error.message, true); }
      setSignedIn(false);
      $('adminPassword').value = '';
      toast('Signed out', 'The owner session cookie was cleared.');
    });
    $('siteForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!isSignedIn()) { toast('Sign in first', 'Only a site owner can make changes.', true); return; }
      const form = new FormData(event.currentTarget);
      const update = { ...site, businessName: String(form.get('businessName') || '').trim(), brandName: String(form.get('businessName') || '').trim().replace(/\s+(care|clinic|studio|practice|dental)$/i, '').trim(), location: String(form.get('location') || '').trim(), email: String(form.get('email') || '').trim(), phone: String(form.get('phone') || '').trim() };
      try { const data = await api('/api/site', { method: 'PUT', body: update }); site = data.config || update; applyToForm(); status('Details saved'); toast('Practice details updated', 'Your public site now has the latest contact information.'); }
      catch (error) { status('Could not save', true); toast(error.message, true); }
    });
    $('themeForm').addEventListener('input', previewTheme);
    $('themeForm').addEventListener('change', (event) => {
      if (event.target.name === 'theme') applyThemePreset();
      else if (event.target.name === 'editorialAccent' && $('themeForm').elements.theme.value === 'editorial') applyThemePreset();
      else previewTheme();
    });
    $('themeForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!isSignedIn()) { toast('Sign in first', 'Only a site owner can make changes.', true); return; }
      const form = event.currentTarget;
      const update = { ...site, theme: form.elements.theme.value, editorialAccent: form.elements.editorialAccent.value, primaryColor: form.elements.primaryColor.value, accentColor: form.elements.accentColor.value, paperColor: form.elements.paperColor.value, fontStyle: form.elements.fontStyle.value };
      try { const data = await api('/api/site', { method: 'PUT', body: update }); site = data.config || update; applyToForm(); previewTheme(); status('Appearance saved'); toast('Your theme is updated', 'The public website will pick up the new palette and type style.'); }
      catch (error) { status('Could not save', true); toast(error.message, true); }
    });
    $('postForm').elements.title.addEventListener('input', (event) => {
      const slug = $('postForm').elements.slug;
      if (!slug.dataset.edited) slug.value = event.target.value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    });
    $('postForm').elements.slug.addEventListener('input', (event) => { event.target.dataset.edited = 'true'; });
    $('addPostGalleryImage').addEventListener('click', () => addPostGalleryRow());
    $('postForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!isSignedIn()) { toast('Sign in first', 'Only a site owner can create posts.', true); return; }
      const formElement = event.currentTarget;
      const form = new FormData(formElement);
      const post = { title: String(form.get('title') || '').trim(), slug: String(form.get('slug') || '').trim(), excerpt: String(form.get('excerpt') || '').trim(), body: String(form.get('body') || '').trim(), featureImageUrl: String(form.get('featureImageUrl') || '').trim(), featureImageAlt: String(form.get('featureImageAlt') || '').trim(), gallery: readPostGallery(), category: String(form.get('category') || '').trim(), status: String(form.get('status') || 'draft') };
      const postId = String(form.get('id') || '');
      try { await api(postId ? `/api/admin/posts/${encodeURIComponent(postId)}` : '/api/admin/posts', { method: postId ? 'PUT' : 'POST', body: post }); formElement.reset(); $('postGalleryRows').replaceChildren(); formElement.elements.id.value = ''; formElement.elements.slug.dataset.edited = ''; formElement.querySelector('[type="submit"]').textContent = 'Save post'; status('Post saved'); toast(postId ? 'Post updated' : 'Post saved', post.status === 'published' ? 'Your published article is live on the journal.' : 'Your draft is safely stored.'); await loadPosts(); }
      catch (error) { toast(error.message, true); }
    });
    $('galleryForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!isSignedIn()) { toast('Sign in first', 'Only a site owner can manage gallery items.', true); return; }
      const formElement = event.currentTarget;
      const form = new FormData(formElement);
      const item = {
        title: String(form.get('title') || '').trim(), imageUrl: String(form.get('imageUrl') || '').trim(),
        altText: String(form.get('altText') || '').trim(), caption: String(form.get('caption') || '').trim(),
        category: String(form.get('category') || '').trim(), status: String(form.get('status') || 'draft'),
        sortOrder: Number(form.get('sortOrder') || 0)
      };
      const itemId = String(form.get('id') || '');
      try {
        await api(itemId ? `/api/admin/gallery/${encodeURIComponent(itemId)}` : '/api/admin/gallery', { method: itemId ? 'PUT' : 'POST', body: item });
        formElement.reset(); formElement.elements.id.value = ''; formElement.elements.sortOrder.value = '0'; formElement.querySelector('[type="submit"]').textContent = 'Save gallery item';
        status('Gallery item saved'); toast(itemId ? 'Gallery item updated' : 'Gallery item saved', item.status === 'published' ? 'It is now visible in the public gallery.' : 'Your draft is safely stored.'); await loadGallery();
      } catch (error) { toast(error.message, true); }
    });
    $('refreshAppointments').addEventListener('click', loadAppointments);
    document.querySelectorAll('[data-payment-tab]').forEach((button) => button.addEventListener('click', () => {
      showPaymentTab(button.dataset.paymentTab);
      loadPayments();
    }));
    $('refreshUnpaidBookings').addEventListener('click', loadUnpaidBookings);
    $('refreshPayments').addEventListener('click', loadPaymentsWithProof);
    showPaymentTab('unpaid');
    $('availabilityMonth').addEventListener('change', loadAvailabilitySchedule);
    $('availabilityForm').addEventListener('submit', submitAvailability);
    $('addScheduleException').addEventListener('click', () => addScheduleException());
  }
  $('availabilityMonth').value = shiftMonth(monthInTimeZone(), 1);
  bind();
  initializeAdmin();
})();
