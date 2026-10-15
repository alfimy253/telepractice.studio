// Password verification must be constant-time, and the 8-25 length rule must
// hold at verification time as well as at creation time.
//
// "Constant-time" here is enforced structurally, not measured with a clock
// (wall-clock timing assertions are flaky and prove little). The structural
// properties are:
//   1. Every digest comparison goes through constantEqual() (shared lib and
//      Cloudflare runtime) or timingSafeEqual() (Vercel runtime) — never ===.
//   2. Every verifier always runs the PBKDF2 derivation before deciding, even
//      for a malformed stored hash, using dummy parameters when the real ones
//      are unusable — so the expensive step cannot be skipped by crafting
//      input.
//   3. Both client login routes verify against DUMMY_PASSWORD_HASH when the
//      email has no account, so login timing cannot reveal whether an
//      account exists.
// These tests pin the behaviour (accept/reject outcomes at every boundary)
// and assert the structure in the shipped sources.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  constantEqual,
  createPasswordHash,
  normalizePasswordHash,
  PASSWORD_MAX,
  PASSWORD_MIN,
  passwordHashWellFormed,
  verifyPasswordHash
} from '../public/_scaffold/templates/shared/lib/admin-security.js';

const MIN_PASSWORD = 'Abcdef1!';            // exactly 8, one of each class
const MAX_PASSWORD = `A${'b'.repeat(22)}1!`; // exactly 25
const SEVEN_CHARS = 'Abcde1!';               // valid under the retired 7-25 rule
const TWENTY_SIX = `A${'b'.repeat(23)}1!`;   // exactly 26

test('the shared constants define 8-25', () => {
  assert.equal(PASSWORD_MIN, 8);
  assert.equal(PASSWORD_MAX, 25);
  assert.equal(MIN_PASSWORD.length, PASSWORD_MIN);
  assert.equal(MAX_PASSWORD.length, PASSWORD_MAX);
});

test('verifyPasswordHash accepts the correct password at both boundaries', async () => {
  assert.equal(await verifyPasswordHash(MIN_PASSWORD, await createPasswordHash(MIN_PASSWORD)), true);
  assert.equal(await verifyPasswordHash(MAX_PASSWORD, await createPasswordHash(MAX_PASSWORD)), true);
});

test('quoted or padded hashes still verify and malformed hashes are detected', async () => {
  const hash = await createPasswordHash(MIN_PASSWORD);
  assert.equal(normalizePasswordHash(`"${hash}"`), hash);
  assert.equal(normalizePasswordHash(`'${hash}'`), hash);
  assert.equal(passwordHashWellFormed(hash), true);
  assert.equal(passwordHashWellFormed(`"${hash}"`), true);
  assert.equal(passwordHashWellFormed(`"${hash}`), false);
  assert.equal(await verifyPasswordHash(MIN_PASSWORD, `"${hash}"`), true);
  assert.equal(await verifyPasswordHash(MIN_PASSWORD, `'${hash}'`), true);
});

test('verifyPasswordHash rejects wrong passwords of any length', async () => {
  const hash = await createPasswordHash(MIN_PASSWORD);
  assert.equal(await verifyPasswordHash('Abcdef2!', hash), false, 'same length, wrong content');
  assert.equal(await verifyPasswordHash('Abcdef1!x', hash), false, 'longer candidate');
  assert.equal(await verifyPasswordHash('Ab1!', hash), false, 'shorter candidate');
  assert.equal(await verifyPasswordHash('', hash), false, 'empty candidate');
});

test('verifyPasswordHash enforces 8-25 at verification time', async () => {
  // createPasswordHash deliberately does not police length (policy lives in
  // the validators), which makes it possible to prove the verifier does:
  // a hash genuinely created from a 7-character password — valid before the
  // rule change — must no longer verify. Accounts created under the old
  // 7-25 rule with a 7-character password need a password reset after this
  // change; that is the intended consequence of raising the minimum.
  const legacyHash = await createPasswordHash(SEVEN_CHARS);
  assert.equal(await verifyPasswordHash(SEVEN_CHARS, legacyHash), false, '7 characters must not verify');
  const overLongHash = await createPasswordHash(TWENTY_SIX);
  assert.equal(await verifyPasswordHash(TWENTY_SIX, overLongHash), false, '26 characters must not verify');
});

test('verifyPasswordHash rejects malformed stored hashes', async () => {
  const good = await createPasswordHash(MIN_PASSWORD);
  const [, , salt, digest] = good.split('$');
  const malformed = [
    '',
    'not-a-hash',
    `bcrypt$210000$${salt}$${digest}`,        // wrong algorithm
    `pbkdf2$99999$${salt}$${digest}`,         // iterations below the floor
    `pbkdf2$1000001$${salt}$${digest}`,       // iterations above the ceiling
    `pbkdf2$abc$${salt}$${digest}`,           // non-numeric iterations
    `pbkdf2$210000$$${digest}`,               // missing salt
    `pbkdf2$210000$${salt}$`,                 // missing digest
    `pbkdf2$210000$${salt}$${digest}$extra`,  // extra field
    `pbkdf2$210000$!!!invalid!!!$${digest}`   // undecodable salt
  ];
  for (const encoded of malformed) {
    assert.equal(await verifyPasswordHash(MIN_PASSWORD, encoded), false, `must reject: ${encoded.slice(0, 40)}`);
  }
  // Non-string candidates never throw and never verify.
  assert.equal(await verifyPasswordHash(undefined, good), false);
  assert.equal(await verifyPasswordHash(null, good), false);
  assert.equal(await verifyPasswordHash(12345678, good), false);
});

test('constantEqual compares without early exit semantics', () => {
  assert.equal(constantEqual('abc', 'abc'), true);
  assert.equal(constantEqual('', ''), true);
  assert.equal(constantEqual('abc', 'abd'), false, 'same length, different content');
  assert.equal(constantEqual('abc', 'abcd'), false, 'different lengths');
  assert.equal(constantEqual('abcd', 'abc'), false, 'different lengths, reversed');
  assert.equal(constantEqual('', 'a'), false);
});

test('client registration enforces the same character classes as the owner', async () => {
  // Client passwords used to be length-only. They must now also carry one
  // lowercase letter, one uppercase letter, one number and one symbol, in
  // both runtimes' registerProblem().
  for (const relative of ['cloudflare/src/index.js', 'vercel/api/index.js']) {
    const source = await readFile(new URL(`../public/_scaffold/templates/${relative}`, import.meta.url), 'utf8');
    const body = source.slice(source.indexOf('function registerProblem'));
    const fn = body.slice(0, body.indexOf('\n}\n') + 3);
    for (const pattern of [/\[a-z\]/, /\[A-Z\]/, /\[0-9\]/, /\[\^A-Za-z0-9\\s\]/]) {
      assert.match(fn, pattern, `${relative}: registerProblem must test ${pattern}`);
    }
    assert.match(fn, /one lowercase letter, one uppercase letter, one number and one symbol/,
      `${relative}: registerProblem must explain the class rule`);
  }
});

test('every password verifier in the shipped runtimes is constant-time', async () => {
  const [cloudflare, vercel] = await Promise.all([
    readFile(new URL('../public/_scaffold/templates/cloudflare/src/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/_scaffold/templates/vercel/api/index.js', import.meta.url), 'utf8')
  ]);

  for (const [name, source] of [['cloudflare', cloudflare], ['vercel', vercel]]) {
    // The dummy hash exists and the client login route verifies against it
    // when the email is unknown (anti-enumeration timing equalisation).
    assert.match(source, /const DUMMY_PASSWORD_HASH = `pbkdf2\$/, `${name}: DUMMY_PASSWORD_HASH must be defined`);
    assert.match(source, /passwordMatches\(password, \w+\[0\]\?\.passwordHash \|\| DUMMY_PASSWORD_HASH\)/,
      `${name}: client login must verify against the dummy hash for unknown emails`);

    // passwordMatches always derives before it decides: the derivation call
    // must appear before the return, with dummy fallbacks for malformed input.
    const body = source.slice(source.indexOf('async function passwordMatches'));
    const fn = body.slice(0, body.indexOf('\n}\n') + 3);
    assert.match(fn, /hashWellFormed \? salt : 'AAAAAAAAAAAAAAAAAAAAAA'/, `${name}: dummy salt fallback missing`);
    assert.match(fn, /return hashWellFormed &&/, `${name}: result must be gated on well-formedness after deriving`);
    assert.doesNotMatch(fn, /if \(algorithm !== 'pbkdf2'[^)]*\) return false;/, `${name}: verifier must not early-return before deriving`);
  }

  const cfBody = cloudflare.slice(cloudflare.indexOf('async function passwordMatches'));
  const cfFn = cfBody.slice(0, cfBody.indexOf('\n}\n') + 3);
  assert.match(cfFn, /constantEqual\(digest, expected\)/, 'cloudflare: digest comparison must use constantEqual');
  assert.doesNotMatch(cfFn, /digest ===|=== expected/, 'cloudflare: digest must never be compared with ===');

  const vcBody = vercel.slice(vercel.indexOf('async function passwordMatches'));
  const vcFn = vcBody.slice(0, vcBody.indexOf('\n}\n') + 3);
  assert.match(vcFn, /timingSafeEqual\(actual, expected\)/, 'vercel: digest comparison must use timingSafeEqual');
  assert.doesNotMatch(vcFn, /actual\.equals\(|actual === expected/, 'vercel: digest must never be compared non-constantly');
});
