const ADMIN_PASSWORD_ITERATIONS = 210000;
const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(value || ''))) throw new Error('Invalid base64url value.');
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantEqual(left, right) {
  const a = encoder.encode(String(left || ''));
  const b = encoder.encode(String(right || ''));
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

async function passwordDigest(password, salt, iterations = ADMIN_PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: decodeBase64url(salt),
    iterations,
    hash: 'SHA-256'
  }, key, 256);
  return base64url(new Uint8Array(derived));
}

async function createPasswordHash(password) {
  const salt = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const digest = await passwordDigest(String(password), salt);
  return `pbkdf2$${ADMIN_PASSWORD_ITERATIONS}$${salt}$${digest}`;
}

async function verifyPasswordHash(password, encoded) {
  const [algorithm, roundsText, salt, expected, ...rest] = String(encoded || '').split('$');
  const rounds = Number(roundsText);
  if (algorithm !== 'pbkdf2' || rest.length || !salt || !expected
    || !Number.isInteger(rounds) || rounds < 100000 || rounds > 1000000
    || typeof password !== 'string' || password.length > 128) return false;
  try {
    return constantEqual(await passwordDigest(password, salt, rounds), expected);
  } catch (_) {
    return false;
  }
}

function normalizedUsername(username) {
  return String(username || '').trim().toLowerCase();
}

async function credentialTag(username, passwordHash, secret) {
  const identity = normalizedUsername(username);
  return base64url(await hmac(`owner-credential:v1:${identity}:${passwordHash}`, secret));
}

async function createAdminSession(username, passwordHash, secret, now = Date.now()) {
  if (!username || !passwordHash || !secret) throw new Error('Owner session configuration is incomplete.');
  const identity = normalizedUsername(username);
  const payload = base64url(encoder.encode(JSON.stringify({
    sub: identity,
    exp: Math.floor(now / 1000) + ADMIN_SESSION_TTL_SECONDS,
    tag: await credentialTag(identity, passwordHash, secret)
  })));
  const signature = base64url(await hmac(`owner-session:v1:${payload}`, secret));
  return `${payload}.${signature}`;
}

async function verifyAdminSession(token, username, passwordHash, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 2048 || !username || !passwordHash || !secret) return false;
  const [payload, signature, ...rest] = token.split('.');
  if (!payload || !signature || rest.length) return false;
  try {
    const expectedSignature = base64url(await hmac(`owner-session:v1:${payload}`, secret));
    if (!constantEqual(signature, expectedSignature)) return false;
    const claims = JSON.parse(decoder.decode(decodeBase64url(payload)));
    if (claims?.sub !== normalizedUsername(username)
      || !Number.isInteger(claims.exp)
      || claims.exp <= Math.floor(now / 1000)) return false;
    const expectedTag = await credentialTag(username, passwordHash, secret);
    return constantEqual(claims.tag, expectedTag);
  } catch (_) {
    return false;
  }
}

export {
  ADMIN_PASSWORD_ITERATIONS,
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSession,
  createPasswordHash,
  verifyAdminSession,
  verifyPasswordHash
};
