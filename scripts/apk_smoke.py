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
    except Exception as e:  # keep what we have
        res["error"] = str(e)
        screenshot(out / "emulator.png")
    log = adb("logcat", "-d", "-s", "Capacitor/Console:*", "chromium:*", "Capacitor:*", check=False)
    res["consoleErrors"] = [l[-300:] for l in log.splitlines() if re.search(r"\b(E|ERROR)\b|Uncaught|error", l)][:40]
    (out / "emulator.json").write_text(json.dumps(res, ensure_ascii=False, indent=2))
    print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    apks = glob.glob(sys.argv[1]) if "*" in sys.argv[1] else [sys.argv[1]]
    main(apks[0], sys.argv[2])
