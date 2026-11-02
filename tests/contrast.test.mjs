// D-051 design A2: every text/icon colour pair the stylesheet uses must meet WCAG 2.1.
// Normal text ≥ 4.5:1, large/bold text (≥ 18.66px bold) and UI frames/icons ≥ 3:1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../site/style.css', import.meta.url), 'utf8');
const token = (name) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
  assert.ok(m, `token --${name} not found`);
  return m[1];
};
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const pairs = [
  // [what, foreground token, background token, minimum]
  ['body text on white', 'c-dark', 'c-white', 4.5],
  ['secondary text on white', 'c-body', 'c-white', 4.5],
  ['secondary text on page', 'c-body', 'c-page', 4.5],
  ['text on selected (light blue)', 'c-dark', 'c-light', 4.5],
  ['panel button text on Deep Blue', 'c-white', 'c-deep', 4.5],
  ['open panel button text on Dark', 'c-white', 'c-dark', 4.5],
  ['light text in the pill on Deep Blue', 'c-light', 'c-deep', 4.5],
  ['"new route" 19px bold on turquoise', 'c-white', 'c-turq', 3],
  ['active tool icon on turquoise', 'c-white', 'c-turq', 3],
  ['frames on white', 'frame', 'c-white', 3],
  ['switch track (off) on white', 'frame', 'c-white', 3],
  ['turquoise switch/focus on white', 'c-turq', 'c-white', 3],
];

for (const [what, fg, bg, min] of pairs) {
  test(`contrast: ${what} ≥ ${min}:1`, () => {
    const r = ratio(token(fg), token(bg));
    assert.ok(r >= min, `${what}: ${r.toFixed(2)}:1`);
  });
}

test('palette: only the brand colours are defined as tokens', () => {
  const brand = ['#258F91', '#3269A0', '#24476B', '#5686B2', '#E3EDF5', '#F3F6F8', '#FFFFFF', '#203449', '#3E5265', '#657789', '#C69A50'];
  for (const n of ['c-turq', 'c-blue', 'c-deep', 'c-mblue', 'c-light', 'c-page', 'c-white', 'c-dark', 'c-body', 'c-sec', 'c-gold']) {
    assert.ok(brand.includes(token(n).toUpperCase()), `--${n} = ${token(n)}`);
  }
});
