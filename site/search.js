// Place search (D-038) with the public Nominatim service (OpenStreetMap data, free, no key).
// Usage policy: no search-as-you-type, at most one request per second, OpenStreetMap attribution. So a search
// runs only when the user presses Enter or the button, and requests are spaced ≥ 1.1 s apart.

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const MIN_GAP_MS = 1100;

export function initSearch(ctx, { fetchImpl = (...a) => fetch(...a) } = {}) {
  const { map, $, t, notify } = ctx;
  const form = $('search'), input = $('search-q'), list = $('search-results');
  let last = 0, marker = null, seq = 0;

  const close = () => { list.hidden = true; list.innerHTML = ''; };

  function show(results) {
    list.innerHTML = '';
    if (!results.length) {
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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q.length < 2) return;
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
      if (my === seq) show(data);
    } catch (err) {
      notify(t('search.error', { message: err.message }));
    } finally {
      form.classList.remove('busy');
    }
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); input.blur(); } });
  document.addEventListener('click', (e) => { if (!form.contains(e.target)) close(); });
  return { close };
}
