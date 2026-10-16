// Session #219: one URL-backed gallery per document, with exclusive placement.
export const MAX_CONTENT_IMAGES = 24;
export const emptyGallery = () => ({ title: '', images: [] });
export function paragraphs(body) { const text = String(body || '').replace(/\r\n?/g, '\n'); return text.trim() ? text.split(/\n[\t ]*\n+/) : []; }
export function imageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2048 || /[\u0000-\u0020\u007f]/.test(raw)) return '';
  if (raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\')) return raw;
  try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch (_) { return ''; }
}
export function normalizeContentGallery(value, body, targets = null) {
  if (value == null) return emptyGallery();
  if (typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.images) || value.images.length > MAX_CONTENT_IMAGES) throw new Error('Use one gallery with at most 24 image URLs.');
  const title = String(value.title || '').trim().slice(0, 120);
  if (!title && !value.images.length && value.setPlacement == null) return emptyGallery();
  if (!title || !value.images.length) throw new Error('A gallery needs a title and at least one image URL.');
  const ids = new Set(), urls = new Set(), placed = new Map();
  const images = value.images.map((image, index) => {
    if (!image || typeof image !== 'object') throw new Error('Invalid gallery image.');
    const url = imageUrl(image.url);
    const id = String(image.id || `image-${index}`).slice(0, 80);
    if (!url || !/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id) || urls.has(url)) throw new Error('Each gallery image needs a unique ID and valid, unique HTTPS or same-site URL.');
    ids.add(id); urls.add(url);
    const target = targets ? String(image.target || '') : '';
    let paragraph = image.paragraph ?? null;
    if (paragraph !== null) {
      const text = targets ? targets[target] : body;
      if (typeof text !== 'string' || !Number.isInteger(paragraph) || paragraph < 0 || paragraph >= paragraphs(text).length) throw new Error('Choose an existing paragraph for each image.');
      const key = `${target}::${paragraph}`;
      placed.set(key, (placed.get(key) || 0) + 1);
      if (placed.get(key) > 2) throw new Error('Only two images may be individually placed after each paragraph. Use a whole gallery set for more.');
    }
    return { id, url, alt: String(image.alt || title).trim().slice(0, 180), paragraph, ...(targets ? { target } : {}) };
  });
  if (value.setPlacement != null) {
    const placement = value.setPlacement;
    if (typeof placement !== 'object' || Array.isArray(placement)) throw new Error('Choose a valid gallery set placement.');
    const style = placement.style ?? 'grid';
    if (!['grid', 'strip'].includes(style)) throw new Error('Choose a Grid or Horizontal strip gallery layout.');
    const target = targets ? String(placement.target || '') : '';
    const text = targets ? targets[target] : body;
    if (typeof text !== 'string' || !Number.isInteger(placement.paragraph) || placement.paragraph < 0 || placement.paragraph >= paragraphs(text).length) throw new Error('Choose an existing paragraph for the gallery set.');
    if (images.some((image) => image.paragraph !== null)) throw new Error('A gallery set is exclusive: remove individual image placements first.');
    return { title, images, setPlacement: { paragraph: placement.paragraph, style, ...(targets ? { target } : {}) } };
  }
  return { title, images };
}
export const escapeContent = (text) => String(text ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function galleryImageHtml(image, title) {
  return `<img src="${escapeContent(imageUrl(image.url))}" alt="${escapeContent(image.alt || title)}" loading="lazy" referrerpolicy="no-referrer" data-gallery-image tabindex="0" role="button" aria-label="${escapeContent(`Open ${image.alt || title || 'image'} fullscreen`)}">`;
}
export function gallerySetHtml(gallery) {
  const style = gallery.setPlacement?.style === 'strip' ? 'strip' : 'grid';
  return `<span class="gallery-set gallery-set-${style}" data-gallery-group><span class="gallery-set-title">${escapeContent(gallery.title)}</span><span class="gallery-set-images">${gallery.images.map((image) => galleryImageHtml(image, gallery.title)).join('')}</span></span>`;
}
export function contentHtml(body, gallery = emptyGallery(), target = '') {
  return paragraphs(body).map((text, index) => {
    const set = gallery?.setPlacement;
    const images = set ? [] : (gallery?.images || []).filter((image) => image.paragraph === index && (image.target || '') === target).slice(0, 2);
    const group = set && set.paragraph === index && (set.target || '') === target ? gallerySetHtml(gallery) : images.length ? `<span class="paragraph-images" data-gallery-group>${images.map((image) => galleryImageHtml(image, gallery.title)).join('')}</span>` : '';
    return `<span class="content-paragraph">${escapeContent(text).replace(/\n/g, '<br>')}</span>${group}`;
  }).join('');
}
export const galleryCss = `
[data-page-deleted]{display:none!important}
.content-paragraph{display:block;white-space:pre-line;margin:0 0 1em}
.paragraph-images{display:flex;width:100%;gap:0;margin:0 0 1em}
.paragraph-images>img{display:block;flex:0 0 50%;width:50%;max-width:50%;object-fit:contain;align-self:flex-start}
.paragraph-images>img:only-child{flex:0 0 100%;width:100%;max-width:100%}
img[data-gallery-image]{cursor:zoom-in}img[data-gallery-image]:focus-visible{outline:3px solid #24644e;outline-offset:2px}
.gallery-set{display:block;width:100%;margin:0 0 1em}.gallery-set-title{display:block;font-weight:700;margin:0 0 .5em}
.gallery-set-grid .gallery-set-images{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0}
.gallery-set-grid img{display:block;width:100%;max-width:100%;object-fit:contain;align-self:start}
.gallery-set-grid img:only-child{grid-column:1/-1}
.gallery-set-strip .gallery-set-images{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:10px}
.gallery-set-strip img{display:block;flex:0 0 75%;width:75%;max-width:75%;object-fit:contain;scroll-snap-align:start;align-self:flex-start}
.gallery-set-strip img:only-child{flex:0 0 100%;width:100%;max-width:100%}
.content-gallery-editor{margin:12px 0;padding:12px;border:1px solid #cbd5cb;border-radius:8px}
.content-gallery-editor button,.content-gallery-modal button{cursor:pointer}.content-gallery-editor p{white-space:pre-line}
.gallery-add-link{display:block;background:none;border:0;text-decoration:underline;color:#24644e;padding:8px 0}
.content-gallery-overlay{position:fixed;inset:0;z-index:10000;background:#0008;display:grid;place-items:center;padding:20px}
.content-gallery-modal{background:#fff;color:#20372c;border-radius:12px;padding:24px;width:min(700px,100%);max-height:90vh;overflow:auto}
.content-gallery-modal label{display:block;margin:10px 0}.content-gallery-modal input,.content-gallery-modal select{display:block;width:100%;box-sizing:border-box;padding:10px}
.content-gallery-modal img{display:block;max-width:100%;max-height:180px;margin:10px auto}.gallery-image-row{border-top:1px solid #ddd;padding:12px 0}
.gallery-modal-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:16px}.gallery-status{display:block;color:#8c3425;white-space:normal}
.content-gallery-lightbox{position:fixed;inset:0;z-index:20000;display:flex;flex-direction:column;justify-content:center;align-items:center;background:rgba(0,0,0,.96);color:#fff;padding:20px;box-sizing:border-box}
.content-gallery-lightbox>img{display:block;width:100%;height:calc(100vh - 150px);height:calc(100dvh - 150px);object-fit:contain;min-height:0}
.content-gallery-lightbox button{background:#fff;color:#15261e;border:0;border-radius:6px;padding:12px;cursor:pointer}.content-gallery-lightbox button:focus-visible{outline:3px solid #92d4b3;outline-offset:3px}
.gallery-lightbox-controls{display:flex;gap:16px;align-items:center;justify-content:center;flex-wrap:wrap;margin-top:12px}.gallery-lightbox-counter{margin:8px 0;min-height:1.5em}
`;

const lightboxBindings = new WeakMap();
export function bindGalleryLightbox(doc) {
  if (lightboxBindings.has(doc)) return lightboxBindings.get(doc);
  let closeActive = null;
  const activate = (event) => {
    const trigger = event.target?.closest?.('img[data-gallery-image]');
    if (!trigger || !doc.contains(trigger)) return;
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    const group = trigger.closest('[data-gallery-group]');
    const images = [...(group?.querySelectorAll('img[data-gallery-image]') || [trigger])].filter((image) => !image.hidden && imageUrl(image.getAttribute('src')));
    if (!images.length) return;
    event.preventDefault(); closeActive?.();
    let index = Math.max(0, images.indexOf(trigger));
    const overflow = doc.body.style.overflow;
    const overlay = doc.createElement('div'); overlay.className = 'content-gallery-lightbox'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', 'Fullscreen gallery image viewer');
    const image = doc.createElement('img'); image.referrerPolicy = 'no-referrer';
    const counter = doc.createElement('p'); counter.className = 'gallery-lightbox-counter'; counter.setAttribute('aria-live', 'polite');
    const controls = doc.createElement('div'); controls.className = 'gallery-lightbox-controls';
    const close = doc.createElement('button'); close.type = 'button'; close.textContent = 'Close image viewer';
    const previous = doc.createElement('button'); previous.type = 'button'; previous.textContent = 'Previous image'; previous.disabled = images.length < 2;
    const next = doc.createElement('button'); next.type = 'button'; next.textContent = 'Next image'; next.disabled = images.length < 2;
    const show = (offset = 0) => { index = (index + offset + images.length) % images.length; image.src = imageUrl(images[index].getAttribute('src')); image.alt = images[index].alt; counter.textContent = `Image ${index + 1} of ${images.length}`; };
    const dismiss = () => { overlay.remove(); doc.body.style.overflow = overflow; closeActive = null; if (trigger.isConnected) trigger.focus(); };
    closeActive = dismiss;
    close.addEventListener('click', dismiss); previous.addEventListener('click', () => show(-1)); next.addEventListener('click', () => show(1));
    image.addEventListener('error', () => { counter.textContent = 'Image unavailable. Try another image or close the viewer.'; });
    overlay.addEventListener('click', (event) => { if (event.target === overlay) dismiss(); });
    overlay.addEventListener('keydown', (event) => {
      if (['Escape', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(event.key)) event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); show(event.key === 'ArrowLeft' ? -1 : 1); }
      if (event.key === 'Tab') { const buttons = [...controls.querySelectorAll('button:not(:disabled)')]; const first = buttons[0], last = buttons.at(-1); if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); } }
    });
    controls.append(close, previous, next); overlay.append(image, counter, controls); doc.body.appendChild(overlay); doc.body.style.overflow = 'hidden'; show(); close.focus();
  };
  const dispose = () => { closeActive?.(); doc.removeEventListener('click', activate); doc.removeEventListener('keydown', activate); lightboxBindings.delete(doc); };
  doc.addEventListener('click', activate); doc.addEventListener('keydown', activate); lightboxBindings.set(doc, dispose); return dispose;
}

// Shared component used by CMS posts, custom pages, and the iframe text editor.
// Saving this modal updates the surrounding editor; its normal Save/Export
// persists the document. No local uploads, hidden global gallery or second gallery bank.
export class GalleryEditor {
  constructor({ host, input, getGallery = emptyGallery, onChange, target = '', getTargets = null }) {
    this.host = host; this.input = input; this.getGallery = getGallery; this.onChange = onChange; this.target = target; this.getTargets = getTargets;
    const doc = host.ownerDocument;
    bindGalleryLightbox(doc);
    if (!doc.querySelector('[data-content-gallery-style]')) { const style = doc.createElement('style'); style.dataset.contentGalleryStyle = ''; style.textContent = galleryCss; doc.head.appendChild(style); }
    this.inputHandler = () => this.reconcile();
    input.addEventListener('input', this.inputHandler);
    this.render();
  }
  destroy() { this.input.removeEventListener('input', this.inputHandler); this.overlay?.remove(); this.host.replaceChildren(); }
  reconcile() {
    const gallery = structuredClone(this.getGallery() || emptyGallery());
    let changed = false;
    for (const image of gallery.images) if ((image.target || '') === this.target && image.paragraph !== null && image.paragraph >= paragraphs(this.input.value).length) { image.paragraph = null; changed = true; }
    if (gallery.setPlacement && (gallery.setPlacement.target || '') === this.target && gallery.setPlacement.paragraph >= paragraphs(this.input.value).length) { delete gallery.setPlacement; changed = true; }
    if (changed) this.onChange(gallery);
    this.render();
  }
  render() {
    const doc = this.host.ownerDocument, gallery = this.getGallery() || emptyGallery();
    this.host.replaceChildren(); this.host.classList.add('content-gallery-editor');
    const manage = doc.createElement('button'); manage.type = 'button'; manage.textContent = gallery.images.length ? `Edit gallery: ${gallery.title}` : 'Create gallery';
    manage.addEventListener('click', () => this.open(null)); this.host.appendChild(manage);
    const unused = !gallery.setPlacement && gallery.images.some((image) => image.paragraph === null);
    paragraphs(this.input.value).forEach((text, paragraph) => {
      const section = doc.createElement('div'), p = doc.createElement('p'); p.textContent = text; section.appendChild(p);
      const deleteParagraph = doc.createElement('button'); deleteParagraph.type = 'button'; deleteParagraph.textContent = 'Delete paragraph';
      deleteParagraph.addEventListener('click', () => {
        const next = structuredClone(this.getGallery() || emptyGallery());
        for (const image of next.images) if ((image.target || '') === this.target && image.paragraph !== null) { if (image.paragraph === paragraph) image.paragraph = null; else if (image.paragraph > paragraph) image.paragraph--; }
        if (next.setPlacement && (next.setPlacement.target || '') === this.target) { if (next.setPlacement.paragraph === paragraph) delete next.setPlacement; else if (next.setPlacement.paragraph > paragraph) next.setPlacement.paragraph--; }
        this.input.value = paragraphs(this.input.value).filter((_, index) => index !== paragraph).join('\n\n'); this.onChange(next);
        this.input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true })); this.render();
      });
      section.appendChild(deleteParagraph);
      const placed = gallery.setPlacement ? [] : gallery.images.filter((image) => image.paragraph === paragraph && (image.target || '') === this.target);
      const row = doc.createElement('div'); row.className = 'paragraph-images'; row.dataset.galleryGroup = '';
      placed.forEach((image) => {
        const wrap = doc.createElement('div'); wrap.style.width = placed.length === 1 ? '100%' : '50%';
        const preview = doc.createElement('img'); preview.src = image.url; preview.alt = image.alt; preview.style.width = '100%'; preview.dataset.galleryImage = ''; preview.tabIndex = 0; preview.setAttribute('role', 'button'); preview.setAttribute('aria-label', `Open ${image.alt || gallery.title} fullscreen`); preview.referrerPolicy = 'no-referrer';
        const remove = doc.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove from paragraph';
        remove.addEventListener('click', () => { const next = structuredClone(this.getGallery()); next.images.find((item) => item.id === image.id).paragraph = null; this.onChange(next); this.render(); });
        wrap.append(preview, remove); row.appendChild(wrap);
      });
      if (placed.length) section.appendChild(row);
      if (gallery.setPlacement?.paragraph === paragraph && (gallery.setPlacement.target || '') === this.target) {
        const set = doc.createElement('div'); set.innerHTML = gallerySetHtml(gallery);
        const remove = doc.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove gallery set';
        remove.addEventListener('click', () => { const next = structuredClone(this.getGallery()); delete next.setPlacement; this.onChange(next); this.render(); });
        section.append(set, remove);
      }
      if (!gallery.setPlacement && placed.length < 2 && (!gallery.images.length || unused)) {
        const add = doc.createElement('button'); add.type = 'button'; add.className = 'gallery-add-link'; add.textContent = 'Add image From A Gallery'; add.dataset.paragraph = String(paragraph);
        add.addEventListener('click', () => this.open(paragraph)); section.appendChild(add);
      }
      this.host.appendChild(section);
    });
  }
  open(paragraph) {
    this.overlay?.remove();
    const doc = this.host.ownerDocument, previousFocus = doc.activeElement;
    const draft = structuredClone(this.getGallery() || emptyGallery());
    const overlay = doc.createElement('div'); this.overlay = overlay; overlay.className = 'content-gallery-overlay';
    const dialog = doc.createElement('section'); dialog.className = 'content-gallery-modal'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', 'Post or page gallery');
    const heading = doc.createElement('h2'); heading.textContent = draft.images.length ? 'Edit gallery' : 'Create gallery';
    const hint = doc.createElement('p'); hint.textContent = 'This updates the gallery in your editor. Finish with Save post or Save page on a deployed site, or the builder save/export, to persist the document.';
    const titleLabel = doc.createElement('label'); titleLabel.textContent = 'Gallery title (required)';
    const title = doc.createElement('input'); title.type = 'text'; title.required = true; title.maxLength = 120; title.value = draft.title; title.name = 'galleryTitle'; titleLabel.appendChild(title);
    const destinationLabel = doc.createElement('label'); destinationLabel.textContent = 'Insert after paragraph';
    const destination = doc.createElement('select'); destination.name = 'galleryParagraph';
    const placeholder = doc.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose a paragraph'; destination.appendChild(placeholder);
    paragraphs(this.input.value).forEach((text, index) => { const option = doc.createElement('option'); option.value = String(index); option.textContent = `${index + 1}. ${text.trim().slice(0, 65) || '(new paragraph)'}`; destination.appendChild(option); });
    if (paragraph === null && (draft.setPlacement?.target || '') === this.target) paragraph = draft.setPlacement?.paragraph ?? null;
    destination.value = paragraph === null ? '' : String(paragraph); destinationLabel.appendChild(destination);
    const layoutLabel = doc.createElement('label'); layoutLabel.textContent = 'Gallery set layout';
    const layout = doc.createElement('select'); layout.name = 'galleryLayout';
    for (const [value, label] of [['grid', 'Grid'], ['strip', 'Horizontal strip']]) { const option = doc.createElement('option'); option.value = value; option.textContent = label; layout.appendChild(option); }
    layout.value = draft.setPlacement?.style || 'grid'; layoutLabel.appendChild(layout);
    const rows = doc.createElement('div'), actions = doc.createElement('div'); rows.dataset.galleryGroup = ''; actions.className = 'gallery-modal-actions';
    const add = doc.createElement('button'); add.type = 'button'; add.textContent = 'Add image URL';
    const save = doc.createElement('button'); save.type = 'button'; save.textContent = draft.images.length ? 'Save gallery' : 'Create gallery'; save.disabled = true;
    const insertSet = doc.createElement('button'); insertSet.type = 'button'; insertSet.textContent = 'Add entire gallery after this paragraph'; insertSet.disabled = true;
    const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
    const status = doc.createElement('p'); status.textContent = paragraph === null ? 'Choose a paragraph above to insert individual images or the entire gallery. Save gallery keeps the bank without adding a new placement.' : ''; status.className = 'gallery-status'; status.setAttribute('role', 'status');
    const entries = [];
    const close = () => { overlay.remove(); previousFocus?.focus(); };
    const value = () => ({ title: title.value.trim(), ...(draft.setPlacement ? { setPlacement: { ...draft.setPlacement, style: layout.value } } : {}), images: entries.filter((entry) => entry.input.value.trim()).map((entry) => ({ ...entry.image, url: imageUrl(entry.input.value), alt: title.value.trim() })) });
    const valid = () => {
      const filled = entries.filter((entry) => entry.input.value.trim());
      return Boolean(title.value.trim() && filled.length && filled.every((entry) => entry.loaded && imageUrl(entry.input.value)) && new Set(filled.map((entry) => imageUrl(entry.input.value))).size === filled.length);
    };
    const refresh = () => { save.disabled = !valid(); insertSet.disabled = !valid() || paragraph === null; add.disabled = entries.length >= MAX_CONTENT_IMAGES; for (const entry of entries) entry.insert.disabled = !valid() || Boolean(draft.setPlacement) || paragraph === null || entry.image.paragraph !== null || value().images.filter((image) => image.paragraph === paragraph && (image.target || '') === this.target).length >= 2; };
    const commit = (imageId = null, wholeSet = false) => {
      if (!valid() || ((imageId || wholeSet) && paragraph === null)) return;
      try {
        const next = value();
        if (wholeSet) {
          next.images = next.images.map((image) => ({ ...image, paragraph: null, ...(this.getTargets ? { target: '' } : {}) }));
          next.setPlacement = { paragraph, style: layout.value, ...(this.getTargets ? { target: this.target } : {}) };
        }
        if (imageId) { const image = next.images.find((image) => image.id === imageId); image.paragraph = paragraph; if (this.getTargets) image.target = this.target; }
        const normalized = normalizeContentGallery(next, this.input.value, this.getTargets?.());
        this.onChange(normalized); this.render(); close();
      } catch (error) { status.textContent = error.message; }
    };
    const addRow = (image = { id: `image-${globalThis.crypto.randomUUID()}`, url: '', paragraph: null }) => {
      if (entries.length >= MAX_CONTENT_IMAGES) return;
      const row = doc.createElement('div'); row.className = 'gallery-image-row';
      const label = doc.createElement('label'); label.textContent = 'Image URL';
      const input = doc.createElement('input'); input.type = 'text'; input.inputMode = 'url'; input.maxLength = 2048; input.value = image.url; label.appendChild(input);
      let preview = doc.createElement('img'); preview.hidden = true; preview.referrerPolicy = 'no-referrer';
      const feedback = doc.createElement('span'); feedback.className = 'gallery-status';
      const insert = doc.createElement('button'); insert.type = 'button'; insert.className = 'gallery-add-link'; insert.textContent = 'Add Image Next To Paragraph'; insert.disabled = true;
      const remove = doc.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove image';
      const entry = { image, input, insert, loaded: false }; entries.push(entry);
      let revision = 0;
      const load = () => {
        entry.loaded = false; preview.hidden = true; preview.removeAttribute('src'); feedback.textContent = ''; refresh();
        const url = imageUrl(input.value); const current = ++revision;
        if (!url) { if (input.value.trim()) feedback.textContent = 'Use an HTTPS or same-site image URL.'; return; }
        const next = doc.createElement('img'); next.hidden = true; next.referrerPolicy = 'no-referrer'; next.alt = title.value.trim() || 'Gallery image preview'; next.dataset.galleryImage = ''; next.tabIndex = 0; next.setAttribute('role', 'button'); next.setAttribute('aria-label', 'Open gallery preview fullscreen');
        next.addEventListener('load', () => { if (current !== revision) return; entry.loaded = true; next.hidden = false; refresh(); });
        next.addEventListener('error', () => { if (current !== revision) return; entry.loaded = false; next.hidden = true; feedback.textContent = 'Image could not be loaded. Check the URL and embedding permissions.'; refresh(); });
        preview.replaceWith(next); preview = next;
        next.src = url;
      };
      input.addEventListener('input', load);
      insert.addEventListener('click', () => commit(image.id));
      remove.addEventListener('click', () => { revision++; entries.splice(entries.indexOf(entry), 1); row.remove(); refresh(); });
      row.append(label, preview, feedback, insert, remove); rows.appendChild(row); load();
    };
    destination.addEventListener('change', () => { paragraph = destination.value === '' ? null : Number(destination.value); refresh(); });
    layout.addEventListener('change', refresh); insertSet.addEventListener('click', () => commit(null, true));
    title.addEventListener('input', refresh); add.addEventListener('click', () => addRow()); save.addEventListener('click', () => commit()); cancel.addEventListener('click', close);
    actions.append(add, save, insertSet, cancel); dialog.append(heading, hint, titleLabel, destinationLabel, layoutLabel, rows, status, actions); overlay.appendChild(dialog); doc.body.appendChild(overlay);
    for (const image of draft.images) addRow(image);
    if (!entries.length) addRow();
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') { const focusable = [...dialog.querySelectorAll('button:not(:disabled),input,select')]; const first = focusable[0], last = focusable.at(-1); if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); } }
    });
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    title.focus();
  }
}
