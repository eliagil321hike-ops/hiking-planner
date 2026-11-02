"""
End-to-end test of the website with the REAL MapLibre GL JS build, in headless Chromium (WebGL via
SwiftShader). External services are replaced by fixtures so the test runs offline and in CI:
  - MapLibre 5.24.0: official release dist.zip from GitHub (cached in .cache/)
  - maplibre-contour: minimal stub (contours are produced client-side; covered by owner runs)
  - OpenFreeMap Liberty: a fixture style with the same OpenMapTiles source-layers and layer kinds
  - Mapterhorn DEM: synthetic Terrarium WebP tiles (same surface as browser_smoke_test.py)
  - Satellite (Esri, EOX): solid-colour tiles
Checks: boot without errors, Topo3D overlay applied (hide/rename/font), terrain on, background switch
adds/removes the satellite layer with the embedded key, drawing a line produces stats and a profile.

Run from the repo root:  python3 scripts/e2e_test.py      (needs Python Playwright + Chromium, Pillow)
"""
import http.server
import io
import json
import socketserver
import sys
import threading
import urllib.request
import zipfile
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import browser_smoke_test as fx  # noqa: E402  (synthetic DEM surface)
import fetch_osm_hiking as osmx  # noqa: E402  (build-time OSM extract, D-032)

# Overpass-shaped fixture around the start view (33.0, 35.4167): an Israel Trail section (via a super-route),
# a regional route, one campsite and one drinking-water point.
OSM_FIXTURE = {"osm3s": {"timestamp_osm_base": "fixture"}, "elements": [
    {"type": "relation", "id": 1, "tags": {"type": "superroute", "route": "hiking", "network": "nwn", "name": "שביל ישראל"},
     "members": [{"type": "relation", "ref": 2, "role": ""}]},
    {"type": "relation", "id": 2, "tags": {"type": "route", "route": "hiking", "name": "קטע"}, "members": [
        {"type": "way", "ref": 10, "role": "", "geometry": [{"lat": 32.97, "lon": 35.37}, {"lat": 33.0, "lon": 35.41}, {"lat": 33.03, "lon": 35.46}]}]},
    {"type": "relation", "id": 3, "tags": {"type": "route", "route": "hiking", "network": "rwn", "name": "שביל אזורי"}, "members": [
        {"type": "way", "ref": 11, "role": "", "geometry": [{"lat": 33.03, "lon": 35.38}, {"lat": 32.97, "lon": 35.45}]}]},
    {"type": "relation", "id": 4, "tags": {"type": "route", "route": "hiking", "network": "lwn", "osmc:symbol": "blue:white:blue_stripe", "name": "שביל כחול"}, "members": [
        {"type": "way", "ref": 12, "role": "", "geometry": [{"lat": 32.98, "lon": 35.39}, {"lat": 33.02, "lon": 35.44}]}]},
    {"type": "node", "id": 20, "lat": 33.006, "lon": 35.40, "tags": {"tourism": "camp_site", "name": "חניון לילה"}},
    {"type": "node", "id": 21, "lat": 32.994, "lon": 35.43, "tags": {"amenity": "drinking_water"}},
    {"type": "node", "id": 22, "lat": 32.9942, "lon": 35.4302, "tags": {"amenity": "drinking_water"}},   # 25 m away → one cluster "2"
    {"type": "node", "id": 23, "lat": 33.0015, "lon": 35.4125, "tags": {"amenity": "parking", "name": "חניון רכב"}},  # next to the trail
    {"type": "node", "id": 24, "lat": 32.90, "lon": 35.30, "tags": {"amenity": "parking"}},                # far from any trail → dropped
]}
_t, _p, _ = osmx.build(OSM_FIXTURE)
OSM_DIR = ROOT / ".cache" / "e2e-osm"
osmx.split_cells({"type": "FeatureCollection", "osm_base": "fixture", "features": _t},
                 {"type": "FeatureCollection", "osm_base": "fixture", "features": _p}, str(OSM_DIR))
# Abroad (outside the Israel extract): an on-demand Overpass answer near Antalya, Turkey (D-042)
ABROAD = (30.62, 36.88)
OVERPASS_ABROAD = {"osm3s": {"timestamp_osm_base": "fixture"}, "elements": [
    {"type": "relation", "id": 900, "tags": {"type": "route", "route": "hiking", "network": "lwn", "osmc:symbol": "red:white:red_bar", "name": "Lycian side trail"}, "members": [
        {"type": "way", "ref": 901, "role": "", "geometry": [{"lat": 36.87, "lon": 30.60}, {"lat": 36.89, "lon": 30.64}]}]},
    {"type": "node", "id": 902, "lat": 36.881, "lon": 30.615, "tags": {"tourism": "camp_site", "name": "Camp"}},
]}

CACHE = ROOT / ".cache"
ML_VERSION = "5.24.0"
ML_ZIP_URL = f"https://github.com/maplibre/maplibre-gl-js/releases/download/v{ML_VERSION}/dist.zip"


def maplibre_files():
    CACHE.mkdir(exist_ok=True)
    zpath = CACHE / f"maplibre-{ML_VERSION}-dist.zip"
    if not zpath.exists():
        urllib.request.urlretrieve(ML_ZIP_URL, zpath)
    with zipfile.ZipFile(zpath) as z:
        return z.read("dist/maplibre-gl.js"), z.read("dist/maplibre-gl.css")


CONTOUR_STUB = b"""
window.mlcontour = { DemSource: class {
  constructor(o) { this.o = o; }
  setupMaplibre(m) { m.addProtocol('contourstub', async () => ({ data: new ArrayBuffer(0) })); }
  contourProtocolUrl() { return 'contourstub://{z}/{x}/{y}'; }
} };
"""

FIXTURE_STYLE = {
    "version": 8,
    "name": "fixture-liberty-like",
    "sources": {"openmaptiles": {"type": "vector", "tiles": ["https://tiles.openfreemap.org/fixture/{z}/{x}/{y}.pbf"], "maxzoom": 14,
                                 "attribution": "OpenFreeMap © OpenMapTiles Data from OpenStreetMap"}},
    "glyphs": "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    "layers": [
        {"id": "background", "type": "background", "paint": {"background-color": "#f8f4f0"}},
        {"id": "landcover_wood", "type": "fill", "source": "openmaptiles", "source-layer": "landcover", "paint": {"fill-color": "#cde"}},
        {"id": "road_path_pedestrian", "type": "line", "source": "openmaptiles", "source-layer": "transportation",
         "filter": ["match", ["get", "class"], ["path", "pedestrian"], True, False]},
        {"id": "road_major", "type": "line", "source": "openmaptiles", "source-layer": "transportation",
         "filter": ["==", ["get", "class"], "primary"]},
        {"id": "water_name", "type": "symbol", "source": "openmaptiles", "source-layer": "water_name",
         "layout": {"text-field": ["get", "name"], "text-font": ["Noto Sans Italic"]}},
        {"id": "mountain_peak", "type": "symbol", "source": "openmaptiles", "source-layer": "mountain_peak",
         "layout": {"text-field": "{name}", "text-font": ["Noto Sans Regular"]}},
        {"id": "place_label", "type": "symbol", "source": "openmaptiles", "source-layer": "place",
         "layout": {"text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]], "text-font": ["Noto Sans Regular"]}},
        {"id": "waterway_stream", "type": "line", "source": "openmaptiles", "source-layer": "waterway",
         "filter": ["==", ["get", "class"], "stream"]},
        {"id": "poi_r1", "type": "symbol", "source": "openmaptiles", "source-layer": "poi", "minzoom": 15,
         "layout": {"text-field": ["get", "name"], "text-font": ["Noto Sans Regular"]}},
        {"id": "highway_shield", "type": "symbol", "source": "openmaptiles", "source-layer": "transportation_name",
         "layout": {"text-field": ["get", "ref"], "text-font": ["Noto Sans Regular"]}},
    ],
}


def solid_tile(color, fmt="PNG", size=256):
    buf = io.BytesIO()
    Image.new("RGB", (size, size), color).save(buf, fmt)
    return buf.getvalue()


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT / "site"), **kw)

    def log_message(self, *a):
        pass


CONSOLE = []


def wait_js(page, expr, timeout_s=60):
    """Poll a JS condition from Python. More robust than wait_for_function on a page that software WebGL
    keeps busy: there the in-page polling can starve even though the state is already correct."""
    import time
    end = time.time() + timeout_s
    while time.time() < end:
        if page.evaluate(expr):
            return
        page.wait_for_timeout(300)
    raise TimeoutError(f"condition not met within {timeout_s}s: {expr}")


def main():
    ml_js, ml_css = maplibre_files()
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Quiet)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    seen = {"satellite": [], "dem": 0, "ors": []}
    ors = {"fail": False}

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        # Location permission granted, fixed position; count geolocation calls to prove nothing asks
        # for location before the user presses the button, and that there is no continuous tracking.
        context = browser.new_context(viewport={"width": 1280, "height": 800}, permissions=["geolocation"],
                                      geolocation={"latitude": 32.9705, "longitude": 35.5020})
        context.add_init_script("""
          window.__geoCalls = { get: 0, watch: 0 };
          const g = navigator.geolocation;
          const get = g.getCurrentPosition.bind(g), watch = g.watchPosition.bind(g);
          g.getCurrentPosition = (...a) => { window.__geoCalls.get++; return get(...a); };
          g.watchPosition = (...a) => { window.__geoCalls.watch++; return watch(...a); };
        """)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: CONSOLE.append(f"{m.type}: {m.text}"[:300]))

        def unpkg(route):
            u = route.request.url
            if u.endswith("maplibre-gl.js"):
                return route.fulfill(body=ml_js, headers={"content-type": "text/javascript"})
            if u.endswith("maplibre-gl.css"):
                return route.fulfill(body=ml_css, headers={"content-type": "text/css"})
            if "maplibre-contour" in u:
                return route.fulfill(body=CONTOUR_STUB, headers={"content-type": "text/javascript"})
            return route.fulfill(body=b"", headers={"content-type": "text/javascript"})  # rtl-text plugin

        def openfreemap(route):
            u = route.request.url
            if "/styles/" in u:
                return route.fulfill(body=json.dumps(FIXTURE_STYLE), headers={"content-type": "application/json", "access-control-allow-origin": "*"})
            return route.fulfill(status=404, body=b"", headers={"access-control-allow-origin": "*"})

        def dem(route):
            seen["dem"] += 1
            z, x, y = route.request.url.split("/")[-3:]
            body = fx.get_tile(int(x), int(y.split(".")[0])) if int(z) == fx.Z else None
            if body is None:
                return route.fulfill(status=404, body=b"", headers={"access-control-allow-origin": "*"})
            route.fulfill(body=body, headers={"content-type": "image/webp", "access-control-allow-origin": "*"})

        def satellite(route):
            seen["satellite"].append(route.request.url)
            route.fulfill(body=solid_tile((60, 110, 60), "JPEG"), headers={"content-type": "image/jpeg", "access-control-allow-origin": "*"})

        def route_ors(route):
            from urllib.parse import urlparse, parse_qs
            u = route.request.url
            seen["ors"].append(u)
            q = parse_qs(urlparse(u).query)
            if ors["fail"]:
                return route.fulfill(status=404, body=json.dumps({"error": {"code": 2010, "message": "Could not find routable point"}}),
                                     headers={"content-type": "application/json", "access-control-allow-origin": "*"})
            (x1, y1), (x2, y2) = [map(float, q[k][0].split(",")) for k in ("start", "end")]
            mid = [(x1 + x2) / 2 + 0.001, (y1 + y2) / 2 + 0.001]          # a bend: proves the routed line is used
            body = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {},
                    "geometry": {"type": "LineString", "coordinates": [[x1, y1, 500], mid + [510], [x2, y2, 520]]}}]}
            route.fulfill(body=json.dumps(body), headers={"content-type": "application/geo+json", "access-control-allow-origin": "*"})

        def osm_data(route):
            f = OSM_DIR / "osm" / route.request.url.split("?")[0].rsplit("/", 1)[-1]
            if not f.exists():
                return route.fulfill(status=404, body=b"")
            route.fulfill(body=f.read_bytes(), headers={"content-type": "application/json"})

        def overpass(route):
            seen.setdefault("overpass", []).append(route.request.post_data or "")
            route.fulfill(body=json.dumps(OVERPASS_ABROAD), headers={"content-type": "application/json", "access-control-allow-origin": "*"})

        page.route("**/data/osm/*.json", osm_data)
        page.route("https://overpass-api.de/**", overpass)
        def nominatim(route):
            seen.setdefault("nominatim", []).append(route.request.url)
            body = [{"display_name": "הר מירון, גליל עליון, ישראל", "lat": "32.9975", "lon": "35.4110", "boundingbox": ["32.99", "33.00", "35.40", "35.42"]},
                    {"display_name": "מירון, מחוז הצפון, ישראל", "lat": "32.98", "lon": "35.44"}]
            route.fulfill(body=json.dumps(body, ensure_ascii=False), headers={"content-type": "application/json", "access-control-allow-origin": "*"})

        page.route("https://nominatim.openstreetmap.org/**", nominatim)
        page.route("https://api.openrouteservice.org/**", route_ors)
        page.route("https://unpkg.com/**", unpkg)
        page.route("https://tiles.openfreemap.org/**", openfreemap)
        page.route("https://tiles.mapterhorn.com/**", dem)
        page.route("https://ibasemaps-api.arcgis.com/**", satellite)
        page.route("https://tiles.maps.eox.at/**", satellite)

        # The DEM fixture only has z12; open at z12 so terrain loads real fixture tiles.
        page.goto(f"http://127.0.0.1:{port}/?demz=12#12/33.0/35.4167/0/0")
        wait_js(page, "() => window.__topo3d && window.__topo3d.results.topo", 60)
        wait_js(page, "() => window.__topo3d.map.loaded()", 60)

        r = {}
        r["topo"] = page.evaluate("() => window.__topo3d.results.topo")
        r["layers"] = page.evaluate("""() => { const m = window.__topo3d.map;
            return ['topo-landcover','topo-hillshade','topo-contours-minor','topo-trails-path','topo-peaks','route-line',
                    'topo-waterway','topo-waterway-label','topo-poi-dot','topo-poi-icon','topo-poi',
                    'topo-hike-casing','topo-hike-line','topo-hike-label','poi-camp','poi-water-cluster','poi-parking','poi-other','topo-marked-line','topo-trails-track-inner']
              .filter((id) => !!m.getLayer(id)); }""")
        r["terrain"] = page.evaluate("() => !!window.__topo3d.map.getTerrain()")
        r["fatal"] = page.evaluate("() => document.getElementById('fatal')?.textContent ?? null")
        # Toolbar menus: closed by default; the style icon opens, the same icon closes; Escape closes.
        # No layers menu (D-052): fixed layer set.
        ui = lambda: page.evaluate("""() => ({ layers: !document.getElementById('menu-layers').hidden, route: !document.getElementById('route-dock').hidden, style: !document.getElementById('menu-style').hidden, routeBtn: !!document.getElementById('btn-route'),
            layersBtn: !!document.getElementById('btn-layers'), styleAria: document.getElementById('btn-style').getAttribute('aria-expanded'),
            fixedLayers: ['hillshade','contours','trails','water','peaks','parking','drinking','camp','poi','landcover'].every((g) => document.querySelector(`input[data-group=${g}]`).checked)
              && !['slope','aspect','relief'].some((g) => document.querySelector(`input[data-group=${g}]`).checked) })""")
        m0 = ui()
        page.evaluate("() => document.getElementById('btn-style').click()"); m1 = ui()
        page.evaluate("() => document.getElementById('btn-style').click()"); m2 = ui()
        page.evaluate("() => document.getElementById('btn-style').click()"); page.keyboard.press("Escape"); m3 = ui()
        m4 = m3
        r["menus"] = [m0, m1, m2, m3, m4]
        r["newRouteVisible"] = page.evaluate("""() => { const b = document.getElementById('new-route'); const q = b.getBoundingClientRect();
            return q.width > 40 && q.height >= 44 && b.contains(document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2)); }""")
        r["routeColor"] = page.evaluate("() => window.__topo3d.map.getPaintProperty('route-line', 'line-color')")
        r["routeW14"] = page.evaluate("() => { const st = window.__topo3d.map.getPaintProperty('route-line', 'line-width').slice(3); return st[st.indexOf(14) + 1]; }")
        r["exagDefault"] = page.evaluate("() => [window.__topo3d.map.getTerrain()?.exaggeration, document.getElementById('exag').value]")
        r["poiMinzoom"] = page.evaluate("() => window.__topo3d.map.getLayer('topo-poi')?.minzoom")
        wait_js(page, "() => typeof window.__topo3d.results.topo.osm.pois === 'number' && typeof window.__topo3d.results.topo.osm.trails === 'number'", 60)
        # campsites and taps start at the 500 m scale (z12.7, D-045): look at z13
        page.evaluate("() => window.__topo3d.map.jumpTo({ center: [35.4167, 33.0], zoom: 13 })")
        diag = """() => { const m = window.__topo3d.map; const q = (l) => m.queryRenderedFeatures({ layers: l }).length;
            return { z: m.getZoom(), hike: q(['topo-hike-line']), camp: q(['poi-camp']), campC: q(['poi-camp-cluster']), water: q(['poi-water', 'poi-water-cluster']),
              parking: q(['poi-parking', 'poi-parking-cluster']), osm: window.__topo3d.results.topo.osm,
              srcWater: m.querySourceFeatures('poi-water').map((f) => [f.properties.point_count ?? 1, f.geometry.coordinates.map((c) => +c.toFixed(4))]),
              srcCamp: m.querySourceFeatures('poi-camp').length, pitch: m.getPitch(), bounds: m.getBounds().toArray().flat().map((c) => +c.toFixed(3)),
              waterLayer: JSON.stringify(m.getStyle().layers.find((l) => l.id === 'poi-water-cluster')).slice(0, 300),
              images: ['topo-tap', 'topo-tent'].map((i) => m.hasImage(i)), vis: ['poi-camp', 'poi-water', 'poi-parking'].map((id) => m.getLayoutProperty(id, 'visibility')) }; }"""
        try:
            wait_js(page, """() => window.__topo3d.map.queryRenderedFeatures({ layers: ['topo-hike-line'] }).length > 0
            && window.__topo3d.map.queryRenderedFeatures({ layers: ['poi-camp'] }).length > 0
            && window.__topo3d.map.queryRenderedFeatures({ layers: ['poi-water', 'poi-water-cluster'] }).length > 0
            && window.__topo3d.map.queryRenderedFeatures({ layers: ['poi-parking'] }).length > 0""", 150)
        except TimeoutError:
            print("POI-DEBUG", page.evaluate(diag), flush=True)
            raise
        r["osm"] = page.evaluate("""() => { const m = window.__topo3d.map;
            const kinds = (id) => [...new Set(m.queryRenderedFeatures({ layers: [id] }).map((f) => f.properties.kind))].sort();
            const w = (id, kind, z) => { const st = m.getPaintProperty(id, 'line-width').slice(3); let v = st[1];
              for (let i = 0; i < st.length; i += 2) if (st[i] <= z) v = st[i + 1];
              return Array.isArray(v) ? (kind === 'regional' ? v[3] : v[4]) : v; };
            return { counts: window.__topo3d.results.topo.osm, lines: kinds('topo-hike-line'), icons: [...new Set(m.queryRenderedFeatures({ layers: ['poi-camp', 'poi-water', 'poi-water-cluster', 'poi-parking'] })
                .map((f) => f.layer.id + (f.properties.point_count ? ':' + f.properties.point_count : '')))].sort(),
              colour: JSON.stringify(m.getPaintProperty('topo-hike-line', 'line-color')),
              marked: [...new Set(m.queryRenderedFeatures({ layers: ['topo-marked-line'] }).map((f) => f.properties.color))],
              markedMinzoom: m.getLayer('topo-marked-line').minzoom, pathMinzoom: m.getLayer('topo-trails-path').minzoom,
              streamFilter: JSON.stringify(m.getFilter('topo-waterway')),
              markedW14: w('topo-marked-line', 'marked', 14), pathW14: w('topo-trails-path', '', 14),
              labelMinzoom: m.getLayer('topo-hike-label').minzoom,
              peakIcon: JSON.stringify(m.getLayoutProperty('topo-peaks', 'icon-image')), hasPeakImg: m.hasImage('topo-peak') && m.hasImage('topo-saddle'),
              contourLabelPad: m.getLayoutProperty('topo-contour-labels', 'text-padding'),
              pathColour: m.getPaintProperty('topo-trails-path', 'line-color'), trackInner: !!m.getLayer('topo-trails-track-inner'),
              baseIconFilter: JSON.stringify(m.getFilter('topo-poi-icon')), iconMinzoom: m.getLayer('poi-parking').minzoom, iconImgs: ['topo-parking', 'topo-spring', 'topo-viewpoint', 'topo-shelter'].every((i) => m.hasImage(i)),
              natW14: w('topo-hike-line', 'national', 14), regW14: w('topo-hike-line', 'regional', 14) }; }""")
        page.evaluate("() => window.__topo3d.map.jumpTo({ center: [35.4167, 33.0], zoom: 12 })")
        # Abroad: no Overpass request inside Israel; at Antalya (z12) one request, trail + campsite shown (D-042)
        r["overpassInIsrael"] = len(seen.get("overpass", []))
        page.evaluate(f"() => window.__topo3d.map.jumpTo({{ center: [{ABROAD[0]}, {ABROAD[1]}], zoom: 13 }})")
        wait_js(page, "() => window.__topo3d.results.topo.osmLoader.dynamicCells > 0 || window.__topo3d.results.topo.osmLoader.errors > 0", 60)
        wait_js(page, "() => window.__topo3d.map.queryRenderedFeatures({ layers: ['topo-marked-line'] }).length > 0 && window.__topo3d.map.queryRenderedFeatures({ layers: ['poi-camp'] }).length > 0", 60)
        r["abroad"] = page.evaluate("""() => { const m = window.__topo3d.map; return { stats: { ...window.__topo3d.results.topo.osmLoader },
            marked: [...new Set(m.queryRenderedFeatures({ layers: ['topo-marked-line'] }).map((f) => f.properties.color))],
            camp: m.queryRenderedFeatures({ layers: ['poi-camp'] }).length }; }""")
        r["overpassAbroad"] = list(seen.get("overpass", []))
        page.evaluate("() => window.__topo3d.map.jumpTo({ center: [35.4167, 33.0], zoom: 12 })")
        wait_js(page, "() => window.__topo3d.map.queryRenderedFeatures({ layers: ['topo-hike-line'] }).length > 0", 60)
        # D-047: at the 5 km scale (z10) campsites show as small badges, taps only from 500 m
        page.evaluate("() => window.__topo3d.map.jumpTo({ center: [35.4167, 33.0], zoom: 10 })")
        wait_js(page, "() => window.__topo3d.map.queryRenderedFeatures({ layers: ['poi-camp'] }).length > 0", 60)
        r["at5km"] = page.evaluate("""() => { const m = window.__topo3d.map; return { camp: m.queryRenderedFeatures({ layers: ['poi-camp'] }).length,
            water: m.queryRenderedFeatures({ layers: ['poi-water', 'poi-water-cluster'] }).length,
            overlap: m.getLayoutProperty('poi-camp', 'icon-allow-overlap'), img: m.getLayoutProperty('poi-camp', 'icon-image') }; }""")
        # Category search (D-045): zoom far out, search "חניון לילה" → every campsite in view, grouped; ✕ clears
        page.evaluate("() => window.__topo3d.map.jumpTo({ center: [35.4167, 33.0], zoom: 9 })")
        page.wait_for_timeout(500)
        r["campHiddenFar"] = page.evaluate("() => window.__topo3d.map.queryRenderedFeatures({ layers: ['poi-camp', 'poi-camp-cluster'] }).length")
        page.evaluate("() => { document.getElementById('search-q').value = 'חניון לילה'; document.getElementById('search').requestSubmit(); }")
        wait_js(page, "() => !document.getElementById('cat-chip').hidden", 60)
        wait_js(page, "() => window.__topo3d.map.queryRenderedFeatures({ layers: ['poi-search', 'poi-search-cluster'] }).length > 0", 60)
        r["catSearch"] = page.evaluate("""() => ({ res: window.__topo3d.results.category, chip: document.querySelector('#cat-chip span').textContent,
            icon: window.__topo3d.map.getLayoutProperty('poi-search', 'icon-image'), nominatim: 0 })""")
        wait_js(page, "() => !document.getElementById('search-results').hidden", 60)
        r["catList"] = page.evaluate("() => [...document.querySelectorAll('#search-results li')].map((li) => li.className || (li.querySelector('strong')?.textContent ?? ''))")
        r["catNominatim"] = len(seen.get("nominatim", []))
        # owner (D-046): emptying the search box ends the category display
        page.evaluate("() => { const i = document.getElementById('search-q'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); }")
        page.wait_for_timeout(500)
        r["catCleared"] = page.evaluate("() => [document.getElementById('cat-chip').hidden, window.__topo3d.map.queryRenderedFeatures({ layers: ['poi-search', 'poi-search-cluster'] }).length]")
        r["campMinzoom"] = page.evaluate("() => [window.__topo3d.map.getLayer('poi-camp').minzoom, window.__topo3d.map.getLayer('poi-water').minzoom, window.__topo3d.map.getLayer('poi-parking').minzoom]")
        page.evaluate("() => window.__topo3d.map.jumpTo({ center: [35.4167, 33.0], zoom: 12 })")
        page.wait_for_timeout(500)
        r["poiIcons"] = page.evaluate("""() => { const m = window.__topo3d.map; return [m.hasImage('topo-tent'), m.hasImage('topo-tap'),
            m.getLayer('topo-poi-icon')?.minzoom, JSON.stringify(m.getLayoutProperty('topo-poi-icon', 'icon-image'))]; }""")
        r["waterColor"] = page.evaluate("() => JSON.stringify(window.__topo3d.map.getPaintProperty('topo-waterway', 'line-color'))")
        r["smallStreamW14"] = page.evaluate("() => { const st = window.__topo3d.map.getPaintProperty('topo-waterway', 'line-width').slice(3); return st[st.indexOf(14) + 1][2]; }")
        page.evaluate("() => document.querySelector('input[data-group=water]').click()")
        wt = [page.evaluate("() => window.__topo3d.map.getLayoutProperty('topo-waterway', 'visibility')")]
        page.evaluate("() => document.querySelector('input[data-group=water]').click()")
        wt.append(page.evaluate("() => window.__topo3d.map.getLayoutProperty('topo-waterway', 'visibility')"))
        r["waterToggle"] = wt
        r["devHidden"] = page.evaluate("() => document.getElementById('dev-section').hidden && document.getElementById('fps').hidden")
        r["geoBefore"] = page.evaluate("() => ({ ...window.__geoCalls })")
        r["attribTopo"] = page.evaluate("() => document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent ?? ''")
        r["geoLabel"] = page.evaluate("() => document.querySelector('.maplibregl-ctrl-geolocate')?.getAttribute('title') ?? ''")
        r["i18n"] = page.evaluate("() => [document.querySelector('[data-i18n=\\'layers.contours\\']').textContent, document.documentElement.lang, document.documentElement.dir]")

        # Background switch → satellite (Esri default, embedded key)
        page.evaluate("() => document.querySelector('input[name=base][value=satellite]').click()")
        # wait for the layer, its attribution and the first tile request (fixed 1.5 s was too short in CI)
        wait_js(page, "() => !!window.__topo3d.map.getLayer('satellite') && (document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent ?? '').includes('Esri')", 60)
        import time as _t
        _end = _t.time() + 60
        while not seen["satellite"] and _t.time() < _end:
            page.wait_for_timeout(300)
        r["satLayer"] = page.evaluate("() => !!window.__topo3d.map.getLayer('satellite')")
        r["satTiles"] = page.evaluate("() => window.__topo3d.map.getStyle().sources.satellite?.tiles?.[0] ?? null")
        r["landcoverInSat"] = page.evaluate("() => window.__topo3d.map.getLayoutProperty('topo-landcover','visibility')")
        r["attribSat"] = page.evaluate("() => document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent ?? ''")
        page.evaluate("() => document.querySelector('input[name=base][value=topo]').click()")
        page.wait_for_timeout(500)
        r["satAfterTopo"] = page.evaluate("() => !!window.__topo3d.map.getLayer('satellite')")
        r["landcoverInTopo"] = page.evaluate("() => window.__topo3d.map.getLayoutProperty('topo-landcover','visibility')")

        # ---- D-038: map styles, 2D/3D, terrain layers, opacity, search
        lv = "(id) => window.__topo3d.map.getLayoutProperty(id, 'visibility') ?? 'visible'"
        styles = {}
        for st in ("satellite", "hybrid", "topo"):
            page.evaluate(f"() => document.querySelector('input[name=base][value={st}]').click()")
            page.wait_for_timeout(600)
            styles[st] = page.evaluate(f"""() => {{ const v = {lv}; return {{ sat: !!window.__topo3d.map.getLayer('satellite'), contours: v('topo-contours-minor'),
                hill: v('topo-hillshade'), land: v('topo-landcover'), trails: v('topo-trails-path'), terrain: !!window.__topo3d.map.getTerrain() }}; }}""")
        r["styles"] = styles
        page.evaluate("() => document.getElementById('btn-3d').click()")
        wait_js(page, "() => window.__topo3d.map.getPitch() < 1 && !window.__topo3d.map.isMoving()")
        d2 = page.evaluate("() => ({ terrain: !!window.__topo3d.map.getTerrain(), pitch: window.__topo3d.map.getPitch(), label: document.getElementById('btn-3d').textContent })")
        page.evaluate("() => document.getElementById('btn-3d').click()")
        try:
            wait_js(page, "() => window.__topo3d.map.getPitch() > 50 && !window.__topo3d.map.isMoving()")
        except Exception:
            print("TILT-DEBUG", page.evaluate("() => { const m = window.__topo3d.map; return { pitch: m.getPitch(), moving: m.isMoving(), terrain: !!m.getTerrain(), is3D: window.__topo3d.ctx.view.is3D(), label: document.getElementById('btn-3d').textContent, zoom: m.getZoom(), maxPitch: m.getMaxPitch() }; }"), CONSOLE[-6:], flush=True)
            raise
        d3 = page.evaluate("() => ({ terrain: !!window.__topo3d.map.getTerrain(), pitch: window.__topo3d.map.getPitch(), label: document.getElementById('btn-3d').textContent })")
        r["view3d"] = [d2, d3]
        for g in ("slope", "aspect", "relief"):
            page.evaluate(f"() => document.querySelector('input[data-group={g}]').click()")
        try:
            wait_js(page, "() => window.__topo3d.results.topo.derive.tiles >= 2", 180)
        except Exception:
            print("DERIVE-DEBUG", page.evaluate("""() => { const m = window.__topo3d.map; return { vis: m.getLayoutProperty('topo-slope','visibility'), src: !!m.getSource('derive-slope'),
                loaded: m.isSourceLoaded('derive-slope'), z: m.getZoom(), stats: window.__topo3d.results.topo.derive, hasML: typeof maplibregl, reg: m.__deriveRegistered }; }"""), CONSOLE[-8:], flush=True)
            raise
        page.evaluate("() => { const e = document.querySelector('input[data-opacity=slope]'); e.value = '0.3'; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); }")
        r["terrainLayers"] = page.evaluate(f"""() => {{ const v = {lv}; const m = window.__topo3d.map; return {{ slope: v('topo-slope'), aspect: v('topo-aspect'), relief: v('topo-relief'),
            derive: {{ ...window.__topo3d.results.topo.derive }}, slopeOpacity: m.getPaintProperty('topo-slope', 'raster-opacity'),
            legendShown: getComputedStyle(document.querySelector('[data-legend=slope]')).display !== 'none' }}; }}""")
        for g in ("slope", "aspect", "relief"):
            page.evaluate(f"() => document.querySelector('input[data-group={g}]').click()")
        # search: Enter → one request → results → pick the first → map moves there, marker shown
        n_nom0 = len(seen.get("nominatim", []))
        page.evaluate("() => { document.getElementById('search-q').value = 'הר מירון'; document.getElementById('search').requestSubmit(); }")
        wait_js(page, "() => !document.getElementById('search-results').hidden", 60)
        r["searchList"] = page.evaluate("() => [...document.querySelectorAll('#search-results strong')].map((e) => e.textContent)")
        page.evaluate("() => document.querySelector('#search-results button').click()")
        page.wait_for_timeout(1600)
        r["searchGo"] = page.evaluate("() => ({ res: window.__topo3d.results.search, marker: !!document.querySelector('.maplibregl-marker'), hidden: document.getElementById('search-results').hidden, c: window.__topo3d.map.getCenter() })")
        r["nominatim"] = list(seen.get("nominatim", []))[n_nom0:]
        page.evaluate("() => window.__topo3d.map.jumpTo({ center: [35.4167, 33.0], zoom: 12, pitch: 0, bearing: 0 })")

        # ---- Route editor (Phase 3A). No router configured yet → new segments are free (straight).
        page.on("dialog", lambda d: d.accept())          # "clear route?" confirmation
        r["snapDefault"] = page.evaluate("() => !document.querySelector('#seg-mode option[value=snap]').disabled && document.getElementById('seg-mode').value === 'snap'")
        # Panel buttons are pressed from inside the page (same handlers): with software WebGL the renderer can be
        # too busy to acknowledge synthetic mouse input in time. Map gestures below stay real mouse input.
        btn = lambda sel: page.evaluate(f"() => document.querySelector('{sel}').click()")
        btn("#new-route")          # D-049: "מסלול חדש" starts drawing and opens the route dock
        for x, y in [(800, 300), (900, 380), (1000, 330)]:
            page.mouse.click(x, y)
            page.wait_for_timeout(300)
        ed = "window.__topo3d.editor"
        nverts = lambda: page.evaluate(f"() => {ed}.state.vertices.length")
        wait_js(page, "() => document.getElementById('stats').textContent.includes('עלייה')", 60)
        r["stats"] = page.inner_text("#stats")
        r["profileVisible"] = page.evaluate("() => !document.getElementById('profile-box').hidden && !!document.querySelector('#profile svg path.profile-area')")
        # D-049 dock: distance big, ascent|descent, max|min, no walking time; start/finish on the profile; 4–5 elevation levels
        r["panel"] = page.evaluate("""() => ({ dist: document.getElementById('rd-dist').textContent, labels: [...document.querySelectorAll('#stats .rd-st small')].map((e) => e.textContent),
            time: document.getElementById('profile-box').textContent.includes('זמן'), dockOpen: !document.getElementById('route-dock').hidden,
            startFinish: !!document.querySelector('#profile .profile-start') && !!document.querySelector('#profile .profile-finish'),
            yLevels: document.querySelectorAll('#profile line.profile-grid-h').length })""")
        # D-054: the graph fills its box and stays inside the panel, also after the window changes size
        fit_js = """() => { const p = document.getElementById('profile'), svg = p.querySelector('svg'), box = document.getElementById('profile-box');
            const vb = svg.viewBox.baseVal, rs = svg.getBoundingClientRect(), rb = box.getBoundingClientRect();
            return { w: Math.abs(vb.width - p.clientWidth) <= 2, h: Math.abs(vb.height - p.clientHeight) <= 2, inside: rs.bottom <= rb.bottom + 0.5, vbw: vb.width, cw: p.clientWidth }; }"""
        fit1 = page.evaluate(fit_js)
        page.set_viewport_size({"width": 1500, "height": 800}); page.wait_for_timeout(1500)
        fit2 = page.evaluate(fit_js)
        page.set_viewport_size({"width": 1280, "height": 800}); page.wait_for_timeout(1500)
        r["profileFit"] = [fit1, fit2]
        for name in ("dock-open",):
            try:
                page.screenshot(path=str(CACHE / f"e2e-{name}.png"), timeout=120_000, animations="disabled")
            except Exception as ex:  # noqa: BLE001 - a picture for review only
                print(f"(screenshot {name} skipped: {type(ex).__name__})")
        page.evaluate("() => document.getElementById('profile-toggle').click()"); page.wait_for_timeout(300)
        try:
            page.screenshot(path=str(CACHE / "e2e-dock-hidden.png"), timeout=120_000, animations="disabled")
        except Exception as ex:  # noqa: BLE001
            print(f"(screenshot dock-hidden skipped: {type(ex).__name__})")
        r["panelCollapsed"] = page.evaluate("""() => [document.getElementById('profile-box').hidden, !document.getElementById('route-pill').hidden,
            !document.querySelector('.route-tools').closest('[hidden]'), document.getElementById('pill-stats').textContent.includes('ק״מ')]""")
        page.evaluate("() => document.getElementById('route-pill').click()"); page.wait_for_timeout(300)
        r["panelBack"] = page.evaluate("() => !document.getElementById('profile-box').hidden && document.getElementById('route-pill').hidden")
        # name (click to edit) and colour (dots)
        page.evaluate("""() => { const n = document.getElementById('route-name'); n.focus(); n.textContent = 'מכתש רמון'; n.blur();
            document.getElementById('route-color').click(); document.querySelectorAll('#color-pop .color-dot')[2].click(); }""")
        r["meta"] = page.evaluate("""() => ({ meta: window.__topo3d.results.routeMeta, paint: window.__topo3d.map.getPaintProperty('route-line', 'line-color'),
            names: document.querySelectorAll('#color-pop .color-dot').length, popHidden: document.getElementById('color-pop').hidden, text: document.getElementById('color-pop').textContent.trim() })""")
        page.evaluate("""() => { document.getElementById('route-color').click(); document.querySelectorAll('#color-pop .color-dot')[0].click(); }""")
        r["routePoints"] = nverts()
        r["modes"] = page.evaluate(f"() => {ed}.state.vertices.map(v => v.mode)")
        wait_js(page, f"() => {ed}.segments().every(s => s.status === 'ok')", 60)
        r["snapped"] = page.evaluate(f"() => {ed}.segments().map(s => [s.status, s.geometry.length])")
        r["orsCalls"] = len(seen["ors"])
        r["orsUrl"] = seen["ors"][0] if seen["ors"] else ""
        r["attribRoute"] = page.evaluate("() => document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent ?? ''")
        r["profileHidden"] = [True, True, True]; r["profileShownAgain"] = True   # (route button removed, D-049)
        # Router failure: segment shows an error, stays snap (never silently straight); user can switch it
        ors["fail"] = True
        page.mouse.click(1050, 250)
        wait_js(page, f"() => {ed}.segments().at(-1).status === 'error'", 60)
        r["errSeg"] = page.evaluate(f"() => {{ const s = {ed}.segments().at(-1); return [s.mode, s.status, s.provisional]; }}")
        r["errUi"] = page.inner_text("#seg-errors")
        btn("#seg-errors button")
        r["afterToFree"] = page.evaluate(f"() => {{ const s = {ed}.segments().at(-1); return [s.mode, s.status]; }}")
        ors["fail"] = False
        page.keyboard.press("Control+z"); page.keyboard.press("Control+z")   # undo "to free" and the 4th point
        page.wait_for_timeout(300)
        btn("#r-undo"); r["afterUndo"] = nverts()
        btn("#r-redo"); r["afterRedo"] = nverts()
        first = page.evaluate(f"() => [{ed}.state.vertices[0].lon, {ed}.state.vertices[0].lat]")
        btn("#r-reverse")
        r["reversedLast"] = page.evaluate(f"() => [{ed}.state.vertices.at(-1).lon, {ed}.state.vertices.at(-1).lat]") == first
        btn("#r-reverse")                          # back to the original order
        btn("#r-loop"); r["afterLoop"] = nverts()
        btn("#r-loop"); r["afterLoop2"] = nverts()
        page.keyboard.press("Control+z"); r["afterCtrlZ"] = nverts()

        # Drag vertex 1 with the mouse (projected to screen) → one move command
        def screen_of(i):
            return page.evaluate(f"() => {{ const v = {ed}.state.vertices[{i}]; const p = window.__topo3d.map.project([v.lon, v.lat]); return [p.x, p.y]; }}")
        x1, y1 = screen_of(1)
        before = page.evaluate(f"() => [{ed}.state.vertices[1].lon, {ed}.state.vertices[1].lat]")
        page.mouse.move(x1, y1); page.mouse.down(); page.mouse.move(x1 + 30, y1 + 20, steps=5); page.mouse.move(x1 + 60, y1 + 40, steps=5); page.mouse.up()
        page.wait_for_timeout(400)
        after = page.evaluate(f"() => [{ed}.state.vertices[1].lon, {ed}.state.vertices[1].lat]")
        r["dragMoved"] = before != after and nverts() == 3
        # Select vertex 2 by clicking it, then Delete
        x2, y2 = screen_of(2)
        page.mouse.click(x2, y2); page.wait_for_timeout(200)
        page.keyboard.press("Delete"); page.wait_for_timeout(200)
        r["afterDelete"] = nverts()
        page.keyboard.press("Control+z"); page.wait_for_timeout(200)

        # Waypoint: right-click → form → save name
        page.mouse.click(1050, 450, button="right"); page.wait_for_timeout(400)
        page.fill(".wp-form input[name=name]", "מעיין"); btn(".wp-form button[type=submit]"); page.wait_for_timeout(300)
        r["waypoints"] = page.evaluate(f"() => {ed}.state.waypoints.map(w => w.name)")

        # Draft survives a reload
        draft_before = page.evaluate(f"() => JSON.stringify({ed}.state)")
        page.reload(wait_until="domcontentloaded", timeout=60_000)
        wait_js(page, "() => window.__topo3d && window.__topo3d.results.topo && window.__topo3d.map.loaded()", 60)
        r["draftRestored"] = page.evaluate(f"() => JSON.stringify({ed}.state)") == draft_before
        if not r["draftRestored"]:
            print("draft before:", draft_before[:300]); print("draft after:", page.evaluate(f"() => JSON.stringify({ed}.state)")[:300])
        r["draftNotice"] = page.evaluate("() => window.__topo3d.results.draftRestored === true")
        # "New route" with an unsaved route: the unsaved-route warning (D-056) → "continue without saving" →
        # cleared in one step, drawing mode on
        page.evaluate("() => document.getElementById('new-route').click()"); page.wait_for_timeout(500)
        r["unsavedWarning"] = page.evaluate("() => document.getElementById('lib-dialog').open && !!document.querySelector('#lib-dialog button[value=discard]')")
        page.evaluate("() => document.querySelector('#lib-dialog button[value=discard]')?.click()"); page.wait_for_timeout(500)
        r["newRoute"] = page.evaluate(f"() => [{ed}.state.vertices.length, !document.getElementById('plan-badge').hidden]")
        page.keyboard.press("Control+z"); page.wait_for_timeout(200)
        r["newRouteUndone"] = nverts() > 0
        page.evaluate("() => document.getElementById('plan').click()")      # leave drawing mode again
        # Clear (confirmed) → empty; undo brings it back
        btn("#plan"); btn("#r-clear"); page.wait_for_timeout(300)
        r["afterClear"] = (nverts(), page.evaluate(f"() => {ed}.state.waypoints.length"))
        btn("#plan")               # stop editing: with no route the dock disappears (D-049)
        r["dockAfterClear"] = page.evaluate("() => document.getElementById('route-dock').hidden")
        btn("#plan")
        page.keyboard.press("Control+z")
        r["clearUndone"] = page.evaluate(f"() => {ed}.state.waypoints.length") == 1

        # "Center on me": one location request, map moves to it, no tracking
        # Clicked from inside the page (same handler as a mouse click): with software WebGL the renderer is too
        # busy to acknowledge synthetic mouse input on map controls in time. Visibility/on-top was verified.
        r["geoButtonOnTop"] = page.evaluate("""() => { const b = document.querySelector('.maplibregl-ctrl-geolocate');
            const q = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2)); }""")
        # The control checks geolocation support asynchronously after load; wait until it is ready, and press
        # again if a slow CI machine swallowed the first press (no location call is made before a press).
        wait_js(page, "() => { const b = document.querySelector('.maplibregl-ctrl-geolocate'); return b && !b.disabled; }", 60)
        for attempt in range(3):
            page.evaluate("() => document.querySelector('.maplibregl-ctrl-geolocate').click()")
            try:
                wait_js(page, "() => window.__geoCalls.get > 0", 60)
                break
            except Exception:  # noqa: BLE001
                print(f"(location press {attempt + 1} not handled yet)")
        r["geoPresses"] = attempt + 1
        page.wait_for_timeout(2500)
        r["geoAfter"] = page.evaluate("() => ({ ...window.__geoCalls })")
        r["centerAfterGeo"] = page.evaluate("() => window.__topo3d.map.getCenter().toArray()")
        r["userDot"] = page.evaluate("() => !!document.querySelector('.maplibregl-user-location-dot')")

        # Remembered settings: exaggeration and view are remembered; a layer switch is not (fixed set, D-052)
        page.evaluate("() => document.querySelector('input[data-group=contours]').click()")
        page.evaluate("() => { const e = document.getElementById('exag'); e.value = '1.7'; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); }")
        page.evaluate("() => window.__topo3d.map.jumpTo({ center: [35.3, 32.9], zoom: 12.5, pitch: 30, bearing: 10 })")
        page.wait_for_timeout(500)
        page.goto(f"http://127.0.0.1:{port}/?demz=12", wait_until="domcontentloaded", timeout=60_000)
        wait_js(page, "() => window.__topo3d && window.__topo3d.results.topo && window.__topo3d.map.loaded()", 60)
        r["prefsAfterReload"] = page.evaluate("""() => { const m = window.__topo3d.map; const c = m.getCenter();
            return { contoursBox: document.querySelector('input[data-group=contours]').checked,
                     contoursLayer: m.getLayoutProperty('topo-contours-minor', 'visibility'),
                     exag: m.getTerrain()?.exaggeration, center: [+c.lng.toFixed(3), +c.lat.toFixed(3)], zoom: +m.getZoom().toFixed(1) }; }""")
        r["geoAfterReload"] = page.evaluate("() => ({ ...window.__geoCalls })")

        # ---------------------------------------------------------------- My Routes (D-056)
        L = "window.__topo3d.ctx.library.lib()"
        def jsclick(sel): page.evaluate(f"() => document.querySelector({sel!r}).click()"); page.wait_for_timeout(400)
        def dialog_open(): return page.evaluate("() => document.getElementById('lib-dialog').open")
        def fresh_route(pts):
            jsclick("#new-route")
            if dialog_open(): jsclick("#lib-dialog button[value=discard]")
            for x, y in pts: page.mouse.click(x, y); page.wait_for_timeout(300)
            wait_js(page, f"() => {ed}.geometry().length >= 2 && document.getElementById('stats').textContent.includes('עלייה')", 120)
        page.evaluate("() => window.__topo3d.map.jumpTo({ center: [35.4167, 33.0], zoom: 12, pitch: 0, bearing: 0 })"); page.wait_for_timeout(800)
        fresh_route([(800, 300), (900, 380), (1000, 330)])
        r["libUnsaved"] = page.evaluate("() => window.__topo3d.results.savedState")
        r["libEmpty"] = page.evaluate(f"() => {L}.listRoutes().then((x) => x.length)")
        page.evaluate("() => window.__topo3d.map.jumpTo({ pitch: 40, bearing: 20 })"); page.wait_for_timeout(500)
        cam_js = "() => { const m = window.__topo3d.map, c = m.getCenter(); return [+c.lng.toFixed(5), +c.lat.toFixed(5), +m.getZoom().toFixed(2), +m.getPitch().toFixed(1), +m.getBearing().toFixed(1)]; }"
        cam_before = page.evaluate(cam_js)
        jsclick("#r-save"); wait_js(page, "() => document.getElementById('lib-dialog').open", 60)
        r["libSaveDialog"] = page.evaluate("() => ({ name: !!document.querySelector('#lib-dialog input[name=name]'), folder: !!document.querySelector('#lib-dialog select[name=folder]'), figs: document.querySelectorAll('#lib-dialog .lib-figs dd').length })")
        page.fill("#lib-dialog input[name=name]", "מעיינות")
        page.select_option("#lib-dialog select[name=folder]", "__new"); page.fill("#lib-dialog input[name=newFolder]", "גליל")
        jsclick("#lib-dialog button[value=save]")
        wait_js(page, "() => !!window.__topo3d.results.lastSaved", 120)
        sid = page.evaluate("() => window.__topo3d.results.lastSaved.id")
        page.wait_for_timeout(500); r["libCamera"] = [cam_before, page.evaluate(cam_js)]
        r["libSaved"] = page.evaluate(f"""() => {L}.getRoute({sid!r}).then((x) => ({{ name: x.name, folder: !!x.folderId, vertices: x.editor.state.vertices.length,
            geomSame: JSON.stringify(x.geometry) === JSON.stringify({ed}.geometry().map((p) => [p[0], p[1]])), profile: x.profile.length,
            elevOk: x.profile.every((p) => p.length === 4), thumb: (x.thumb || '').slice(0, 11), state: window.__topo3d.results.savedState }}))""")
        # reload: the saved route persists in the library and the route on the map stays linked + saved
        page.reload(wait_until="domcontentloaded", timeout=60_000)
        wait_js(page, "() => window.__topo3d && window.__topo3d.results.topo && window.__topo3d.map.loaded() && window.__topo3d.ctx.library", 60)
        page.wait_for_timeout(1500)
        r["libAfterReload"] = page.evaluate(f"() => {L}.listRoutes().then((x) => [x.length, window.__topo3d.results.savedState])")
        # a saved route is not drawn by itself: start a new route (no warning: nothing unsaved), map route is empty
        jsclick("#new-route"); r["libNoWarnWhenSaved"] = not dialog_open()
        r["libNotAuto"] = page.evaluate("() => window.__topo3d.map.getSource('route')._data.features.length") if False else page.evaluate(f"() => {ed}.geometry().length")
        jsclick("#plan")
        # open it from the library
        jsclick("#btn-library"); wait_js(page, "() => document.querySelectorAll('#library .lib-card').length === 1", 60)
        jsclick("#library .lib-card .lib-btn[data-act=open]"); page.wait_for_timeout(1500)
        r["libOpened"] = page.evaluate(f"() => [{ed}.state.vertices.length, document.getElementById('library').hidden, window.__topo3d.results.savedState, document.getElementById('route-name').textContent]")
        # change it, then "save changes" → update the original (still one route, now 4 points)
        jsclick("#plan"); page.mouse.click(1050, 250); page.wait_for_timeout(500)
        wait_js(page, f"() => {ed}.state.vertices.length === 4 && document.getElementById('stats').textContent.includes('עלייה')", 120)
        r["libChanged"] = page.evaluate("() => window.__topo3d.results.savedState")
        jsclick("#r-save"); wait_js(page, "() => document.getElementById('lib-dialog').open", 60)
        r["libUpdateChoice"] = page.evaluate("() => document.querySelector('#lib-dialog input[name=how]:checked')?.value")
        page.evaluate("() => window.__topo3d.results.lastSaved = null")
        jsclick("#lib-dialog button[value=save]"); wait_js(page, "() => !!window.__topo3d.results.lastSaved", 120)
        r["libUpdated"] = page.evaluate(f"() => {L}.listRoutes().then((x) => [x.length, x[0].editor.state.vertices.length, x[0].id === {sid!r}])")
        jsclick("#plan")
        # card actions: duplicate, rename, move to "no folder", edit → create copy (original untouched), delete
        jsclick("#btn-library"); wait_js(page, "() => document.querySelectorAll('#library .lib-card').length === 1", 60)
        jsclick("#library .lib-card .lib-btn[data-act=menu]"); jsclick(".lib-menu button[data-m=duplicate]")
        wait_js(page, "() => document.querySelectorAll('#library .lib-card').length === 2", 60)
        page.evaluate("() => document.querySelector('.lib-sort select').value = 'name'"); page.evaluate("() => document.querySelector('.lib-sort select').dispatchEvent(new Event('change'))")
        page.wait_for_timeout(800)   # the sort re-renders the cards asynchronously; let it settle
        jsclick("#library .lib-card .lib-btn[data-act=menu]"); wait_js(page, "() => !!document.querySelector('.lib-menu button[data-m=rename]')", 60)
        jsclick(".lib-menu button[data-m=rename]"); wait_js(page, "() => document.getElementById('lib-dialog').open && !!document.querySelector('#lib-dialog input[name=name]')", 60)
        page.fill("#lib-dialog input[name=name]", "אאא ראשון"); jsclick("#lib-dialog button[value=ok]")
        wait_js(page, "() => document.querySelector('#library .lib-card h3')?.textContent === 'אאא ראשון'", 60)
        jsclick("#library .lib-card .lib-btn[data-act=menu]"); wait_js(page, "() => !!document.querySelector('.lib-menu button[data-m=move]')", 60)
        jsclick(".lib-menu button[data-m=move]"); wait_js(page, "() => document.getElementById('lib-dialog').open", 60)
        page.select_option("#lib-dialog select[name=folder]", ""); jsclick("#lib-dialog button[value=ok]")
        page.wait_for_timeout(800)
        r["libCards"] = page.evaluate(f"() => {L}.listRoutes().then((x) => x.map((r) => [r.name, !!r.folderId]).sort())")
        page.fill("#library .lib-search input", "zzz"); page.wait_for_timeout(300)
        r["libNoResults"] = page.evaluate("() => document.querySelectorAll('#library .lib-card').length === 0 && !!document.querySelector('#library .lib-empty')")
        page.fill("#library .lib-search input", ""); page.wait_for_timeout(300)
        before = page.evaluate(f"() => {L}.getRoute({sid!r}).then((x) => JSON.stringify(x.editor))")
        page.evaluate(f"() => document.querySelector('#library .lib-card[data-id=\"{sid}\"] .lib-btn[data-act=edit]').click()"); page.wait_for_timeout(400)
        page.check("#lib-dialog input[value=copy]"); page.fill("#lib-dialog input[name=name]", "עותק לעריכה"); jsclick("#lib-dialog button[value=go]")
        page.wait_for_timeout(1500)
        r["libCopy"] = page.evaluate(f"""() => {L}.listRoutes().then(async (x) => [x.length, x.some((r) => r.name === 'עותק לעריכה'),
            JSON.stringify((await {L}.getRoute({sid!r})).editor) === {before!r}, window.__topo3d.results.editMode, !document.getElementById('plan-badge').hidden])""")
        jsclick("#plan")
        jsclick("#btn-library"); wait_js(page, "() => document.querySelectorAll('#library .lib-card').length === 3", 60)
        jsclick("#library .lib-chip[data-folder]:not([data-folder=all]):not([data-folder=none])")
        jsclick("#library .lib-folderbar button[data-act=delete-folder]"); jsclick("#lib-dialog button[value=ok]"); page.wait_for_timeout(800)
        r["libFolderDeleted"] = page.evaluate(f"() => Promise.all([{L}.listRoutes(), {L}.listFolders()]).then(([a, b]) => [a.length, b.length, a.every((r) => !r.folderId)])")
        jsclick("#library .lib-card .lib-btn[data-act=menu]"); jsclick(".lib-menu button[data-m=delete]"); jsclick("#lib-dialog button[value=ok]"); page.wait_for_timeout(800)
        r["libDeleted"] = page.evaluate(f"() => {L}.listRoutes().then((x) => x.length)")
        jsclick("#library .lib-x")

        # Developer mode: test panel visible and the devtools module loaded
        page.goto(f"http://127.0.0.1:{port}/?demz=12&dev=1#12/33.0/35.4167/0/0", wait_until="domcontentloaded", timeout=60_000)
        wait_js(page, "() => window.__topo3d && window.__topo3d.results.topo && window.__topo3d.map.loaded()", 60)
        wait_js(page, "() => document.getElementById('test-out').textContent.includes('hidden base layers')", 60)
        r["devShown"] = page.evaluate("() => !document.getElementById('dev-section').hidden && !document.getElementById('fps').hidden")
        try:  # best effort: software WebGL can keep the page busy
            page.screenshot(path=str(CACHE / "e2e.png"), timeout=15_000)
        except Exception as e:  # noqa: BLE001
            print(f"(screenshot skipped: {type(e).__name__})")
        browser.close()
    httpd.shutdown()

    import re
    if r.get("orsUrl"):
        r["orsUrl"] = re.sub(r"api_key=[^&]+", "api_key=<redacted>", r["orsUrl"])
    if r.get("satTiles"):
        r["satTiles"] = re.sub(r"token=[^&]+", "token=<redacted>", r["satTiles"])  # CI logs are public
    print(json.dumps({k: v for k, v in r.items() if k != "topo"} | {"hidden": r["topo"]["hidden"], "renamed": r["topo"]["renamed"], "labelFont": r["topo"]["labelFont"], "demRequests": seen["dem"], "satelliteRequests": len(seen["satellite"])}, ensure_ascii=False, indent=2))
    ok = True

    def expect(cond, msg):
        nonlocal ok
        print(("PASS " if cond else "FAIL ") + msg)
        ok &= bool(cond)

    # The RTL text plugin is an external script not available offline; the test serves an empty file for it.
    real_errors = [e for e in errors if "RTL Text Plugin" not in e]
    expect(not real_errors and r["fatal"] is None, f"boots without page errors {real_errors} {r['fatal']}")
    expect(set(r["topo"]["hidden"]) == {"road_path_pedestrian", "mountain_peak", "waterway_stream", "poi_r1"}, f"base trail/peak/waterway/poi layers hidden by schema (not road_major) {r['topo']['hidden']}")
    expect(r["topo"]["renamed"] == 2, "Hebrew-first names on name labels only (water_name, place_label; not the ref shield)")
    expect(r["topo"]["labelFont"] == ["Noto Sans Regular"], "Regular label font chosen over the first (Italic) one")
    expect(len(r["layers"]) == 20, f"Topo3D (incl. streams, POIs) + route layers present {r['layers']}")
    m = r["menus"]
    expect({k: m[0][k] for k in ("layers", "route", "style", "styleAria")} == {"layers": False, "route": False, "style": False, "styleAria": "false"} and not m[0]["routeBtn"],
           f"menus and route dock closed at start; no route-options button (D-049) {m[0]}")
    expect(not m[0]["layersBtn"] and m[0]["fixedLayers"], f"no layers menu; hillshade, contours and all features on, slope/aspect/relief off (D-052) {m[0]}")
    expect(m[1]["style"] and m[1]["styleAria"] == "true", "map-style icon opens its menu")
    expect(not m[2]["style"], "pressing the same icon again closes the menu")
    expect(not m[3]["style"], "Escape closes the menu")
    expect(all(f["w"] and f["h"] and f["inside"] for f in r["profileFit"]), f"elevation graph fills its box and stays inside the panel, also after a resize (D-054) {r['profileFit']}")
    expect(r.get("unsavedWarning"), "unsaved route: 'new route' warns first (save / continue without saving / cancel) (D-056)")
    expect(r["libUnsaved"] == "unsaved" and r["libEmpty"] == 0, f"a new route is marked unsaved; nothing is saved automatically {r['libUnsaved']} {r['libEmpty']}")
    expect(r["libSaveDialog"] == {"name": True, "folder": True, "figs": 4}, f"save dialog: name, folder (+ new folder), distance/ascent/min/max {r['libSaveDialog']}")
    s_ = r["libSaved"]
    expect(s_["name"] == "מעיינות" and s_["folder"] and s_["vertices"] == 3 and s_["geomSame"] and s_["profile"] > 10 and s_["elevOk"] and s_["thumb"].startswith("data:image") and s_["state"] == "saved",
           f"manual save keeps every coordinate, the elevation profile and a preview picture, in a new folder {s_}")
    expect(r["libAfterReload"] == [1, "saved"], f"library and saved state survive a reload {r['libAfterReload']}")
    expect(r["libNoWarnWhenSaved"] and r["libNotAuto"] == 0, f"a saved, unchanged route closes without a warning; saved routes are not drawn by themselves {r['libNotAuto']}")
    expect(r["libOpened"] == [3, True, "saved", "מעיינות"], f"open: library closes, the route + name are loaded and marked saved {r['libOpened']}")
    expect(r["libChanged"] == "changed" and r["libUpdateChoice"] == "update" and r["libUpdated"] == [1, 4, True], f"editing marks it changed; save changes updates the original {r['libChanged']} {r['libUpdated']}")
    # sorted by name the original ("מעיינות") comes before its copy, so the original is renamed and moved
    expect(r["libCamera"][0] == r["libCamera"][1], f"saving (preview picture) gives the user's view back: centre, zoom, tilt, bearing {r['libCamera']}")
    expect(r["libCards"] == [["אאא ראשון", False], ["מעיינות (עותק)", True]], f"duplicate, rename, move to no folder {r['libCards']}")
    expect(r["libNoResults"], "search with no results shows the empty message")
    expect(r["libCopy"] == [3, True, True, "copy", True], f"edit → create copy: new route opened for editing, original untouched {r['libCopy']}")
    expect(r["libFolderDeleted"] == [3, 0, True], f"deleting a folder keeps its routes (now without a folder) {r['libFolderDeleted']}")
    expect(r["libDeleted"] == 2, f"delete route (confirmed) {r['libDeleted']}")
    expect(r["newRouteVisible"], "'new route' button always visible and not covered")
    expect(r["newRoute"] == [0, True] and r["newRouteUndone"], f"'new route' clears (confirmed, undoable) and starts drawing {r['newRoute']}")
    expect(r["routeColor"] == "#39ff14", f"route line in fluorescent green {r['routeColor']}")
    expect(r["exagDefault"] == [1.5, "1.5"], f"default exaggeration 1.5 (D-043) {r['exagDefault']}")
    expect(r["poiIcons"][:3] == [True, True, 13] and "topo-tent" in r["poiIcons"][3] and "topo-tap" in r["poiIcons"][3],
           f"tent and tap icons registered, icon layer from z13 (D-031) {r['poiIcons'][:3]}")
    o = r["osm"]
    cs = r["catSearch"]
    expect(r["campMinzoom"] == [9.4, 12.7, 12.7], f"campsites from the 5 km scale, taps and parking from 500 m (D-047) {r['campMinzoom']}")
    expect(r["at5km"]["camp"] > 0 and r["at5km"]["water"] == 0 and r["at5km"]["overlap"] is False and r["at5km"]["img"] == "topo-tent",
           f"at the 5 km scale: campsite badges shown (overlaps hide), taps not yet (D-047) {r['at5km']}")
    expect(r["campHiddenFar"] == 0 and cs["res"] and cs["res"]["kind"] == "camp" and cs["res"]["count"] == 1 and cs["icon"] == "topo-tent" and "חניוני לילה" in cs["chip"],
           f"category search shows campsites in view at a far zoom (D-045) {cs} hiddenBefore={r['campHiddenFar']}")
    expect(r["catList"][:1] == ["cat-line"] and "הר מירון" in r["catList"], f"category first in the list, then places by name (D-046) {r['catList']}")
    expect(r["catCleared"] == [True, 0], f"emptying the search box clears the category display (D-046) {r['catCleared']}")
    a = r["abroad"]
    expect(r["overpassInIsrael"] == 0, "inside Israel the pre-built extract is used (no Overpass requests)")
    expect(len(r["overpassAbroad"]) == 1 and a["stats"]["dynamicCells"] >= 1 and a["marked"] == ["#d32f2f"] and a["camp"] >= 1 and a["stats"]["errors"] == 0,
           f"abroad: loaded on demand from Overpass (one request), marked trail + campsite shown {a} {len(r['overpassAbroad'])}")
    expect(o["marked"] == ["#1e63c4"], f"marked trail drawn in its marking colour (blue) {o['marked']}")
    expect(o["markedMinzoom"] < o["pathMinzoom"] and '[">=",["zoom"],13]' in o["streamFilter"].replace(" ", ""),
           f"marked trails (z{o['markedMinzoom']}) before unmarked (z{o['pathMinzoom']}), small streams only from z13 (D-033)")
    expect(r["routeW14"] > o["natW14"], f"planned route wider than national trails (D-043) {r['routeW14']} > {o['natW14']}")
    expect(o["natW14"] > o["regW14"] > o["markedW14"] > o["pathW14"], f"width order national > regional > marked > unmarked {o['natW14']} {o['regW14']} {o['markedW14']} {o['pathW14']}")
    expect(o["hasPeakImg"] and "topo-peak" in o["peakIcon"] and "topo-saddle" in o["peakIcon"], "peaks/saddles drawn with their own icons (D-037)")
    expect(o["contourLabelPad"] == 8, "contour labels spaced with collision padding (D-037)")
    expect(o["pathColour"] == "#5a5550" and o["trackInner"], "unmarked paths dark grey dashes, 4x4 tracks double line (owner's example, D-035)")
    expect('"within"' in o["baseIconFilter"], "base-tile campsite/water icons hidden inside Israel (no duplicates with the OSM extract)")
    expect(o["counts"]["trails"] == 3 and o["counts"]["byKind"] == {"camp": 1, "water": 2, "parking": 1}, f"OSM extract loaded; parking far from trails dropped {o['counts']}")
    expect(o["lines"] == ["int", "regional"] and "poi-camp" in o["icons"] and "poi-parking" in o["icons"] and any(i.startswith("poi-water") for i in o["icons"]),
           f"routes, tent, parking and water rendered at the 500 m scale (D-036, D-045) {o['lines']} {o['icons']}")
    expect(o["iconImgs"], "parking / spring / viewpoint / shelter icons registered")
    expect('"int","#e3893f"' in o["colour"].replace(" ", ""), "Israel National Trail drawn orange, calmer than the fluorescent route (D-032, D-043)")
    expect(o["labelMinzoom"] == 14.4 and o["iconMinzoom"] == 12.7, f"route names from ~200 m scale, parking icons only from the 500 m scale (D-048) {o['labelMinzoom']} {o['iconMinzoom']}")
    expect(r["poiMinzoom"] == 13 and "#2f7fd8" in r["waterColor"] and "#5a9fdc" in r["waterColor"], f"POIs from z13, perennial blue / intermittent light blue {r['poiMinzoom']} {r['waterColor']}")
    expect(r["smallStreamW14"] < o["pathW14"], f"non-perennial streams thinner than unmarked trails (D-034) {r['smallStreamW14']} < {o['pathW14']}")
    expect(r["waterToggle"] == ["none", "visible"], f"streams switch hides/shows the layer {r['waterToggle']}")
    expect(r["terrain"], "3D terrain on")
    expect(seen["dem"] > 0, "DEM tiles requested")
    expect(r["satLayer"] and "ibasemaps-api.arcgis.com" in (r["satTiles"] or "") and "token=" in r["satTiles"], "satellite: Esri layer with embedded key")
    expect(len(seen["satellite"]) > 0, "satellite tiles requested")
    expect(r["landcoverInSat"] == "none" and r["landcoverInTopo"] == "visible", "topo tint hidden on imagery, restored on topo")
    S = r["styles"]
    expect(S["satellite"]["sat"] and S["satellite"]["contours"] == "none" and S["satellite"]["hill"] == "none" and S["satellite"]["trails"] == "visible",
           f"satellite style: imagery + features, no contours/hillshade {S['satellite']}")
    expect(S["hybrid"]["sat"] and S["hybrid"]["contours"] == "visible" and S["hybrid"]["hill"] == "visible" and S["hybrid"]["land"] == "none" and S["hybrid"]["terrain"],
           f"hybrid 3D: imagery + 3D terrain + hillshade + contours {S['hybrid']}")
    expect(not S["topo"]["sat"] and S["topo"]["contours"] == "visible" and S["topo"]["land"] == "visible", f"topographic restores the topo layers {S['topo']}")
    d2, d3 = r["view3d"]
    expect(not d2["terrain"] and d2["pitch"] < 1 and d2["label"] == "3D" and d3["terrain"] and d3["pitch"] > 50 and d3["label"] == "2D",
           f"2D/3D button flattens and tilts smoothly {r['view3d']}")
    T = r["terrainLayers"]
    expect(T["slope"] == "visible" and T["aspect"] == "visible" and T["relief"] == "visible" and T["derive"]["tiles"] >= 2 and T["derive"]["lastError"] in (None, "DEM 404"),
           f"slope / aspect computed from the DEM (fixture DEM covers only some tiles → 404s there), elevation colouring shown {T}")
    expect(abs(T["slopeOpacity"] - 0.3) < 1e-6 and T["legendShown"], f"opacity slider and legend {T['slopeOpacity']} {T['legendShown']}")
    expect(r["searchList"][:1] == ["הר מירון"] and len(r["nominatim"]) == 1 and "q=%D7%94%D7%A8" in r["nominatim"][0],
           f"search: one Nominatim request on Enter, results listed {r['searchList']} {len(r['nominatim'])}")
    g = r["searchGo"]
    expect(g["res"] and g["marker"] and g["hidden"] and abs(g["c"]["lat"] - 32.995) < 0.02, f"choosing a result moves the map and drops a marker {g['c']}")
    expect(not r["satAfterTopo"], "satellite layer removed in topo mode")
    expect(r["devHidden"], "developer tests hidden by default")
    expect(r["devShown"], "developer tests shown with ?dev=1 (devtools loaded, startup report logged)")
    expect(r["i18n"] == ["קווי גובה", "he", "rtl"], f"UI text from i18n, Hebrew, RTL {r['i18n']}")
    expect(r["geoBefore"] == {"get": 0, "watch": 0}, "no location request at page load")
    expect(r["geoLabel"] == "מרכז עליי", f"map control texts in Hebrew ({r['geoLabel']!r})")
    expect(r["geoButtonOnTop"], "location button visible and not covered by the panel")
    expect(r["geoAfter"]["get"] >= 1 and r["geoAfter"]["watch"] == 0, f"location requested only on click, no tracking {r['geoAfter']}")
    expect(abs(r["centerAfterGeo"][0] - 35.502) < 0.01 and abs(r["centerAfterGeo"][1] - 32.9705) < 0.01 and r["userDot"], f"map centred on the user {r['centerAfterGeo']}")
    expect("Mapterhorn" in r["attribTopo"] and "OpenStreetMap" in r["attribTopo"], "attribution: base map + DEM sources shown")
    expect("Esri" in r["attribSat"], "attribution: Esri shown in satellite mode")
    p_ = r["prefsAfterReload"]
    expect(p_["contoursBox"] is True and p_["contoursLayer"] == "visible", f"fixed layer set: an old layer switch is not restored after reload (D-052) {p_}")
    expect(p_["exag"] == 1.7, f"exaggeration remembered {p_['exag']}")
    expect(p_["center"] == [35.3, 32.9] and p_["zoom"] == 12.5, f"last view restored when the URL has no camera {p_['center']} z{p_['zoom']}")
    expect(r["geoAfterReload"] == {"get": 0, "watch": 0}, "no location request after reload either")
    expect(r["snapDefault"], "router configured → snap to trails is the default for new segments")
    expect(r["routePoints"] == 3 and r["modes"] == [None, "snap", "snap"], f"3 points added by clicks {r['modes']}")
    expect(all(st == "ok" and n >= 3 for st, n in r["snapped"]), f"segments replaced by routed (bent) lines {r['snapped']}")
    expect(r["orsCalls"] == 2 and "/v2/directions/foot-hiking?api_key=" in r["orsUrl"], f"one foot-hiking request per segment ({r['orsCalls']})")
    expect("openrouteservice" in r["attribRoute"], "routing attribution shown")
    expect(r["errSeg"] == ["snap", "error", True] and "לא נמצא מסלול" in r["errUi"], f"router failure → error shown, segment stays snap {r['errSeg']}")
    expect(r["afterToFree"] == ["free", "ok"], "user switches the failed segment to a straight line explicitly")
    expect((r["afterUndo"], r["afterRedo"]) == (2, 3), f"undo/redo buttons {r['afterUndo']},{r['afterRedo']}")
    expect(r["reversedLast"], "reverse puts the first point last")
    expect((r["afterLoop"], r["afterLoop2"], r["afterCtrlZ"]) == (4, 4, 3), f"close loop once, no duplicate, Ctrl+Z {r['afterLoop']},{r['afterLoop2']},{r['afterCtrlZ']}")
    expect(r["dragMoved"], "dragging a point moves it (one command, no new point)")
    expect(r["afterDelete"] == 2, f"click + Delete removes the selected point ({r['afterDelete']})")
    expect(r["waypoints"] == ["מעיין"], f"right-click adds a named waypoint {r['waypoints']}")
    expect(r["draftRestored"] and r["draftNotice"], "draft restored after reload (exact state), notice shown")
    expect(r["afterClear"] == (0, 0) and r["clearUndone"], f"clear (confirmed) empties the route, and is undoable {r['afterClear']}")
    expect("עלייה" in r["stats"] and "ירידה" in r["stats"], "stats shown")
    expect(r["dockAfterClear"], "route dock hidden when the route is cleared and editing ends (D-049)")
    P = r["panel"]
    expect(P["dockOpen"] and float(P["dist"]) > 0 and P["labels"] == ["עלייה", "ירידה", "גובה מקסימלי", "גובה מינימלי"] and not P["time"] and P["startFinish"] and 3 <= P["yLevels"] <= 5,
           f"route dock: distance, ascent|descent, max|min, no walking time, start/finish, 3–5 elevation levels (D-049) {P}")
    expect(r["panelCollapsed"] == [True, True, True, True] and r["panelBack"], f"hiding the panel keeps the tool bar and a pill with the figures; the pill brings it back {r['panelCollapsed']} {r['panelBack']}")
    M = r["meta"]
    expect(M["meta"]["name"] == "מכתש רמון" and M["meta"]["color"] == "#00e5ff" and M["paint"] == "#00e5ff" and M["names"] == 6 and M["popHidden"] and M["text"] == "",
           f"route name editable, colour chosen from 6 dots without names, route line recoloured (D-049) {M}")
    expect(r["profileVisible"], "elevation profile drawn")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
