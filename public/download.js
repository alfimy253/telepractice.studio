// Shared browser request flow for the Generate buttons. The fetcher argument
// keeps the same client logic testable without a browser or hosted deployment.
export async function requestGeneratedPackage(target, payload, displayName, fetcher = globalThis.fetch) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const csrfResponse = await fetcher('/api/csrf', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }
    });
    if (!csrfResponse.ok) {
      const error = await csrfResponse.json().catch(() => ({}));
      throw new Error(`${error.error || 'Could not initialize the secure build session.'} (/api/csrf → ${csrfResponse.status})`);
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
      const error = await response.json().catch(() => ({}));
      throw new Error(`${error.error || `The ${displayName} code package could not be generated.`} (/api/generate → ${response.status})`);
    }
    return response;
  }
  throw new Error('The secure build session was refused twice. Refresh the page and retry. (/api/generate → 403)');
}
