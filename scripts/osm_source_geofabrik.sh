#!/usr/bin/env bash
# Prepare one region's OSM source for fetch_osm_hiking.py from its Geofabrik file (D-060, regions D-061).
# Usage: osm_source_geofabrik.sh <work_dir> <region>          region: israel | georgia | norway
#        osm_source_geofabrik.sh <work_dir> <region> --poly-only   (just the border outline, a few kB)
# Always writes <work_dir>/<region>.poly when Geofabrik answers (the site's coverage follows the real border).
# On success the last stdout line is the arguments for fetch_osm_hiking.py (--opl <file> --osm-base <time>);
# on any failure that line is empty and the script exits 0, so the caller falls back (Israel: Overpass; others:
# the previous live data). Data © OpenStreetMap contributors, ODbL. Geofabrik updates the files daily.
set -uo pipefail
WORK="${1:?work dir}"; REGION="${2:?region}"; MODE="${3:-}"
case "$REGION" in
  israel)  PATHS="asia/israel-and-palestine"; EXTRA="nwr/natural=water" ;;   # pools named גב/בריכת (D-061)
  georgia) PATHS="europe/georgia asia/georgia"; EXTRA="" ;;
  norway)  PATHS="europe/norway"; EXTRA="" ;;
  *) echo "unknown region $REGION" >&2; echo ""; exit 0 ;;
esac
BASE_URL="https://download.geofabrik.de"
mkdir -p "$WORK"
log() { echo "[$REGION] $*" >&2; }

FOUND=""
for p in $PATHS; do   # the outline doubles as a check of which path Geofabrik uses
  if curl -fsSL --retry 2 -m 60 -o "$WORK/$REGION.poly" "$BASE_URL/$p.poly"; then FOUND="$p"; break; fi
done
if [ -z "$FOUND" ]; then log "no outline at: $PATHS"; rm -f "$WORK/$REGION.poly"; echo ""; exit 0; fi
log "outline $FOUND.poly ($(wc -l < "$WORK/$REGION.poly") lines)"
[ "$MODE" = "--poly-only" ] && { echo ""; exit 0; }

if ! command -v osmium >/dev/null; then
  log "installing osmium-tool"
  { sudo apt-get update -q && sudo apt-get install -y -q osmium-tool; } >&2 || { log "osmium install failed"; echo ""; exit 0; }
fi

PBF="$WORK/$REGION.osm.pbf"
t0=$(date +%s)
curl -fsSL --retry 2 -m 1800 -o "$PBF" "$BASE_URL/$FOUND-latest.osm.pbf" || { log "download failed"; echo ""; exit 0; }
log "downloaded $(du -h "$PBF" | cut -f1) in $(( $(date +%s) - t0 )) s"
BASE=$(osmium fileinfo -g header.option.osmosis_replication_timestamp "$PBF" 2>/dev/null)
log "OSM data time: ${BASE:-unknown}"

# Same objects as the Overpass queries in fetch_osm_hiking.py; osmium adds the ways and nodes they reference.
# scripts/osm_opl.py then applies the exact query rules (network, box, pool names, …).
# shellcheck disable=SC2086
osmium tags-filter "$PBF" \
  r/route=hiking \
  nwr/tourism=camp_site,viewpoint,wilderness_hut,alpine_hut \
  nwr/amenity=drinking_water,shelter,parking \
  nwr/man_made=water_tap \
  n/natural=spring \
  nwr/waterway=waterfall \
  nwr/water=stream_pool \
  nwr/natural=waterhole \
  nwr/leisure=swimming_area \
  nwr/historic=ruins,archaeological_site \
  $EXTRA \
  -O -o "$WORK/$REGION-hiking.osm.pbf" >&2 || { log "osmium tags-filter failed"; echo ""; exit 0; }
rm -f "$PBF"   # large; not needed any more
osmium add-locations-to-ways "$WORK/$REGION-hiking.osm.pbf" --ignore-missing-nodes \
  -f opl,add_metadata=false -O -o "$WORK/$REGION.opl" >&2 || { log "osmium add-locations-to-ways failed"; echo ""; exit 0; }
log "filtered: $(wc -l < "$WORK/$REGION.opl") objects, $(du -h "$WORK/$REGION.opl" | cut -f1)"

if [ -n "$BASE" ]; then echo "--opl $WORK/$REGION.opl --osm-base $BASE"; else echo "--opl $WORK/$REGION.opl"; fi
