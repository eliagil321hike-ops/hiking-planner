"""D-077 (A1): tests of the installable desktop app (manifest + shell service worker + update notice).

The site is copied, stamped like the real deploy (scripts/stamp_build.sh) and served under /hiking-planner/,
as on GitHub Pages. Map content comes from the e2e fixtures (context.route also reaches the worker's own
requests). Checks:
  1. manifest valid and the page installable (Chromium's own installability check: no errors)
  2. the worker controls the page; its scope is /hiking-planner/
  3. online, map content (tiles/DEM/style) never goes through the worker; shell files do
  4. offline, the app opens again from the shell (start page, app.js, styles, fonts, MapLibre)
  5. a new deploy while the app is open → "גרסה חדשה זמינה – רענן"; a tap reloads into the new build
  6. after the reload the page runs the new build and old-build copies are dropped from the cache
Run: python3 scripts/pwa_test.py
"""
import http.server
import json
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import e2e_test as e2e  # noqa: E402  (fixtures: MapLibre build, style, DEM)
fx = e2e.fx

FAILS = []


def expect(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def deploy(root, build):
    """Copy site/ to <root>/hiking-planner and stamp it with `build`, like CI does."""
    dst = root / "hiking-planner"
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(ROOT / "site", dst, ignore=shutil.ignore_patterns("data"))
    subprocess.run(["bash", str(ROOT / "scripts" / "stamp_build.sh"), str(dst), build], check=True, capture_output=True)


def main():
    tmp = Path(tempfile.mkdtemp(prefix="pwa-"))
    deploy(tmp, "build-a")

    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(tmp), **kw)

        def end_headers(self):
            self.send_header("Cache-Control", "max-age=600")   # like GitHub Pages
            super().end_headers()

        def log_message(self, *a):
            pass

    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://localhost:{port}/hiking-planner/"
    ml_js, ml_css = e2e.maplibre_files()
    map_requests = {"via_worker": [], "all": 0}

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})

        def unpkg(route):
            u = route.request.url
            if u.endswith("maplibre-gl.js"):
                return route.fulfill(body=ml_js, headers={"content-type": "text/javascript", "access-control-allow-origin": "*"})
            if u.endswith("maplibre-gl.css"):
                return route.fulfill(body=ml_css, headers={"content-type": "text/css", "access-control-allow-origin": "*"})
            if "maplibre-contour" in u:
                return route.fulfill(body=e2e.CONTOUR_STUB, headers={"content-type": "text/javascript", "access-control-allow-origin": "*"})
            return route.fulfill(body=b"", headers={"content-type": "text/javascript", "access-control-allow-origin": "*"})

        def mapdata(route):
            map_requests["all"] += 1
            if route.request.service_worker:
                map_requests["via_worker"].append(route.request.url)
            u = route.request.url
            if "openfreemap" in u and "/styles/" in u:
                return route.fulfill(body=json.dumps(e2e.FIXTURE_STYLE), headers={"content-type": "application/json", "access-control-allow-origin": "*"})
            if "mapterhorn" in u:
                z, x, y = u.split("/")[-3:]
                body = fx.get_tile(int(x), int(y.split(".")[0])) if int(z) == fx.Z else None
                if body:
                    return route.fulfill(body=body, headers={"content-type": "image/webp", "access-control-allow-origin": "*"})
            return route.fulfill(status=404, body=b"", headers={"access-control-allow-origin": "*"})

        ctx.route("https://unpkg.com/**", unpkg)
        for host in ("https://tiles.openfreemap.org/**", "https://tiles.mapterhorn.com/**", "https://*.arcgis.com/**",
                     "https://tiles.maps.eox.at/**", "https://api.openrouteservice.org/**", "https://overpass-api.de/**"):
            ctx.route(host, mapdata)

        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(base)
        e2e.wait_js(page, "() => !!window.__topo3d?.results?.pwa?.sw", 90)
        page.evaluate("() => navigator.serviceWorker.ready")
        e2e.wait_js(page, "() => !!navigator.serviceWorker.controller", 30)
        pwa = page.evaluate("() => window.__topo3d.results.pwa")
        expect(pwa["sw"] == base and not pwa["native"], f"worker registered for /hiking-planner/ {pwa}")

        # 1. installability (Chromium's own check) and the manifest
        cdp = ctx.new_cdp_session(page)
        inst = cdp.send("Page.getInstallabilityErrors")
        expect(inst.get("installabilityErrors") == [], f"installable: no installability errors {inst}")
        man = page.evaluate("async () => (await fetch('manifest.webmanifest')).json()")
        expect(man["name"] == "Topo3D" and man["lang"] == "he" and man["dir"] == "rtl" and man["display"] == "standalone"
               and man["start_url"] == "./" and man["scope"] == "./", f"manifest: name, he, rtl, standalone, scope ./ {man}")
        sizes = sorted(i["sizes"] for i in man["icons"])
        expect(sizes == ["192x192", "512x512", "512x512"] and any(i["purpose"] == "maskable" for i in man["icons"]), f"icons 192/512 + maskable {sizes}")

        # 3. map content is not handled by the worker (page-level requests only)
        e2e.wait_js(page, "() => window.__topo3d.map?.loaded?.()", 120)
        page.reload()
        e2e.wait_js(page, "() => window.__topo3d?.map?.loaded?.()", 120)
        expect(map_requests["all"] > 0 and not map_requests["via_worker"], f"map content bypasses the worker ({map_requests['all']} requests, via worker: {map_requests['via_worker'][:3]})")
        shell = page.evaluate("""async () => { const c = await caches.open('topo3d-shell-v1'); return (await c.keys()).map((r) => r.url); }""")
        has = lambda part: any(part in u for u in shell)
        expect(has("/hiking-planner/") and has("app.js?v=build-a") and has("style.css?v=build-a") and has("topo3d.json?v=build-a")
               and has("maplibre-gl.js") and has(".woff2") and has("icons/icon-192.png") and not has("/data/"), f"shell cached ({len(shell)} files), no map data")

        # 4. offline: the app opens from the shell
        ctx.set_offline(True)
        page.reload()
        e2e.wait_js(page, "() => !!window.__topo3d?.results?.pwa", 90)
        off = page.evaluate("() => ({ title: document.title, toolbar: !!document.querySelector('.toolbar'), ml: typeof maplibregl, dir: document.documentElement.dir })")
        expect(off["toolbar"] and off["ml"] == "object" and off["dir"] == "rtl", f"offline: the app opens (toolbar, MapLibre, RTL) {off}")
        ctx.set_offline(False)

        # 5. a new deploy while the app is open → the notice; a tap reloads into the new build
        page.reload()
        e2e.wait_js(page, "() => !!window.__topo3d?.results?.pwa", 90)
        before = page.evaluate("() => window.__topo3d.ctx?.BUILD ?? document.querySelector('script[type=module][src*=app]')?.src")
        deploy(tmp, "build-b")
        page.evaluate("() => document.dispatchEvent(new Event('visibilitychange'))")
        e2e.wait_js(page, "() => !!document.getElementById('app-update') && !document.getElementById('app-update').hidden", 30)
        note = page.evaluate("() => { const b = document.getElementById('app-update'); const r = b.getBoundingClientRect(); return { text: b.textContent, cls: b.className, w: r.width, h: r.height }; }")
        expect(note["text"] == "גרסה חדשה זמינה – רענן" and "status" in note["cls"] and "toast" in note["cls"], f"new deploy → notice {note} (page was {before})")
        page.screenshot(path=str(tmp / "update-notice.png"))
        shutil.copy(tmp / "update-notice.png", ROOT / ".cache" / "pwa-update-notice.png")
        page.click("#app-update")
        page.wait_for_load_state("load")
        e2e.wait_js(page, "() => !!window.__topo3d?.results?.pwa", 90)
        src = page.evaluate("() => document.querySelector('script[type=module][src^=\"app.js\"]').getAttribute('src')")
        expect(src == "app.js?v=build-b", f"after the tap the page runs the new build ({src})")
        # 6. copies of the old build are dropped
        page.wait_for_timeout(1500)
        shell = page.evaluate("""async () => { const c = await caches.open('topo3d-shell-v1'); return (await c.keys()).map((r) => r.url); }""")
        expect(not any("v=build-a" in u for u in shell), f"old build dropped from the cache ({sum('v=build-a' in u for u in shell)} left)")
        expect(not [e for e in errors if "pwa" in e.lower() or "serviceworker" in e.lower()], f"no worker errors {errors[:3]}")
        browser.close()
    httpd.shutdown()
    print(f"\n{len(FAILS)} failed" if FAILS else "\nall passed")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
