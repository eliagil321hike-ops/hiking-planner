// Unit tests for site/router.js with a fake fetch (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrsRouter, RoutingError } from '../site/router.js';

const ok = (coords) => ({ ok: true, status: 200, json: async () => ({ type: 'FeatureCollection', features: [{ geometry: { type: 'LineString', coordinates: coords } }] }) });
const fail = (status, error) => ({ ok: false, status, json: async () => ({ error }) });

test('request: foot-hiking GET, key encoded, start/end as lon,lat', async () => {
  let url;
  const r = createOrsRouter({ key: 'k+/=', minIntervalMs: 0, fetchImpl: async (u) => { url = u; return ok([[35.4, 33.0, 900], [35.41, 33.01]]); } });
  const g = await r.route([35.4, 33.0], [35.41, 33.01]);
  assert.match(url, /\/v2\/directions\/foot-hiking\?api_key=k%2B%2F%3D&start=35\.4,33&end=35\.41,33\.01$/);
  assert.deepEqual(g, [[35.4, 33.0], [35.41, 33.01]], '[lon, lat] kept, elevation dropped');
});

test('errors map to codes; nothing is turned into a straight line', async () => {
  const cases = [[404, { code: 2010, message: 'no routable point' }, 'NO_PATH'], [401, 'bad key', 'AUTH'], [403, 'quota', 'AUTH'],
    [429, 'Rate limit exceeded', 'RATE_LIMITED'], [500, 'oops', 'SERVER']];
  for (const [status, err, code] of cases) {
    const r = createOrsRouter({ key: 'k', minIntervalMs: 0, fetchImpl: async () => fail(status, err) });
    await assert.rejects(r.route([35, 33], [35.1, 33.1]), (e) => e instanceof RoutingError && e.code === code, `HTTP ${status}`);
  }
  const net = createOrsRouter({ key: 'k', minIntervalMs: 0, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(net.route([35, 33], [35.1, 33.1]), (e) => e.code === 'NETWORK');
  const empty = createOrsRouter({ key: 'k', minIntervalMs: 0, fetchImpl: async () => ok([]) });
  await assert.rejects(empty.route([35, 33], [35.1, 33.1]), (e) => e.code === 'NO_PATH');
});

test('requests are queued and spaced (stays under 40/minute)', async () => {
  const times = [];
  const r = createOrsRouter({ key: 'k', minIntervalMs: 120, fetchImpl: async () => { times.push(Date.now()); return ok([[0, 0], [1, 1]]); } });
  await Promise.all([1, 2, 3].map(() => r.route([0, 0], [1, 1])));
  assert.equal(times.length, 3);
  assert.ok(times[1] - times[0] >= 110 && times[2] - times[1] >= 110, `gaps ${times[1] - times[0]}, ${times[2] - times[1]}`);
});

test('a failed request does not block the queue', async () => {
  let n = 0;
  const r = createOrsRouter({ key: 'k', minIntervalMs: 0, fetchImpl: async () => (++n === 1 ? fail(404, 'x') : ok([[0, 0], [1, 1]])) });
  await assert.rejects(r.route([0, 0], [1, 1]));
  assert.deepEqual(await r.route([0, 0], [1, 1]), [[0, 0], [1, 1]]);
});

test('missing key is an error at setup', () => {
  assert.throws(() => createOrsRouter({}), /missing key/);
});
