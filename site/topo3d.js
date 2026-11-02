// Applies the Topo3D overlay (site/styles/topo3d.json) on top of the loaded OpenFreeMap base style.
// Base layers are found by schema (source-layer + filter), never by guessed layer ids.
// Returns a report of what was found/changed so the page can show it (runtime verification).

import { addPoiIcons } from './poi-icons.js';
import { createOsmLoader } from './osm-loader.js';
import { registerDeriveProtocol, deriveStats } from './terrain-derive.js';

const CLUSTERED = ['water', 'parking'];
// Campsites: own source, not grouped — from the 5 km scale, overlapping symbols hide each other (owner, D-047).
const OWN_SOURCE = ['camp', ...CLUSTERED];

export function applyTopo3d(map, overlay, { contourTiles, demMaxzoom }) {
  const style = map.getStyle();
  const report = { baseSource: null, labelFont: null, hidden: [], renamed: 0, added: [], warnings: [] };

  // 1. Base vector source (the OpenFreeMap one)
  const baseSource = Object.entries(style.sources).find(([, s]) => s.type === 'vector')?.[0];
  if (!baseSource) throw new Error('Base style has no vector source');
  report.baseSource = baseSource;

  // 2. A font that the base style's glyph server certainly has. Prefer an upright "Regular" font:
  //    the first symbol layer in Liberty uses "Noto Sans Italic" (owner run 2026-11-01).
  const fonts = style.layers
    .filter((l) => l.type === 'symbol' && Array.isArray(l.layout?.['text-font']))
    .map((l) => l.layout['text-font']);
  const labelFont =
    fonts.find((f) => f.some((n) => /regular/i.test(n))) ??
    fonts.find((f) => !f.some((n) => /italic/i.test(n))) ??
    fonts[0];
  if (!labelFont) report.warnings.push('No text-font found in base style; labels may not render');
  report.labelFont = labelFont;

  // 3. Hide base layers that Topo3D replaces (trails, peaks)
  const hideRules = Object.values(overlay.hideBaseLayers).filter((r) => typeof r === 'object' && r.sourceLayer);
  for (const l of style.layers) {
    const sl = l['source-layer'];
    for (const rule of hideRules) {
      if (sl !== rule.sourceLayer) continue;
      const f = JSON.stringify(l.filter ?? '');
      if (rule.filterMentionsAny && !rule.filterMentionsAny.some((w) => f.includes(`"${w}"`))) continue;
      map.setLayoutProperty(l.id, 'visibility', 'none');
      report.hidden.push(l.id);
    }
  }

  // 4. Hebrew-first names on base symbol layers that show a name (not road refs/shields)
  const nameExpr = overlay.nameExpr;
  for (const l of style.layers) {
    if (l.type !== 'symbol' || report.hidden.includes(l.id)) continue;
    const tf = l.layout?.['text-field'];
    if (!tf) continue;
    const s = JSON.stringify(tf);
    if (s.includes('name') && !s.includes('"ref"')) {
      map.setLayoutProperty(l.id, 'text-field', nameExpr);
      report.renamed++;
    }
  }

  // 5. Sources: two raster-dem sources with the same tiles (MapLibre recommends separate
  //    sources for terrain and hillshade), and the client-side contour source.
  const demSrc = (extra) => ({
    type: 'raster-dem',
    tiles: [overlay.dem.tiles],
    encoding: overlay.dem.encoding,   // explicit (SPEC §14 pitfall 2)
    tileSize: overlay.dem.tileSize,   // explicit (P10.3)
    maxzoom: demMaxzoom,
    ...extra,
  });
  map.addSource('dem-terrain', demSrc({ attribution: overlay.dem.attribution }));
  map.addSource('dem-hillshade', demSrc({}));
  map.addSource('contours', { type: 'vector', tiles: [contourTiles], maxzoom: 15 });
  // Slope angle / aspect, computed in the browser from the same DEM tiles (D-038).
  if (!map.__deriveRegistered && globalThis.maplibregl) { registerDeriveProtocol(globalThis.maplibregl, overlay.dem.tiles, overlay.dem.tileSize); map.__deriveRegistered = true; }
  report.derive = deriveStats;
  for (const kind of ['slope', 'aspect']) {
    map.addSource(`derive-${kind}`, { type: 'raster', tiles: [`derive://${kind}/{z}/{x}/{y}`], tileSize: overlay.dem.tileSize, minzoom: 8, maxzoom: demMaxzoom });
  }
  // Build-time OSM extract (D-032): national/regional hiking routes + campsites/taps. Start empty, fill
  // when the files arrive; a missing file (e.g. the extract failed at deploy) just leaves the layers empty.
  const empty = { type: 'FeatureCollection', features: [] };
  const osm = overlay.osmExtract;
  map.addSource('osm-trails', { type: 'geojson', data: empty, attribution: osm.attribution });
  // Points of interest: one source per category (D-036, D-047). Water and parking are clustered at
  // distant zooms (a cluster shows the category icon + a count, and splits as you zoom in); springs,
  // viewpoints and shelters share one unclustered source.
  for (const kind of CLUSTERED) {
    map.addSource(`poi-${kind}`, { type: 'geojson', data: empty, cluster: true, clusterMaxZoom: 13, clusterRadius: 36 });
  }
  map.addSource('poi-camp', { type: 'geojson', data: empty });
  map.addSource('poi-other', { type: 'geojson', data: empty });
  // Category search results (D-045): a snapshot of the view, at any zoom, grouped with a count.
  map.addSource('poi-search', { type: 'geojson', data: empty, cluster: true, clusterMaxZoom: 13, clusterRadius: 40 });
  // Data for what is on screen: Israel from the per-cell extract, elsewhere on demand (D-042).
  report.osm = { trails: null, pois: null };
  const loader = createOsmLoader(map, osm.loader, {
    onUpdate: ({ trails, pois }) => {
      map.getSource('osm-trails')?.setData({ type: 'FeatureCollection', features: trails });
      for (const kind of OWN_SOURCE) map.getSource(`poi-${kind}`)?.setData({ type: 'FeatureCollection', features: pois.filter((f) => f.properties.kind === kind) });
      map.getSource('poi-other')?.setData({ type: 'FeatureCollection', features: pois.filter((f) => !OWN_SOURCE.includes(f.properties.kind)) });
      report.osm.trails = trails.length;
      report.osm.pois = pois.length;
      report.osm.byKind = Object.fromEntries([...new Set(pois.map((f) => f.properties.kind))].map((k) => [k, pois.filter((f) => f.properties.kind === k).length]));
    },
  });
  report.osmLoader = loader.stats;
  Object.defineProperty(report, 'osmApi', { value: loader, enumerable: false });   // category search (search.js)
  loader.start();

  // 6. Layer order: landcover tint + hillshade go under roads/buildings (so roads stay crisp);
  //    contours and trails under the first base label; Topo3D labels on top of everything.
  const layersNow = map.getStyle().layers;
  const firstSymbol = layersNow.find((l) => l.type === 'symbol')?.id;
  const firstStructure = layersNow.find((l) => ['transportation', 'building'].includes(l['source-layer']))?.id ?? firstSymbol;
  const underStructure = new Set(['fill', 'hillshade', 'color-relief', 'raster']);
  const fill = (v) => {
    if (v === '$base') return baseSource;
    if (v === '$labelFont') return labelFont;
    if (v === '$nameExpr') return nameExpr;
    if (Array.isArray(v)) return v.map(fill);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
    return v;
  };
  report.icons = addPoiIcons(map); // tent / tap images must exist before the icon layer renders
  for (const raw of overlay.layers) {
    const { $comment, ...layer } = fill(raw); // eslint-disable-line no-unused-vars
    const onTop = overlay.symbolLayersOnTop.includes(layer.id);
    map.addLayer(layer, onTop ? undefined : underStructure.has(layer.type) ? firstStructure : firstSymbol);
    report.added.push(layer.id);
  }

  // 7. 3D terrain
  map.setTerrain({ source: 'dem-terrain', exaggeration: overlay.terrain.exaggeration });
  return report;
}

/** Count rendered features per Topo3D layer in the current view (runtime check that filters match data). */
export function layerFeatureCounts(map, ids) {
  const out = {};
  for (const id of ids) {
    if (!map.getLayer(id) || map.getLayer(id).type === 'hillshade') continue;
    out[id] = map.queryRenderedFeatures({ layers: [id] }).length;
  }
  return out;
}
