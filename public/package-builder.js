// Browser-side build entry. Runs the exact same package-core as the Worker,
// reading scaffold templates over same-origin fetch instead of the ASSETS
// binding. Used as the Generate fallback (and for instant previews) so the
// builder keeps working when the deployed Worker is on a plan whose per-request
// CPU budget cannot absorb the server-side build (Workers Free is capped at
// 10ms of CPU; a full ZIP build needs far more).
import { buildPreviewDocument, generateBundle } from './package-core.js';

const templateCache = new Map();

async function fetchTemplate(filename) {
  if (templateCache.has(filename)) return templateCache.get(filename);
  // Resolve against the builder page so the same code runs in a browser tab
  // and in tests (where location may be absent and the path is used as-is).
  const path = `/_scaffold/templates/${filename.split('/').map(encodeURIComponent).join('/')}`;
  const url = globalThis.location ? new URL(path, globalThis.location.href).href : path;
  // Cache the text-producing promise (not the Response) so warm hits resolve
  // to the same string the first read returned.
  const request = (async () => {
    const response = await fetch(url, {
      method: 'GET', credentials: 'same-origin', cache: 'force-cache', headers: { Accept: 'text/plain' }
    });
    if (!response.ok) throw new Error(`Missing build scaffold file: ${filename}`);
    return response.text();
  })();
  templateCache.set(filename, request);
  try {
    return await request;
  } catch (error) {
    templateCache.delete(filename);
    throw error instanceof Error && /Missing build scaffold file/.test(error.message)
      ? error
      : new Error(`Missing build scaffold file: ${filename}`);
  }
}

// Builds the selected code package entirely in the browser. Returns the same
// { config, buffer, filename } shape as the Worker route.
async function buildPackageLocally(payload) {
  return generateBundle(payload, fetchTemplate);
}

// Renders the live preview document entirely in the browser.
async function buildPreviewLocally(input) {
  return buildPreviewDocument(input, fetchTemplate);
}

export { buildPackageLocally, buildPreviewLocally, fetchTemplate };
