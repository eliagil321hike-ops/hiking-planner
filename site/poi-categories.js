// Point-of-interest categories (D-045): icon, Hebrew name and the words that find them in the search box.
// Searching a category shows all of its points in the current view at any zoom. A new icon category only
// needs an entry here (plus its icon in poi-icons.js and its kind in the OSM rules).

export const CATEGORIES = [
  { kind: 'camp', icon: 'topo-tent', label: 'חניוני לילה', words: ['חניון לילה', 'חניוני לילה', 'חניון', 'חניונים', 'קמפינג', 'אוהל', 'campsite', 'camp site', 'camping', 'camp'] },
  { kind: 'water', icon: 'topo-tap', label: 'ברזי מים', words: ['ברז', 'ברזים', 'ברזיה', 'ברזי מים', 'מים', 'מי שתייה', 'מי שתיה', 'נקודת מים', 'נקודות מים', 'water', 'tap', 'drinking water'] },
  { kind: 'parking', icon: 'topo-parking', label: 'חניות', words: ['חניה', 'חנייה', 'חניות', 'חניית רכב', 'חניה לרכב', 'parking', 'car park'] },
  { kind: 'spring', icon: 'topo-spring', label: 'מעיינות', words: ['מעיין', 'מעיינות', 'עין', 'spring', 'springs'] },
  { kind: 'viewpoint', icon: 'topo-viewpoint', label: 'תצפיות', words: ['תצפית', 'תצפיות', 'נקודת תצפית', 'viewpoint', 'view'] },
  { kind: 'shelter', icon: 'topo-shelter', label: 'מחסות', words: ['מחסה', 'מחסות', 'בקתה', 'בקתות', 'shelter', 'hut'] },
];

const norm = (s) => s.trim().toLowerCase().replace(/[״"׳']/g, '').replace(/\s+/g, ' ');

/** The category a search text asks for, or null (then it is a place search). */
export function categoryFor(text) {
  const q = norm(text);
  return CATEGORIES.find((c) => c.words.some((w) => norm(w) === q)) ?? null;
}
