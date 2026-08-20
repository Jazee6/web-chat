# The landing page is prerendered into the SPA shell instead of migrating to an SSR framework

Version 1.7.0 adds a marketing landing page at `/` that must be discoverable by search engines and citable by AI answer engines (GEO). The client is a client-rendered Vite SPA (`client/src/main.tsx`, BrowserRouter), and the static host serves unknown paths by falling back to `dist/index.html` - the same shell that powers shared `/room/:id` links.

## The decision

`client/scripts/prerender-landing.ts` runs after `vite build` (`client` package `build` script). It renders the presentational `LandingPage` (`client/src/landing/landing.tsx` - no hooks, no router context) with `react-dom/static`'s `prerender` and injects the resulting HTML into the empty `<div id="root">` of `dist/index.html`. The React app then re-renders the same markup when it mounts the `/` route, so the prerendered content is replaced by identical hydrated output.

`/` is a regular SPA route whose lazy chunk is the landing page; Public Room Discovery moved to `/rooms` (legacy `/room` redirects there; `/room/:id` room links are unchanged). Signed-in visitors are bounced to `/rooms` twice: an inline script injected by the prerender script checks better-auth's non-httpOnly `wc-session_data` cookie cache before the bundle loads, and the `Landing` component re-checks the session once mounted. The same script generates `sitemap.xml` and rewrites the canonical/OG/robots URLs from the `SITE_URL` env var so self-hosted builds point at their own domain.

## Why not the alternatives

- **Migrate the client to Next.js/Astro for real SSR.** The whole app would be rebuilt for one static page; chat realtime, WebRTC, and the Durable Object backend gain nothing from SSR. Disproportionate to the goal.
- **A pure zero-JS static HTML at `/` with the SPA moved to another path.** The host's SPA fallback would serve that landing HTML for `/rooms` and `/room/:id` deep links, breaking room sharing for signed-out visitors - unless the hosting layer is also reconfigured, which this repo does not control. Prerendering into the shell keeps every existing URL working with zero hosting changes.
- **A hand-written static HTML page.** Duplicates the shadcn/Tailwind design system in a second copy that drifts from the app, and loses the component-based review path.

## Consequences

- Crawlers that never execute JavaScript (GPTBot, PerplexityBot, most AI engines) still receive the complete landing markup - FAQ answers use native `<details open>` so no script is needed to expose them, and JSON-LD (`WebApplication`, `FAQPage`) plus `llms.txt`/`llms-full.txt` give generative engines structured, quotable facts.
- The prerendered markup is only refreshed by rebuilding; editing `landing.tsx` without running `bun run build` leaves stale static content in the shell. The script throws if the `#root` placeholder is missing so silent no-ops are caught.
- The landing is English-only by decision; no hreflang/multi-language variants exist.
