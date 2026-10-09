// Builder-tab side of the page editor. The "Page editor" link in the site
// layout section opens public/page-editor.html in a new tab. That tab edits
// the exact document the builder preview shows and, on "Export to builder",
// posts the edits over a BroadcastChannel. This bridge hands them to the
// builder (which applies them to its config, preview and next ZIP) and
// persists them server-side through /api/page-editor so they survive the
// editor tab closing.
import { normalizePageEdits } from './package-core.js';

export const PAGE_EDITOR_CHANNEL = 'canopy-page-editor';

// Persists page edits through the Worker (KV-backed). Never throws: a missing
// storage binding or a network failure must not lose the edits the builder
// already applied locally.
export async function savePageEditsToServer(siteId, edits, fetcher = globalThis.fetch) {
  try {
    const csrfResponse = await fetcher('/api/csrf', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }
    });
    if (!csrfResponse.ok) return { saved: false, message: `could not open a save session (${csrfResponse.status})` };
    const { token } = await csrfResponse.json().catch(() => ({}));
    if (typeof token !== 'string' || !token) return { saved: false, message: 'the save session returned no token' };
    const response = await fetcher('/api/page-editor', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({ siteId, edits })
    });
    if (response.status === 503) return { saved: false, message: 'page editor storage is not configured on this deployment' };
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return { saved: false, message: error.error || `the save request failed (${response.status})` };
    }
    const result = await response.json().catch(() => ({}));
    return { saved: true, savedCount: result.saved ?? edits.length };
  } catch (_) {
    return { saved: false, message: 'the save request could not reach the server' };
  }
}

export function openPageEditor() {
  window.open('/page-editor.html', '_blank', 'noopener');
}

// Listens for "Export to builder" messages from the editor tab. `applyEdits`
// receives the validated edit list and resolves to an outcome that is sent
// back as the acknowledgement; `notify` is the builder's toast.
export function initPageEditorBridge({ applyEdits, notify }) {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const channel = new BroadcastChannel(PAGE_EDITOR_CHANNEL);
  channel.addEventListener('message', async (event) => {
    const message = event.data;
    if (!message || message.type !== 'export') return;
    let edits;
    try { edits = normalizePageEdits(message.edits); }
    catch (_) {
      channel.postMessage({ type: 'export-ack', ok: false, message: 'The edits could not be applied.' });
      return;
    }
    let outcome;
    try {
      outcome = await applyEdits(edits);
    } catch (cause) {
      outcome = { saved: false, message: cause?.message || 'the edits could not be applied' };
    }
    if (typeof notify === 'function') {
      notify('Page edits applied', outcome?.saved
        ? `${edits.length} edit${edits.length === 1 ? '' : 's'} now show in the preview, are saved on the server, and will be in the next ZIP.`
        : `The preview now shows your ${edits.length} edit${edits.length === 1 ? '' : 's'}, but the server save failed — ${outcome?.message || 'unknown error'}.`);
    }
    channel.postMessage({ type: 'export-ack', ok: true, ...outcome });
  });
  return () => channel.close();
}
