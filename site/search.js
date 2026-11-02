// Place search (D-038) with the public Nominatim service (OpenStreetMap data, free, no key), and category
// search (D-045, D-046): a category word shows all its points in the current view, and the results list shows
// that category first, then places with that name. Clearing the search box clears the category display.
// Usage policy: no search-as-you-type, at most one request per second, OpenStreetMap attribution. So a search
// runs only when the user presses Enter or the button, and requests are spaced ≥ 1.1 s apart.

import { categoryFor } from './poi-categories.js';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const MIN_GAP_MS = 1100;

export function initSearch(ctx, { fetchImpl = (...a) => fetch(...a) } = {}) {
  const { map, $, t, notify, fmtNumber } = ctx;
  const form = $('search'), input = $('search-q'), list = $('search-results');
  let last = 0, marker = null, seq = 0;

  const close = () => { list.hidden = true; list.innerHTML = ''; };

  function show(results, catLine = null) {
    list.innerHTML = '';
    if (catLine) {
      const li = document.createElement('li'); li.className = 'cat-line'; li.textContent = catLine; list.append(li);
    }
    if (!results.length && !catLine) {
      const li = document.createElement('li'); li.className = 'empty'; li.textContent = t('search.none'); list.append(li);
    }
    for (const r of results) {
      const li = document.createElement('li');
      const b = document.createElement('button'); b.type = 'button';
      const [name, ...rest] = r.display_name.split(',');
      const strong = document.createElement('strong'); strong.textContent = name;
      const small = document.createElement('small'); small.textContent = rest.slice(0, 3).join(',').trim();
      b.append(strong, small);
      b.addEventListener('click', () => go(r));
      li.append(b); list.append(li);
    }
    const credit = document.createElement('li'); credit.className = 'credit'; credit.textContent = t('search.credit'); list.append(credit);
    list.hidden = false;
  }

  function go(r) {
    close();
    const lon = Number(r.lon), lat = Number(r.lat);
    const bb = r.boundingbox?.map(Number);   // [south, north, west, east]
    if (bb && bb[1] - bb[0] > 0.002) map.fitBounds([[bb[2], bb[0]], [bb[3], bb[1]]], { padding: 80, maxZoom: 15, duration: 1200 });
    else map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 14), duration: 1200 });
    marker?.remove();
    marker = new maplibregl.Marker({ color: '#b5502a' }).setLngLat([lon, lat]).addTo(map);
    ctx.results.search = { name: r.display_name, lon, lat };
  }

  // ---- category search (D-045): "חניון לילה", "ברז", … → all of them in the current view, any zoom
  const chip = $('cat-chip');
  function clearCategory() {
    map.getSource('poi-search')?.setData({ type: 'FeatureCollection', features: [] });
    chip.hidden = true;
    ctx.results.category = null;
  }
  chip.querySelector('button').addEventListener('click', () => { clearCategory(); input.value = ''; });

  async function showCategory(cat) {
    close();
    const api = ctx.results.topo?.osmApi;
    if (!api) return null;
    const b = map.getBounds();
    form.classList.add('busy');
    try {
      const { features, tooLargeAbroad } = await api.collect(cat.kind, [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      for (const id of ['poi-search-cluster', 'poi-search']) map.setLayoutProperty(id, 'icon-image', cat.icon);
      map.getSource('poi-search').setData({ type: 'FeatureCollection', features });
      chip.querySelector('span').textContent = features.length
        ? t('search.catFound', { n: fmtNumber(features.length), label: cat.label }) + (tooLargeAbroad ? ` · ${t('search.catZoomAbroad')}` : '')
        : t(tooLargeAbroad ? 'search.catZoomAbroad' : 'search.catNone', { label: cat.label });
      chip.hidden = false;
      ctx.results.category = { kind: cat.kind, count: features.length, tooLargeAbroad };
      return chip.querySelector('span').textContent;
    } finally {
      form.classList.remove('busy');
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q.length < 2) return;
    const cat = categoryFor(q);
    // a category word: its points first (on the map and as the first line of the list), then places by name
    const catLine = cat ? await showCategory(cat) : (clearCategory(), null);
    const wait = last + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    last = Date.now();
    const my = ++seq;
    const url = `${ENDPOINT}?${new URLSearchParams({ q, format: 'jsonv2', limit: '6', 'accept-language': 'he,en' })}`;
    form.classList.add('busy');
    try {
      const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (my === seq) show(data, catLine);
    } catch (err) {
      notify(t('search.error', { message: err.message }));
    } finally {
      form.classList.remove('busy');
    }
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); input.blur(); } });
  // Owner (D-046): emptying the search box (typing it away or its built-in ✕) ends the category display.
  input.addEventListener('input', () => { if (!input.value.trim()) { clearCategory(); close(); } });
  document.addEventListener('click', (e) => { if (!form.contains(e.target)) close(); });
  return { close };
}
