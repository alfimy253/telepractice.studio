// Shared browser request flow for the Generate buttons. The fetcher argument
// keeps the same client logic testable without a browser or hosted deployment.
// When the JSON body of a failure has no `error` (Cloudflare's CPU-limit kills
// answer with a plain-text "error code: 1102" page), the raw body becomes the
// message so the toast shows the actual error string.
async function failureMessage(response, fallback) {
  const raw = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.error === 'string' && parsed.error) return parsed.error;
  } catch (_) { /* plain-text error body (edge 503 pages, empty bodies) */ }
  return raw.trim().slice(0, 240) || fallback;
}
export async function requestGeneratedPackage(target, payload, displayName, fetcher = globalThis.fetch) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const csrfResponse = await fetcher('/api/csrf', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }
    });
    if (!csrfResponse.ok) {
      const message = await failureMessage(csrfResponse, 'Could not initialize the secure build session.');
      throw new Error(`${message} (/api/csrf → ${csrfResponse.status})`);
    }
    const csrf = await csrfResponse.json().catch(() => ({}));
    if (typeof csrf.token !== 'string' || !csrf.token) {
      throw new Error('The secure build session returned no token. (/api/csrf)');
    }
    const response = await fetcher('/api/generate', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/zip', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.token },
      body: JSON.stringify({ ...payload, target })
    });
    // A newly issued token is normally enough. Retry once with a second fresh
    // token if a reverse proxy or an expired browser cookie drops the first.
    if (response.status === 403) {
      try { await response.body?.cancel(); } catch (_) { /* retry or report the refusal */ }
      if (attempt === 0) continue;
      throw new Error('The secure build session was refused twice. Refresh the page and retry. (/api/generate → 403)');
    }
    if (!response.ok) {
      const message = await failureMessage(response, `The ${displayName} code package could not be generated.`);
      throw new Error(`${message} (/api/generate → ${response.status})`);
    }
    return response;
  }
  throw new Error('The secure build session was refused twice. Refresh the page and retry. (/api/generate → 403)');
}
