// Perf review 2026-11-03: the DEM tile cache is bounded, and a failed download is not remembered for good.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemSampler } from '../site/dem-sampler.js';

const opts = { urlTemplate: 'https://dem.test/{z}/{x}/{y}.webp', encoding: 'terrarium', tileSize: 512, zoom: 12 };

test('the tile cache never holds more than maxTiles entries', async () => {
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(url); return { status: 404, ok: false }; };   // "no data": cached as null
  const s = createDemSampler({ ...opts, maxTiles: 5 });
  for (let i = 0; i < 20; i++) await s.elevationAt([35 + i * 0.2, 33]);
  assert.ok(s.cacheSize() <= 5, `cache size ${s.cacheSize()}`);
  const n = calls.length;
  await s.elevationAt([35 + 19 * 0.2, 33]);   // most recent tile: still cached, no new request
  assert.equal(calls.length, n);
});

test('a failed download is retried on the next request', async () => {
  let fail = true, calls = 0;
  globalThis.fetch = async () => { calls++; if (fail) throw new Error('network down'); return { status: 404, ok: false }; };
  const s = createDemSampler(opts);
  await assert.rejects(s.elevationAt([35.4, 33]));
  await new Promise((r) => setTimeout(r, 0));   // let the cache drop the failed job
  fail = false;
  assert.equal(await s.elevationAt([35.4, 33]), null);   // asked again, and answered this time
  assert.equal(calls, 2);
});
