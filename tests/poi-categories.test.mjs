// Category words in the search box (D-045).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryFor, CATEGORIES } from '../site/poi-categories.js';

test('Hebrew and English category words, with spacing/quote variants', () => {
  assert.equal(categoryFor('חניון לילה').kind, 'camp');
  assert.equal(categoryFor('  חניוני   לילה ').kind, 'camp');
  assert.equal(categoryFor('ברז').kind, 'water');
  assert.equal(categoryFor('מי שתייה').kind, 'water');
  assert.equal(categoryFor('Parking').kind, 'parking');
  assert.equal(categoryFor('מעיין').kind, 'spring');
});

test('place names are not categories', () => {
  assert.equal(categoryFor('הר מירון'), null);
  assert.equal(categoryFor('עין גדי'), null);
  assert.equal(categoryFor('חניון לילה נחל עמוד'), null);
});

test('every category has an icon, a label and at least one word; no word in two categories', () => {
  const seen = new Map();
  for (const c of CATEGORIES) {
    assert.ok(c.icon.startsWith('topo-') && c.label && c.words.length);
    for (const w of c.words) { assert.ok(!seen.has(w), `${w} in ${seen.get(w)} and ${c.kind}`); seen.set(w, c.kind); }
  }
});
