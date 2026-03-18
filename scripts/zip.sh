#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT_DIR/dist"
OUT="$ROOT_DIR/releases"
VERSION="0.1.0"

mkdir -p "$OUT"

ZIP_NAME="gitleet-chrome-v${VERSION}.zip"
ZIP_PATH="$OUT/$ZIP_NAME"

rm -f "$ZIP_PATH"

(cd "$DIST" && zip -r "$ZIP_PATH" .)

echo "Wrote $ZIP_PATH"

