#!/usr/bin/env python3
"""How much of the data for new map layers exists in an OSM extract (D-058 planning, used by osm-check.yml).

Usage: osm_tag_stats.py <file.opl>   (osmium OPL, see osm_opl.py). Prints a Markdown report: waterfalls, pools,
ruins/archaeological sites, and how many paths carry difficulty (sac_scale) / visibility (trail_visibility).
"""
import collections, sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from osm_opl import parse  # noqa: E402


def main():
    nodes, ways, rels = parse(open(sys.argv[1], encoding="utf-8"))
    objs = [("n", o) for o in nodes.values()] + [("w", o) for o in ways.values()] + [("r", o) for o in rels.values()]
    c = collections.Counter()
    water_vals, sac, vis, hist_names, pool_names = collections.Counter(), collections.Counter(), collections.Counter(), [], []
    paths = 0
    for kind, o in objs:
        t = o["tags"]
        name = t.get("name:he") or t.get("name") or ""
        if t.get("waterway") == "waterfall":
            c[f"waterfall ({kind})"] += 1
            c["waterfall named"] += bool(name)
        if t.get("natural") == "water":
            water_vals[t.get("water", "(none)")] += 1
            if name.startswith(("גב ", "גבי ", "בריכת ", "בריכה ")):
                c["water named גב/בריכה"] += 1
                pool_names.append(name)
        if t.get("leisure") == "swimming_area":
            c["leisure=swimming_area"] += 1
        if t.get("historic") in ("ruins", "archaeological_site"):
            c[f"historic={t['historic']}"] += 1
            c[f"historic={t['historic']} named"] += bool(name)
            if name and len(hist_names) < 15:
                hist_names.append(name)
        if kind == "w" and t.get("highway") in ("path", "footway", "track", "bridleway"):
            paths += 1
            sac[t.get("sac_scale", "-")] += 1
            vis[t.get("trail_visibility", "-")] += 1
    print("### Tag counts in this extract\n")
    for k, v in sorted(c.items()):
        print(f"- {k}: {v}")
    print(f"\n`natural=water` by `water=`: {dict(water_vals.most_common(12))}")
    print(f"\nPools named גב/בריכה (sample): {', '.join(pool_names[:20])}")
    print(f"\nRuins/archaeology names (sample): {', '.join(hist_names)}")
    print(f"\nPaths/footways/tracks: {paths}; sac_scale: {dict(sac.most_common())}; trail_visibility: {dict(vis.most_common())}")


if __name__ == "__main__":
    main()
