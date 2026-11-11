#!/bin/sh
# Create a zip of src/ ready to upload to the Chrome Web Store.
set -e
cd "$(dirname "$0")/.."
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' src/manifest.json | head -n 1)
mkdir -p dist
OUT="dist/gta6-blocker-chrome-$VERSION.zip"
(cd src && zip -r -X "../$OUT" . -x "*.DS_Store" -x "icons/icon-512.png" -x "_metadata/*")
echo "Created $OUT"
