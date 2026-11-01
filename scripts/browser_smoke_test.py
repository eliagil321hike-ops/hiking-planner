"""
Headless-Chromium smoke test for the Option B browser modules that do NOT need MapLibre:
  - dem-sampler.js: fetch WebP DEM tiles, decode via createImageBitmap/OffscreenCanvas, Terrarium decode
  - the reference-elevation encoding check incl. negative control (wrong encoding must fail)
  - profile.js renders an SVG and breaks the line at missing data
Mapterhorn is replaced by synthetic Terrarium tiles (lossless WebP, 512 px) generated here, so this tests
OUR pipeline in a real browser; it does not test Mapterhorn's data or MapLibre rendering.

Run from the repo root:  python3 scripts/browser_smoke_test.py
Needs: Python Playwright with Chromium, Pillow with WebP.
"""
import http.server
import io
import json
import math
import socketserver
import sys
import threading
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SIZE = 512


def tile_for(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    lat_r = math.radians(lat)
    y = (1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n
    return int(x), int(y)


def terrarium_webp(elev_fn):
    img = Image.new("RGBA", (SIZE, SIZE))
    px = img.load()
    for j in range(SIZE):
        for i in range(SIZE):
            v = elev_fn(i, j) + 32768
            r = int(v // 256)
            g = int(v) - r * 256
            b = round((v - math.floor(v)) * 256)
            if b == 256:
                g, b = g + 1, 0
            px[i, j] = (r, g, b, 255)
    buf = io.BytesIO()
    img.save(buf, "WEBP", lossless=True, exact=True)
    return buf.getvalue()


def pixel_in_tile(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    lat_r = math.radians(lat)
    y = (1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n
    return (x - int(x)) * SIZE, (y - int(y)) * SIZE


Z = 12
# One continuous synthetic surface in GLOBAL pixel coordinates, so any tile can be generated and
# sampling across tile borders is exercised:
#  - north of 32.5°N: cone peaking at 1208 m, ~500 m EAST of the published (rounded) Meron coordinate.
#    The published point lies ~200 m from the east edge of its z12 tile, so the apex is in the NEXT tile.
#  - west of 35°E (coast): flat 2 m;   - otherwise (Dead Sea): flat -425 m.
MERON = (35.4167, 33.0)
_mpp = math.cos(math.radians(33.0)) * 2 * math.pi * 6378137 / (SIZE * 2 ** Z)  # metres per pixel
_tx, _ty = tile_for(*MERON, Z)
_px, _py = pixel_in_tile(*MERON, Z)
APEX_GX = _tx * SIZE + _px + 500 / _mpp
APEX_GY = _ty * SIZE + _py


def surface_tile(tx, ty):
    n = 2 ** Z
    lon = (tx + 0.5) / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty + 0.5) / n))))
    if lat > 32.5:
        return terrarium_webp(lambda i, j: 1208 - 0.5 * math.hypot(tx * SIZE + i + 0.5 - APEX_GX, ty * SIZE + j + 0.5 - APEX_GY))
    if lon < 35:
        return terrarium_webp(lambda i, j: 2.0)
    return terrarium_webp(lambda i, j: -425.0)


NO_DATA_TILE = tile_for(35.0, 30.0, Z)  # simulate a missing tile → must become null, not 0
_cache = {}


def get_tile(x, y):
    if (x, y) == NO_DATA_TILE:
        return None
    if (x, y) not in _cache:
        _cache[(x, y)] = surface_tile(x, y)
    return _cache[(x, y)]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def log_message(self, *a):
        pass


def main():
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Quiet)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}/site/"

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        def dem_route(route):
            z, x, y = route.request.url.split("/")[-3:]
            body = get_tile(int(x), int(y.split(".")[0])) if int(z) == Z else None
            if body is not None:
                route.fulfill(status=200, body=body, headers={"content-type": "image/webp", "access-control-allow-origin": "*"})
            else:
                route.fulfill(status=404, body=b"", headers={"access-control-allow-origin": "*"})

        page.route("https://tiles.mapterhorn.com/**", dem_route)
        page.goto(base + "../../README.md")  # any same-origin page so module imports resolve
        result = page.evaluate(
            """async (base) => {
              const { createDemSampler } = await import(base + 'dem-sampler.js');
              const geo = await import(base + 'vendor/geo/index.js');
              const { renderProfile } = await import(base + 'profile.js');
              const DEM = { urlTemplate: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp', tileSize: 512, zoom: 12 };
              const good = createDemSampler({ ...DEM, encoding: 'terrarium' });
              const bad = createDemSampler({ ...DEM, encoding: 'mapbox' });
              const out = {};
              // exact value at the cone apex region: max within 1200 m must be ~1208
              const refs = geo.ISRAEL_REFERENCE_POINTS;
              async function measure(s, r) {
                if (r.mode === 'point') return s.elevationAt(r.point);
                const dLat = r.searchRadiusM / 111320, dLon = r.searchRadiusM / (111320 * Math.cos(r.point[1] * Math.PI / 180));
                const pts = [];
                for (let y = -1; y <= 1; y += 0.02) for (let x = -1; x <= 1; x += 0.02) if (x*x + y*y <= 1) pts.push([r.point[0] + x*dLon, r.point[1] + y*dLat]);
                const v = (await s.elevations(pts)).filter((e) => e !== null);
                return v.length ? Math.max(...v) : null;
              }
              async function check(s) {
                const m = new Map();
                for (const r of refs) m.set(r.name, await measure(s, r));
                const byPt = new Map(refs.map((r) => [r.point, r.name]));
                return geo.checkReferenceElevations(refs, (p) => m.get(byPt.get(p)));
              }
              const res = await check(good);
              out.good = res.map((r) => ({ name: r.name, measured: r.measured, pass: r.pass }));
              try { await check(bad); out.negative = 'NOT DETECTED'; }
              catch (e) { out.negative = e.name; out.negativeSample = e.results[0].measured; }
              // bytes survive the browser image pipeline exactly: single pixel at a known spot
              out.coastExact = await good.elevationAt([34.7668, 32.0836]);
              // missing tile -> null, never 0
              out.missing = await good.elevationAt([35.0, 30.0]);
              // z13 requested, only z12 exists in the fixture -> falls back to z12, same value
              const z13 = createDemSampler({ ...DEM, zoom: 13, fallbackMinZoom: 12, encoding: 'terrarium' });
              out.fallback = await z13.elevationAt([34.7668, 32.0836]);
              out.fallbackZooms = Object.fromEntries(z13.zoomUsed);
              out.fallbackMissing = await z13.elevationAt([35.0, 30.0]);
              // profile breaks at null
              const div = document.createElement('div'); div.style.width = '400px'; div.style.height = '150px'; document.body.append(div);
              renderProfile(div, [{distance:0,elevation:100},{distance:20,elevation:110},{distance:40,elevation:null},{distance:60,elevation:120},{distance:80,elevation:125}], () => {});
              // satellite provider config: key required → null without key; key is URL-encoded into the URL
              const { satelliteSource } = await import(base + 'satellite.js');
              const ov = await (await fetch(base + 'styles/topo3d.json')).json();
              const prov = Object.fromEntries(ov.satellite.providers.map((p) => [p.id, p]));
              out.satEox = satelliteSource(prov['eox-s2-2024'], null)?.tiles[0];
              out.satEsriNoKey = satelliteSource(prov['esri-world-imagery'], '');
              out.satEsriKey = satelliteSource(prov['esri-world-imagery'], 'a/b+c')?.tiles[0];
              out.noMapbox = !prov['mapbox-satellite'];
              out.esriEmbedded = !!prov['esri-world-imagery'].embeddedKey && ov.satellite.default === 'esri-world-imagery';
              out.satMaptiler = satelliteSource(prov['maptiler-satellite'], 'k1')?.url;
              out.profileAreas = div.querySelectorAll('path.profile-area').length;
              out.profileSegs = div.querySelectorAll('line.profile-seg').length;
              out.profileColors = [...new Set([...div.querySelectorAll('line.profile-seg')].map((l) => l.getAttribute('stroke')))];
              return out;
            }""",
            base,
        )
        browser.close()
    httpd.shutdown()

    print(json.dumps(result, indent=2, ensure_ascii=False))
    ok = True

    def expect(cond, msg):
        nonlocal ok
        print(("PASS " if cond else "FAIL ") + msg)
        ok &= bool(cond)

    expect(all(r["pass"] for r in result["good"]), "terrarium decoding passes all 3 reference points")
    expect(abs(result["good"][0]["measured"] - 1208) < 1, "Meron max within radius ≈ 1208 m (cone apex)")
    expect(result["negative"] == "EncodingCheckError", "negative control: 'mapbox' decoding is rejected loudly")
    expect(result["coastExact"] == 2.0, "WebP bytes survive browser decoding exactly (coast = 2.0 m)")
    expect(result["missing"] is None, "missing DEM tile gives null, not 0")
    expect(result["fallback"] == 2.0 and result["fallbackZooms"] == {"12": 1}, "z13 missing → falls back to z12 (same value)")
    expect(result["fallbackMissing"] is None, "no tile at z13 or z12 → null")
    expect(result["satEox"] and "{z}/{y}/{x}" in result["satEox"] and "{key}" not in result["satEox"], "EOX satellite needs no key, z/y/x order kept")
    expect(result["satEsriNoKey"] is None, "Esri without a key → no source (never a broken URL)")
    expect(result["satEsriKey"] and "token=a%2Fb%2Bc" in result["satEsriKey"], "Esri key is URL-encoded into the tile URL")
    expect(result["esriEmbedded"], "Esri has the owner's embedded key and is the default satellite (D-021)")
    expect(result["noMapbox"], "Mapbox removed (owner: free only, D-018)")
    expect(result["satMaptiler"] and result["satMaptiler"].endswith("tiles.json?key=k1"), "MapTiler uses its TileJSON URL")
    expect(result["profileAreas"] == 2 and result["profileSegs"] == 2, "profile area and slope line break at missing data (2 runs, 2 segments)")
    expect(len(result["profileColors"]) >= 1, f"slope colours drawn {result['profileColors']}")
    expect(not errors, f"no page errors {errors}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
