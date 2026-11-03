#!/usr/bin/env python3
"""Turn an osmium OPL extract into the same JSON shape the Overpass queries return (D-060).

Why: the public Overpass servers kept failing (502/504, time budget, out-of-date backup), so the live extract
stayed at 2026-07-15. The weekly deploy now downloads the Geofabrik Israel file once, filters it with osmium,
and this module gives `fetch_osm_hiking.build()` exactly what Overpass would have given, so the output files and
the map do not change. Overpass stays as the fallback.

Input, made in CI (see .github/workflows/pages.yml):
  osmium tags-filter israel.osm.pbf r/route=hiking nwr/tourism=... -o hiking.pbf
  osmium add-locations-to-ways hiking.pbf --ignore-missing-nodes -f opl,add_metadata=false -o hiking.opl
OPL lines (one object per line, fields separated by spaces, order not relied on):
  n20 Ttourism=camp_site,name=%20%... x35.6 y33.1
  w10 Thighway=path Nn1x35.6y33.1,n2x35.61y33.11
  r1 Troute=hiking,network=nwn Mr2@,w10@,w12@alternative
Characters that would break the format are written as %<hex code point>%.

What it mirrors (scripts/fetch_osm_hiking.py, queries Q_MAJOR, Q_MARKED, Q_POIS, Q_PARKING):
- hiking route relations with network iwn/nwn/rwn/lwn that touch the box, members with way geometry
  (Overpass `out geom`); for iwn/nwn/rwn also their child relations, at any depth (Overpass: one level);
- campsites, drinking water, taps, viewpoints, shelters, huts, car parks, waterfalls, pools and ruins (nodes, ways, relations) with a
  centre (Overpass `out center`: middle of the bounding box), springs as nodes only.
Pure standard library, so it runs (and is tested) without osmium.
"""
import re

_ESC = re.compile(r"%([0-9a-fA-F]+)%")
TOP = {"iwn", "nwn", "rwn"}


def unescape(s):
    return _ESC.sub(lambda m: chr(int(m.group(1), 16)), s)


def _tags(field):
    out = {}
    if not field:
        return out
    for kv in field.split(","):
        if "=" in kv:
            k, v = kv.split("=", 1)
            out[unescape(k)] = unescape(v)
    return out


def _loc(token):
    """'n1x35.6y33.1' → (35.6, 33.1); missing location ('n1x y' or 'n1') → None."""
    m = re.match(r"n-?\d+x(-?[\d.]*)y(-?[\d.]*)$", token)
    if not m or not m.group(1) or not m.group(2):
        return None
    return float(m.group(1)), float(m.group(2))


def parse(lines):
    """OPL lines → (nodes, ways, rels): {id: {...}} with tags, location / point list / member list."""
    nodes, ways, rels = {}, {}, {}
    for raw in lines:
        line = raw.strip()
        if not line or line[0] not in "nwr":
            continue
        fields = line.split(" ")
        kind, oid = fields[0][0], int(fields[0][1:])
        f = {t[0]: t[1:] for t in fields[1:] if t}
        tags = _tags(f.get("T", ""))
        if kind == "n":
            if f.get("x") and f.get("y"):
                nodes[oid] = {"tags": tags, "lon": float(f["x"]), "lat": float(f["y"])}
        elif kind == "w":
            pts = [_loc(t) for t in f.get("N", "").split(",") if t]
            ways[oid] = {"tags": tags, "pts": [p for p in pts if p]}
        else:
            members = []
            for m in f.get("M", "").split(",") if f.get("M") else []:
                ref, _, role = m.partition("@")
                members.append({"type": {"n": "node", "w": "way", "r": "relation"}[ref[0]],
                                "ref": int(ref[1:]), "role": unescape(role)})
            rels[oid] = {"tags": tags, "members": members}
    return nodes, ways, rels


POOL_NAME = re.compile(r"^(גב|גבי|בריכת|בריכה) ")


def poi_wanted(t, is_node):
    """The tag tests of Q_POIS and Q_PARKING (springs: nodes only)."""
    return (t.get("tourism") in ("camp_site", "viewpoint", "wilderness_hut", "alpine_hut")
            or t.get("amenity") in ("drinking_water", "shelter", "parking")
            or t.get("man_made") == "water_tap"
            or (is_node and t.get("natural") == "spring")
            or t.get("waterway") == "waterfall"
            or (t.get("natural") == "water" and (t.get("water") == "stream_pool" or bool(POOL_NAME.match(t.get("name", "")))))
            or t.get("leisure") == "swimming_area"
            or t.get("historic") in ("ruins", "archaeological_site"))


def _in_box(lon, lat, box):
    s, w, n, e = box
    return s <= lat <= n and w <= lon <= e


def _center(pts):
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return {"lat": (min(ys) + max(ys)) / 2, "lon": (min(xs) + max(xs)) / 2}


def to_overpass(lines, bbox, osm_base=""):
    """The Overpass-shaped dict: {"osm3s": {"timestamp_osm_base": ...}, "elements": [...]}."""
    nodes, ways, rels = parse(lines)

    def way_geom(wid):
        return [{"lat": y, "lon": x} for x, y in ways[wid]["pts"]] if wid in ways else None

    def touches(rid, depth=0):
        """A member way in the box, or a child relation that has one (a super-route like the Israel Trail holds
        only its sections)."""
        for m in rels[rid]["members"]:
            if m["type"] == "way" and m["ref"] in ways and any(_in_box(x, y, bbox) for x, y in ways[m["ref"]]["pts"]):
                return True
            if m["type"] == "relation" and m["ref"] in rels and depth < 5 and touches(m["ref"], depth + 1):
                return True
        return False

    def route_out(rid):
        members = []
        for m in rels[rid]["members"]:
            mm = dict(m)
            if m["type"] == "way":
                g = way_geom(m["ref"])
                if g is None:   # member not in the extract: Overpass gives it without geometry, build() skips it
                    members.append(mm)
                    continue
                mm["geometry"] = g
            elif m["type"] == "node" and m["ref"] in nodes:
                mm["lat"], mm["lon"] = nodes[m["ref"]]["lat"], nodes[m["ref"]]["lon"]
            members.append(mm)
        return {"type": "relation", "id": rid, "tags": rels[rid]["tags"], "members": members}

    chosen = []
    for rid, r in rels.items():
        t = r["tags"]
        if t.get("route") == "hiking" and t.get("network") in TOP | {"lwn"} and touches(rid):
            chosen.append(rid)
    # children of national/regional routes (sections of the Israel Trail etc.), at any depth
    todo = [rid for rid in chosen if rels[rid]["tags"].get("network") in TOP]
    have = set(chosen)
    while todo:
        rid = todo.pop()
        for m in rels[rid]["members"]:
            if m["type"] == "relation" and m["ref"] in rels and m["ref"] not in have:
                have.add(m["ref"]); chosen.append(m["ref"]); todo.append(m["ref"])
    elements = [route_out(rid) for rid in sorted(chosen)]

    for nid, n in sorted(nodes.items()):
        if poi_wanted(n["tags"], True) and _in_box(n["lon"], n["lat"], bbox):
            elements.append({"type": "node", "id": nid, "lat": n["lat"], "lon": n["lon"], "tags": n["tags"]})
    for wid, w in sorted(ways.items()):
        if w["pts"] and poi_wanted(w["tags"], False):
            c = _center(w["pts"])
            if _in_box(c["lon"], c["lat"], bbox):
                elements.append({"type": "way", "id": wid, "center": c, "tags": w["tags"]})
    for rid, r in sorted(rels.items()):
        if rid in have or not poi_wanted(r["tags"], False):
            continue
        pts = [p for m in r["members"] if m["type"] == "way" and m["ref"] in ways for p in ways[m["ref"]]["pts"]]
        pts += [(nodes[m["ref"]]["lon"], nodes[m["ref"]]["lat"]) for m in r["members"] if m["type"] == "node" and m["ref"] in nodes]
        if pts:
            c = _center(pts)
            if _in_box(c["lon"], c["lat"], bbox):
                elements.append({"type": "relation", "id": rid, "center": c, "tags": r["tags"]})
    return {"osm3s": {"timestamp_osm_base": osm_base}, "elements": elements}
