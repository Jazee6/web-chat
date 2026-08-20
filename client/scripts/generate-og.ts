// Generates client/public/og.png (1200x630 Open Graph image) by rendering a
// local HTML file in a headless Chromium-family browser and screenshotting it.
//
// Usage: bun run scripts/generate-og.ts  (from the client/ package)
//
// Deliberately NOT part of `npm run build` - see docs/adr/0015-og-image-headless-browser-screenshot.md.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WIDTH = 1200;
const HEIGHT = 630;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const clientDir = resolve(scriptDir, "..");
const iconSvg = readFileSync(join(clientDir, "public", "icon.svg"), "utf8");

// The icon uses stroke="currentColor"; the wrapper div supplies the color.
const iconMarkup = iconSvg.replace(
  /<svg /,
  '<svg style="width:60px;height:60px;display:block" ',
);

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
    body {
        background:
            radial-gradient(ellipse 900px 550px at 22% 30%, rgba(63, 63, 70, 0.22) 0%, transparent 70%),
            radial-gradient(#27272a 1px, transparent 1px) 0 0 / 24px 24px,
            #09090b;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif;
        display: flex;
        align-items: center;
    }
    .stack {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 28px;
        padding-left: 96px;
        color: #fafafa;
    }
    .icon-box {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 104px;
        height: 104px;
        border: 1px solid #27272a;
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.02);
        color: #fafafa;
    }
    .brand {
        font-size: 76px;
        font-weight: 600;
        letter-spacing: -0.03em;
        line-height: 1;
    }
    .tagline {
        font-size: 30px;
        font-weight: 400;
        color: #a1a1aa;
        letter-spacing: -0.01em;
    }
    .domain {
        font-size: 17px;
        color: #71717a;
        letter-spacing: 0.01em;
    }
</style>
</head>
<body>
    <div class="stack">
        <div class="icon-box">${iconMarkup}</div>
        <div class="brand">Web Chat</div>
        <div class="tagline">Real-time chat rooms at the edge</div>
        <div class="domain">chat.jaze.top</div>
    </div>
</body>
</html>`;

function findBrowser(): string {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ];
  for (const bin of candidates) {
    try {
      execFileSync("test", ["-x", bin]);
      return bin;
    } catch {
      // keep looking
    }
  }
  throw new Error(
    "No Chromium-family browser found. Install Google Chrome or Microsoft Edge, or add a path to generate-og.ts.",
  );
}

function pngDimensions(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) {
    throw new Error("Output is not a valid PNG");
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const workDir = mkdtempSync(join(tmpdir(), "og-image-"));
const htmlPath = join(workDir, "og.html");
const shotPath = join(workDir, "og.png");
writeFileSync(htmlPath, html);

const browser = findBrowser();
execFileSync(
  browser,
  [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    `--window-size=${WIDTH},${HEIGHT}`,
    "--force-device-scale-factor=1",
    "--virtual-time-budget=1000",
    `--screenshot=${shotPath}`,
    `file://${htmlPath}`,
  ],
  { stdio: "ignore" },
);

const png = readFileSync(shotPath);
const { width, height } = pngDimensions(png);
if (width !== WIDTH || height !== HEIGHT) {
  throw new Error(`Expected ${WIDTH}x${HEIGHT}, got ${width}x${height}`);
}

const outPath = join(clientDir, "public", "og.png");
writeFileSync(outPath, png);
console.log(
  `Wrote ${outPath} (${width}x${height}, ${(png.length / 1024).toFixed(1)} KB)`,
);
