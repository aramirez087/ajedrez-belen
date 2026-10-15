# Landing page review — 14 October 2026

The published page and local implementation were reviewed for messaging, responsive layout, keyboard use, chess interactions, and search metadata. The typography, wooden knight, warm palette, transparent prices, and per-level WhatsApp links give the page a coherent identity. The changes preserve that identity.

## Corrections

- The opening copy identifies the audience (children, young people, and adults aged 6+) and venue. The main invitation now coordinates a free first class through WhatsApp. “Ver clases y precios” goes directly to the enrollment information; the chess activities remain available further down the page.
- The owner supplied the association's WhatsApp information during the review. The page now includes the Polideportivo de Belén chess building, Saturday beginner starts at 8 a.m. and 1 p.m., the association's email, support from CCDR Belén, lesson frequency, and the trial coordination process. End times and exact durations are omitted because the source contradicts itself. No trial-form URL or instructor name was provided.
- The discount banner and FAQ now agree with the existing billing behavior and tests: when two or more family members are enrolled, each receives 25% off. The owner's WhatsApp source explicitly includes siblings and other family members. The old FAQ incorrectly limited the discount to the second athlete onward.
- The game introduction now promises five highlighted positions, matching the implementation. The development lesson no longer claims that the entire white army is still present after pieces have been captured.
- Both boards now correctly have a dark a1 and a light h1.
- The puzzle locks an incorrect attempt through the complete move-and-return cycle. Previously, a second action could interrupt the temporary position and create an invalid move or conflicting timers.
- The puzzle uses one Tab entry, arrow-key navigation, Enter/Space activation, and current accessible labels for the rook. Selecting a square is exposed through ARIA. Tab leaves the board for the controls.
- Phone and tablet navigation retain the class and contact links without pushing contact onto a separate row. Sticky offsets track the actual header height. Footer links can wrap.
- Inactive game explanations remain readable at full contrast. The sticky board becomes static on short screens and with reduced motion. Decorative automatic motion stops within five seconds.
- Essential content remains visible if the main script fails to load. Keyboard focus immediately reveals any focused content that was awaiting its entrance animation.
- The page title names the service and locality. Canonical URL, Open Graph URL, absolute social-image URL, and the confirmed contact number in structured data are included.

## Highest-value next improvements

1. Confirm lesson end times/durations and the schedules of the other levels. Add the trial-form link when its actual URL is available. The source lists an afternoon ending of “2:30 am” and describes both a 2.5-hour morning slot and a 1.5-hour beginner class; those inconsistencies were not silently corrected.
2. Add an authorized photograph of the actual club and an instructor introduction. An attributed parent testimonial could also help if permission and the exact wording are available. The current chess artwork communicates the theme but does not show the people behind the club.
3. Consider moving the long Opera Game after the class information. At a 390 × 844 viewport, classes originally began roughly 6,900 CSS pixels down the page. The direct hero link now bypasses that journey. Reordering the sections is an editorial option, not a demonstrated conversion result.
4. Consider a dedicated landscape social-sharing image, a public-page sitemap, and Search Console verification as follow-up work. No search rankings, indexing coverage, or traffic data were available for this review.

## Verification and limits

- `npm test`: 401 existing tests passed. These primarily verify the portal and billing rules; they are not a substitute for landing-page browser checks.
- `npm run check`: no errors, warnings, or hints across 216 files.
- `npm run build`: successful local build. The Cloudflare build needed permission to open its local runtime port and write its logs; no deployment was performed.
- In-app browser: inspected desktop and mobile rendering, puzzle selection, wrong-move recovery, disabled controls during movement, checkmate labels, reset, and Tab exit. Browser console had no warnings or errors during this pass.
- WebKit: timed regression checks passed for the old race window, invalid diagonal prevention, arrow/Enter/Space interaction, Tab exit, solution/reset focus, reduced motion, and the static no-JavaScript solution. Evidence is in `output/playwright/landing-puzzle-regression-result.json`; repeatable browser checks are in `output/playwright/landing-puzzle-regression.cjs`.
- Reflow checks at viewport widths 320, 390, 600, 760, 820, 1024, and 1440, plus 844 × 390 landscape: no horizontal document overflow. The compact tablet header was checked again at 820 px after its final adjustment.
- Compiled HTML contains the expected title and canonical URL. The page uses three small client modules (two inline and the puzzle module as a separate asset). This is a build inspection, not a Core Web Vitals measurement.

Changes are local. This is not a formal WCAG certification, a real-device test, a field-performance report, or a claim of improved conversion rates. Historical zero-JavaScript statements in earlier QA entries describe older versions of the page.

Final viewport previews: [desktop](../output/playwright/landing-review-hero.png) and [mobile](../output/playwright/landing-review-hero-mobile.png). These local artifacts are ignored by Git. Full-page captures retain unloaded reveal states and should only be treated as raw diagnostic evidence.
