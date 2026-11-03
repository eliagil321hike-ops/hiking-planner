#!/usr/bin/env python3
"""Compare two OSM extracts (live vs new) and explain the differences (D-057, used by osm-check.yml).

Usage: osm_compare.py <live_dir> <new_dir> [<area.poly>]
With a Geofabrik .poly outline, every feature that is only in one extract is classed as inside or outside that
outline, so a drop caused by coverage (Jordan, Sinai, Lebanon in the old bounding box) is told apart from a drop
inside Israel, which would point at a rule difference. Prints a Markdown report.
"""
import collections, json, os, sys


def load(d, n):
    try:
        return json.load(open(os.path.join(d, n), encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {"features": [], "osm_base": "none"}


def read_poly(path):
    """Geofabrik/osmosis .poly → list of (ring, is_hole)."""
    rings, cur, hole = [], None, False
    for line in open(path, encoding="utf-8").read().splitlines()[1:]:
        s = line.strip()
        if not s:
            continue
        if cur is None:
            if s == "END":
                break
            cur, hole = [], s.startswith("!")
        elif s == "END":
            rings.append((cur, hole)); cur = None
        else:
            x, y = s.split()[:2]
            cur.append((float(x), float(y)))
    return rings


def inside_ring(x, y, ring):
    c = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def make_inside(rings):
    def inside(x, y):
        return any(inside_ring(x, y, r) for r, h in rings if not h) and not any(inside_ring(x, y, r) for r, h in rings if h)
    return inside


def mid(f):
    g = f["geometry"]
    if g["type"] == "Point":
        return g["coordinates"]
    pts = [p for line in g["coordinates"] for p in line]
    return pts[len(pts) // 2]


def main():
    live, new = sys.argv[1], sys.argv[2]
    inside = make_inside(read_poly(sys.argv[3])) if len(sys.argv) > 3 else None
    print("| | live | new (Geofabrik) |\n|---|---|---|")
    for n in ("osm-trails.geojson", "osm-pois.geojson"):
        a, b = load(live, n), load(new, n)
        print(f"| **{n}** OSM time | {a.get('osm_base')} | {b.get('osm_base')} |")
        print(f"| features | {len(a['features'])} | {len(b['features'])} |")
        ca = collections.Counter(f["properties"]["kind"] for f in a["features"])
        cb = collections.Counter(f["properties"]["kind"] for f in b["features"])
        for k in sorted(set(ca) | set(cb)):
            print(f"| &nbsp; {k} | {ca[k]} | {cb[k]} |")
        if inside:
            ia = collections.Counter(f["properties"]["kind"] for f in a["features"] if inside(*mid(f)))
            ib = collections.Counter(f["properties"]["kind"] for f in b["features"] if inside(*mid(f)))
            print(f"| *inside Israel & Palestine only* | {sum(ia.values())} | {sum(ib.values())} |")
            for k in sorted(set(ia) | set(ib)):
                print(f"| &nbsp; {k} (inside) | {ia[k]} | {ib[k]} |")
    print()
    if inside:
        # trails: by name; points: by kind + position (6 decimals)
        a, b = load(live, "osm-trails.geojson"), load(new, "osm-trails.geojson")
        nb = {f["properties"]["name"] for f in b["features"]}
        gone_in = sorted({f["properties"]["name"] for f in a["features"] if f["properties"]["name"] not in nb and inside(*mid(f))})
        gone_out = sorted({f["properties"]["name"] for f in a["features"] if f["properties"]["name"] not in nb and not inside(*mid(f))})
        print(f"Trail names only in the live data, **inside** the outline ({len(gone_in)}): {', '.join(gone_in) or '—'}\n")
        print(f"Trail names only in the live data, outside ({len(gone_out)}): {', '.join(gone_out[:40])}\n")
        a, b = load(live, "osm-pois.geojson"), load(new, "osm-pois.geojson")
        key = lambda f: (f["properties"]["kind"], round(f["geometry"]["coordinates"][0], 4), round(f["geometry"]["coordinates"][1], 4))
        kb = {key(f) for f in b["features"]}
        ka = {key(f) for f in a["features"]}
        gone = [f for f in a["features"] if key(f) not in kb and inside(*mid(f))]
        added = [f for f in b["features"] if key(f) not in ka]
        print(f"Points only in the live data, inside the outline: {len(gone)} "
              f"({dict(collections.Counter(f['properties']['kind'] for f in gone))})")
        for f in gone[:25]:
            print(f"- {f['properties']['kind']} {f['properties'].get('name', '')} {f['geometry']['coordinates']}")
        print(f"\nPoints only in the new data: {len(added)} ({dict(collections.Counter(f['properties']['kind'] for f in added))})")
    for n in ("osm-trails.geojson", "osm-pois.geojson"):
        print(f"\n{n}: {os.path.getsize(os.path.join(new, n))} bytes")


if __name__ == "__main__":
    main()
