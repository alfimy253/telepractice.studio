const MAX_MENU_LINKS = 16;
const MENU_FEATURES = new Set(['gallery', 'blog', 'scheduling']);
const DEFAULT_MENU_LINKS = Object.freeze([
  Object.freeze({ id: 'home', label: 'Welcome', href: '/#home' }),
  Object.freeze({ id: 'care', label: 'Our care', href: '/#care' }),
  Object.freeze({ id: 'about', label: 'Our approach', href: '/#about' }),
  Object.freeze({ id: 'gallery', label: 'Gallery', href: '/#gallery', feature: 'gallery' }),
  Object.freeze({ id: 'journal', label: 'Journal', href: '/#journal', feature: 'blog' }),
  Object.freeze({ id: 'appointments', label: 'Appointments', href: '/appointments.html', feature: 'scheduling' }),
  Object.freeze({ id: 'contact', label: 'Contact', href: '/#contact' })
]);

function safeMenuHref(value) {
  const raw = String(value ?? '').trim().slice(0, 2048);
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return '';

  if (raw.startsWith('/')) {
    if (raw.startsWith('//') || raw.startsWith('/\\')) return '';
    try {
      const url = new URL(raw, 'https://menu.invalid');
      if (url.origin !== 'https://menu.invalid') return '';
      return `${url.pathname}${url.search}${url.hash}`;
    } catch (_) {
      return '';
    }
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return '';
    return url.href;
  } catch (_) {
    return '';
  }
}

function cleanMenuLinks(value, fallback = DEFAULT_MENU_LINKS) {
  const source = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : [];
  const seenIds = new Set();
  return source.slice(0, MAX_MENU_LINKS).flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const label = String(item.label ?? '').trim().slice(0, 60);
    const href = safeMenuHref(item.href);
    const id = String(item.id ?? '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || `menu-${index + 1}`;
    if (!label || !href || seenIds.has(id)) return [];
    seenIds.add(id);
    const feature = MENU_FEATURES.has(item.feature) ? item.feature : '';
    return [{ id, label, href, ...(feature ? { feature } : {}) }];
  });
}

function menuLinksForPages(customPages = []) {
  const pageLinks = Array.isArray(customPages) ? customPages.map((page) => ({
    id: `custom-${page.slug || page.id || page.url || ''}`,
    label: page.menuName,
    href: page.url
  })) : [];
  return cleanMenuLinks([...DEFAULT_MENU_LINKS, ...pageLinks], []);
}

export { DEFAULT_MENU_LINKS, MAX_MENU_LINKS, cleanMenuLinks, menuLinksForPages, safeMenuHref };
