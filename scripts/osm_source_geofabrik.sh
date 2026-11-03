#!/usr/bin/env bash
# Prepare the OSM source for fetch_osm_hiking.py from the Geofabrik Israel file (D-057).
# Usage: osm_source_geofabrik.sh <work_dir>
# On success prints the arguments for fetch_osm_hiking.py (--opl <file> --osm-base <time>) on stdout's last line;
# on any failure prints nothing there and exits 0, so the caller falls back to Overpass (as before D-057).
# Geofabrik updates the extract daily; one ~100–200 MB download per weekly run. Data © OpenStreetMap contributors, ODbL.
set -uo pipefail
WORK="${1:?work dir}"
URL="https://download.geofabrik.de/asia/israel-and-palestine-latest.osm.pbf"
mkdir -p "$WORK"
log() { echo "$*" >&2; }

if ! command -v osmium >/dev/null; then
  log "installing osmium-tool"
  { sudo apt-get update -q && sudo apt-get install -y -q osmium-tool; } >&2 || { log "osmium install failed"; exit 0; }
fi
log "osmium $(osmium --version | head -1)"

t0=$(date +%s)
curl -fsSL --retry 2 -m 900 -o "$WORK/israel.osm.pbf" "$URL" || { log "download failed: $URL"; exit 0; }
log "downloaded $(du -h "$WORK/israel.osm.pbf" | cut -f1) in $(( $(date +%s) - t0 )) s"

BASE=$(osmium fileinfo -g header.option.osmosis_replication_timestamp "$WORK/israel.osm.pbf" 2>/dev/null)
log "OSM data time: ${BASE:-unknown}"

# Same objects as the Overpass queries in fetch_osm_hiking.py (Q_MAJOR, Q_MARKED, Q_POIS, Q_PARKING); osmium adds
# the ways and nodes they reference. scripts/osm_opl.py then applies the exact query rules (network, box, …).
osmium tags-filter "$WORK/israel.osm.pbf" \
  r/route=hiking \
  nwr/tourism=camp_site,viewpoint,wilderness_hut,alpine_hut \
  nwr/amenity=drinking_water,shelter,parking \
  nwr/man_made=water_tap \
  n/natural=spring \
  -O -o "$WORK/hiking.osm.pbf" >&2 || { log "osmium tags-filter failed"; exit 0; }
osmium add-locations-to-ways "$WORK/hiking.osm.pbf" --ignore-missing-nodes \
  -f opl,add_metadata=false -O -o "$WORK/hiking.opl" >&2 || { log "osmium add-locations-to-ways failed"; exit 0; }
log "filtered: $(wc -l < "$WORK/hiking.opl") objects, $(du -h "$WORK/hiking.opl" | cut -f1)"

if [ -n "$BASE" ]; then echo "--opl $WORK/hiking.opl --osm-base $BASE"; else echo "--opl $WORK/hiking.opl"; fi
