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
# Inside the app the page stays inside the safe area (status bar, camera cut-out, gesture bar): the SystemBars
# plugin pads the WebView ("native" insets) and the page asks for "contain" instead of the website's "cover",
# so no control sits under a system bar. The website's own file is unchanged (D-078).
sed -i 's/viewport-fit=cover/viewport-fit=contain/' "$HERE/app/www/index.html"
grep -q 'viewport-fit=contain' "$HERE/app/www/index.html" || { echo "viewport not adapted" >&2; exit 1; }
echo "app/www ready (build $BUILD)"
