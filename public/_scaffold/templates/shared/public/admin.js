(() => {
  const fallback = window.SITE_CONFIG || {};
  let site = { ...fallback, features: { ...(fallback.features || {}) } };
  let csrfToken = '';
  const $ = (id) => document.getElementById(id);
  const keyStore = 'practice-admin-key';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const key = () => sessionStorage.getItem(keyStore) || '';
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
    if (key()) headers.Authorization = `Bearer ${key()}`;
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
    themeForm.elements.theme.value = site.theme || 'canopy';
    themeForm.elements.editorialAccent.value = site.editorialAccent || 'black';
    $('editorialAccentField').hidden = themeForm.elements.theme.value !== 'editorial';
    $('adminBrandName').textContent = site.brandName || site.businessName || 'Practice studio';
    $('themePreviewName').textContent = site.businessName || 'Practice name';
    $('themePreviewLayout').textContent = `${themeForm.elements.theme.options[themeForm.elements.theme.selectedIndex]?.text.split(' · ')[0] || 'Canopy'} layout · fixed content system`;
    const isDental = site.specialty === 'dental';
    $('adminSymbol').textContent = isDental ? '✦' : '✳'; $('themeMiniMark').textContent = isDental ? '✦' : '✳';
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
    previewBox.classList.remove('theme-canopy','theme-clay','theme-coastal','theme-editorial','theme-neat','theme-launcher','theme-air');
    if (['canopy','clay','coastal','editorial','neat','launcher','air'].includes(form.elements.theme.value)) previewBox.classList.add(`theme-${form.elements.theme.value}`);
    $('editorialAccentField').hidden = form.elements.theme.value !== 'editorial';
    $('themeMiniMark').style.background = primary;
    $('colorReadout').textContent = primary.toUpperCase(); $('accentReadout').textContent = accent.toUpperCase(); $('paperReadout').textContent = paper.toUpperCase();
    $('themePreviewLayout').textContent = `${form.elements.theme.options[form.elements.theme.selectedIndex]?.text.split(' · ')[0] || 'Canopy'} layout · fixed content system`;
  }
  function applyThemePreset() {
    const form = $('themeForm');
    const presets = {
      canopy: ['#376f62','#e9b36e','#fbf8f1'], clay: ['#ac6550','#e8b897','#fbf6ef'], coastal: ['#397c87','#dfb75d','#f4f8f7'],
      editorial: ['#202522','#c9a45b','#f6f5f1'], neat: ['#2d8078','#f0b768','#f7faf9'], launcher: ['#c33e55','#f0c85c','#fff9f1'], air: ['#dd356e','#fee856','#ffffff']
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
    applyToForm(); previewTheme();
  }
  function setConnected(connected) {
    $('connectPanel').classList.toggle('connected', connected);
    $('keyMessage').textContent = connected ? 'Connected. Your key stays in this tab session.' : 'The key is never added to the website ZIP.';
    $('adminKey').value = '';
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
    if (!key()) { list.innerHTML = '<p class="empty-posts">Connect your owner key to manage blog posts.</p>'; return; }
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
    } catch (error) { list.innerHTML = `<p class="empty-posts">${esc(error.message)} — check your owner key.</p>`; }
  }
  async function loadGallery() {
    const list = $('galleryList');
    if (!key()) { list.innerHTML = '<p class="empty-posts">Connect your owner key to manage gallery items.</p>'; return; }
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
    } catch (error) { list.innerHTML = `<p class="empty-posts">${esc(error.message)} — check your owner key.</p>`; }
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
    const month = $('availabilityMonth')?.value; if (!month || !key()) return;
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
    if (!key()) { toast('Connect your owner key first', true); return; }
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
    if (!key()) { list.innerHTML = '<p class="empty-posts">Connect your owner key to review consultations.</p>'; return; }
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
    } catch (error) { list.innerHTML = `<p class="empty-posts">${esc(error.message)} — check your owner key.</p>`; }
  }
  async function updateAppointment(id, status) {
    const action = status === 'confirmed' ? 'Confirm this appointment?' : 'Cancel this reserved consultation? Owner cancellation requires at least 24 hours’ notice.';
    if (!window.confirm(action)) return;
    try { await api(`/api/admin/appointments/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } }); toast(status === 'confirmed' ? 'Consultation confirmed' : 'Consultation cancelled'); await loadAppointments(); }
    catch (error) { toast(error.message, true); }
  }
  function bind() {
    $('keyForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const candidate = $('adminKey').value.trim();
      if (!candidate) { $('keyMessage').textContent = 'Enter the owner key to continue.'; return; }
      sessionStorage.setItem(keyStore, candidate);
      try {
        await api('/api/admin/posts');
        setConnected(true); toast('Owner editor connected'); await loadSite(); await loadPosts(); await loadGallery(); await loadAppointments(); await loadAvailabilitySchedule();
      } catch (error) { sessionStorage.removeItem(keyStore); setConnected(false); $('keyMessage').textContent = error.message; toast('Could not connect', error.message, true); }
    });
    $('siteForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!key()) { toast('Connect your owner key first', 'Only a site owner can make changes.', true); return; }
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
      if (!key()) { toast('Connect your owner key first', 'Only a site owner can make changes.', true); return; }
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
      if (!key()) { toast('Connect your owner key first', 'Only a site owner can create posts.', true); return; }
      const formElement = event.currentTarget;
      const form = new FormData(formElement);
      const post = { title: String(form.get('title') || '').trim(), slug: String(form.get('slug') || '').trim(), excerpt: String(form.get('excerpt') || '').trim(), body: String(form.get('body') || '').trim(), featureImageUrl: String(form.get('featureImageUrl') || '').trim(), featureImageAlt: String(form.get('featureImageAlt') || '').trim(), gallery: readPostGallery(), category: String(form.get('category') || '').trim(), status: String(form.get('status') || 'draft') };
      const postId = String(form.get('id') || '');
      try { await api(postId ? `/api/admin/posts/${encodeURIComponent(postId)}` : '/api/admin/posts', { method: postId ? 'PUT' : 'POST', body: post }); formElement.reset(); $('postGalleryRows').replaceChildren(); formElement.elements.id.value = ''; formElement.elements.slug.dataset.edited = ''; formElement.querySelector('[type="submit"]').textContent = 'Save post'; status('Post saved'); toast(postId ? 'Post updated' : 'Post saved', post.status === 'published' ? 'Your published article is live on the journal.' : 'Your draft is safely stored.'); await loadPosts(); }
      catch (error) { toast(error.message, true); }
    });
    $('galleryForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!key()) { toast('Connect your owner key first', 'Only a site owner can manage gallery items.', true); return; }
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
    $('availabilityMonth').addEventListener('change', loadAvailabilitySchedule);
    $('availabilityForm').addEventListener('submit', submitAvailability);
    $('addScheduleException').addEventListener('click', () => addScheduleException());
  }
  $('availabilityMonth').value = shiftMonth(monthInTimeZone(), 1);
  bind();
  loadSite();
  setConnected(Boolean(key()));
  if (key()) { loadPosts(); loadGallery(); loadAppointments(); loadAvailabilitySchedule(); }
})();
