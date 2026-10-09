import { neon } from '@neondatabase/serverless';

const SUPPORTED_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const RUNTIME_OPTIONS = new Set(['sslmode', 'channel_binding']);

export function normalizeDatabaseUrl(value) {
  let raw = String(value ?? '').trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const next = raw.replace(/&amp;/gi, '&');
    if (next === raw) break;
    raw = next;
  }
  if (!raw) throw new Error('Database is not configured. Set DATABASE_URL.');

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
  return neon(normalizeDatabaseUrl(value));
}
