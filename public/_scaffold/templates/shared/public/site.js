(() => {
  const fallback = window.SITE_CONFIG || {};
  let site = { ...fallback, features: { ...(fallback.features || {}) } };
  let articleRequestId = 0;
  const $ = (id) => document.getElementById(id);
  const text = (id, value) => { const node = $(id); if (node && value != null) node.textContent = value; };
  const setLink = (id, href, label) => { const node = $(id); if (node) { node.href = href; if (label) node.textContent = label; } };
  const verticalDefaults = {
    veterinary: { icon: '✳', subline: 'CARE THAT FEELS PERSONAL', context: 'Pet name (optional)', book: 'Request a visit', journal: 'Notes from our care team' },
    dental: { icon: '✦', subline: 'A BRIGHTER KIND OF CARE', context: 'Reason for your visit (optional)', book: 'Request an appointment', journal: 'Notes for a healthier smile' }
  };
  const isVet = site.specialty !== 'dental';
  const vertical = verticalDefaults[site.specialty] || verticalDefaults.veterinary;
  const isEnabled = (feature) => site.features?.[feature] !== false;
  const defaultMenuLinks = [
    { id: 'home', label: 'Welcome', href: '/#home' },
    { id: 'care', label: 'Our care', href: '/#care' },
    { id: 'about', label: 'Our approach', href: '/#about' },
    { id: 'gallery', label: 'Gallery', href: '/#gallery', feature: 'gallery' },
    { id: 'journal', label: 'Journal', href: '/#journal', feature: 'blog' },
    { id: 'appointments', label: 'Appointments', href: '/appointments.html', feature: 'scheduling' },
    { id: 'contact', label: 'Contact', href: '/#contact' }
  ];

  function setTheme() {
    const root = document.documentElement;
    if (site.primaryColor) root.style.setProperty('--primary', site.primaryColor);
    if (site.accentColor) root.style.setProperty('--accent', site.accentColor);
    if (site.paperColor) root.style.setProperty('--paper', site.paperColor);
    document.body.classList.toggle('font-sans', site.fontStyle === 'sans');
    document.body.classList.toggle('dental-site', site.specialty === 'dental');
    document.body.classList.remove('theme-canopy','theme-clay','theme-coastal','theme-editorial','theme-neat','theme-launcher','theme-air','theme-brivon-dark','theme-brivon-light');
    if (['canopy','clay','coastal','editorial','neat','launcher','air','brivon-dark','brivon-light'].includes(site.theme)) document.body.classList.add(`theme-${site.theme}`);
  }
  function safeMenuNavigationHref(value) {
    const raw = String(value ?? '').trim();
    if (!raw || raw.length > 2048 || /[\u0000-\u001f\u007f]/.test(raw)) return '';
    if (raw.startsWith('/')) {
      if (raw.startsWith('//') || raw.startsWith('/\\')) return '';
      try {
        const url = new URL(raw, window.location.origin);
        if (url.origin !== window.location.origin) return '';
        return `${url.pathname}${url.search}${url.hash}`;
      } catch (_) { return ''; }
    }
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return '';
      return url.href;
    } catch (_) { return ''; }
  }
  function renderMenuNavigation() {
    const customPages = Array.isArray(site.customPages) ? site.customPages : [];
    const fallbackLinks = [
      ...defaultMenuLinks,
      ...customPages.map((page) => ({ id: `custom-${page?.slug || page?.url || page?.id || ''}`, label: page?.menuName, href: page?.url }))
    ];
    const source = Array.isArray(site.menuLinks) ? site.menuLinks : fallbackLinks;
    const links = source.slice(0, 16).filter((item) => item && item.label && isEnabled(item.feature));
    ['siteNav', 'editorialSiteNav'].forEach((id) => {
      const nav = $(id);
      if (!nav) return;
      nav.replaceChildren();
      links.forEach((item) => {
        const href = safeMenuNavigationHref(item.href);
        if (!href) return;
        const link = document.createElement('a');
        link.href = href;
        link.textContent = String(item.label).trim().slice(0, 60);
        link.dataset.menuLinkId = String(item.id || '').slice(0, 48);
        if (item.feature) link.dataset.menuFeature = String(item.feature);
        const destination = new URL(href, window.location.origin);
        if (destination.origin === window.location.origin && destination.pathname === window.location.pathname) link.setAttribute('aria-current', 'page');
        nav.appendChild(link);
      });
    });
  }
  function renderPaymentDetails() {
    const section = $('footerPayments');
    const list = $('paymentDetails');
    if (!section || !list) return;
    const details = site.payments || {};
    const methods = [
      { name: 'GCash', account: details.gcashName, number: details.gcashNumber },
      { name: 'Maya', account: details.mayaName, number: details.mayaNumber }
    ].filter((item) => String(item.account || '').trim() || String(item.number || '').trim());
    list.replaceChildren();
    methods.forEach((item) => {
      const method = document.createElement('div'); method.className = 'footer-payment-method';
      const name = document.createElement('strong'); name.textContent = item.name;
      method.appendChild(name);
      if (String(item.account || '').trim()) {
        const account = document.createElement('span'); account.textContent = String(item.account).trim();
        method.appendChild(account);
      }
      if (String(item.number || '').trim()) {
        const number = document.createElement('span'); number.textContent = String(item.number).trim();
        method.appendChild(number);
      }
      list.appendChild(method);
    });
    section.classList.toggle('hidden', !methods.length);
  }
  function applyContent() {
    const title = site.businessName || 'Practice';
    const brand = site.brandName || title;
    const place = site.location || '';
    document.title = title;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = `Thoughtful care from ${title}.`;
    text('brandName', brand); text('footerBrandName', brand); text('footerLegalName', title);
    text('brandSubline', vertical.subline); text('footerBrandSubline', vertical.subline);
    text('footerLocation', place); text('footerEmail', site.email); text('footerPhone', site.phone);
    text('yearNow', new Date().getFullYear());
    setLink('footerEmail', `mailto:${site.email}`);
    setLink('footerPhone', `tel:${String(site.phone || '').replace(/[^+\d]/g, '')}`);
    setLink('phoneLink', `tel:${String(site.phone || '').replace(/[^+\d]/g, '')}`, site.phone);
    renderMenuNavigation();
    renderPaymentDetails();
    text('brandSymbol', vertical.icon); text('footerSymbol', vertical.icon); text('labelIcon', vertical.icon);
    text('editorialBrandSymbol', vertical.icon); text('editorialBrandName', brand); text('editorialBrandLocation', place);
    text('editorialSidebarCta', vertical.book);
    text('heroEyebrow', site.heroEyebrow || (isVet ? 'A LITTLE MORE CARE, EVERY DAY' : 'A BRIGHTER KIND OF DENTAL CARE'));
    const headline = String(site.heroHeadline || (isVet ? 'Good care for\ngood companions.' : 'A reason to\nsmile easier.')).split('\n');
    const headlineNode = $('heroHeadline');
    if (headlineNode) {
      headlineNode.replaceChildren(document.createTextNode(headline[0] || title));
      headlineNode.appendChild(document.createElement('br'));
      const em = document.createElement('em'); em.textContent = headline.slice(1).join(' ') || 'good care.';
      headlineNode.appendChild(em);
    }
    text('heroText', site.heroText || 'Thoughtful care, built around the lives you share.');
    const services = Array.isArray(site.services) ? site.services : [];
    document.querySelectorAll('.service-title').forEach((node, index) => { if (services[index]) node.textContent = services[index]; });
    text('contextLabel', vertical.context);
    text('headerCta', vertical.book); text('heroBook', vertical.book); text('bookingSubmit', isVet ? 'Send visit request ↗' : 'Send appointment request ↗');
    if (site.specialty === 'dental') { const formHeading = document.querySelector('.form-heading strong'); if (formHeading) formHeading.textContent = 'Request an appointment'; }
    $('journal')?.classList.toggle('hidden', !isEnabled('blog'));
    $('gallery')?.classList.toggle('hidden', !isEnabled('gallery'));
    $('book')?.classList.toggle('hidden', !isEnabled('scheduling'));
    if (!isEnabled('scheduling')) {
      setLink('headerCta', '#contact', 'Get in touch');
      setLink('heroBook', '#contact', 'Contact our team');
      setLink('articleBook', '#contact', 'Contact our team');
      setLink('editorialSidebarCta', '#contact', 'Contact our team ↗');
    } else {
      setLink('headerCta', '/appointments.html', vertical.book);
      setLink('heroBook', '/appointments.html', vertical.book);
      setLink('articleBook', '/appointments.html', vertical.book);
      setLink('editorialSidebarCta', '/appointments.html', `${vertical.book} ↗`);
    }
  }
  function toast(message, error = false) {
    const node = $('siteToast'); if (!node) return;
    node.textContent = message; node.classList.toggle('error', error); node.classList.add('visible');
    window.clearTimeout(toast.timer); toast.timer = window.setTimeout(() => node.classList.remove('visible'), 4400);
  }
  function renderArticleGallery(images) {
    const section = $('articleGallery'); const grid = $('articleGalleryGrid');
    if (!section || !grid) return;
    grid.replaceChildren();
    const safeItems = Array.isArray(images) ? images.filter((item) => item && item.imageUrl).slice(0, 24) : [];
    section.classList.toggle('hidden', !safeItems.length);
    safeItems.forEach((item) => {
      const url = safeImageUrl(item.imageUrl);
      if (!url) return;
      const figure = document.createElement('figure'); figure.className = 'article-gallery-item';
      const image = document.createElement('img'); image.src = url; image.alt = String(item.altText || ''); image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
      figure.appendChild(image);
      if (item.caption) { const caption = document.createElement('figcaption'); caption.textContent = item.caption; figure.appendChild(caption); }
      grid.appendChild(figure);
    });
    if (!grid.children.length) section.classList.add('hidden');
  }
  function updateArticle(post) {
    text('articleCategory', post.category || 'From our team');
    text('articleTitle', post.title || 'A note from our team');
    text('articleExcerpt', post.excerpt || '');
    const date = post.publishedAt || post.createdAt;
    text('articleMeta', date ? new Date(date).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : 'A note from our team');
    text('articleBody', post.body || post.excerpt || '');
    const image = $('articleFeatureImage');
    if (image) {
      image.src = safeImageUrl(post.featureImageUrl) || '/images/blog-welcome.svg';
      image.alt = String(post.featureImageAlt || post.title || 'Article feature image');
    }
    renderArticleGallery(post.gallery || []);
  }
  async function openArticle(post) {
    const requestId = ++articleRequestId;
    updateArticle(post);
    const modal = $('articleModal'); modal?.classList.add('open'); modal?.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden'; $('articleClose')?.focus();
    if (!post.slug) return;
    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(post.slug)}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const result = await response.json();
      if (requestId === articleRequestId && result.post) updateArticle(result.post);
    } catch (_) { /* Keep the public-list fallback content in view. */ }
  }
  function closeArticle() {
    articleRequestId += 1;
    const modal = $('articleModal'); modal?.classList.remove('open'); modal?.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  function renderPosts(posts) {
    const grid = $('postGrid'); if (!grid) return;
    grid.replaceChildren();
    const safePosts = Array.isArray(posts) ? posts.filter((post) => post && post.title).slice(0, 12) : [];
    if (!safePosts.length) {
      const note = document.createElement('p'); note.className = 'loading-copy'; note.textContent = 'New notes from our care team are coming soon.'; grid.appendChild(note); return;
    }
    safePosts.forEach((post, index) => {
      const card = document.createElement('article'); card.className = 'post-card'; card.setAttribute('role', 'button'); card.setAttribute('tabindex', '0'); card.setAttribute('aria-label', `Read ${post.title}`);
      card.addEventListener('click', () => openArticle(post));
      card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openArticle(post); } });
      const image = document.createElement('div'); image.className = 'post-image';
      const featureUrl = safeImageUrl(post.featureImageUrl);
      if (featureUrl) {
        const feature = document.createElement('img'); feature.src = featureUrl; feature.alt = String(post.featureImageAlt || post.title); feature.loading = 'lazy'; feature.decoding = 'async'; feature.referrerPolicy = 'no-referrer'; image.appendChild(feature);
      } else {
        const symbol = document.createElement('span'); symbol.className = 'image-symbol'; symbol.textContent = ['✳','♡','⌁'][index % 3]; image.appendChild(symbol);
      }
      const content = document.createElement('div'); content.className = 'post-card-content';
      const category = document.createElement('span'); category.className = 'post-category'; category.textContent = post.category || 'From our team';
      const title = document.createElement('h3'); title.textContent = post.title;
      const excerpt = document.createElement('p'); excerpt.textContent = post.excerpt || '';
      const date = document.createElement('div'); date.className = 'post-meta';
      const created = post.publishedAt || post.createdAt;
      date.textContent = created ? new Date(created).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'A note from our team';
      content.append(category, title, excerpt, date); card.append(image, content); grid.appendChild(card);
    });
  }
  async function loadPosts() {
    if (!isEnabled('blog')) return;
    const localPosts = site.demoPosts || [];
    try {
      const response = await fetch('/api/posts', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('posts unavailable');
      const result = await response.json(); renderPosts(result.posts || []);
    } catch (_) { renderPosts(localPosts); }
  }
  function safeImageUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw, window.location.origin);
      if (parsed.protocol === 'https:' || (parsed.origin === window.location.origin && raw.startsWith('/') && !raw.startsWith('//'))) return parsed.href;
    } catch (_) {}
    return '';
  }
  function renderGallery(items) {
    const grid = $('galleryGrid'); if (!grid) return;
    grid.replaceChildren();
    const safeItems = Array.isArray(items) ? items.filter((item) => item && item.title).slice(0, 24) : [];
    if (!safeItems.length) {
      const note = document.createElement('p'); note.className = 'loading-copy'; note.textContent = 'A few scenes from practice life are on their way.'; grid.appendChild(note); return;
    }
    safeItems.forEach((item, index) => {
      const card = document.createElement('figure'); card.className = `gallery-card gallery-card-${index % 4}`;
      const media = document.createElement('div'); media.className = 'gallery-image';
      const url = safeImageUrl(item.imageUrl);
      if (url) {
        const image = document.createElement('img'); image.src = url; image.alt = String(item.altText || item.title); image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer'; media.appendChild(image);
      } else {
        media.classList.add('gallery-placeholder'); media.setAttribute('role', 'img'); media.setAttribute('aria-label', String(item.altText || item.title));
        const ornament = document.createElement('span'); ornament.className = 'gallery-ornament'; ornament.setAttribute('aria-hidden', 'true'); ornament.textContent = ['✳','⌂','♡','✦'][index % 4]; media.appendChild(ornament);
      }
      const caption = document.createElement('figcaption');
      const category = document.createElement('span'); category.className = 'gallery-category'; category.textContent = item.category || 'Practice life';
      const title = document.createElement('strong'); title.textContent = item.title;
      const description = document.createElement('p'); description.textContent = item.caption || '';
      caption.append(category, title, description); card.append(media, caption); grid.appendChild(card);
    });
  }
  async function loadGallery() {
    if (!isEnabled('gallery')) return;
    try {
      const response = await fetch('/api/gallery', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('gallery unavailable');
      const result = await response.json(); renderGallery(result.items || []);
    } catch (_) { renderGallery(site.demoGallery || []); }
  }
  async function refreshSiteConfig() {
    try {
      const response = await fetch('/api/site', { headers: { Accept: 'application/json' } });
      if (response.ok) {
        const data = await response.json();
        if (data.config && typeof data.config === 'object') { site = { ...site, ...data.config, features: { ...site.features, ...(data.config.features || {}) } }; }
      }
    } catch (_) { /* use the generated config fallback */ }
    setTheme(); applyContent(); loadPosts(); loadGallery();
  }
  $('articleClose')?.addEventListener('click', closeArticle);
  $('articleModal')?.addEventListener('click', (event) => { if (event.target === $('articleModal')) closeArticle(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && $('articleModal')?.classList.contains('open')) closeArticle(); });
  $('navMenu')?.addEventListener('click', () => $('siteNav')?.classList.toggle('open'));
  $('siteNav')?.addEventListener('click', (event) => { if (event.target.closest('a')) $('siteNav')?.classList.remove('open'); });
  setTheme(); applyContent();
  refreshSiteConfig();
})();
