import { neon } from '@neondatabase/serverless';

const SUPPORTED_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const RUNTIME_OPTIONS = new Set(['sslmode', 'channel_binding']);

function decodeHtmlEscapedUrl(value) {
  let decoded = String(value ?? '').trim();
  // URLs copied from HTML can contain one or more escaped ampersands.
  for (let pass = 0; pass < 3; pass += 1) {
    const next = decoded.replace(/&amp;/gi, '&');
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

/**
 * Normalize a Neon URL for the serverless HTTP driver.
 *
 * The driver makes secure HTTPS requests, so connection-string SSL mode and
 * channel-binding flags are not needed. Removing them also lets the runtime
 * accept a URL copied from Neon with HTML escaping still present.
 */
export function normalizeDatabaseUrl(value) {
  const raw = decodeHtmlEscapedUrl(value);
  if (!raw) return '';

  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }

  if (!SUPPORTED_PROTOCOLS.has(url.protocol) || !url.hostname || !url.pathname || url.pathname === '/') {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }

  for (const key of [...url.searchParams.keys()]) {
    if (RUNTIME_OPTIONS.has(key.toLowerCase())) url.searchParams.delete(key);
  }

  return url.toString();
}

export function createNeonClient(value) {
  const connectionUrl = normalizeDatabaseUrl(value);
  if (!connectionUrl) throw new Error('Database is not configured. Set DATABASE_URL.');
  return neon(connectionUrl);
}
