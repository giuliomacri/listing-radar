#!/usr/bin/env bash
# Builds a Safari-ready copy of the extension and (on a Mac with Xcode) converts it to an Xcode project.
# Usage:  ./build-safari.sh [bundle-id]      e.g. ./build-safari.sh com.yourname.listingradar
set -euo pipefail
cd "$(dirname "$0")"
BUNDLE_ID="${1:-com.example.listingradar}"
OUT="safari-build"
rm -rf "$OUT" 2>/dev/null || true; mkdir -p "$OUT"
cp -R manifest.json config.js background.js LICENSE lib popup icons "$OUT"/

# Safari tweaks: host access is granted in Safari's settings, so declare it directly;
# drop the Chrome-only version key.
python3 - "$OUT/manifest.json" <<'PY'
import json, sys
p = sys.argv[1]
m = json.load(open(p))
m["host_permissions"] = m.pop("optional_host_permissions", [])
m.pop("minimum_chrome_version", None)
json.dump(m, open(p, "w"), indent=2)
print("Safari manifest written:", len(m["host_permissions"]), "host patterns")
PY

if command -v xcrun >/dev/null 2>&1 && xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  xcrun safari-web-extension-converter "$OUT" --app-name "Listing Radar" \
    --bundle-identifier "$BUNDLE_ID" --macos-only --swift --copy-resources \
    --project-location "$PWD/safari-xcode" --force
  echo "Xcode project created in safari-xcode/. Build and Run it, then enable the extension in Safari."
else
  echo "Xcode converter not found (needs a Mac with the full Xcode app). Safari-ready folder is in $OUT/."
fi
