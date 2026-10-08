/* Brivon homepage behavior — the Brivon template's site.js (mobile drawer,
   scroll reveal, sticky-header shadow), extended to mirror the generated
   menu navigation into the mobile drawer. Runs only on the Brivon shell. */
(() => {
  'use strict';
  if (!document.body.classList.contains('brivon-shell')) return;

  // Mobile drawer
  const toggle = document.querySelector('.nav-toggle');
  const drawer = document.getElementById('mobile-drawer');
  const closeBtn = drawer && drawer.querySelector('.drawer-close');

  function openDrawer() {
    if (!drawer) return;
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }
  if (toggle) toggle.addEventListener('click', openDrawer);
  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  if (drawer) {
    drawer.addEventListener('click', (event) => { if (event.target.closest('a')) closeDrawer(); });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drawer && drawer.classList.contains('open')) closeDrawer();
  });

  // Mirror the generated menu (#siteNav, populated by site.js) into the drawer.
  const nav = document.getElementById('siteNav');
  const drawerNav = document.getElementById('drawerNav');
  if (nav && drawerNav) {
    const syncDrawer = () => {
      drawerNav.replaceChildren(...[...nav.querySelectorAll('a')].map((link) => {
        const clone = link.cloneNode(true);
        clone.removeAttribute('aria-current');
        return clone;
      }));
    };
    syncDrawer();
    if ('MutationObserver' in window) new MutationObserver(syncDrawer).observe(nav, { childList: true, subtree: true });
  }

  // Reveal on intersect (respects prefers-reduced-motion)
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced && 'IntersectionObserver' in window) {
    const els = document.querySelectorAll('.reveal');
    if (els.length) {
      els.forEach((el) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(16px)';
        el.style.transition = 'opacity 600ms cubic-bezier(0.16, 1, 0.3, 1), transform 600ms cubic-bezier(0.16, 1, 0.3, 1)';
      });
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
            io.unobserve(entry.target);
          }
        });
      }, { threshold: 0.18, rootMargin: '0px 0px -10% 0px' });
      els.forEach((el) => io.observe(el));
    }
  }

  // Sticky header subtle shadow on scroll
  const header = document.querySelector('.site-header');
  if (header) {
    let last = 0;
    window.addEventListener('scroll', () => {
      const y = window.scrollY;
      if (y > 4 && last <= 4) header.style.boxShadow = '0 8px 24px -16px rgba(0,0,0,0.6)';
      if (y <= 4 && last > 4) header.style.boxShadow = 'none';
      last = y;
    }, { passive: true });
  }
})();
