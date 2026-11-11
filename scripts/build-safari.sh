#!/bin/bash
# One-step Safari build for macOS.
#
#   ./scripts/build-safari.sh            build + install the app, open it once
#   ./scripts/build-safari.sh --open     only generate the Xcode project and open it
#   ./scripts/build-safari.sh --ios      also generate iOS/iPadOS targets
#
# Env vars:
#   DEVELOPMENT_TEAM=ABCDE12345   sign with your Apple team (otherwise signs to run locally)
#   BUNDLE_ID=com.you.gta6blocker
#
# Requires Xcode (the full app, not just the Command Line Tools).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

APP_NAME="GTA 6 Blocker"
BUNDLE_ID="${BUNDLE_ID:-com.gta6blocker.safari}"
TEAM="${DEVELOPMENT_TEAM:-}"
MACOS_MIN="12.0"   # Safari 15.4+ is the minimum for Manifest V3 service workers
IOS_MIN="15.4"
OUT="$ROOT/build/safari"
LOG="$ROOT/build/xcodebuild.log"
MODE="build"
PLATFORM_FLAG="--macos-only"

for arg in "$@"; do
  case "$arg" in
    --open) MODE="open" ;;
    --ios) PLATFORM_FLAG="" ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

say() { printf '\n\033[1;31m▶\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

# --- Checks -------------------------------------------------------------------
[ "$(uname)" = "Darwin" ] || fail "Safari builds need macOS."
if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  if [ -d /Applications/Xcode.app ]; then
    fail "Xcode is installed but not selected. Run:  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer && sudo xcodebuild -license accept"
  fi
  fail "Xcode not found. Install it from the Mac App Store, open it once, then run this again."
fi

VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' src/manifest.json | head -n 1)"
BUILD_NUMBER="$(echo "$VERSION" | tr -d '.')"
say "Building $APP_NAME $VERSION for Safari"

# --- 1. Generate the Xcode project --------------------------------------------
say "Generating Xcode project"
rm -rf "$OUT"
mkdir -p "$OUT"
# shellcheck disable=SC2086
xcrun safari-web-extension-converter "$ROOT/src" \
  --project-location "$OUT" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --swift \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force \
  $PLATFORM_FLAG

PROJ="$(find "$OUT" -maxdepth 3 -name '*.xcodeproj' | head -n 1)"
[ -n "$PROJ" ] || fail "The converter did not create an Xcode project."
PBX="$PROJ/project.pbxproj"

# --- 2. Fix project settings so it builds out of the box ----------------------
say "Configuring project (versions, deployment targets, signing)"
sed -i '' \
  -e "s/MARKETING_VERSION = [^;]*;/MARKETING_VERSION = $VERSION;/g" \
  -e "s/CURRENT_PROJECT_VERSION = [^;]*;/CURRENT_PROJECT_VERSION = $BUILD_NUMBER;/g" \
  -e "s/MACOSX_DEPLOYMENT_TARGET = [^;]*;/MACOSX_DEPLOYMENT_TARGET = $MACOS_MIN;/g" \
  -e "s/IPHONEOS_DEPLOYMENT_TARGET = [^;]*;/IPHONEOS_DEPLOYMENT_TARGET = $IOS_MIN;/g" \
  -e "s/DEVELOPMENT_TEAM = [^;]*;//g" \
  "$PBX"
# Newer converters derive the app's bundle id from the app name
# (e.g. com.gta6blocker.GTA-6-Blocker) while the extension keeps
# $BUNDLE_ID.Extension, so the embedded extension isn't prefixed by the app id
# and the build fails. Force app = $BUNDLE_ID, extension = $BUNDLE_ID.Extension.
sed -i '' -E \
  -e "/PRODUCT_BUNDLE_IDENTIFIER = /{/\.Extension\"?;/!s/PRODUCT_BUNDLE_IDENTIFIER = [^;]*;/PRODUCT_BUNDLE_IDENTIFIER = \"$BUNDLE_ID\";/;}" \
  -e "s/PRODUCT_BUNDLE_IDENTIFIER = \"?[^;\"]*\.Extension\"?;/PRODUCT_BUNDLE_IDENTIFIER = \"$BUNDLE_ID.Extension\";/" \
  "$PBX"
find "$OUT" -name '*.swift' -exec sed -i '' -E \
  "s/let extensionBundleIdentifier = \"[^\"]*\"/let extensionBundleIdentifier = \"$BUNDLE_ID.Extension\"/" {} +

if [ -n "$TEAM" ]; then
  # Real signing with your Apple team.
  sed -i '' -e "s/CODE_SIGN_STYLE = [^;]*;/CODE_SIGN_STYLE = Automatic; DEVELOPMENT_TEAM = $TEAM;/g" "$PBX"
  SIGN_ARGS=(DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates)
else
  # No team: "Sign to Run Locally". Works on this Mac without an Apple developer account.
  sed -i '' -e "s/CODE_SIGN_STYLE = [^;]*;/CODE_SIGN_STYLE = Manual; CODE_SIGN_IDENTITY = \"-\"; DEVELOPMENT_TEAM = \"\"; PROVISIONING_PROFILE_SPECIFIER = \"\";/g" "$PBX"
  SIGN_ARGS=(CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER=)
fi

if [ "$MODE" = "open" ]; then
  say "Opening Xcode. Pick the \"$APP_NAME\" scheme with destination \"My Mac\" and press ⌘R."
  open "$PROJ"
  exit 0
fi

# --- 3. Build ------------------------------------------------------------------
SCHEMES="$(xcodebuild -list -project "$PROJ" 2>/dev/null | awk '/Schemes:/{f=1;next} f&&NF{sub(/^ +/,"");print}')"
if echo "$SCHEMES" | grep -qx "$APP_NAME (macOS)"; then
  SCHEME="$APP_NAME (macOS)"
else
  SCHEME="$(echo "$SCHEMES" | head -n 1)"
fi
say "Building scheme \"$SCHEME\" (Release, My Mac). This takes a minute."

if ! xcodebuild \
  -project "$PROJ" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination "platform=macOS,arch=$(uname -m)" \
  -derivedDataPath "$ROOT/build/DerivedData" \
  MARKETING_VERSION="$VERSION" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  MACOSX_DEPLOYMENT_TARGET="$MACOS_MIN" \
  "${SIGN_ARGS[@]}" \
  build > "$LOG" 2>&1; then
  grep -E "error:" "$LOG" | sort -u | head -20 >&2 || true
  fail "Build failed. Full log: build/xcodebuild.log  (or run with --open to build in Xcode)"
fi

APP="$(find "$ROOT/build/DerivedData/Build/Products/Release" -maxdepth 1 -name '*.app' | head -n 1)"
[ -n "$APP" ] || fail "Build finished but no app was found. See build/xcodebuild.log"

# --- 4. Install & register with Safari -----------------------------------------
DEST="$HOME/Applications"
mkdir -p "$DEST"
say "Installing to ~/Applications"
osascript -e "quit app \"$APP_NAME\"" >/dev/null 2>&1 || true
rm -rf "$DEST/$APP_NAME.app"
cp -R "$APP" "$DEST/"
# Launching the container app once registers the extension with Safari.
open "$DEST/$APP_NAME.app"

cat <<EOF

✅ Built and installed $APP_NAME $VERSION

Turn it on in Safari (first time only):
  1. Safari ▸ Settings ▸ Advanced ▸ tick "Show features for web developers"
  2. Safari ▸ Settings ▸ Developer ▸ tick "Allow unsigned extensions"
     (needed because it's signed locally; Safari resets this when it quits.
      Build with DEVELOPMENT_TEAM=<your team id> to skip this step.)
  3. Safari ▸ Settings ▸ Extensions ▸ enable "$APP_NAME",
     then "Edit Websites…" ▸ set "Other Websites" to "Allow"

EOF
