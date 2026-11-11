#!/usr/bin/env bash
# Builds a Firefox (desktop + Android) copy of the extension in firefox-build/ and zips it.
# Usage: ./build-firefox.sh [gecko-id]     e.g. ./build-firefox.sh listing-radar@yourdomain.com
set -euo pipefail
cd "$(dirname "$0")"
GECKO_ID="${1:-{f4a2483f-7281-452d-94f8-dddbc259ec60}}"
OUT="firefox-build"
rm -rf "$OUT" 2>/dev/null || true; mkdir -p "$OUT"
cp -R manifest.json config.js background.js LICENSE lib popup icons "$OUT"/

python3 - "$OUT/manifest.json" "$GECKO_ID" <<'PY'
import json, sys
p, gid = sys.argv[1], sys.argv[2]
m = json.load(open(p))
# Firefox runs MV3 background code as an event page (no service workers).
m["background"] = {"scripts": ["background.js"], "type": "module"}
m.pop("minimum_chrome_version", None)
m["browser_specific_settings"] = {
    "gecko": {"id": gid, "strict_min_version": "142.0",
              "data_collection_permissions": {"required": ["none"]}},
    "gecko_android": {"strict_min_version": "142.0"},
}
json.dump(m, open(p, "w"), indent=2)
print("Firefox manifest written for", gid)
PY

VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
ZIP="/tmp/listing-radar-firefox-$VERSION.zip"
rm -f "$ZIP" && (cd "$OUT" && zip -rq "$ZIP" . -x ".DS_Store") && cp -f "$ZIP" "./listing-radar-firefox-$VERSION.zip"
echo "Built $OUT/ and listing-radar-firefox-$VERSION.zip"
echo "Try it: about:debugging -> This Firefox -> Load Temporary Add-on -> pick $OUT/manifest.json"
