import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateBundle, buildPreviewDocument } from '../public/package-core.js';

const adminInput = {
  adminUsername: 'practiceowner',
  adminEmail: 'owner@example.test',
  adminPassword: 'CanopyOwner!8'
};
const readDisk = (filename) => readFile(new URL(`../public/_scaffold/templates/${filename}`, import.meta.url), 'utf8');
function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const files = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + size;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    files.set(name, { size, text: decoder.decode(bytes.subarray(dataStart, dataEnd)) });
    offset = dataEnd;
  }
  return files;
}

// Every heading level keeps five pixels of extra line-box space, so wrapped
// Brivon titles keep 4–8px of breathing room between lines. The rule lives in
// the shared brivon.css template, which both the prepared ZIP and the live
// preview (inlined <style>) use verbatim.
function assertHeadingRule(css, label) {
  const shellRule = css.match(/\.brivon-shell h1,[\s\S]*?\.brivon-shell h8 \{ line-height: calc\(1em \+ 5px\); \}/);
  assert.ok(shellRule, `${label}: .brivon-shell h1–h8 line-height rule missing`);
  for (const level of ['h1','h2','h3','h4','h5','h6','h7','h8']) {
    assert.ok(shellRule[0].includes(`.brivon-shell ${level}`), `${label}: ${level} missing from the rule`);
  }
  // The functional-page compatibility rule covers both Brivon themes, h1–h8.
  const compatRule = css.match(/body\.theme-brivon-dark:not\(\.brivon-shell\) h1,[\s\S]*?\{font-family:'Boldonse'[\s\S]*?line-height:calc\(1em \+ 5px\)!important[\s\S]*?\}/);
  assert.ok(compatRule, `${label}: Brivon continuity heading rule missing`);
  for (const theme of ['theme-brivon-dark', 'theme-brivon-light']) {
    for (const level of ['h1','h2','h3','h4','h5','h6','h7','h8']) {
      assert.ok(compatRule[0].includes(`body.${theme}:not(.brivon-shell) ${level}`), `${label}: ${theme} ${level} missing from the continuity rule`);
    }
  }
}

test('the packaged brivon.css keeps 5px extra line space for h1–h8 in both themes', async () => {
  for (const target of ['vercel', 'cloudflare']) {
    const built = await generateBundle({ target, businessName: 'Heading Practice', theme: 'brivon-dark', ...adminInput }, readDisk);
    const entries = zipEntries(built.buffer);
    const css = entries.get(target === 'cloudflare' ? 'public/brivon.css' : 'brivon.css');
    assert.ok(css, `${target}: brivon.css missing from ZIP`);
    assertHeadingRule(css.text, `${target} package`);
  }
});

test('the live preview inlines the same h1–h8 heading rule for Brivon Dark and Light', async () => {
  for (const theme of ['brivon-dark', 'brivon-light']) {
    const { html } = await buildPreviewDocument({ theme }, readDisk);
    const inlined = html.match(/<style>([\s\S]*?)<\/style>/);
    assert.ok(inlined, `${theme}: preview has no inlined stylesheet`);
    assertHeadingRule(inlined[1], `${theme} preview`);
  }
});
