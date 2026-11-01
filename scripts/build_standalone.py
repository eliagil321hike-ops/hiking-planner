"""
Build ONE self-contained HTML file of the Option B page that opens by double-click (file://), no server.

How: every local ES module becomes a data: URL, relative import specifiers are rewritten to bare names,
and an import map maps those names to the data: URLs. CSS and the Topo3D overlay JSON are inlined.
Libraries (MapLibre, maplibre-contour, rtl-text) and tiles still load from the internet.

Run from the repo root:  python3 scripts/build_standalone.py
Output: dist/topo3d-standalone.html
"""
import base64
import json
import posixpath
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "site"
OUT = ROOT / "dist" / "topo3d-standalone.html"

SPEC_RE = re.compile(r"""((?:\bfrom|\bimport)\s*\(?\s*)(['"])(\.{1,2}/[^'"]+)\2""")


def collect(entry: str):
    """Return {module_path: source} for the entry module and every relative import it reaches."""
    mods, todo = {}, [entry]
    while todo:
        rel = todo.pop()
        if rel in mods:
            continue
        src = (PAGE / rel).read_text(encoding="utf-8")
        mods[rel] = src
        for m in SPEC_RE.finditer(src):
            todo.append(posixpath.normpath(posixpath.join(posixpath.dirname(rel), m.group(3))))
    return mods


def bare(rel: str) -> str:
    return "topo3d:" + rel


def main():
    mods = collect("app.js")
    imports = {}
    for rel, src in mods.items():
        def repl(m, rel=rel):
            target = posixpath.normpath(posixpath.join(posixpath.dirname(rel), m.group(3)))
            return f"{m.group(1)}{m.group(2)}{bare(target)}{m.group(2)}"
        rewritten = SPEC_RE.sub(repl, src)
        if SPEC_RE.search(rewritten):
            raise SystemExit(f"unresolved relative import left in {rel}")
        imports[bare(rel)] = "data:text/javascript;base64," + base64.b64encode(rewritten.encode("utf-8")).decode("ascii")

    html = (PAGE / "index.html").read_text(encoding="utf-8")
    css = (PAGE / "style.css").read_text(encoding="utf-8")
    overlay = json.loads((ROOT / "site" / "styles" / "topo3d.json").read_text(encoding="utf-8"))

    html = html.replace('<link rel="stylesheet" href="style.css">', f"<style>\n{css}\n</style>")
    head_inject = (
        f'<script>globalThis.__TOPO3D_OVERLAY__ = {json.dumps(overlay, ensure_ascii=False)};</script>\n'
        f'<script type="importmap">{json.dumps({"imports": imports})}</script>\n'
    )
    html = html.replace("</head>", head_inject + "</head>")
    html = html.replace('<script type="module" src="app.js"></script>',
                        f'<script type="module">import "{bare("app.js")}";</script>')
    if 'src="app.js"' in html or 'href="style.css"' in html:
        raise SystemExit("index.html structure changed; update build_standalone.py")
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB, {len(mods)} modules: {', '.join(sorted(mods))})")


if __name__ == "__main__":
    main()
