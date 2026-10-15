// Brivon continuity on functional pages (appointments, owner dashboard, custom
// pages) reuses the same Boldonse / Inter Tight / Geist Mono stack the
// homepage loads, but the functional pages cannot statically know whether
// the site is on a Brivon theme. The `body.theme-brivon-*` class is set by
// site.js, so the simplest way to load the matching fonts is to inspect
// `window.SITE_CONFIG.theme` after `site-config.js` has run and inject the
// preconnect + stylesheet `<link>` elements once. Without this, every
// Brivon-themed appointments page, owner dashboard, and custom page would
// silently fall through `Boldonse` → `Archivo Black` → generic sans-serif
// (see audit F9). The preconnect hints mirror the homepage so the browser
// can warm the TLS session before the first stylesheet fetch.
(function loadBrivonFonts() {
  if (typeof window === 'undefined' || !window.SITE_CONFIG) return;
  const theme = String(window.SITE_CONFIG.theme || '');
  if (theme !== 'brivon-dark' && theme !== 'brivon-light') return;
  const head = document.head || document.getElementsByTagName('head')[0];
  if (!head || head.querySelector('link[data-brivon-fonts]')) return;
  const preconnect = (href, crossorigin) => {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = href;
    if (crossorigin) link.crossOrigin = 'anonymous';
    link.setAttribute('data-brivon-fonts', 'preconnect');
    head.appendChild(link);
  };
  preconnect('https://fonts.googleapis.com');
  preconnect('https://fonts.gstatic.com', true);
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = 'https://fonts.googleapis.com/css2?family=Boldonse&family=Inter+Tight:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap';
  stylesheet.setAttribute('data-brivon-fonts', 'stylesheet');
  head.appendChild(stylesheet);
})();
