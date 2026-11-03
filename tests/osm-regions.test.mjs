// Pre-built regions (D-061): each country is extracted to its own files, then merged into cells; the index says
// which on-demand cells lie fully inside a region's border (those are never asked from Overpass).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXTURE = new URL('./fixtures/overpass-sample.json', import.meta.url).pathname;
const py = (code) => JSON.parse(execFileSync('python3', ['-c', `import json, sys; sys.path.insert(0, 'scripts')\nimport fetch_osm_hiking as f\n${code}`], { encoding: 'utf8' }));
const run = (...args) => execFileSync('python3', ['scripts/fetch_osm_hiking.py', ...args], { encoding: 'utf8' });
const count = (cov) => Object.values(cov).flat().reduce((n, [a, b]) => n + b - a + 1, 0);

test('covered cells: whole cells inside the outline; holes and border cells excluded', () => {
  const r = py(`print(json.dumps({
    'box': f.covered_cells(f.box_rings(f.BBOX)),
    'sq': f.covered_cells([[(0, 0), (2, 0), (2, 1), (0, 1)]]),
    'hole': f.covered_cells([[(0, 0), (2, 0), (2, 1), (0, 1)], [(0.6, 0.3), (1.4, 0.3), (1.4, 0.7), (0.6, 0.7)]]),
  }))`);
  assert.equal(count(r.box), 90, 'Israel box: same 90 cells as the old box rule');
  assert.equal(count(r.sq), 31, '2°×1° square = 32 cells, minus the one holding an outline vertex');
  assert.equal(count(r.hole), 23, 'the 8 cells touching the hole are not covered');
  assert.deepEqual(r.hole['1'], [[0, 1], [6, 7]]);
});

test('regions are extracted separately and merged; index lists regions, covered cells and trail ids', () => {
  const out = mkdtempSync(join(tmpdir(), 'osmreg-'));
  const polys = join(out, 'polys'); mkdirSync(polys);
  // Norway stand-in: the same fixture shifted far away; its outline is a box around it
  const fx = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const shift = (o) => { if (o && typeof o === 'object') { if ('lat' in o) { o.lat += 30; o.lon -= 25; } Object.values(o).forEach(shift); } };
  shift(fx); fx.elements.forEach((e) => { e.id += 100000; });
  writeFileSync(join(out, 'no.json'), JSON.stringify(fx));
  writeFileSync(join(polys, 'norway.poly'), 'norway\n1\n   9.0 62.5\n   11.5 62.5\n   11.5 64.5\n   9.0 64.5\nEND\nEND\n');
  run(out, '--region', 'israel', '--from', FIXTURE, '--no-split');
  run(out, '--region', 'norway', '--from', join(out, 'no.json'), '--no-split');
  assert.ok(existsSync(join(out, 'osm-trails.geojson')) && existsSync(join(out, 'osm-trails-norway.geojson')));
  assert.ok(!existsSync(join(out, 'osm', 'index.json')), '--no-split writes no cells');
  const log = run(out, '--split-only', '--poly-dir', polys);
  assert.match(log, /region israel: .* outline box/);
  assert.match(log, /region norway: .* outline yes/);
  const index = JSON.parse(readFileSync(join(out, 'osm', 'index.json'), 'utf8'));
  assert.deepEqual(index.regions.map((r) => r.name), ['israel', 'norway']);
  assert.equal(index.dcell, 0.25);
  assert.equal(count(index.covered), 90 + 10 * 8 - 1, 'Israel box cells + Norway 2.5°×2° box (10 × 8 cells, minus the corner cell holding an outline vertex)');
  const cellFiles = Object.keys(index.cells);
  assert.ok(cellFiles.some((k) => Number(k.split('_')[0]) > 120), 'Norway cells written');
  const one = JSON.parse(readFileSync(join(out, 'osm', `${cellFiles[0]}.json`), 'utf8'));
  const withTrails = cellFiles.map((k) => JSON.parse(readFileSync(join(out, 'osm', `${k}.json`), 'utf8'))).find((c) => c.trails.length);
  assert.ok(one && withTrails.trails.every((t) => Number.isInteger(t.id)), 'trail features keep their relation id');
});

test('a region without a source keeps its previous files; Israel alone falls back to Overpass', () => {
  const out = mkdtempSync(join(tmpdir(), 'osmreg2-'));
  const prev = join(out, 'prev'); mkdirSync(prev);
  writeFileSync(join(prev, 'osm-trails-georgia.geojson'), JSON.stringify({ type: 'FeatureCollection', osm_base: 'X', extract_version: 4, features: [] }));
  writeFileSync(join(prev, 'osm-pois-georgia.geojson'), JSON.stringify({ type: 'FeatureCollection', osm_base: 'X', extract_version: 4, features: [] }));
  const log = run(join(out, 'o'), '--region', 'georgia', '--opl', '/nonexistent.opl', '--previous', prev, '--soft', '--no-split');
  assert.match(log, /georgia: OSM extract failed/);
  assert.match(log, /georgia: kept previous osm-trails-georgia.geojson/);
  assert.doesNotMatch(log, /Overpass/i, 'no Overpass attempt for a non-Israel region');
});
