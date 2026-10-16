import { GalleryEditor, emptyGallery, paragraphs } from './content-gallery.js';
import { normalizePageEdits, applyPageEditsToDocument, outsideLiveRegions, pageTarget, installDeletionControls, releaseDeletedGalleryTargets } from './page-edits.js';

// Deployed owner dashboard only: one Save page writes the existing site API.
// It never talks to a builder tab, downloads a ZIP, or reports an unsaved draft as saved.
export function mountOwnerPages({ host, api, getSite, setSite, fetchPage }) {
  const doc = host.ownerDocument, win = doc.defaultView;
  const choose = doc.createElement('select'); choose.setAttribute('aria-label', 'Page to edit');
  const open = doc.createElement('button'); open.type = 'button'; open.textContent = 'Open page';
  const save = doc.createElement('button'); save.type = 'button'; save.textContent = 'Save page'; save.disabled = true;
  const message = doc.createElement('p'); message.setAttribute('role', 'status');
  const frame = doc.createElement('iframe'); frame.title = 'Edit deployed homepage'; frame.setAttribute('sandbox', 'allow-same-origin'); frame.style.cssText = 'width:100%;height:65vh;border:1px solid #ccc'; frame.hidden = true;
  const fields = doc.createElement('div'); fields.hidden = true;
  const title = doc.createElement('input'); title.setAttribute('aria-label', 'Page title'); title.maxLength = 120;
  const body = doc.createElement('textarea'); body.setAttribute('aria-label', 'Page content'); body.maxLength = 6000; body.rows = 10; body.style.width = '100%';
  const titleLabel = doc.createElement('label'); titleLabel.textContent = 'Page title'; titleLabel.appendChild(title);
  const bodyLabel = doc.createElement('label'); bodyLabel.textContent = 'Page content'; bodyLabel.appendChild(body);
  const galleryHost = doc.createElement('div'); fields.append(titleLabel, bodyLabel, galleryHost);
  host.append(choose, open, save, message, frame, fields);
  let config, selected = null, galleryEditor = null, gallery = emptyGallery(), changes = new Map(), dirty = false, busy = false, generation = 0, revision = 0;
  const note = (text, error = false) => { message.textContent = text; message.classList.toggle('is-error', error); };
  const changed = () => { revision++; dirty = true; note('Unsaved changes — click Save page.'); };
  const key = (target) => `${target.selector}::${target.index}`;
  function options() {
    choose.replaceChildren();
    for (const [value, label] of [['/', 'Homepage'], ...(getSite().customPages || []).map((page) => [page.url, page.menuName])]) {
      const option = doc.createElement('option'); option.value = value; option.textContent = label; choose.appendChild(option);
    }
  }
  function normalizedChanges() {
    const list = [...changes.values()].map(({ pageGallery: _old, ...edit }) => edit);
    const targets = Object.fromEntries(list.filter((edit) => !edit.remove).map((edit) => [key(edit), edit.text]));
    for (const image of gallery.images) if (image.paragraph !== null && image.paragraph >= paragraphs(targets[image.target]).length) image.paragraph = null;
    if (gallery.setPlacement && gallery.setPlacement.paragraph >= paragraphs(targets[gallery.setPlacement.target]).length) delete gallery.setPlacement;
    if (list.length && gallery.images.length) list[0].pageGallery = gallery;
    return normalizePageEdits(list);
  }
  function bindHomepage(child) {
    applyPageEditsToDocument(child, config.pageEdits || []);
    for (const element of child.querySelectorAll('[data-page-edit-key]')) {
      const edit = changes.get(element.dataset.pageEditKey); if (edit && !edit.remove) element.textContent = edit.text;
    }
    for (const element of child.querySelectorAll('h1,h2,h3,h4,h5,h6,h7,h8,p,span,li,strong,em,small,blockquote,figcaption,label,div,section')) {
      if (!outsideLiveRegions(element) || element.closest('[data-page-deleted]')) continue;
      const target = pageTarget(element, child); element.dataset.pageEditKey = key(target);
      if (element.tagName !== 'SECTION' && [...element.children].every((node) => node.tagName === 'BR')) element.dataset.peEditable = '';
    }
    const capture = (element) => {
      if (!element || element.closest('[data-page-deleted]')) return;
      changes.set(element.dataset.pageEditKey, { ...pageTarget(element, child), text: element.innerText ?? element.textContent }); changed();
    };
    child.addEventListener('submit', (event) => event.preventDefault());
    child.addEventListener('click', (event) => {
      if (event.target.closest?.('a')) event.preventDefault();
      const element = event.target.closest?.('[data-pe-editable]');
      if (!element || element.closest('[data-page-deleted]')) return;
      element.contentEditable = 'true'; element.focus();
    });
    child.addEventListener('input', (event) => capture(event.target.closest?.('[data-pe-editable]')));
    child.addEventListener('focusout', (event) => { const element = event.target.closest?.('[data-pe-editable]'); if (element && element.contentEditable === 'true') { capture(element); element.contentEditable = 'false'; } });
    installDeletionControls(child, (element) => {
      const affected = new Set([element, ...element.querySelectorAll('[data-page-edit-key]')].map((node) => node.dataset.pageEditKey).filter(Boolean));
      for (const target of affected) changes.delete(target);
      releaseDeletedGalleryTargets(gallery, affected);
      const target = pageTarget(element, child); changes.set(key(target), { ...target, remove: true });
      element.contentEditable = 'false'; element.replaceChildren(); element.hidden = true; element.dataset.pageDeleted = ''; element.style.setProperty('display', 'none', 'important'); changed();
    });
    const style = child.createElement('style'); style.textContent = '[data-pe-editable]:hover,[contenteditable=true]{outline:2px dashed #376f62;outline-offset:2px}[data-page-deleted]{display:none!important}'; child.head.appendChild(style);
  }
  async function load() {
    if (busy || (dirty && !win.confirm('Discard unsaved page changes?'))) return;
    busy = true; open.disabled = save.disabled = true; note('Loading page…');
    const current = ++generation;
    try {
      const data = await api('/api/site'); config = { ...getSite(), ...data.config }; setSite(config);
      selected = choose.value || '/'; galleryEditor?.destroy(); fields.hidden = frame.hidden = true;
      if (selected === '/') {
        changes = new Map((config.pageEdits || []).map((edit) => [key(edit), structuredClone(edit)]));
        gallery = structuredClone((config.pageEdits || []).find((edit) => edit.pageGallery)?.pageGallery || emptyGallery());
        const html = await fetchPage('/');
        if (current !== generation) return;
        const parsed = new win.DOMParser().parseFromString(html, 'text/html');
        parsed.querySelectorAll('script').forEach((node) => node.remove());
        parsed.querySelectorAll('*').forEach((node) => { for (const attribute of [...node.attributes]) if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name); });
        const base = parsed.createElement('base'); base.href = win.location.origin + '/'; parsed.head.prepend(base);
        frame.onload = () => { if (current === generation) bindHomepage(frame.contentDocument); };
        frame.srcdoc = '<!doctype html>' + parsed.documentElement.outerHTML; frame.hidden = false;
      } else {
        const page = config.customPages.find((page) => page.url === selected); if (!page) throw new Error('Page no longer exists. Reload the dashboard.');
        title.value = page.pageTitle; body.value = page.pageContent; gallery = structuredClone(page.contentGallery || emptyGallery());
        fields.hidden = false;
        galleryEditor = new GalleryEditor({ host: galleryHost, input: body, getGallery: () => gallery, onChange: (next) => { gallery = next; changed(); } });
      }
      dirty = false; save.disabled = false; note('Edit text or delete a paragraph/section, then click Save page.');
    } catch (error) { selected = null; note(error.message, true); }
    finally { busy = false; open.disabled = false; }
  }
  title.addEventListener('input', changed); body.addEventListener('input', changed);
  open.addEventListener('click', load);
  save.addEventListener('click', async () => {
    if (busy || !selected) return;
    busy = true; save.disabled = open.disabled = choose.disabled = true; note('Saving page…');
    const savingRevision = revision;
    try {
      const latest = await api('/api/site');
      const update = { ...getSite(), ...latest.config };
      if (selected === '/') update.pageEdits = normalizedChanges();
      else {
        if (!title.value.trim()) throw new Error('Page title is required.');
        if (!update.customPages.some((page) => page.url === selected)) throw new Error('Page no longer exists. Reload the dashboard.');
        update.customPages = update.customPages.map((page) => page.url === selected ? { ...page, pageTitle: title.value.trim(), pageContent: body.value, contentGallery: gallery } : page);
      }
      const data = await api('/api/site', { method: 'PUT', body: update }); config = data.config; setSite(config); dirty = revision !== savingRevision;
      note(dirty ? 'Earlier changes saved. Newer changes are unsaved — click Save page.' : 'Page saved. Visitors will see these changes when they reload the page.');
    } catch (error) { note(`Not saved — ${error.message}`, true); }
    finally { busy = false; save.disabled = open.disabled = choose.disabled = false; }
  });
  options(); return { refresh: options, load };
}
