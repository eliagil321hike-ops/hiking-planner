// The browser rules (site/osm-build.js) must give exactly what the build-time extract (scripts/
// fetch_osm_hiking.py) gives, so Israel (pre-built) and areas abroad (loaded on demand) look the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { build } from '../site/osm-build.js';

const FIXTURE = new URL('./fixtures/overpass-sample.json', import.meta.url);

test('browser and build-time OSM rules produce identical features', () => {
  const py = JSON.parse(execFileSync('python3', ['-c', `
import json, sys; sys.path.insert(0, 'scripts')
import fetch_osm_hiking as f
t, p, _ = f.build(json.load(open(${JSON.stringify(FIXTURE.pathname)}, encoding='utf-8')))
print(json.dumps({'trails': t, 'pois': p}, ensure_ascii=False))`], { encoding: 'utf8' }));
  const js = build(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  assert.ok(js.trails.length > 0 && js.pois.length > 0);
  assert.deepEqual(JSON.parse(JSON.stringify(js)), py);
});
