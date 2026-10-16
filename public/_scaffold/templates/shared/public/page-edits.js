import { normalizeContentGallery, contentHtml, escapeContent as htmlEscape } from './content-gallery.js';
const PAGE_EDIT_TAGS = new Set(['h1','h2','h3','h4','h5','h6','h7','h8','p','span','li','strong','em','small','blockquote','figcaption','label','div','section']);
// Regions the preview regenerates from the builder config and the generated
// site re-renders at runtime (menu, gallery, journal, payments, CTAs, modal,
// toast). Their content differs between the preview document and the packaged
// homepage source, so page edits never target them — in the editor, in the
// index computation, and in applyPageEdits alike. Keeping one shared list is
// what makes a selector+index pair mean the same element in both documents.
const PAGE_EDIT_EXCLUDED_IDS = new Set(['siteNav','drawerNav','editorialSiteNav','galleryGrid','postGrid','paymentDetails','footerPayments','headerCta','heroBook','articleBook','editorialSidebarCta','articleModal','siteToast','pageEditorControls']);
const MAX_PAGE_EDITS = 64;
const MAX_PAGE_EDIT_TEXT = 2000;
const PAGE_EDIT_SELECTOR = /^([a-z][a-z0-9]*)?((?:\.[a-zA-Z0-9_-]+){0,3})?(#[a-zA-Z0-9_-]+)?$/;
function parsePageEditSelector(selector) {
  const match = PAGE_EDIT_SELECTOR.exec(String(selector || '').trim());
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  return {
    tag: match[1] ? match[1].toLowerCase() : null,
    classes: match[2] ? match[2].split('.').filter(Boolean) : [],
    id: match[3] ? match[3].slice(1) : null
  };
}
// Validates and deduplicates the editor's edit list. Throws on anything the
// editor would never produce, so a bad payload fails loudly instead of
// silently dropping edits.
function normalizePageEdits(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('Page edits must be a list of target/text pairs.');
  if (value.length > MAX_PAGE_EDITS) throw new Error(`Apply no more than ${MAX_PAGE_EDITS} page edits.`);
  const byTarget = new Map();
  let pageGallery = null;
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Each page edit must be a target/text object.');
    const selector = String(item.selector || '').trim();
    const parsed = parsePageEditSelector(selector);
    if (!parsed) throw new Error(`Unsupported page-edit target: ${selector || '(empty)'}`);
    if (parsed.tag && !PAGE_EDIT_TAGS.has(parsed.tag)) throw new Error(`Page edits cannot target <${parsed.tag}> elements.`);
    if (item.remove !== undefined && typeof item.remove !== 'boolean') throw new Error('Page removal must be true or false.');
    if (parsed.tag === 'section' && !item.remove) throw new Error('Sections may only be deleted, not replaced with plain text.');
    const index = Number(item.index);
    if (!Number.isInteger(index) || index < 0 || index > 999) throw new Error('Each page edit needs a target position between 0 and 999.');
    if (item.pageGallery) { if (pageGallery) throw new Error('Only one gallery is allowed per page.'); pageGallery = item.pageGallery; }
    byTarget.set(`${selector}::${index}`, { selector, index, ...(item.remove ? { remove: true } : { text: String(item.text ?? '').slice(0, MAX_PAGE_EDIT_TEXT) }) });
  }
  const edits = [...byTarget.values()];
  if (pageGallery && edits.length) edits[0].pageGallery = normalizeContentGallery(pageGallery, '', Object.fromEntries(edits.filter((edit) => !edit.remove).map((edit) => [`${edit.selector}::${edit.index}`, edit.text])));
  return edits;
}
// Ranges of a document whose text must never be scanned for tags: style and
// script bodies can contain characters that look like markup, and comments
// can contain example tags.
function inertRanges(html) {
  const ranges = [];
  const pattern = /<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) ranges.push([match.index, match.index + match[0].length]);
  return ranges;
}
// Every opening tag matching the parsed selector, in document order, skipping
// the excluded live-data regions (by ancestor-or-self id) and inert ranges.
// Mirrors the browser editor's index computation: querySelectorAll(selector)
// filtered to elements outside the same excluded regions.
const PAGE_EDIT_VOID_TAGS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','source','track','wbr']);
function findMatchingTags(html, parsed) {
  const inert = inertRanges(html);
  const insideInert = (index) => inert.some(([start, end]) => index >= start && index < end);
  const matches = [];
  const openIds = []; // ids of currently open ancestors
  const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let match;
  while ((match = tagPattern.exec(html)) !== null) {
    if (insideInert(match.index)) continue;
    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const attrs = match[3];
    const idAttr = (/\bid\s*=\s*"([^"]*)"/.exec(attrs) || /\bid\s*=\s*'([^']*)'/.exec(attrs) || [])[1] || '';
    if (closing) {
      for (let i = openIds.length - 1; i >= 0; i--) {
        if (openIds[i].tag === tag) { openIds.length = i; break; }
      }
      continue;
    }
    const selfClosing = /\/\s*>$/.test(match[0]) || PAGE_EDIT_VOID_TAGS.has(tag);
    const excluded = PAGE_EDIT_EXCLUDED_IDS.has(idAttr) || openIds.some((entry) => PAGE_EDIT_EXCLUDED_IDS.has(entry.id));
    if (!selfClosing) openIds.push({ tag, id: idAttr });
    if (excluded) continue;
    if (parsed.tag && tag !== parsed.tag) continue;
    const classAttr = (/\bclass\s*=\s*"([^"]*)"/.exec(attrs) || /\bclass\s*=\s*'([^']*)'/.exec(attrs) || [])[1] || '';
    const classes = classAttr.split(/\s+/).filter(Boolean);
    if (parsed.classes.some((name) => !classes.includes(name))) continue;
    if (parsed.id && idAttr !== parsed.id) continue;
    matches.push({ start: match.index, end: match.index + match[0].length, tag: match[0] });
  }
  return matches;
}
// Replaces the inner HTML of the element whose opening tag is `openTag`,
// tracking nested tags of the same name so nested wrappers stay intact.
function replaceElementContentAt(html, openTag, content) {
  const tagName = /^<\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(openTag.tag)[1].toLowerCase();
  const scanner = new RegExp(`<\\/?${tagName}(?=[\\s/>])`, 'gi');
  scanner.lastIndex = openTag.end;
  let depth = 1;
  let match;
  while ((match = scanner.exec(html)) !== null) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return `${html.slice(0, openTag.end)}${content}${html.slice(match.index)}`;
  }
  return html;
}
// Stamp original identities before removal changes sibling selector positions.
function stampPageTargets(html) {
  const source = html;
  const targets = findMatchingTags(source, { tag: null, classes: [], id: null }).filter((target) => PAGE_EDIT_TAGS.has(/^<([a-z0-9]+)/i.exec(target.tag)[1].toLowerCase()));
  for (const target of targets.reverse()) {
    if (/\bdata-page-edit-key=/.test(target.tag)) continue;
    const tag = /^<([a-z0-9]+)/i.exec(target.tag)[1].toLowerCase();
    const id = (/\bid="([^"]*)"/.exec(target.tag) || /\bid='([^']*)'/.exec(target.tag) || [])[1];
    const classes = ((/\bclass="([^"]*)"/.exec(target.tag) || /\bclass='([^']*)'/.exec(target.tag) || [])[1] || '').split(/\s+/).slice(0, 3).filter((name) => /^[a-zA-Z0-9_-]+$/.test(name));
    const selector = id ? `#${id}` : tag + classes.map((name) => `.${name}`).join('');
    const parsed = parsePageEditSelector(selector); if (!parsed) continue;
    const index = findMatchingTags(source, parsed).findIndex((match) => match.start === target.start);
    const marked = target.tag.replace(/^(<[a-zA-Z0-9]+)/, `$1 data-page-edit-key="${htmlEscape(`${selector}::${index}`)}"`);
    html = html.slice(0, target.start) + marked + html.slice(target.end);
  }
  return html;
}
// Applies page-editor text edits to an HTML document. New text is escaped and
// newlines become <br>, so edited elements keep their line structure.
function applyPageEdits(html, edits, markRuntimeEdits = false) {
  if (edits.length && (markRuntimeEdits || edits.some((edit) => edit.remove || edit.pageGallery))) html = stampPageTargets(html);
  const gallery = edits.find((edit) => edit.pageGallery)?.pageGallery;
  // Resolve all original targets before gallery wrappers add span elements.
  // Apply from the end so earlier offsets and selector indexes remain stable.
  const resolved = edits.map((edit) => { const parsed = parsePageEditSelector(edit.selector); return { edit, target: parsed ? (() => { const matches = findMatchingTags(html, parsed); return matches.find((match) => match.tag.includes(`data-page-edit-key="${htmlEscape(`${edit.selector}::${edit.index}`)}"`)) || matches[edit.index]; })() : null }; })
    .filter(({ target }) => target);
  const targets = [...new Map(resolved.map((item) => [item.target.start, item])).values()].sort((a, b) => b.target.start - a.target.start);
  for (const { edit, target } of targets) {
    const content = edit.remove ? '' : gallery ? contentHtml(edit.text, gallery, `${edit.selector}::${edit.index}`) : htmlEscape(edit.text).replace(/\n/g, '<br>');
    html = replaceElementContentAt(html, target, content);
    let markedTag = target.tag;
    if (markRuntimeEdits || gallery || edit.remove) markedTag = markedTag.replace(/\bdata-page-edit-key="[^"]*"/, `data-page-edit-key="${htmlEscape(`${edit.selector}::${edit.index}`)}"`);
    if ((markRuntimeEdits || gallery || edit.remove) && !/\bdata-page-edited\b/.test(markedTag)) {
      markedTag = markedTag.replace(/^(<[a-zA-Z0-9]+)/, '$1 data-page-edited');
    }
    if (edit.remove && !/\bdata-page-deleted\b/.test(markedTag)) markedTag = markedTag.replace(/^(<[a-zA-Z0-9]+)/, '$1 hidden data-page-deleted');
    html = html.slice(0, target.start) + markedTag + html.slice(target.end);
  }
  return html;
}


export function outsideLiveRegions(element) { return ![...PAGE_EDIT_EXCLUDED_IDS].some((id) => element.closest(`[id="${id}"]`)); }
export function pageTarget(element, doc) {
  const marked = element.getAttribute('data-page-edit-key');
  if (marked) { const at = marked.lastIndexOf('::'); return { selector: marked.slice(0, at), index: Number(marked.slice(at + 2)) }; }
  const classes = [...element.classList].slice(0, 3).filter((name) => /^[a-zA-Z0-9_-]+$/.test(name));
  const selector = element.id ? `#${element.id}` : element.tagName.toLowerCase() + classes.map((name) => `.${name}`).join('');
  return { selector, index: [...doc.querySelectorAll(selector)].filter(outsideLiveRegions).indexOf(element) };
}
export function applyPageEditsToDocument(doc, raw) {
  const edits = normalizePageEdits(raw), gallery = edits.find((edit) => edit.pageGallery)?.pageGallery;
  const targets = edits.map((edit) => ({ edit, element: (() => { const matches = [...doc.querySelectorAll(edit.selector)].filter(outsideLiveRegions); return matches.find((element) => element.dataset.pageEditKey === `${edit.selector}::${edit.index}`) || matches[edit.index]; })() }));
  for (const { edit, element } of targets.reverse()) {
    if (!element) continue;
    element.dataset.pageEdited = ''; element.dataset.pageEditKey = `${edit.selector}::${edit.index}`;
    if (edit.remove) { element.replaceChildren(); element.hidden = true; element.dataset.pageDeleted = ''; element.style.setProperty('display', 'none', 'important'); }
    else element.innerHTML = gallery ? contentHtml(edit.text, gallery, element.dataset.pageEditKey) : htmlEscape(edit.text).replace(/\n/g, '<br>');
  }
}
export function releaseDeletedGalleryTargets(gallery, keys) {
  if (!gallery) return;
  for (const image of gallery.images) if (keys.has(image.target)) image.paragraph = null;
  if (gallery.setPlacement && keys.has(gallery.setPlacement.target)) delete gallery.setPlacement;
}
export function installDeletionControls(doc, onDelete) {
  const bar = doc.createElement('div'); bar.id = 'pageEditorControls'; bar.hidden = true;
  bar.style.cssText = 'position:fixed;right:8px;top:8px;z-index:2147483647;background:white;padding:8px;border:1px solid #b64b40;border-radius:6px;box-shadow:0 2px 12px #0003';
  const paragraph = doc.createElement('button'), section = doc.createElement('button');
  paragraph.type = section.type = 'button'; paragraph.textContent = '× Delete paragraph'; section.textContent = '× Delete section';
  for (const button of [paragraph, section]) button.style.cssText = 'cursor:pointer;margin:3px;padding:8px;color:#8b241a;background:white;border:1px solid currentColor;border-radius:4px';
  let selectedParagraph = null, selectedSection = null;
  const choose = (event) => {
    if (event.target.closest?.('#pageEditorControls')) return;
    selectedParagraph = event.target.closest?.('p,blockquote,li') || event.target.closest?.('div[data-pe-editable]');
    if (selectedParagraph && !['P','BLOCKQUOTE','LI','DIV'].includes(selectedParagraph.tagName)) selectedParagraph = null;
    selectedSection = event.target.closest?.('section');
    if (selectedParagraph && (!outsideLiveRegions(selectedParagraph) || selectedParagraph.closest('[data-page-deleted]'))) selectedParagraph = null;
    if (selectedSection && (!outsideLiveRegions(selectedSection) || selectedSection.closest('[data-page-deleted]'))) selectedSection = null;
    paragraph.hidden = !selectedParagraph; section.hidden = !selectedSection; bar.hidden = !selectedParagraph && !selectedSection;
  };
  paragraph.addEventListener('click', (event) => { event.stopPropagation(); if (selectedParagraph) onDelete(selectedParagraph); bar.hidden = true; });
  section.addEventListener('click', (event) => { event.stopPropagation(); if (selectedSection) onDelete(selectedSection); bar.hidden = true; });
  bar.append(paragraph, section); doc.body.appendChild(bar); doc.addEventListener('click', choose);
  return () => { bar.remove(); doc.removeEventListener('click', choose); };
}
export { normalizePageEdits, applyPageEdits, PAGE_EDIT_EXCLUDED_IDS };
