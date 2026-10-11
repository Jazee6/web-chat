#!/usr/bin/env bash
# 由 public/icons/*.svg 生成 Manifest 与 apple-touch-icon 用的 PNG，借用本机 Chrome 的无头模式渲染。
# 改过图标 SVG 后运行：bash scripts/gen-icons.sh
set -euo pipefail
cd "$(dirname "$0")/../public/icons"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

render() { # render <svg> <size> <png>
  printf '<body style="margin:0"><img src="file://%s/%s" width="%s" height="%s">' "$PWD" "$1" "$2" "$2" > "$tmp/page.html"
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size="$2,$2" --screenshot="$PWD/$3" "file://$tmp/page.html" 2>/dev/null
}

render icon.svg 192 icon-192.png
render icon.svg 512 icon-512.png
render icon-maskable.svg 512 icon-maskable-512.png
render icon-maskable.svg 180 apple-touch-icon.png
