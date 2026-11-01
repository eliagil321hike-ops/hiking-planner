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
import json, math, os, sys, time, urllib.parse, urllib.request

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
);
out center tags;"""
BAND = 0.25  # degrees of latitude per marked-trail query (0.5 timed out on the dense centre, 2026-11-01)
RANK = {"marked": 0, "regional": 1, "national": 2, "int": 3}
# Trail-marking colour (first part of osmc:symbol, else colour=) → map colour. Israeli marked trails are red,
# blue, green or black (Israel Trails Committee); others get a neutral brown.
MARK_COLOURS = {"red": "#d32f2f", "blue": "#1e63c4", "green": "#2e9b3e", "black": "#2b2b2b", "orange": "#f57c00",
                "purple": "#7b1fa2", "yellow": "#e0b000", "brown": "#8a5a2b", "white": "#9e9e9e"}
SKIP_ROLES = {"alternative", "excursion", "approach", "connection"}


def run_query(q, bbox):
    s_, w, n, e = bbox
    body = urllib.parse.urlencode({"data": q.format(s=s_, w=w, n=n, e=e)}).encode()
    last = None
    for attempt in range(3):
        for url in ENDPOINTS:
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": "Topo3D hiking planner (personal, build-time extract; github.com/eliagil321hike-ops/hiking-planner)"})
                with urllib.request.urlopen(req, timeout=240) as r:
                    return json.load(r)
            except Exception as ex:  # noqa: BLE001 - report and try the next endpoint
                last = ex
                print(f"overpass {url} attempt {attempt + 1} failed: {ex}", file=sys.stderr)
        time.sleep(30 * (attempt + 1))
    raise RuntimeError(f"all Overpass endpoints failed: {last}")


def overpass():
    """Run the split queries; keep whatever succeeds. Fails only if nothing at all came back."""
    s_, w, n, e = BBOX
    parts = [("major routes", Q_MAJOR, BBOX), ("campsites/water", Q_POIS, BBOX)]
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

    pois = []
    for el in data["elements"]:
        if el["type"] == "relation" and "center" not in el:
            continue
        t = el.get("tags", {})
        if t.get("tourism") == "camp_site":
            kind = "camp"
        elif t.get("amenity") == "drinking_water" or t.get("man_made") == "water_tap":
            if t.get("drinking_water") == "no" or t.get("access") in ("private", "no"):
                continue
            kind = "water"
        else:
            continue
        lon, lat = (el["lon"], el["lat"]) if "lon" in el else (el["center"]["lon"], el["center"]["lat"])
        pois.append({"type": "Feature", "properties": {"kind": kind, "name": t.get("name:he") or t.get("name") or ""},
                     "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]}})
    return trails, pois, seen


def main():
    out = sys.argv[1]
    soft = "--soft" in sys.argv
    try:
        if "--from" in sys.argv:
            data = json.load(open(sys.argv[sys.argv.index("--from") + 1], encoding="utf-8"))
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
        sys.exit(0 if soft or kept else 1)
    trails, pois, seen = build(data)
    stamp = data.get("osm3s", {}).get("timestamp_osm_base", "")
    for name, feats in (("osm-trails.geojson", trails), ("osm-pois.geojson", pois)):
        old = previous(name) if prev and data.get("incomplete") else None
        if old and len(old["features"]) > len(feats):  # partial run: the previous complete file is better
            print(f"partial extract: keeping previous {name} ({len(old['features'])} > {len(feats)} features)")
            feats, fstamp = old["features"], old.get("osm_base", "")
        else:
            fstamp = stamp
        with open(os.path.join(out, name), "w", encoding="utf-8") as f:
            json.dump({"type": "FeatureCollection", "osm_base": fstamp, "features": feats}, f, ensure_ascii=False, separators=(",", ":"))
    sizes = {n: os.path.getsize(os.path.join(out, n)) for n in ("osm-trails.geojson", "osm-pois.geojson")}
    print(f"OSM base {stamp}; trails {len(trails)}, pois {len(pois)} "
          f"(camp {sum(p['properties']['kind'] == 'camp' for p in pois)}, water {sum(p['properties']['kind'] == 'water' for p in pois)}); bytes {sizes}")
    for k in ("int", "national", "regional", "marked"):
        names = sorted(set(seen.get(k, [])))
        print(f"  {k}: {len(seen.get(k, []))} relations: {', '.join(names[:40])}{' …' if len(names) > 40 else ''}")


if __name__ == "__main__":
    main()
