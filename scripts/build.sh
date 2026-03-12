#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT_DIR/dist"

rm -rf "$DIST"
mkdir -p "$DIST"

cp -R "$ROOT_DIR/extension/." "$DIST/"

echo "Built extension to $DIST"

