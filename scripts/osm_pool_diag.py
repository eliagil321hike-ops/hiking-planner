#!/usr/bin/env python3
"""Temporary (D-063): list how objects named "גב …" / "גבי …" are tagged in an OPL dump."""
import collections, re, sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from osm_opl import _tags  # noqa: E402

NAME = re.compile(r"^(גב|גבי|גבא|גבים)( |$)")
combos, samples, n = collections.Counter(), [], 0
for line in open(sys.argv[1], encoding="utf-8"):
    if " T" not in line or ("name" not in line):
        continue
    f = {t[0]: t[1:] for t in line.rstrip("\n").split(" ")[1:] if t}
    t = _tags(f.get("T", ""))
    name = t.get("name:he") or t.get("name") or ""
    if not NAME.match(name):
        continue
    n += 1
    key = ", ".join(f"{k}={v}" for k, v in sorted(t.items()) if not k.startswith(("name", "wiki", "source", "note", "description", "alt_name", "old_name", "int_name")))
    combos[(line[0], key)] += 1
    if len(samples) < 40:
        samples.append(f"{line[0]} {name} | {key}")
print(f"### Objects named גב/גבי: {n}\n")
print("| type | tags (without names) | count |\n|---|---|---|")
for (typ, k), c in combos.most_common(40):
    print(f"| {typ} | {k or '(only names)'} | {c} |")
print("\nSamples:\n")
for s in samples:
    print(f"- {s}")
