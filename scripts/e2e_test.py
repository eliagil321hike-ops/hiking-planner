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
    "sources": {"openmaptiles": {"type": "vector", "tiles": ["https://tiles.openfreemap.org/fixture/{z}/{x}/{y}.pbf"], "maxzoom": 14}},
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
    seen = {"satellite": [], "dem": 0}

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        page = browser.new_page(viewport={"width": 1280, "height": 800})
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

        page.route("https://unpkg.com/**", unpkg)
        page.route("https://tiles.openfreemap.org/**", openfreemap)
        page.route("https://tiles.mapterhorn.com/**", dem)
        page.route("https://ibasemaps-api.arcgis.com/**", satellite)
        page.route("https://tiles.maps.eox.at/**", satellite)

        # The DEM fixture only has z12; open at z12 so terrain loads real fixture tiles.
        page.goto(f"http://127.0.0.1:{port}/?demz=12#12/33.0/35.4167/0/0")
        page.wait_for_function("() => window.__topo3d && window.__topo3d.results.topo", timeout=60_000)
        page.wait_for_function("() => window.__topo3d.map.loaded()", timeout=60_000)

        r = {}
        r["topo"] = page.evaluate("() => window.__topo3d.results.topo")
        r["layers"] = page.evaluate("""() => { const m = window.__topo3d.map;
            return ['topo-landcover','topo-hillshade','topo-contours-minor','topo-trails-path','topo-peaks','route-line']
              .filter((id) => !!m.getLayer(id)); }""")
        r["terrain"] = page.evaluate("() => !!window.__topo3d.map.getTerrain()")
        r["fatal"] = page.evaluate("() => document.getElementById('fatal')?.textContent ?? null")
        r["devHidden"] = page.evaluate("() => document.getElementById('dev-section').hidden && document.getElementById('fps').hidden")
        r["i18n"] = page.evaluate("() => [document.querySelector('[data-i18n=\\'layers.contours\\']').textContent, document.documentElement.lang, document.documentElement.dir]")

        # Background switch → satellite (Esri default, embedded key)
        page.click("input[name=base][value=satellite]")
        page.wait_for_timeout(1500)
        r["satLayer"] = page.evaluate("() => !!window.__topo3d.map.getLayer('satellite')")
        r["satTiles"] = page.evaluate("() => window.__topo3d.map.getStyle().sources.satellite?.tiles?.[0] ?? null")
        r["landcoverInSat"] = page.evaluate("() => window.__topo3d.map.getLayoutProperty('topo-landcover','visibility')")
        page.click("input[name=base][value=topo]")
        page.wait_for_timeout(500)
        r["satAfterTopo"] = page.evaluate("() => !!window.__topo3d.map.getLayer('satellite')")
        r["landcoverInTopo"] = page.evaluate("() => window.__topo3d.map.getLayoutProperty('topo-landcover','visibility')")

        # Draw a 3-point line in the map's free area (panel is on the left in RTL)
        page.click("#draw")
        for x, y in [(800, 300), (900, 380), (1000, 330)]:
            page.mouse.click(x, y)
            page.wait_for_timeout(300)
        page.wait_for_function("() => document.getElementById('stats').textContent.includes('מרחק')", timeout=20_000)
        r["stats"] = page.inner_text("#stats")
        r["profileVisible"] = page.evaluate("() => !document.getElementById('profile').hidden && !!document.querySelector('#profile svg path.profile-area')")
        r["routePoints"] = page.evaluate("async () => (await window.__topo3d.map.getSource('route').getData()).features.filter(f => f.geometry.type === 'Point').length")
        # Developer mode: test panel visible and the devtools module loaded
        page.goto(f"http://127.0.0.1:{port}/?demz=12&dev=1#12/33.0/35.4167/0/0", wait_until="domcontentloaded", timeout=60_000)
        page.wait_for_function("() => window.__topo3d && window.__topo3d.results.topo && window.__topo3d.map.loaded()", timeout=60_000)
        page.wait_for_function("() => document.getElementById('test-out').textContent.includes('hidden base layers')", timeout=30_000)
        r["devShown"] = page.evaluate("() => !document.getElementById('dev-section').hidden && !document.getElementById('fps').hidden")
        try:  # best effort: software WebGL can keep the page busy
            page.screenshot(path=str(CACHE / "e2e.png"), timeout=15_000)
        except Exception as e:  # noqa: BLE001
            print(f"(screenshot skipped: {type(e).__name__})")
        browser.close()
    httpd.shutdown()

    import re
    if r.get("satTiles"):
        r["satTiles"] = re.sub(r"token=[^&]+", "token=<redacted>", r["satTiles"])  # CI logs are public
    print(json.dumps({k: v for k, v in r.items() if k != "topo"} | {"hidden": r["topo"]["hidden"], "renamed": r["topo"]["renamed"], "labelFont": r["topo"]["labelFont"], "demRequests": seen["dem"], "satelliteRequests": len(seen["satellite"])}, ensure_ascii=False, indent=2))
    ok = True

    def expect(cond, msg):
        nonlocal ok
        print(("PASS " if cond else "FAIL ") + msg)
        ok &= bool(cond)

    expect(not errors and r["fatal"] is None, f"boots without page errors {errors} {r['fatal']}")
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
    expect(r["routePoints"] == 3, "3 route points drawn")
    expect("מרחק" in r["stats"] and "עלייה" in r["stats"], "stats shown")
    expect(r["profileVisible"], "elevation profile drawn")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
