// All user-facing text (SPEC §11: no hardcoded strings). Hebrew is the default and currently the only
// language the owner needs (SPEC P1); the structure allows adding others. Developer tools (?dev=1) stay in
// English on purpose. Elements with data-i18n="key" get their text; data-i18n-attr="attr:key" sets attributes.

const STRINGS = {
  he: {
    'app.title': 'Topo3D · מתכנן מסלולים',
    'panel.toggle': 'הסתר/הצג לוח',
    'map.label': 'מפה טופוגרפית תלת-ממדית',
    'bg.heading': 'רקע',
    'bg.group': 'רקע המפה',
    'bg.topo': 'טופוגרפי',
    'bg.satellite': 'לוויין',
    'bg.provider': 'מקור לוויין',
    'bg.key': 'מפתח (נשמר רק בדפדפן הזה)',
    'bg.keySave': 'שמור מפתח והצג',
    'bg.embeddedKey': 'מפתח מובנה פעיל — אין צורך להזין. אפשר להזין מפתח אישי שיחליף אותו.',
    'bg.needKey': '{provider}: צריך להזין מפתח כדי להציג את התמונה',
    'layers.heading': 'שכבות',
    'layers.terrain': 'תלת-ממד',
    'layers.hillshade': 'הצללה',
    'layers.contours': 'קווי גובה',
    'layers.trails': 'שבילים',
    'layers.landcover': 'צמחייה וכיסוי קרקע',
    'layers.exaggeration': 'הגבהה',
    'route.heading': 'קו ופרופיל',
    'route.draw': 'צייר קו',
    'route.finish': 'סיים ציור',
    'route.undo': 'בטל נקודה',
    'route.clear': 'נקה',
    'route.hint': 'לחץ "צייר קו" ואז הקש על המפה להוספת נקודות.',
    'stats.distance': 'מרחק',
    'stats.ascent': 'עלייה',
    'stats.descent': 'ירידה',
    'stats.minmax': 'מינ׳ / מקס׳',
    'stats.duration': 'זמן (הערכה)',
    'stats.source': 'מקור גובה',
    'stats.warning': 'אזהרה',
    'stats.incomplete': 'חסרים נתוני גובה בחלק מהקו',
    'stats.sourceValue': 'Mapterhorn z{z} (גיבוי z12)',
    'unit.m': 'מ׳',
    'unit.km': 'ק״מ',
    'unit.hours': 'שעות',
    'error.elevation': 'שגיאה בקבלת נתוני גובה: {message}',
    'error.libs': 'ספריות המפה לא נטענו מ-unpkg.com: בדוק חיבור לאינטרנט או חסימה של אנטי-וירוס.',
    'error.map': 'שגיאת מפה: {message}',
    'error.location': 'לא הצלחתי לקבל מיקום. בדוק שהדפדפן מורשה לגשת למיקום.',
    // MapLibre's own controls (keys verified in maplibre-gl 5.24.0 dist)
    'ml.GeolocateControl.FindMyLocation': 'מרכז עליי',
    'ml.GeolocateControl.LocationNotAvailable': 'המיקום לא זמין',
    'ml.NavigationControl.ZoomIn': 'התקרב',
    'ml.NavigationControl.ZoomOut': 'התרחק',
    'ml.NavigationControl.ResetBearing': 'אפס כיוון לצפון',
    'ml.ScaleControl.Meters': 'מ׳',
    'ml.ScaleControl.Kilometers': 'ק״מ',
    'ml.AttributionControl.ToggleAttribution': 'מקורות המפה',
    'ml.AttributionControl.MapFeedback': 'משוב על המפה',
    'ml.Map.Title': 'מפה',
    'safety': 'מסלולים, גבהים וזמני הליכה הם הערכות ועלולים להיות שגויים. בדוק תמיד את השטח, מזג האוויר והמים לפני ובמהלך הטיול.',
  },
};

export const LANG = 'he';
const dict = STRINGS[LANG];

/** Translate a key; {name} placeholders are filled from `vars`. Missing keys show the key (visible bug). */
export function t(key, vars = {}) {
  const s = dict[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

/** Apply translations to static markup. */
export function applyI18n(root = document) {
  document.documentElement.lang = LANG;
  document.documentElement.dir = 'rtl';
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map((x) => x.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  });
}

/** MapLibre `locale` option: its control texts in the current language. */
export function mapLocale() {
  return Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith('ml.')).map(([k, v]) => [k.slice(3), v]));
}

/** Number formatting for the current language. */
export const fmtNumber = (v, opts) => v.toLocaleString(`${LANG}-IL`, opts);
