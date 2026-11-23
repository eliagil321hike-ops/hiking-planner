#!/usr/bin/env bash
# A1 (D-078): the Android app's web content = the site/ folder, copied into app/www and stamped with a build id
# like the Pages deploy (scripts/stamp_build.sh). The OSM extract (site/data, built by the deploy) is not
# copied: inside the app it is read from the live site over the network (app.js, D-078).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="${1:-${GITHUB_SHA:-local}}"; BUILD="${BUILD::7}"
rm -rf "$HERE/app/www"
cp -r "$HERE/site" "$HERE/app/www"
rm -rf "$HERE/app/www/data"
bash "$HERE/scripts/stamp_build.sh" "$HERE/app/www" "$BUILD"
echo "app/www ready (build $BUILD)"
