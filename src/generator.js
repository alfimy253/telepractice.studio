// Worker-side entry for the shared package/preview build core. All of the
// actual generation lives in public/package-core.js so the builder browser tab
// can run the very same code as a fallback when the deployed Worker is on a
// CPU-capped plan. This module only supplies the ASSETS-backed template reader
// and keeps the (input, env, origin) signatures used by src/index.js.
import {
  buildPreviewDocument as buildPreviewDocumentCore,
  generateBundle as generateBundleCore,
  normalizeAdminAccount,
  normalizeConfig
} from '../public/package-core.js';

async function readScaffold(env, origin, filename) {
  const url = new URL(`/_scaffold/templates/${filename.split('/').map(encodeURIComponent).join('/')}`, origin);
  const response = await env.ASSETS.fetch(new Request(url, { method: 'GET' }));
  if (!response.ok) throw new Error(`Missing build scaffold file: ${filename}`);
  return response.text();
}

async function buildPreviewDocument(input, env, origin) {
  return buildPreviewDocumentCore(input, (filename) => readScaffold(env, origin, filename));
}

async function generateBundle(input, env, origin) {
  return generateBundleCore(input, (filename) => readScaffold(env, origin, filename));
}

export { buildPreviewDocument, generateBundle, normalizeAdminAccount, normalizeConfig };
