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
EXTRACT_VERSION = 4  # 4: waterfalls, pools, ruins/archaeology (D-061)
BBOX = (29.45, 34.2, 33.45, 35.95)  # south, west, north, east: Israel incl. Golan and Eilat
# Pre-built regions (D-061): each comes from its Geofabrik file and is written to its own pair of files; the site
# then shows it from far zooms. Israel keeps its file names and its Overpass fallback; other regions keep their
# previous data when the download fails. The rest of the world loads on demand in the browser (osm-loader.js).
REGIONS = {
    "israel": {"bbox": BBOX, "suffix": "", "overpass": True},
    "georgia": {"bbox": None, "suffix": "-georgia", "overpass": False},
    "norway": {"bbox": None, "suffix": "-norway", "overpass": False},
}
WORLD = (-90, -180, 90, 180)


def region_files(region):
    sfx = REGIONS[region]["suffix"]
    return f"osm-trails{sfx}.geojson", f"osm-pois{sfx}.geojson"
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


# Pools in nature (D-061): OSM has no single tag. `water=stream_pool` (rock pool in a stream bed), natural
# swimming spots, and in Israel water bodies named "גב …" / "בריכת …" that are not reservoirs, sewage, fish ponds
# or concrete basins and not swimming/fish pools by name.
POOL_NAME = re.compile(r"^(גב|גבי|בריכת|בריכה) ")
POOL_NOT_WATER = {"reservoir", "wastewater", "fishpond", "basin", "river", "canal", "lake", "lagoon", "moat"}
POOL_NOT_NAME = re.compile(r"שחי|דגים|חמצון|ניקוז|ביוב|שכשוך|נוי|אגירה")


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


DCELL = 0.25  # degrees: the browser's on-demand cell (osm-loader.js); cells fully inside a region skip Overpass


def read_poly(path):
    """Geofabrik/osmosis .poly → list of rings [(lon, lat), …] (holes included; even-odd rule)."""
    rings, cur = [], None
    with open(path, encoding="utf-8") as fh:
        lines = fh.read().splitlines()[1:]
    for line in lines:
        t = line.strip()
        if not t:
            continue
        if cur is None:
            if t == "END":
                break
            cur = []
        elif t == "END":
            rings.append(cur); cur = None
        else:
            x, y = t.split()[:2]
            cur.append((float(x), float(y)))
    return rings


def covered_cells(rings, size=DCELL, samples=8):
    """{row: [[j0, j1], …]}: the size° cells that lie entirely inside the outline (conservative: a cell counts only
    when a samples² lattice of points inside it (centres of a samples × samples grid, ≈ 3 km apart at 0.25°) is inside
    and no outline vertex falls in it)."""
    import bisect
    if not rings:
        return {}
    xs_all = [x for r in rings for x, _ in r]; ys_all = [y for r in rings for _, y in r]
    i0, i1 = math.floor(min(ys_all) / size), math.floor(max(ys_all) / size)
    j0, j1 = math.floor(min(xs_all) / size), math.floor(max(xs_all) / size)
    edges = [(a, b) for r in rings for a, b in zip(r, r[1:] + r[:1]) if a[1] != b[1]]
    vert_cells = {(math.floor(y / size), math.floor(x / size)) for r in rings for x, y in r}
    step = size / samples
    def row_inside(y):
        cross = sorted(x1 + (y - y1) * (x2 - x1) / (y2 - y1) for (x1, y1), (x2, y2) in edges if (y1 > y) != (y2 > y))
        return lambda x: bisect.bisect_right(cross, x) % 2 == 1
    ok_rows = {}
    for i in range(i0, i1 + 1):
        tests = [row_inside(i * size + (k + 0.5) * step) for k in range(samples)]
        good = []
        for j in range(j0, j1 + 1):
            if (i, j) in vert_cells:
                continue
            if all(t(j * size + (m + 0.5) * step) for t in tests for m in range(samples)):
                good.append(j)
        ranges = []
        for j in good:
            if ranges and ranges[-1][1] == j - 1:
                ranges[-1][1] = j
            else:
                ranges.append([j, j])
        if ranges:
            ok_rows[str(i)] = ranges
    return ok_rows


def box_rings(bbox):
    s_, w, n, e = bbox
    return [[(w, s_), (e, s_), (e, n), (w, n)]]


def split_cells(trails_fc, pois_fc, out_dir, regions=None):
    """Write data/osm/index.json + one file per 0.5° cell: trail lines by their midpoint, points by position.
    `regions`: [{"name", "osm_base", "rings" (border outline, or None → its bbox)}]; default Israel by its box."""
    if regions is None:
        regions = [{"name": "israel", "osm_base": trails_fc.get("osm_base", ""), "rings": None}]
    cells = {}
    for f in trails_fc["features"]:
        by = {}
        for line in f["geometry"]["coordinates"]:
            mid = line[len(line) // 2]
            by.setdefault(cell_key(*mid), []).append(line)
        for k, lines in by.items():
            feat = {"type": "Feature", "properties": f["properties"], "geometry": {"type": "MultiLineString", "coordinates": lines}}
            if f.get("id") is not None:
                feat["id"] = f["id"]          # the browser drops the same route loaded again from Overpass
            cells.setdefault(k, {"trails": [], "pois": []})["trails"].append(feat)
    for f in pois_fc["features"]:
        cells.setdefault(cell_key(*f["geometry"]["coordinates"]), {"trails": [], "pois": []})["pois"].append(f)
    d = os.path.join(out_dir, "osm")
    os.makedirs(d, exist_ok=True)
    for k, c in cells.items():
        with open(os.path.join(d, f"{k}.json"), "w", encoding="utf-8") as fh:
            json.dump(c, fh, ensure_ascii=False, separators=(",", ":"))
    covered = {}
    for r in regions:
        rings = r.get("rings") or (box_rings(REGIONS[r["name"]]["bbox"]) if REGIONS.get(r["name"], {}).get("bbox") else None)
        for row, ranges in covered_cells(rings).items():
            covered.setdefault(row, []).extend(ranges)
    s_, w, n, e = BBOX
    index = {"extract_version": EXTRACT_VERSION, "osm_base": trails_fc.get("osm_base", ""), "cell": CELL,
             "coverage": [w, s_, e, n],   # legacy (before D-061); the browser now uses `covered`
             "dcell": DCELL, "covered": covered,
             "regions": [{"name": r["name"], "osm_base": r.get("osm_base", "")} for r in regions],
             "cells": {k: [len(c["trails"]), len(c["pois"])] for k, c in cells.items()}}
    with open(os.path.join(d, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, separators=(",", ":"))
    sizes = sorted(os.path.getsize(os.path.join(d, f"{k}.json")) for k in cells)
    ncov = sum(b - a + 1 for rs in covered.values() for a, b in rs)
    print(f"split into {len(cells)} cells of {CELL}°; largest {sizes[-1] if sizes else 0} bytes, median {sizes[len(sizes) // 2] if sizes else 0}; "
          f"{ncov} on-demand cells covered by {', '.join(r['name'] for r in regions)}; total {sum(sizes)} bytes")


def split_all(out, poly_dir=None):
    """Merge every region's files present in `out` and write the cells + index (D-061)."""
    trails, pois, regions = [], [], []
    for name in REGIONS:
        tn, pn = region_files(name)
        try:
            t = json.load(open(os.path.join(out, tn), encoding="utf-8"))
            p = json.load(open(os.path.join(out, pn), encoding="utf-8"))
        except (OSError, ValueError):
            continue
        poly = os.path.join(poly_dir, f"{name}.poly") if poly_dir else None
        rings = read_poly(poly) if poly and os.path.exists(poly) else None
        if rings is None and not REGIONS[name]["bbox"]:
            print(f"WARNING: no outline for {name}: its area will still be loaded on demand")
        trails += t["features"]; pois += p["features"]
        regions.append({"name": name, "osm_base": t.get("osm_base", ""), "rings": rings})
        print(f"region {name}: {len(t['features'])} trails, {len(p['features'])} points, OSM {t.get('osm_base')}, outline {'yes' if rings else 'box' if REGIONS[name]['bbox'] else 'none'}")
    israel = next((r for r in regions if r["name"] == "israel"), None)
    split_cells({"type": "FeatureCollection", "osm_base": israel["osm_base"] if israel else "", "features": trails},
                {"type": "FeatureCollection", "features": pois}, out, regions)


def counts(pois):
    kinds = ('camp', 'water', 'parking', 'spring', 'viewpoint', 'shelter', 'waterfall', 'pool', 'ruins')
    return ', '.join(f"{k} {sum(p['properties']['kind'] == k for p in pois)}" for k in kinds)


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def main():
    """fetch_osm_hiking.py <out> [--region R] [--opl F --osm-base T | --from F] [--previous DIR] [--reuse-same-version]
                                [--soft] [--no-split]
       fetch_osm_hiking.py <out> --split-only [--poly-dir DIR]     (merge all regions in <out> into cells + index)"""
    out = sys.argv[1]
    if "--split-only" in sys.argv:
        split_all(out, arg("--poly-dir"))
        return
    region = arg("--region", "israel")
    cfg = REGIONS[region]
    names = region_files(region)
    soft = "--soft" in sys.argv
    prev = arg("--previous")
    finish = (lambda: None) if "--no-split" in sys.argv else (lambda: split_all(out, arg("--poly-dir")))
    os.makedirs(out, exist_ok=True)

    def previous(name):
        try:
            with open(os.path.join(prev, name), encoding="utf-8") as f:
                return json.load(f)
        except Exception:  # noqa: BLE001
            return None

    def write(name, obj):
        with open(os.path.join(out, name), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))

    if "--reuse-same-version" in sys.argv and prev:
        olds = {n: previous(n) for n in names}
        if all(olds.values()) and all(o.get("extract_version") == EXTRACT_VERSION for o in olds.values()):
            for n, o in olds.items():
                write(n, o)
            print(f"{region}: reused live OSM extract v{EXTRACT_VERSION} (OSM base {olds[names[0]].get('osm_base')})")
            return finish()
        print(f"{region}: live extract missing or another version → fresh extract")
    try:
        if "--from" in sys.argv:
            data = json.load(open(arg("--from"), encoding="utf-8"))
        elif "--opl" in sys.argv:  # Geofabrik file filtered by osmium (D-060); Overpass only for Israel
            data = from_opl(arg("--opl"), arg("--osm-base", ""), cfg["bbox"] or WORLD, cfg["overpass"])
        elif cfg["overpass"]:
            data = overpass()
        else:
            raise RuntimeError("no source given")
    except Exception as ex:  # noqa: BLE001
        print(f"{region}: OSM extract failed: {ex}")
        data = None
    if data is None:  # keep the data that is live now rather than shipping nothing
        kept = 0
        for name in names:
            old = previous(name) if prev else None
            if old:
                write(name, old)
                kept += 1
                print(f"{region}: kept previous {name} ({len(old['features'])} features, OSM base {old.get('osm_base')})")
        finish()
        sys.exit(0 if soft or kept else 1)
    trails, pois, seen = build(data)
    stamp = data.get("osm3s", {}).get("timestamp_osm_base", "")
    olds = [previous(n) for n in names] if prev else [None, None]
    if all(olds) and all(o.get("osm_base", "") > stamp for o in olds) and stamp and all(o.get("extract_version") == EXTRACT_VERSION for o in olds):
        print(f"{region}: new extract (OSM base {stamp}) is older than the live one ({olds[0].get('osm_base')}): keeping the live data")
        for n, o in zip(names, olds):
            write(n, o)
        return finish()
    for name, feats in zip(names, (trails, pois)):
        old = previous(name) if prev and data.get("incomplete") else None
        if old and len(old["features"]) > len(feats):  # partial run: the previous complete file is better
            print(f"{region}: partial extract: keeping previous {name} ({len(old['features'])} > {len(feats)} features)")
            feats, fstamp = old["features"], old.get("osm_base", "")
        else:
            fstamp = stamp
        write(name, {"type": "FeatureCollection", "osm_base": fstamp, "extract_version": EXTRACT_VERSION, "features": feats})
    sizes = {n: os.path.getsize(os.path.join(out, n)) for n in names}
    print(f"{region}: OSM base {stamp}; trails {len(trails)}, pois {len(pois)} ({counts(pois)}); bytes {sizes}")
    pool_names = sorted({f["properties"]["name"] for f in pois if f["properties"]["kind"] == "pool" and f["properties"]["name"]})
    print(f"  pool names ({len(pool_names)}): {', '.join(pool_names[:60])}")
    for k in ("int", "national", "regional", "marked"):
        nm = sorted(set(seen.get(k, [])))
        print(f"  {k}: {len(seen.get(k, []))} relations: {', '.join(nm[:40])}{' …' if len(nm) > 40 else ''}")
    finish()


def from_opl(path, osm_base, bbox=BBOX, allow_overpass=True):
    """Overpass-shaped data from an osmium OPL extract (scripts/osm_opl.py). Israel falls back to Overpass."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import osm_opl
    try:
        with open(path, encoding="utf-8") as fh:
            data = osm_opl.to_overpass(fh, bbox, osm_base)
        if not any(el["type"] == "relation" for el in data["elements"]):
            raise RuntimeError("no hiking routes in the file")
        print(f"source: Geofabrik extract via osmium, OSM base {osm_base or 'unknown'}, {len(data['elements'])} elements")
        return data
    except Exception as ex:  # noqa: BLE001
        if not allow_overpass:
            raise
        print(f"OPL source failed ({ex}) → Overpass", file=sys.stderr)
        return overpass()


if __name__ == "__main__":
    main()
