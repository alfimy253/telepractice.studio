import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// wrangler.jsonc is JSONC: full-line // comments are allowed, so strip them before parsing.
async function readBuilderWranglerConfig() {
  const source = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  return JSON.parse(source.replace(/^\s*\/\/.*$/gm, ''));
}

test('builder wrangler config keeps the previews block that `wrangler preview` requires', async () => {
  const config = await readBuilderWranglerConfig();
  // An empty object is enough: previews inherit the top-level settings, so the
  // Worker entry point and the ASSETS binding used by src/index.js must stay top-level.
  assert.ok(
    config.previews && typeof config.previews === 'object' && !Array.isArray(config.previews),
    'add a "previews" object (it may be empty) to wrangler.jsonc, or `npx wrangler preview` fails'
  );
  assert.equal(config.main, 'src/index.js');
  assert.equal(config.assets.binding, 'ASSETS');
});
