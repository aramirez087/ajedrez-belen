# Landing performance/accessibility follow-up

## Changes

- `src/data/landing-media.ts` supplies identical responsive candidates and sizes to the hero preload and image. The preload now has `fetchpriority="high"`. Only known assets advertise generated variants; replacing the crest/knight does not invent nonexistent derivative URLs.
- The intentionally low-contrast classes watermark is now an explicitly decorative, non-focusable SVG. Meaningful headings remain HTML text. Lighthouse no longer treats the outlined decorative artwork as low-contrast reading content.
- The price is static from first render. Lighthouse identified repeated shifts of the adjacent trial-class fact during the old counter animation. Removing it also avoids momentarily displaying an incorrect monthly price.
- Preload the already-used DM Sans Latin and Manrope Latin Extended fonts, avoiding their late discovery after style/layout. The latter includes the colón glyph.
- Board-image `sizes` now follows the actual frame width rather than assuming 1340px on every tablet/desktop.
- Added regression tests for shared preload/image settings, asset existence, and custom-image fallback.

## Same-server comparison

Lighthouse 12.8.2, default mobile simulation, Chrome headless, static build served on loopback with gzip. This server is for public static assets only, not a Worker/portal emulator.

| Build | Performance | Accessibility | Best practices | SEO |
| --- | ---: | ---: | ---: | ---: |
| Baseline before this follow-up | 98 | 97 | 100 | 100 |
| Final run 1 | 99 | 100 | 100 | 100 |
| Final run 2 | 99 | 100 | 100 | 100 |
| Final run 3 | 99 | 100 | 100 | 100 |

Final runs: FCP ~1.1s, LCP ~2.2s, TBT 0ms, CLS 0. There is **no claim of a stable 100 performance score**. The responsive-image audit still estimates ~13KiB savings with 0ms FCP/LCP savings; do not undersize high-DPR artwork merely to suppress that warning.

Each final Lighthouse network log contains exactly one knight request (560px variant), with high priority and preload discovery. At 390px / DPR 2, the integrated-browser check likewise found one knight request (750px variant), no broken images, and no horizontal overflow. The decorative SVG was visually checked in the classes section.

`npm run build`, `npx astro check` (219 files, no errors/warnings/hints), and `npm test` (404 passing tests) succeeded.

## Live deployment check (read-only)

An independent run against `https://ajedrezbelen.com/` returned **94 performance / 97 accessibility / 82 best practices / 100 SEO**. This is the deployed markup, not the local follow-up build. Different network/edge conditions mean its score is not a controlled before/after comparison.

Verified response headers:
- Homepage: HTTP 200, `Content-Encoding: gzip`, `CF-Cache-Status: HIT`, `Cache-Control: public, max-age=0, must-revalidate`.
- Hashed font: HTTP 200, cache HIT, one-year immutable browser cache.
- Responsive knight WebP: HTTP 200, cache HIT, browser revalidation policy.

The live best-practices failures are deprecated API calls in Cloudflare's `/cdn-cgi/challenge-platform/scripts/jsd/main.js` (StorageType.persistent and Fledge). These are injected by the edge, not authored in this repository. No security settings were disabled and nothing was deployed. Review that managed script/configuration separately; re-audit the live site after an authorized deployment.

## Evidence and reproduction

JSON and HTML reports are retained locally under `output/lighthouse/` (git-ignored): `before.report.*`, `final-1.report.*` through `final-3.report.*`, and `live.report.*`. Header captures and build/check/test logs are in the same folder.

```sh
npm run build
node scripts/lighthouse-server.mjs
# In a second terminal, from the project root:
npx lighthouse@12.8.2 http://127.0.0.1:4324/ \
  --output=json --output=html --output-path=output/lighthouse/recheck \
  --chrome-flags="--headless=new --no-sandbox" --quiet
```

Use an appropriate Node version and Chrome installation (`CHROME_PATH` when necessary). Repeat with cold browser storage and report all runs rather than selecting the highest score. Stop the local server after auditing. A Lighthouse accessibility score of 100 is not a substitute for manual assistive-technology testing or a WCAG certification.
