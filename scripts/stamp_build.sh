#!/usr/bin/env bash
# Cache busting for GitHub Pages (it lets browsers cache files ~10 min): append ?v=<build> to every
# relative module import, the entry script, the stylesheet and the style overlay, and write the build id
# where __BUILD__ appears. Run by CI on the folder that is deployed. Usage: scripts/stamp_build.sh <dir> <build>
set -euo pipefail
DIR="$1"; BUILD="$2"
find "$DIR" -name '*.js' -print0 | xargs -0 sed -i -E \
  "s#((from|import)[[:space:]]*\(?[[:space:]]*['\"])(\.{1,2}/[^'\"?]+\.js)(['\"])#\1\3?v=${BUILD}\4#g"
sed -i -E "s#src=\"app\.js\"#src=\"app.js?v=${BUILD}\"#; s#href=\"style\.css\"#href=\"style.css?v=${BUILD}\"#; s#__BUILD__#${BUILD}#g" "$DIR/index.html"
sed -i -E "s#'\./styles/topo3d\.json'#'./styles/topo3d.json?v=${BUILD}'#; s#__BUILD__#${BUILD}#g" "$DIR/app.js"
# Fail loudly if any relative import was missed
if grep -rnE "(from|import)[[:space:]]*\(?[[:space:]]*['\"]\.{1,2}/[^'\"?]+\.js['\"]" "$DIR" --include='*.js'; then
  echo "unstamped relative import found" >&2; exit 1
fi
echo "stamped $DIR with build $BUILD"
