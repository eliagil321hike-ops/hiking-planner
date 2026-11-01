// Routing provider (SPEC §6.2 RoutingProvider, Phase 3B): openrouteservice, profile foot-hiking (D-026).
// Request: GET /v2/directions/{profile}?api_key=…&start=lon,lat&end=lon,lat → GeoJSON (ORS API spec; profile
// list includes foot-hiking). A GET with query parameters needs no CORS preflight.
// Free Standard plan: 2,000 directions/day, 40/minute (openrouteservice.org/plans, checked 2026-11-01) →
// requests are queued and spaced ≥ 1.6 s apart, so editing can never exceed the per-minute limit.
// Errors become codes the UI can explain; a failed segment is never turned into a straight line here.

export class RoutingError extends Error {
  constructor(code, message) { super(message); this.name = 'RoutingError'; this.code = code; }
}

export function createOrsRouter({ key, profile = 'foot-hiking', base = 'https://api.openrouteservice.org', minIntervalMs = 1600, timeoutMs = 20_000, fetchImpl = fetch } = {}) {
  if (!key) throw new Error('openrouteservice: missing key');
  let chain = Promise.resolve();
  let last = 0;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function request(from, to) {
    const url = `${base}/v2/directions/${profile}?api_key=${encodeURIComponent(key)}`
      + `&start=${from[0]},${from[1]}&end=${to[0]},${to[1]}`;          // [lon, lat] → "lon,lat"
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res, body;
    try {
      res = await fetchImpl(url, { signal: ctl.signal, headers: { Accept: 'application/geo+json, application/json' } });
      body = await res.json().catch(() => null);
    } catch (e) {
      throw new RoutingError(e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', e.message);
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      const msg = body?.error?.message ?? body?.error ?? `HTTP ${res.status}`;
      const code = res.status === 429 ? 'RATE_LIMITED'
        : res.status === 401 || res.status === 403 ? 'AUTH'
        : res.status === 404 || res.status === 400 ? 'NO_PATH'
        : 'SERVER';
      throw new RoutingError(code, String(msg));
    }
    const coords = body?.features?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) throw new RoutingError('NO_PATH', 'empty route');
    return coords.map((c) => [c[0], c[1]]);                            // GeoJSON is already [lon, lat]
  }

  return {
    name: 'openrouteservice',
    profile,
    attribution: '© <a href="https://openrouteservice.org/">openrouteservice.org</a> by HeiGIT',
    /** Route between two [lon, lat] points; queued so requests are spaced out. */
    route(from, to) {
      const run = chain.then(async () => {
        const gap = last + minIntervalMs - Date.now();
        if (gap > 0) await wait(gap);
        last = Date.now();
        return request(from, to);
      });
      chain = run.catch(() => {});
      return run;
    },
  };
}
