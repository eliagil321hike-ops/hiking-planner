"""D-077 (A1): app icons from the site's brand mark (index.html .brand: the turquoise mountain, #258F91).
Writes site/icons/icon-{180,192,512}.png (rounded white tile) and icon-maskable-512.png (full bleed, mark in the
safe zone), plus android/ launcher sources when asked. Run: python3 scripts/make_icons.py [out_dir]"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

MARK = ('<path d="M3 19 L10 6 L14 13 L16.5 9 L21 19 Z" fill="none" stroke="#258F91" stroke-width="1.9" stroke-linejoin="round"/>'
        '<path d="M7 15.5 H17" stroke="#258F91" stroke-width="1.9" stroke-linecap="round"/>')

def svg(size, maskable):
    # mark is drawn in a 24-unit box (x 3–21, y 6–19); scale = how much of the icon it fills
    scale = 0.46 if maskable else 0.60          # maskable: inside the 80 % safe circle
    unit = size * scale / 18                     # 18 = mark width in units
    tx = size / 2 - 12 * unit
    ty = size / 2 - 12.5 * unit
    radius = 0 if maskable else size * 0.22
    frame = '' if maskable else f'<rect x="{size*0.01}" y="{size*0.01}" width="{size*0.98}" height="{size*0.98}" rx="{radius}" fill="none" stroke="#C9D6E2" stroke-width="{size*0.012}"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
            f'<rect width="{size}" height="{size}" rx="{radius}" fill="#FFFFFF"/>{frame}'
            f'<g transform="translate({tx} {ty}) scale({unit})">{MARK}</g></svg>')

def main(out):
    out = Path(out); out.mkdir(parents=True, exist_ok=True)
    jobs = [("icon-180.png", 180, False), ("icon-192.png", 192, False), ("icon-512.png", 512, False),
            ("icon-maskable-512.png", 512, True), ("icon-foreground-432.png", 432, True)]
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        for name, size, mask in jobs:
            pg.set_viewport_size({"width": size, "height": size})
            pg.set_content(f'<html><body style="margin:0;background:transparent">{svg(size, mask)}</body></html>')
            pg.locator("svg").screenshot(path=str(out / name), omit_background=not mask)
            print("wrote", out / name)
        b.close()

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "site/icons")
