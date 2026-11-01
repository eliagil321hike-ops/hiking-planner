// Developer tools: the Phase 0 tests (encoding check, DEM zoom probe, FPS test, layer check, report and
// style export). Loaded only with ?dev=1 (app.js imports it dynamically). Text stays in English.

import { layerFeatureCounts } from './topo3d.js';
import { createDemSampler } from './dem-sampler.js';
import { checkReferenceElevations, EncodingCheckError, ISRAEL_REFERENCE_POINTS } from './vendor/geo/index.js';

export function initDevtools(ctx) {
  const { map, results, log, perf, sampler, DEM, demMaxzoom, samplingZoom, GROUPS, setGroup, vis, overlay, $ } = ctx;
  $('dev-section').hidden = false;
  $('fps').hidden = false;
  perf.liveMeter($('fps'));

  // ---------------------------------------------------------------- test: encoding (P10.5)
  const metresToDeg = (m, lat) => ({ dLat: m / 111_320, dLon: m / (111_320 * Math.cos((lat * Math.PI) / 180)) });

  async function measureReference(s, r) {
    if (r.mode === 'point') return s.elevationAt(r.point);
    // max within radius, on a 20 m grid
    const { dLat, dLon } = metresToDeg(r.searchRadiusM, r.point[1]);
    const step = 20 / r.searchRadiusM;
    const pts = [];
    for (let y = -1; y <= 1; y += step) for (let x = -1; x <= 1; x += step) {
      if (x * x + y * y <= 1) pts.push([r.point[0] + x * dLon, r.point[1] + y * dLat]);
    }
    const vals = (await s.elevations(pts)).filter((v) => v !== null);
    return vals.length ? Math.max(...vals) : null;
  }

  async function runReferenceCheck(s) {
    const measured = new Map();
    for (const r of ISRAEL_REFERENCE_POINTS) measured.set(r.name, await measureReference(s, r));
    const byPoint = new Map(ISRAEL_REFERENCE_POINTS.map((r) => [r.point, r.name]));
    return checkReferenceElevations(ISRAEL_REFERENCE_POINTS, (p) => measured.get(byPoint.get(p)));
  }

  $('t-encoding').addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    const report = { declared: DEM, zoom: samplingZoom, points: null, pass: false, negativeControl: null };
    try {
      // 1. Real tiles, declared encoding → must PASS
      try {
        const res = await runReferenceCheck(sampler);
        report.points = res.map(({ name, measured, min, max, pass }) => ({ name, measured, min, max, pass }));
        report.pass = true;
        log(`<span class="pass">ENCODING CHECK PASSED</span> (terrarium, z${samplingZoom}→12)\n` +
          res.map((r) => `  ✓ ${r.name}: ${r.measured.toFixed(1)} m (expected ${r.min}…${r.max})`).join('\n'));
      } catch (e) {
        if (!(e instanceof EncodingCheckError)) throw e;
        report.points = e.results.map(({ name, measured, min, max, pass }) => ({ name, measured, min, max, pass }));
        log(`<span class="fail">${e.message.replace(/\n/g, '<br>')}</span>`);
      }
      // 2. Negative control: same tiles, WRONG encoding → must FAIL, proving the test can fail
      const wrong = createDemSampler({ ...DEM, encoding: 'mapbox', zoom: samplingZoom, fallbackMinZoom: Math.min(12, samplingZoom) });
      try {
        await runReferenceCheck(wrong);
        report.negativeControl = 'NOT DETECTED';
        log('<span class="fail">NEGATIVE CONTROL FAILED: wrong encoding was not detected</span>');
      } catch (e) {
        if (!(e instanceof EncodingCheckError)) throw e;
        report.negativeControl = 'detected';
        log(`<span class="pass">negative control OK</span>: decoding as "mapbox" gives e.g. ${e.results[0].measured?.toFixed(0)} m → rejected`);
      }
      // 3. Engine check: what MapLibre itself renders at the Meron reference point (exaggeration 1)
      results.engineCheck = await engineElevationCheck(ISRAEL_REFERENCE_POINTS[0].point);
      log(`engine check (MapLibre terrain vs own decoder at ${ISRAEL_REFERENCE_POINTS[0].point}): ` +
        `engine ${fmtNum(results.engineCheck.engine)} m, own ${fmtNum(results.engineCheck.own)} m, Δ ${fmtNum(results.engineCheck.diff)} m`,
        results.engineCheck.diff !== null && Math.abs(results.engineCheck.diff) <= 20 ? 'pass' : 'fail');
    } catch (e) {
      log(`encoding test error: ${e.message}`, 'fail');
    } finally {
      results.encoding = report;
      ev.target.disabled = false;
    }
  });
  const fmtNum = (v) => (v === null || v === undefined ? '—' : v.toFixed(1));

  async function engineElevationCheck(p) {
    const before = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
    const hadTerrain = !!map.getTerrain();
    map.setTerrain({ source: 'dem-terrain', exaggeration: 1 });
    map.jumpTo({ center: p, zoom: 14, pitch: 0, bearing: 0 });
    await new Promise((r) => map.once('idle', r));
    const engine = map.queryTerrainElevation(p);
    const own = await sampler.elevationAt(p);
    map.setTerrain(hadTerrain ? { source: 'dem-terrain', exaggeration: ctx.state.exaggeration } : null);
    map.jumpTo(before);
    return { point: p, engine, own, diff: engine !== null && own !== null ? engine - own : null };
  }

  // ---------------------------------------------------------------- test: DEM max zoom over Israel
  $('t-probe').addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    const p = ISRAEL_REFERENCE_POINTS[0].point;
    const rows = [];
    const { tileForLonLat } = await import('./vendor/geo/index.js');
    for (let z = 10; z <= 17; z++) {
      const t = tileForLonLat(p, z);
      const url = DEM.urlTemplate.replace('{z}', z).replace('{x}', t.x).replace('{y}', t.y);
      let status;
      try { status = (await fetch(url, { cache: 'no-store' })).status; } catch { status = 'network error'; }
      rows.push({ z, status });
    }
    const okZ = rows.filter((r) => r.status === 200).map((r) => r.z);
    const maxOk = okZ.length ? Math.max(...okZ) : null;
    results.demZoomProbe = { point: p, rows, maxOk };
    log(`DEM tiles at Meron: ${rows.map((r) => `z${r.z}:${r.status}`).join(' ')}\n→ highest available z${maxOk}. ` +
      `Reload with <a href="?demz=${maxOk}${location.hash}">?demz=${maxOk}</a> to use it.`);
    ev.target.disabled = false;
  });

  // ---------------------------------------------------------------- test: FPS while rotating and tilting
  // Which GPU does the browser use? Software rendering (SwiftShader, "Basic Render Driver") explains very
  // low FPS and is fixed in browser settings, not in our code.
  function gpuInfo() {
    try {
      const gl = map.getCanvas().getContext('webgl2') || map.getCanvas().getContext('webgl');
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      const vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      const software = /swiftshader|basic render|llvmpipe|software/i.test(renderer);
      return { renderer, vendor, software, webgl2: !!map.getCanvas().getContext('webgl2'), pixelRatio: map.getPixelRatio() };
    } catch (e) { return { error: e.message }; }
  }

  const MERON_VIEW = { center: [35.4167, 33.0], zoom: 13.5, pitch: 60, bearing: -20 };
  const idle = () => new Promise((r) => map.once('idle', r));
  const orbit = (start) => (p) => map.jumpTo({ bearing: start.bearing + 360 * p, pitch: 52.5 + 12.5 * Math.sin(p * Math.PI * 4) });

  // Repeatable FPS test: always at the same Meron view; a warm-up orbit first (tiles load, not measured),
  // then one measured orbit per variant. Run 2 (owner, Intel HD 4400): all layers 8 fps, no contours 17,
  // no 3D terrain 58.5 → 3D terrain is the cost and contours drawn onto the terrain double it. These
  // variants measure the cheap savings: fewer pixels (pixel ratio 1), index contours only, no contour labels.
  const canSetPR = typeof map.setPixelRatio === 'function';
  const nativePR = map.getPixelRatio();
  $('t-perf').addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    const before = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
    const gpu = gpuInfo();
    log(`GPU: ${gpu.renderer ?? gpu.error} · WebGL2 ${gpu.webgl2} · pixelRatio ${gpu.pixelRatio?.toFixed(2)}`, gpu.software ? 'fail' : undefined);
    if (gpu.software) log('The browser is drawing WITHOUT the graphics card (software rendering). In Chrome: Settings → System → turn on "Use graphics acceleration when available", restart Chrome.', 'fail');
    if (!canSetPR) log('map.setPixelRatio is not available in this MapLibre version → pixel-ratio variants skipped (use ?pr=1 to test).');
    log('FPS test ≈ 70 s at Meron — do not touch the map…');
    map.jumpTo(MERON_VIEW);
    await idle();
    await perf.frameRun('warm-up (not counted)', 8_000, orbit(MERON_VIEW));
    await idle();
    const minor = ['topo-contours-minor'], labels = ['topo-contour-labels'];
    const pr = (v) => { if (canSetPR) map.setPixelRatio(v); };
    const reset = () => { pr(nativePR); vis([...GROUPS.contours], true); setGroup('terrain', true); };
    const variants = [
      ['all layers', () => reset()],
      [`all layers · pixelRatio 1`, () => { reset(); pr(1); }, canSetPR],
      [`pixelRatio 1 · index contours only (100 m)`, () => { reset(); pr(1); vis(minor, false); }, canSetPR],
      [`pixelRatio 1 · index contours, no contour labels`, () => { reset(); pr(1); vis(minor, false); vis(labels, false); }, canSetPR],
      ['no contours', () => { reset(); setGroup('contours', false); }],
      ['no 3D terrain (2D baseline)', () => { reset(); setGroup('terrain', false); }],
    ];
    const runs = [];
    for (const [name, apply, enabled = true] of variants) {
      if (!enabled) continue;
      apply();
      map.jumpTo(MERON_VIEW);
      await idle();
      const run = await perf.frameRun(`Meron z13.5 · ${name}`, 10_000, orbit(MERON_VIEW));
      runs.push(run);
      log(`${run.label}: avg ${run.avgFps} fps, slowest-5% ${run.p5Fps} fps, stutters(>50 ms) ${run.longFrames}`,
        run.avgFps >= 30 ? 'pass' : 'fail');
    }
    pr(nativePR);
    setGroup('terrain', true);
    document.querySelectorAll('input[data-group]').forEach((cb) => setGroup(cb.dataset.group, cb.checked));
    ctx.applyBackground(); // keep satellite mode consistent after the test restored the layers
    results.perfTest = { gpu, runs };
    map.jumpTo(before);
    ev.target.disabled = false;
  });

  // ---------------------------------------------------------------- test: do the Topo3D layers find data?
  // Always measured at the same Meron view (flat, z13.5) so results are comparable.
  $('t-features').addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    const before = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
    map.jumpTo({ ...MERON_VIEW, pitch: 0, bearing: 0 });
    await idle();
    results.features = { at: MERON_VIEW.center, zoom: MERON_VIEW.zoom, counts: layerFeatureCounts(map, results.topo?.added ?? []) };
    log(`features at Meron (z${MERON_VIEW.zoom}):\n` +
      Object.entries(results.features.counts).map(([k, v]) => `  ${v > 0 ? '✓' : '·'} ${k}: ${v}`).join('\n'));
    map.jumpTo(before);
    ev.target.disabled = false;
  });

  // ---------------------------------------------------------------- export
  function fullReport() {
    return { ...perf.report(), build: ctx.BUILD, demMaxzoom, samplingZoom, overlayVersion: overlay.version, camera: location.hash, ...results, timingsText: undefined };
  }
  $('t-copy').addEventListener('click', async () => {
    const json = JSON.stringify(fullReport(), null, 2);
    try { await navigator.clipboard.writeText(json); log('results copied to clipboard'); }
    catch { download('phase0-results.json', json); log('clipboard unavailable — downloaded phase0-results.json'); }
  });
  $('t-style').addEventListener('click', () => {
    download('topo3d-merged-style.json', JSON.stringify(map.getStyle(), null, 2));
    log('downloaded topo3d-merged-style.json (contour source uses the maplibre-contour protocol)');
  });
  function download(name, text) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Startup report (the map may already be idle when this module loads)
  const startup = () => {
    results.gpu = gpuInfo();
    const t = perf.report().timings;
    if (t['first-idle']) log(`cold start → first full map: ${Math.round(t['first-idle'] - t['script-start'])} ms`);
    if (results.topo) {
      log(`DEM maxzoom ${demMaxzoom} · base source "${results.topo.baseSource}" · hidden base layers: ${results.topo.hidden.join(', ') || 'none'} · names switched to Hebrew-first: ${results.topo.renamed}`);
      if (results.topo.hidden.length === 0) log('WARNING: no base trail/peak layers were matched — check base style', 'fail');
    }
  };
  // Run once the Topo3D overlay is applied (not on 'idle': a busy map may take long to become idle).
  const iv = setInterval(() => { if (results.topo) { clearInterval(iv); startup(); } }, 200);
}
