#!/usr/bin/env python3
"""Build-time OSM extract for Israel (D-032): national/regional/marked (lwn) hiking routes, campsites and drinking water.

Why: the OpenFreeMap (OpenMapTiles) tiles carry no hiking-route relations at all, and their `poi` layer has
campsites/taps only from z14. The owner wants national/regional trails coloured and named, and tent/tap icons
from a ~1 km scale, so we extract them once per deploy from OpenStreetMap via the Overpass API and ship them
as two static GeoJSON files next to the site. Data © OpenStreetMap contributors, ODbL.

Usage: fetch_osm_hiking.py <out_dir>            (queries Overpass)
       fetch_osm_hiking.py <out_dir> --from <overpass.json>   (offline, for tests)
Exit code 0 even on network failure when --soft is given (the deploy then ships without the extra data).
"""
import json, math, os, re, sys, time, urllib.parse, urllib.request

# Bump when the extract's content rules change: a push then re-downloads instead of reusing live files.
EXTRACT_VERSION = 4  # 4: waterfalls, pools, ruins/archaeology (D-058)
BBOX = (29.45, 34.2, 33.45, 35.95)  # south, west, north, east: Israel incl. Golan and Eilat
ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
# Several small queries instead of one big one (one big query timed out on both public servers, 2026-11-01).
HEAD = "[out:json][timeout:180];"
Q_MAJOR = HEAD + """rel["route"="hiking"]["network"~"^(iwn|nwn|rwn)$"]({s},{w},{n},{e})->.top;
(.top; rel(r.top);)->.routes;
.routes out geom;"""
Q_MARKED = HEAD + """rel["route"="hiking"]["network"="lwn"]({s},{w},{n},{e});
out geom;"""
Q_POIS = HEAD + """(
  nwr["tourism"="camp_site"]({s},{w},{n},{e});
  nwr["amenity"="drinking_water"]({s},{w},{n},{e});
  nwr["man_made"="water_tap"]({s},{w},{n},{e});
  node["natural"="spring"]({s},{w},{n},{e});
  nwr["tourism"="viewpoint"]({s},{w},{n},{e});
  nwr["amenity"="shelter"]({s},{w},{n},{e});
  nwr["tourism"~"^(wilderness_hut|alpine_hut)$"]({s},{w},{n},{e});
  nwr["waterway"="waterfall"]({s},{w},{n},{e});
  nwr["natural"="water"]["water"="stream_pool"]({s},{w},{n},{e});
  nwr["natural"="water"]["name"~"^(גב|גבי|בריכת|בריכה) "]({s},{w},{n},{e});
  nwr["leisure"="swimming_area"]({s},{w},{n},{e});
  nwr["historic"~"^(ruins|archaeological_site)$"]({s},{w},{n},{e});
);
out center tags;"""
# All car parks; only those within PARKING_NEAR_M of a hiking route are kept (trailheads, not city car parks).
Q_PARKING = HEAD + """nwr["amenity"="parking"]({s},{w},{n},{e});
out center tags;"""
PARKING_NEAR_M = 400
BAND = 0.25  # degrees of latitude per marked-trail query (0.5 timed out on the dense centre, 2026-11-01)
RANK = {"marked": 0, "regional": 1, "national": 2, "int": 3}
# Trail-marking colour (first part of osmc:symbol, else colour=) → map colour. Israeli marked trails are red,
# blue, green or black (Israel Trails Committee); others get a neutral brown.
MARK_COLOURS = {"red": "#d32f2f", "blue": "#1e63c4", "green": "#2e9b3e", "black": "#2b2b2b", "orange": "#f57c00",
                "purple": "#7b1fa2", "yellow": "#e0b000", "brown": "#8a5a2b", "white": "#9e9e9e"}
SKIP_ROLES = {"alternative", "excursion", "approach", "connection"}


# A total time budget for all queries, and per-server health: a server that keeps failing is tried last, so
# one dead server cannot cost ~4 minutes per query (2026-11-02: a refresh spent 50+ min that way). D-044.
BUDGET_S = float(os.environ.get("OSM_BUDGET_MIN", "25")) * 60
REQUEST_TIMEOUT_S = 150
_T0 = time.time()
_fails = {u: 0 for u in ENDPOINTS}


def _endpoints():
    return sorted(ENDPOINTS, key=lambda u: (_fails[u] >= 2, ENDPOINTS.index(u)))


def run_query(q, bbox):
    s_, w, n, e = bbox
    body = urllib.parse.urlencode({"data": q.format(s=s_, w=w, n=n, e=e)}).encode()
    last, stale = None, None
    for attempt in range(3):
        for url in _endpoints():
            left = BUDGET_S - (time.time() - _T0)
            if left < 20:
                raise RuntimeError("time budget used up")
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": "Topo3D hiking planner (personal, build-time extract; github.com/eliagil321hike-ops/hiking-planner)"})
                with urllib.request.urlopen(req, timeout=min(REQUEST_TIMEOUT_S, left)) as r:
                    d = json.load(r)
                _fails[url] = 0
                age = stale_days(d)
                if age > MAX_AGE_DAYS:
                    print(f"overpass {url}: data {age:.0f} days old", file=sys.stderr)
                    stale = d
                    continue
                return d
            except Exception as ex:  # noqa: BLE001 - report and try the next endpoint
                last = ex
                _fails[url] += 1
                print(f"overpass {url} attempt {attempt + 1} failed: {ex}", file=sys.stderr)
        if stale is not None:      # only out-of-date servers answered: better old data than none
            print("WARNING: using out-of-date Overpass data", file=sys.stderr)
            return stale
        time.sleep(min(30 * (attempt + 1), max(0, BUDGET_S - (time.time() - _T0) - 20)))
    raise RuntimeError(f"all Overpass endpoints failed: {last}")


MAX_AGE_DAYS = 14


def stale_days(d):
    """Age of an Overpass answer's OSM data in days (0 when unknown)."""
    from datetime import datetime, timezone
    ts = d.get("osm3s", {}).get("timestamp_osm_base", "")
    try:
        return (datetime.now(timezone.utc) - datetime.fromisoformat(ts.replace("Z", "+00:00"))).total_seconds() / 86400
    except ValueError:
        return 0


def overpass():
    """Run the split queries; keep whatever succeeds. Fails only if nothing at all came back."""
    s_, w, n, e = BBOX
    parts = [("major routes", Q_MAJOR, BBOX), ("campsites/water/springs/views/shelters", Q_POIS, BBOX), ("parking", Q_PARKING, BBOX)]
    lat = s_
    while lat < n:
        top = min(n, round(lat + BAND, 4))
        parts.append((f"marked trails {lat:.2f}-{top:.2f}", Q_MARKED, (lat, w, top, e)))
        lat = top
    elements, seen, stamp, failed = [], set(), "", []
    for label, q, bbox in parts:
        try:
            d = run_query(q, bbox)
        except Exception as ex:  # noqa: BLE001
            failed.append(label)
            print(f"part '{label}' skipped: {ex}", file=sys.stderr)
            continue
        stamp = stamp or d.get("osm3s", {}).get("timestamp_osm_base", "")
        new = [el for el in d["elements"] if (el["type"], el["id"]) not in seen]
        seen.update((el["type"], el["id"]) for el in new)
        elements += new
        print(f"part '{label}': {len(new)} elements", file=sys.stderr)
        time.sleep(3)
    if len(failed) == len(parts):
        raise RuntimeError("all parts failed")
    if failed:
        print(f"WARNING: incomplete extract, missing: {', '.join(failed)}")
    return {"osm3s": {"timestamp_osm_base": stamp}, "elements": elements, "incomplete": bool(failed)}


def is_int(tags):
    names = " ".join(tags.get(k, "") for k in ("name", "name:he", "name:en"))
    return "שביל ישראל" in names or "Israel National Trail" in names


def own_kind(tags):
    if is_int(tags):
        return "int"
    return {"iwn": "national", "nwn": "national", "rwn": "regional", "lwn": "marked"}.get(tags.get("network"))


def mark_colour(tags):
    c = (tags.get("osmc:symbol", "").split(":")[0] or tags.get("colour", "")).strip().lower()
    return MARK_COLOURS.get(c, "#8a5a2b")


def simplify(pts, tol_m=4.0):
    """Douglas-Peucker on lon/lat with a local metric approximation."""
    if len(pts) < 3:
        return pts
    k = math.cos(math.radians(pts[0][1]))
    def d2(p, a, b):
        ax, ay, bx, by, px, py = a[0] * k, a[1], b[0] * k, b[1], p[0] * k, p[1]
        dx, dy = bx - ax, by - ay
        t = 0 if dx == dy == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        return ((ax + t * dx - px) ** 2 + (ay + t * dy - py) ** 2) * (111_320 ** 2)
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        best, bi = 0, None
        for m in range(i + 1, j):
            v = d2(pts[m], pts[i], pts[j])
            if v > best:
                best, bi = v, m
        if bi is not None and best > tol_m ** 2:
            keep[bi] = True
            stack += [(i, bi), (bi, j)]
    return [p for p, f in zip(pts, keep) if f]


def build(data):
    rels = {el["id"]: el for el in data["elements"] if el["type"] == "relation"}
    # a section of a super-route inherits the parent's kind/name (e.g. the Israel Trail split in sections)
    parent = {}
    for r in rels.values():
        for m in r.get("members", []):
            if m["type"] == "relation":
                parent.setdefault(m["ref"], r["id"])
    def kind_of(rid, depth=0):
        r = rels[rid]; k = own_kind(r.get("tags", {}))
        p = parent.get(rid)
        if p in rels and depth < 5:
            pk = kind_of(p, depth + 1)
            if pk and (not k or RANK[pk] > RANK[k]):
                k = pk
        return k
    def label_of(rid):
        t = rels[rid].get("tags", {})
        p = parent.get(rid)
        if p in rels and is_int(rels[p].get("tags", {})) and not is_int(t):
            return label_of(p)
        return t.get("name:he") or t.get("name") or t.get("name:en") or ""

    trails = []
    seen = {}
    for rid, r in rels.items():
        k = kind_of(rid)
        if not k:
            continue
        lines = []
        for m in r.get("members", []):
            if m["type"] != "way" or m.get("role", "") in SKIP_ROLES or "geometry" not in m:
                continue
            pts = [[round(g["lon"], 5), round(g["lat"], 5)] for g in m["geometry"] if g]
            pts = simplify(pts)
            if len(pts) >= 2:
                lines.append(pts)
        if not lines:
            continue
        t = r.get("tags", {})
        trails.append({"type": "Feature", "id": rid,
                       "properties": {"kind": k, "rank": RANK[k], "name": label_of(rid), "ref": t.get("ref", ""),
                                      "network": t.get("network", ""), "color": mark_colour(t)},
                       "geometry": {"type": "MultiLineString", "coordinates": lines}})
        seen.setdefault(k, []).append(label_of(rid))

    near = trail_index(trails)
    pois = []
    for el in data["elements"]:
        if el["type"] == "relation" and "center" not in el:
            continue
        kind = poi_kind(el.get("tags", {}))
        if not kind:
            continue
        t = el["tags"]
        lon, lat = (el["lon"], el["lat"]) if "lon" in el else (el["center"]["lon"], el["center"]["lat"])
        if kind == "parking" and not near(lon, lat):
            continue
        props = {"kind": kind, "name": t.get("name:he") or t.get("name") or ""}
        if kind == "spring" and t.get("seasonal") in ("yes", "spring", "winter") or t.get("intermittent") == "yes":
            props["seasonal"] = 1
        pois.append({"type": "Feature", "properties": props,
                     "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]}})
    return trails, pois, seen


def poi_kind(t):
    if t.get("tourism") == "camp_site":
        return "camp"
    if t.get("amenity") == "drinking_water" or t.get("man_made") == "water_tap":
        return None if t.get("drinking_water") == "no" or t.get("access") in ("private", "no") else "water"
    if t.get("amenity") == "parking":
        if t.get("parking") in ("underground", "multi-storey", "rooftop", "street_side", "lane") or t.get("access") in ("private", "no", "customers", "permit"):
            return None
        return "parking"
    if t.get("natural") == "spring":
        return "spring"
    if t.get("tourism") == "viewpoint":
        return "viewpoint"
    if t.get("tourism") in ("wilderness_hut", "alpine_hut") or (t.get("amenity") == "shelter" and t.get("shelter_type") not in ("public_transport", "changing_rooms", "field_shelter")):
        return "shelter"
    if t.get("waterway") == "waterfall":
        return "waterfall"
    if is_pool(t):
        return "pool"
    if t.get("historic") in ("ruins", "archaeological_site"):
        return "ruins"
    return None


# Pools in nature (D-058): OSM has no single tag. `water=stream_pool` (rock pool in a stream bed), natural
# swimming spots, and in Israel water bodies named "גב …" / "בריכת …" that are not reservoirs, sewage, fish ponds
# or concrete basins and not swimming/fish pools by name.
POOL_NAME = re.compile(r"^(גב|גבי|בריכת|בריכה) ")
POOL_NOT_WATER = {"reservoir", "wastewater", "fishpond", "basin", "river", "canal", "lake", "lagoon", "moat"}
POOL_NOT_NAME = re.compile(r"שחי|דגים|חמצון|ניקוז|ביוב")


def is_pool(t):
    if t.get("leisure") == "swimming_area":
        return t.get("access") not in ("private", "no")
    if t.get("natural") != "water":
        return False
    if t.get("water") == "stream_pool":
        return True
    name = t.get("name:he") or t.get("name") or ""
    return bool(POOL_NAME.match(name)) and t.get("water") not in POOL_NOT_WATER and not POOL_NOT_NAME.search(name)


def trail_index(trails, cell=0.01):
    """Return near(lon, lat) → True when a hiking-route line passes within PARKING_NEAR_M (grid of densified points)."""
    grid = set()
    step = 100 / 111_320  # densify to ~100 m so long straight segments are indexed too
    for f in trails:
        for line in f["geometry"]["coordinates"]:
            for (x1, y1), (x2, y2) in zip(line, line[1:]):
                n = max(1, int(math.hypot(x2 - x1, y2 - y1) / step))
                for i in range(n + 1):
                    x, y = x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n
                    grid.add((round(x, 4), round(y, 4)))  # ~10 m buckets, deduplicated
    cells = {}
    for x, y in grid:
        cells.setdefault((int(x / cell), int(y / cell)), []).append((x, y))
    r = PARKING_NEAR_M / 111_320
    def near(lon, lat):
        k = math.cos(math.radians(lat))
        cx, cy = int(lon / cell), int(lat / cell)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for x, y in cells.get((cx + dx, cy + dy), ()):
                    if ((x - lon) * k) ** 2 + (y - lat) ** 2 <= r * r:
                        return True
        return False
    return near


CELL = 0.5  # degrees: the site loads only the cells in view (D-042)


def cell_key(lon, lat):
    return f"{math.floor(lat / CELL)}_{math.floor(lon / CELL)}"


def split_cells(trails_fc, pois_fc, out_dir):
    """Write data/osm/index.json + one file per 0.5° cell: trail lines by their midpoint, points by position."""
    cells = {}
    for f in trails_fc["features"]:
        by = {}
        for line in f["geometry"]["coordinates"]:
            mid = line[len(line) // 2]
            by.setdefault(cell_key(*mid), []).append(line)
        for k, lines in by.items():
            cells.setdefault(k, {"trails": [], "pois": []})["trails"].append(
                {"type": "Feature", "properties": f["properties"], "geometry": {"type": "MultiLineString", "coordinates": lines}})
    for f in pois_fc["features"]:
        cells.setdefault(cell_key(*f["geometry"]["coordinates"]), {"trails": [], "pois": []})["pois"].append(f)
    d = os.path.join(out_dir, "osm")
    os.makedirs(d, exist_ok=True)
    for k, c in cells.items():
        with open(os.path.join(d, f"{k}.json"), "w", encoding="utf-8") as fh:
            json.dump(c, fh, ensure_ascii=False, separators=(",", ":"))
    s_, w, n, e = BBOX
    index = {"extract_version": EXTRACT_VERSION, "osm_base": trails_fc.get("osm_base", ""), "cell": CELL,
             "coverage": [w, s_, e, n], "cells": {k: [len(c["trails"]), len(c["pois"])] for k, c in cells.items()}}
    with open(os.path.join(d, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, separators=(",", ":"))
    sizes = sorted(os.path.getsize(os.path.join(d, f"{k}.json")) for k in cells)
    print(f"split into {len(cells)} cells of {CELL}°; largest {sizes[-1] if sizes else 0} bytes, median {sizes[len(sizes) // 2] if sizes else 0}")


def counts(pois):
    kinds = ('camp', 'water', 'parking', 'spring', 'viewpoint', 'shelter', 'waterfall', 'pool', 'ruins')
    return ', '.join(f"{k} {sum(p['properties']['kind'] == k for p in pois)}" for k in kinds)


def main():
    out = sys.argv[1]
    soft = "--soft" in sys.argv
    if "--reuse-same-version" in sys.argv and "--previous" in sys.argv:
        prevdir = sys.argv[sys.argv.index("--previous") + 1]
        try:
            olds = {n: json.load(open(os.path.join(prevdir, n), encoding="utf-8")) for n in ("osm-trails.geojson", "osm-pois.geojson")}
            if all(o.get("extract_version") == EXTRACT_VERSION for o in olds.values()):
                os.makedirs(out, exist_ok=True)
                for n, o in olds.items():
                    with open(os.path.join(out, n), "w", encoding="utf-8") as f:
                        json.dump(o, f, ensure_ascii=False, separators=(",", ":"))
                print(f"reused live OSM extract v{EXTRACT_VERSION} (OSM base {olds['osm-trails.geojson'].get('osm_base')})")
                split_cells(olds["osm-trails.geojson"], olds["osm-pois.geojson"], out)
                return
            print("live extract has another version → fresh extract")
        except Exception as ex:  # noqa: BLE001
            print(f"no reusable live extract ({ex}) → fresh extract")
    try:
        if "--from" in sys.argv:
            data = json.load(open(sys.argv[sys.argv.index("--from") + 1], encoding="utf-8"))
        elif "--opl" in sys.argv:  # Geofabrik file filtered by osmium (D-057); Overpass only if this fails
            data = from_opl(sys.argv[sys.argv.index("--opl") + 1],
                            sys.argv[sys.argv.index("--osm-base") + 1] if "--osm-base" in sys.argv else "")
        else:
            data = overpass()
    except Exception as ex:  # noqa: BLE001
        print(f"OSM extract failed: {ex}")
        data = None
    prev = sys.argv[sys.argv.index("--previous") + 1] if "--previous" in sys.argv else None
    def previous(name):
        try:
            with open(os.path.join(prev, name), encoding="utf-8") as f:
                return json.load(f)
        except Exception:  # noqa: BLE001
            return None
    os.makedirs(out, exist_ok=True)
    if data is None:  # keep the data that is live now rather than shipping nothing
        kept = 0
        for name in ("osm-trails.geojson", "osm-pois.geojson"):
            old = previous(name) if prev else None
            if old:
                with open(os.path.join(out, name), "w", encoding="utf-8") as f:
                    json.dump(old, f, ensure_ascii=False, separators=(",", ":"))
                kept += 1
                print(f"kept previous {name} ({len(old['features'])} features, OSM base {old.get('osm_base')})")
        if kept == 2:
            split_from_files(out)
        sys.exit(0 if soft or kept else 1)
    trails, pois, seen = build(data)
    stamp = data.get("osm3s", {}).get("timestamp_osm_base", "")
    olds = [previous(n) for n in ("osm-trails.geojson", "osm-pois.geojson")] if prev else [None, None]
    if all(olds) and all(o.get("osm_base", "") > stamp for o in olds) and stamp:
        print(f"new extract (OSM base {stamp}) is older than the live one ({olds[0].get('osm_base')}): keeping the live data")
        for n, o in zip(("osm-trails.geojson", "osm-pois.geojson"), olds):
            with open(os.path.join(out, n), "w", encoding="utf-8") as f:
                json.dump(o, f, ensure_ascii=False, separators=(",", ":"))
        split_from_files(out)
        return
    for name, feats in (("osm-trails.geojson", trails), ("osm-pois.geojson", pois)):
        old = previous(name) if prev and data.get("incomplete") else None
        if old and len(old["features"]) > len(feats):  # partial run: the previous complete file is better
            print(f"partial extract: keeping previous {name} ({len(old['features'])} > {len(feats)} features)")
            feats, fstamp = old["features"], old.get("osm_base", "")
        else:
            fstamp = stamp
        with open(os.path.join(out, name), "w", encoding="utf-8") as f:
            json.dump({"type": "FeatureCollection", "osm_base": fstamp, "extract_version": EXTRACT_VERSION, "features": feats}, f, ensure_ascii=False, separators=(",", ":"))
    sizes = {n: os.path.getsize(os.path.join(out, n)) for n in ("osm-trails.geojson", "osm-pois.geojson")}
    print(f"OSM base {stamp}; trails {len(trails)}, pois {len(pois)} "
          f"({counts(pois)}); bytes {sizes}")
    for k in ("int", "national", "regional", "marked"):
        names = sorted(set(seen.get(k, [])))
        print(f"  {k}: {len(seen.get(k, []))} relations: {', '.join(names[:40])}{' …' if len(names) > 40 else ''}")
    split_from_files(out)


def from_opl(path, osm_base):
    """Overpass-shaped data from an osmium OPL extract (scripts/osm_opl.py). Falls back to Overpass on failure."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import osm_opl
    try:
        with open(path, encoding="utf-8") as fh:
            data = osm_opl.to_overpass(fh, BBOX, osm_base)
        if not any(el["type"] == "relation" for el in data["elements"]):
            raise RuntimeError("no hiking routes in the file")
        print(f"source: Geofabrik extract via osmium, OSM base {osm_base or 'unknown'}, {len(data['elements'])} elements")
        return data
    except Exception as ex:  # noqa: BLE001 - the Overpass path is the fallback
        print(f"OPL source failed ({ex}) → Overpass", file=sys.stderr)
        return overpass()


def split_from_files(out):
    load = lambda n: json.load(open(os.path.join(out, n), encoding="utf-8"))
    split_cells(load("osm-trails.geojson"), load("osm-pois.geojson"), out)


if __name__ == "__main__":
    main()
