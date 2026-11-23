"""D-078 (A1): Android launcher icons and splash from the site's brand mark (same drawing as make_icons.py).
Writes app/android/app/src/main/res/mipmap-*/ic_launcher{,_round,_foreground}.png and the splash images.
Run: python3 scripts/make_android_icons.py"""
from pathlib import Path
from playwright.sync_api import sync_playwright
from make_icons import MARK

RES = Path(__file__).resolve().parents[1] / "app/android/app/src/main/res"
DENS = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}

def mark_svg(w, h, scale, bg, radius=0, circle=False):
    unit = min(w, h) * scale / 18
    tx, ty = w / 2 - 12 * unit, h / 2 - 12.5 * unit
    shape = (f'<circle cx="{w/2}" cy="{h/2}" r="{w/2}" fill="{bg}"/>' if circle else
             f'<rect width="{w}" height="{h}" rx="{radius}" fill="{bg}"/>' if bg else '')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{shape}'
            f'<g transform="translate({tx} {ty}) scale({unit})">{MARK}</g></svg>')

def main():
    jobs = []
    for d, k in DENS.items():
        s = round(48 * k); f = round(108 * k)
        jobs += [(RES / f"mipmap-{d}/ic_launcher.png", mark_svg(s, s, 0.60, "#FFFFFF", radius=s * 0.22)),
                 (RES / f"mipmap-{d}/ic_launcher_round.png", mark_svg(s, s, 0.56, "#FFFFFF", circle=True)),
                 (RES / f"mipmap-{d}/ic_launcher_foreground.png", mark_svg(f, f, 0.40, None))]   # 66/108 safe zone
        for o, (w, h) in {"port": (320, 480), "land": (480, 320)}.items():
            jobs.append((RES / f"drawable-{o}-{d}/splash.png", mark_svg(round(w * k), round(h * k), 0.30, "#F3F6F8")))
    jobs.append((RES / "drawable/splash.png", mark_svg(480, 480, 0.30, "#F3F6F8")))
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page()
        for path, svg in jobs:
            w = int(svg.split('width="')[1].split('"')[0]); h = int(svg.split('height="')[1].split('"')[0])
            pg.set_viewport_size({"width": w, "height": h})
            pg.set_content(f'<html><body style="margin:0;background:transparent">{svg}</body></html>')
            pg.locator("svg").screenshot(path=str(path), omit_background=True)
        b.close()
    print(f"wrote {len(jobs)} images")
    (RES / "values/ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#FFFFFF</color>\n</resources>\n')

if __name__ == "__main__":
    main()
