"""D-078 (A1): open the APK on an Android emulator and check it from inside the WebView (CI, wip/a1 only).

Needs adb (the emulator runner) and websocket-client. The debug build allows WebView debugging, so the page is
reached over the DevTools protocol. A release build does not (then only the screenshot and logcat are kept).
Writes <out>/emulator.png, <out>/emulator-back.png and <out>/emulator.json.
Usage: python3 scripts/apk_smoke.py <apk> <out_dir>
"""
import glob
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

PKG = "io.github.eliagil321hikeops.topo3d"


def sh(*a, check=True, **kw):
    r = subprocess.run(list(a), capture_output=True, text=True, **kw)
    if check and r.returncode:
        raise RuntimeError(f"{a}: {r.stderr or r.stdout}")
    return r.stdout


def adb(*a, **kw):
    return sh("adb", *a, **kw)


def screenshot(path):
    with open(path, "wb") as f:
        f.write(subprocess.run(["adb", "exec-out", "screencap", "-p"], capture_output=True).stdout)


class Page:
    """Minimal DevTools client: Runtime.evaluate on the app's WebView."""

    def __init__(self):
        import websocket
        pid = adb("shell", "pidof", PKG).strip()
        adb("forward", "tcp:9222", f"localabstract:webview_devtools_remote_{pid}")
        for _ in range(30):
            try:
                targets = json.load(urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=5))
                page = next(t for t in targets if t.get("type") == "page")
                break
            except Exception:
                time.sleep(2)
        else:
            raise RuntimeError("no WebView page to debug")
        self.ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=60, suppress_origin=True)
        self.n = 0

    def js(self, expr):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": "Runtime.evaluate",
                                 "params": {"expression": expr, "awaitPromise": True, "returnByValue": True}}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == self.n:
                r = m.get("result", {})
                if "exceptionDetails" in r:
                    return {"error": r["exceptionDetails"].get("text")}
                return r.get("result", {}).get("value")

    def wait(self, expr, secs=120):
        end = time.time() + secs
        while time.time() < end:
            if self.js(expr):
                return True
            time.sleep(2)
        return False


def main(apk, out):
    out = Path(out); out.mkdir(parents=True, exist_ok=True)
    res = {"apk": Path(apk).name, "android": adb("shell", "getprop", "ro.build.version.release").strip()}
    pkg = adb("shell", "dumpsys", "package", "com.google.android.webview")
    res["webview"] = (re.search(r"versionName=(\S+)", pkg) or [None, None])[1]
    adb("install", "-r", apk)
    adb("logcat", "-c")
    adb("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")
    time.sleep(25)
    res["running"] = bool(adb("shell", "pidof", PKG, check=False).strip())
    try:
        p = Page()
        res["mapLoaded"] = p.wait("!!window.__topo3d?.map?.loaded?.()", 150)
        time.sleep(10)
        res["inside"] = p.js("""(async () => {
            const r = window.__topo3d.results, m = window.__topo3d.map;
            localStorage.setItem('topo3d.apkcheck', 'ok');
            const idb = await new Promise((ok) => { const q = indexedDB.open('topo3d-apkcheck', 1); q.onsuccess = () => ok('ok'); q.onerror = () => ok('error'); });
            const live = await fetch('https://eliagil321hike-ops.github.io/hiking-planner/data/osm/index.json').then((x) => x.status).catch((e) => 'error ' + e.message);
            return { native: r.native, pwa: r.pwa, origin: location.origin, viewport: document.querySelector('meta[name=viewport]').content,
              terrain: !!m.getTerrain(), layers: m.getStyle().layers.length, background: r.background,
              localStorage: localStorage.getItem('topo3d.apkcheck'), indexedDB: idb, osmIndexFromLiveSite: live,
              osmIndexPath: window.__topo3d.ctx?.overlay?.osmExtract?.loader?.index ?? null,
              inner: [innerWidth, innerHeight], dpr: devicePixelRatio,
              fatal: document.getElementById('fatal')?.textContent ?? null };
          })()""")
        screenshot(out / "emulator.png")
        # Back button: open the map-style menu, press back → the menu closes (the site's own Escape)
        p.js("document.getElementById('btn-style').click()")
        time.sleep(1)
        opened = p.js("document.getElementById('btn-style').getAttribute('aria-expanded')")
        adb("shell", "input", "keyevent", "4")
        time.sleep(2)
        res["back"] = {"menuOpened": opened, "afterBack": p.js("document.getElementById('btn-style').getAttribute('aria-expanded')"),
                       "handled": p.js("window.__topo3d.results.native?.back ?? null"),
                       "stillRunning": bool(adb("shell", "pidof", PKG, check=False).strip())}
        screenshot(out / "emulator-back.png")
        # Location: nothing asked before the button; pressing "center on me" asks Android's permission once
        perms = lambda: adb("shell", "dumpsys", "package", PKG, check=False)
        granted = lambda: "ACCESS_FINE_LOCATION: granted=true" in perms() or "ACCESS_COARSE_LOCATION: granted=true" in perms()
        top = lambda: adb("shell", "dumpsys", "activity", "activities", check=False)
        res["location"] = {"askedBeforePress": "permissioncontroller" in top().split("mResumedActivity")[-1][:400].lower(), "grantedBefore": granted()}
        p.js("document.querySelector('.maplibregl-ctrl-geolocate').click()")
        time.sleep(4)
        resumed = [l for l in top().splitlines() if "mResumedActivity" in l or "topResumedActivity" in l]
        res["location"]["dialogAfterPress"] = any("permissioncontroller" in l.lower() for l in resumed)
        screenshot(out / "emulator-location.png")
        # answer the system dialog with "Don't allow" (a back press could reach the app and close it)
        adb("shell", "uiautomator", "dump", "/sdcard/ui.xml", check=False)
        ui = adb("shell", "cat", "/sdcard/ui.xml", check=False)
        m = re.search(r'resource-id="com\.android\.permissioncontroller:id/permission_deny_button"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', ui) \
            or re.search(r'text="Don.t allow"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', ui)
        if m:
            x1, y1, x2, y2 = map(int, m.groups())
            adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
        res["location"]["denied"] = bool(m)
        time.sleep(3)
        res["location"]["appStillRunning"] = bool(adb("shell", "pidof", PKG, check=False).strip())
        res["location"]["tapped"] = m.groups() if m else None
        res["location"]["activities"] = [l.strip()[:200] for l in top().splitlines() if "topo3d" in l][:8]
        res["location"]["am"] = [l[-250:] for l in adb("logcat", "-d", "-s", "ActivityManager:*", "ActivityTaskManager:*", check=False).splitlines()
                                 if "topo3d" in l and "Slow operation" not in l][-15:]
        screenshot(out / "emulator-after-deny.png")
        # GPX: the personal-points export goes to Android's share sheet
        p.js("import('./gpx.js').then((m) => m.downloadText('<gpx/>', 'topo3d-check.gpx'))")
        time.sleep(4)
        resumed = [l for l in top().splitlines() if "mResumedActivity" in l or "topResumedActivity" in l]
        res["gpxShare"] = {"shared": p.js("window.__topo3d.results.native?.shared ?? null"),
                           "chooserShown": any(("chooser" in l.lower() or "resolver" in l.lower() or "intentresolver" in l.lower()) for l in resumed),
                           "resumed": resumed[:2]}
        screenshot(out / "emulator-share.png")
    except Exception as e:  # keep what we have
        res["error"] = str(e)
        screenshot(out / "emulator.png")
    crash = adb("logcat", "-d", "-b", "crash", check=False) + adb("logcat", "-d", "-s", "AndroidRuntime:E", "ActivityManager:I", check=False)
    res["crash"] = [l[-400:] for l in crash.splitlines() if re.search(r"FATAL|Exception|at |Caused by|Process .*topo3d.*(died|crash)|Force", l)][:60]
    log = adb("logcat", "-d", "-s", "Capacitor/Console:*", "chromium:*", "Capacitor:*", check=False)
    res["consoleErrors"] = [l[-300:] for l in log.splitlines() if re.search(r"\b(E|ERROR)\b|Uncaught|error", l)][:40]
    (out / "emulator.json").write_text(json.dumps(res, ensure_ascii=False, indent=2))
    print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    apks = glob.glob(sys.argv[1]) if "*" in sys.argv[1] else [sys.argv[1]]
    main(apks[0], sys.argv[2])
