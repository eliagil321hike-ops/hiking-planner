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

        page.route("https://api.openrouteservice.org/**", route_ors)
        page.route("https://unpkg.com/**", unpkg)
        page.route("https://tiles.openfreemap.org/**", openfreemap)
        page.route("https://tiles.mapterhorn.com/**", dem)
        page.route("https://ibasemaps-api.arcgis.com/**", satellite)
        page.route("https://tiles.maps.eox.at/**", satellite)

        # The DEM fixture only has z12; open at z12 so terrain loads real fixture tiles.
        page.goto(f"http://127.0.0.1:{port}/?demz=12#12/33.0/35.4167/0/0")
        page.wait_for_function("() => window.__topo3d && window.__topo3d.results.topo", polling=250, timeout=60_000)
        page.wait_for_function("() => window.__topo3d.map.loaded()", polling=250, timeout=60_000)

        r = {}
        r["topo"] = page.evaluate("() => window.__topo3d.results.topo")
        r["layers"] = page.evaluate("""() => { const m = window.__topo3d.map;
            return ['topo-landcover','topo-hillshade','topo-contours-minor','topo-trails-path','topo-peaks','route-line']
              .filter((id) => !!m.getLayer(id)); }""")
        r["terrain"] = page.evaluate("() => !!window.__topo3d.map.getTerrain()")
        r["fatal"] = page.evaluate("() => document.getElementById('fatal')?.textContent ?? null")
        r["devHidden"] = page.evaluate("() => document.getElementById('dev-section').hidden && document.getElementById('fps').hidden")
        r["geoBefore"] = page.evaluate("() => ({ ...window.__geoCalls })")
        r["attribTopo"] = page.evaluate("() => document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent ?? ''")
        r["geoLabel"] = page.evaluate("() => document.querySelector('.maplibregl-ctrl-geolocate')?.getAttribute('title') ?? ''")
        r["i18n"] = page.evaluate("() => [document.querySelector('[data-i18n=\\'layers.contours\\']').textContent, document.documentElement.lang, document.documentElement.dir]")

        # Background switch → satellite (Esri default, embedded key)
        page.click("input[name=base][value=satellite]")
        page.wait_for_timeout(1500)
        r["satLayer"] = page.evaluate("() => !!window.__topo3d.map.getLayer('satellite')")
        r["satTiles"] = page.evaluate("() => window.__topo3d.map.getStyle().sources.satellite?.tiles?.[0] ?? null")
        r["landcoverInSat"] = page.evaluate("() => window.__topo3d.map.getLayoutProperty('topo-landcover','visibility')")
        r["attribSat"] = page.evaluate("() => document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent ?? ''")
        page.click("input[name=base][value=topo]")
        page.wait_for_timeout(500)
        r["satAfterTopo"] = page.evaluate("() => !!window.__topo3d.map.getLayer('satellite')")
        r["landcoverInTopo"] = page.evaluate("() => window.__topo3d.map.getLayoutProperty('topo-landcover','visibility')")

        # ---- Route editor (Phase 3A). No router configured yet → new segments are free (straight).
        page.on("dialog", lambda d: d.accept())          # "clear route?" confirmation
        r["snapDefault"] = page.evaluate("() => !document.querySelector('#seg-mode option[value=snap]').disabled && document.getElementById('seg-mode').value === 'snap'")
        # Panel buttons are pressed from inside the page (same handlers): with software WebGL the renderer can be
        # too busy to acknowledge synthetic mouse input in time. Map gestures below stay real mouse input.
        btn = lambda sel: page.evaluate(f"() => document.querySelector('{sel}').click()")
        btn("#plan")
        for x, y in [(800, 300), (900, 380), (1000, 330)]:
            page.mouse.click(x, y)
            page.wait_for_timeout(300)
        ed = "window.__topo3d.editor"
        nverts = lambda: page.evaluate(f"() => {ed}.state.vertices.length")
        page.wait_for_function("() => document.getElementById('stats').textContent.includes('מרחק')", polling=250, timeout=20_000)
        r["stats"] = page.inner_text("#stats")
        r["profileVisible"] = page.evaluate("() => !document.getElementById('profile').hidden && !!document.querySelector('#profile svg path.profile-area')")
        r["routePoints"] = nverts()
        r["modes"] = page.evaluate(f"() => {ed}.state.vertices.map(v => v.mode)")
        page.wait_for_function(f"() => {ed}.segments().every(s => s.status === 'ok')", polling=250, timeout=20_000)
        r["snapped"] = page.evaluate(f"() => {ed}.segments().map(s => [s.status, s.geometry.length])")
        r["orsCalls"] = len(seen["ors"])
        r["orsUrl"] = seen["ors"][0] if seen["ors"] else ""
        r["attribRoute"] = page.evaluate("() => document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent ?? ''")
        # Router failure: segment shows an error, stays snap (never silently straight); user can switch it
        ors["fail"] = True
        page.mouse.click(1050, 250)
        page.wait_for_function(f"() => {ed}.segments().at(-1).status === 'error'", polling=250, timeout=20_000)
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
        page.wait_for_function("() => window.__topo3d && window.__topo3d.results.topo && window.__topo3d.map.loaded()", polling=250, timeout=60_000)
        r["draftRestored"] = page.evaluate(f"() => JSON.stringify({ed}.state)") == draft_before
        if not r["draftRestored"]:
            print("draft before:", draft_before[:300]); print("draft after:", page.evaluate(f"() => JSON.stringify({ed}.state)")[:300])
        r["draftNotice"] = page.inner_text("#status")
        # Clear (confirmed) → empty; undo brings it back
        btn("#plan"); btn("#r-clear"); page.wait_for_timeout(300)
        r["afterClear"] = (nverts(), page.evaluate(f"() => {ed}.state.waypoints.length"))
        page.keyboard.press("Control+z")
        r["clearUndone"] = page.evaluate(f"() => {ed}.state.waypoints.length") == 1

        # "Center on me": one location request, map moves to it, no tracking
        # Clicked from inside the page (same handler as a mouse click): with software WebGL the renderer is too
        # busy to acknowledge synthetic mouse input on map controls in time. Visibility/on-top was verified.
        r["geoButtonOnTop"] = page.evaluate("""() => { const b = document.querySelector('.maplibregl-ctrl-geolocate');
            const q = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2)); }""")
        page.evaluate("() => document.querySelector('.maplibregl-ctrl-geolocate').click()")
        page.wait_for_function("() => window.__geoCalls.get > 0", polling=250, timeout=10_000)
        page.wait_for_timeout(2500)
        r["geoAfter"] = page.evaluate("() => ({ ...window.__geoCalls })")
        r["centerAfterGeo"] = page.evaluate("() => window.__topo3d.map.getCenter().toArray()")
        r["userDot"] = page.evaluate("() => !!document.querySelector('.maplibregl-user-location-dot')")

        # Remembered settings: switch contours off, change exaggeration, move; reload WITHOUT a hash
        page.uncheck("input[data-group=contours]")
        page.evaluate("() => { const e = document.getElementById('exag'); e.value = '1.7'; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); }")
        page.evaluate("() => window.__topo3d.map.jumpTo({ center: [35.3, 32.9], zoom: 12.5, pitch: 30, bearing: 10 })")
        page.wait_for_timeout(500)
        page.goto(f"http://127.0.0.1:{port}/?demz=12", wait_until="domcontentloaded", timeout=60_000)
        page.wait_for_function("() => window.__topo3d && window.__topo3d.results.topo && window.__topo3d.map.loaded()", polling=250, timeout=60_000)
        r["prefsAfterReload"] = page.evaluate("""() => { const m = window.__topo3d.map; const c = m.getCenter();
            return { contoursBox: document.querySelector('input[data-group=contours]').checked,
                     contoursLayer: m.getLayoutProperty('topo-contours-minor', 'visibility'),
                     exag: m.getTerrain()?.exaggeration, center: [+c.lng.toFixed(3), +c.lat.toFixed(3)], zoom: +m.getZoom().toFixed(1) }; }""")
        r["geoAfterReload"] = page.evaluate("() => ({ ...window.__geoCalls })")

        # Developer mode: test panel visible and the devtools module loaded
        page.goto(f"http://127.0.0.1:{port}/?demz=12&dev=1#12/33.0/35.4167/0/0", wait_until="domcontentloaded", timeout=60_000)
        page.wait_for_function("() => window.__topo3d && window.__topo3d.results.topo && window.__topo3d.map.loaded()", polling=250, timeout=60_000)
        page.wait_for_function("() => document.getElementById('test-out').textContent.includes('hidden base layers')", polling=250, timeout=30_000)
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
    expect(set(r["topo"]["hidden"]) == {"road_path_pedestrian", "mountain_peak"}, "base trail and peak layers hidden by schema (not road_major)")
    expect(r["topo"]["renamed"] == 2, "Hebrew-first names on name labels only (water_name, place_label; not the ref shield)")
    expect(r["topo"]["labelFont"] == ["Noto Sans Regular"], "Regular label font chosen over the first (Italic) one")
    expect(len(r["layers"]) == 6, f"Topo3D + route layers present {r['layers']}")
    expect(r["terrain"], "3D terrain on")
    expect(seen["dem"] > 0, "DEM tiles requested")
    expect(r["satLayer"] and "ibasemaps-api.arcgis.com" in (r["satTiles"] or "") and "token=" in r["satTiles"], "satellite: Esri layer with embedded key")
    expect(len(seen["satellite"]) > 0, "satellite tiles requested")
    expect(r["landcoverInSat"] == "none" and r["landcoverInTopo"] == "visible", "topo tint hidden on imagery, restored on topo")
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
    expect(p_["contoursBox"] is False and p_["contoursLayer"] == "none", f"layer switch remembered after reload {p_}")
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
    expect(r["draftRestored"] and "שוחזרה" in r["draftNotice"], "draft restored after reload, with a notice")
    expect(r["afterClear"] == (0, 0) and r["clearUndone"], f"clear (confirmed) empties the route, and is undoable {r['afterClear']}")
    expect("מרחק" in r["stats"] and "עלייה" in r["stats"], "stats shown")
    expect(r["profileVisible"], "elevation profile drawn")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
