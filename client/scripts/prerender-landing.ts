/**
 * Post-build landing prerender.
 *
 * The client is a Vite SPA, but `/` must serve real content to crawlers:
 * Google's JS rendering is unreliable and AI answer engines (GPTBot,
 * PerplexityBot, ...) generally do not execute JavaScript at all. This
 * script runs after `vite build`, renders the presentational landing page
 * with `react-dom/static` and injects the resulting HTML into the empty
 * `#root` div of dist/index.html. The React app then re-renders the same
 * markup when it hydrates the `/` route.
 *
 * It also injects an inline script that bounces signed-in visitors from
 * `/` to `/rooms` before the bundle loads (better-auth's non-httpOnly
 * `wc-session_data` cookie cache), and rewrites the canonical/site URLs
 * in index.html + robots.txt from the SITE_URL env var when set, plus
 * writes sitemap.xml.
 *
 * Usage: bun scripts/prerender-landing.ts   (from client/, after vite build)
 */
import { createElement } from "react";
import { prerender } from "react-dom/static";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { LandingPage } from "../src/landing/landing.tsx";

const distDir = resolve(import.meta.dir, "../dist");
const defaultSiteUrl = "https://chat.jaze.top";
const siteUrl = (
  process.env.SITE_URL ?? defaultSiteUrl
).replace(/\/+$/, "");

const indexHtmlPath = resolve(distDir, "index.html");
let indexHtml = readFileSync(indexHtmlPath, "utf8");

// 1. Prerender the landing page into #root.
const { prelude } = await prerender(createElement(LandingPage));
let landingHtml = "";
const decoder = new TextDecoder();
for await (const chunk of prelude) {
  landingHtml +=
    typeof chunk === "string"
      ? chunk
      : decoder.decode(chunk, { stream: true });
}

const rootPlaceholder = '<div id="root"></div>';
if (!indexHtml.includes(rootPlaceholder)) {
  throw new Error(
    "dist/index.html no longer contains the empty #root div - " +
      "update the placeholder in scripts/prerender-landing.ts",
  );
}
indexHtml = indexHtml.replace(
  rootPlaceholder,
  `<div id="root">${landingHtml}</div>`,
);

// 2. Bounce signed-in visitors to /rooms before the bundle loads.
//    The wc-session_data cookie is better-auth's non-httpOnly session
//    cache (cookiePrefix "wc" + cookieCache enabled in server auth config).
const sessionRedirect = `<script>if(location.pathname==="/"&&/(?:^|;\\s*)wc-session_data=/.test(document.cookie))location.replace("/rooms")</script>`;
indexHtml = indexHtml.replace(
  '<body class="dark">',
  `<body class="dark">\n${sessionRedirect}`,
);

// 3. Point canonical/OG/JSON-LD URLs at this deployment when SITE_URL is set.
if (siteUrl !== defaultSiteUrl) {
  indexHtml = indexHtml.split(defaultSiteUrl).join(siteUrl);
}
writeFileSync(indexHtmlPath, indexHtml);

// 4. robots.txt with the deployment's sitemap URL.
const robotsTxtPath = resolve(distDir, "robots.txt");
let robotsTxt = readFileSync(robotsTxtPath, "utf8");
if (siteUrl !== defaultSiteUrl) {
  robotsTxt = robotsTxt.split(defaultSiteUrl).join(siteUrl);
}
writeFileSync(robotsTxtPath, robotsTxt);

// 5. sitemap.xml - only `/` carries crawlable content; everything behind
//    /rooms requires sign-in.
writeFileSync(
  resolve(distDir, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteUrl}/</loc>
  </url>
</urlset>
`,
);

console.log(
  `Prerendered landing page into dist/index.html (${landingHtml.length} bytes of HTML, site URL: ${siteUrl})`,
);
