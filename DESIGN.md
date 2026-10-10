# Ajedrez Belén — modern editorial chess club

The design presents a welcoming local chess community through confident sans-serif typography, warm paper surfaces and a restrained deep-red accent. The approved wooden knight is the central visual asset, framed by a quiet coordinate grid and anchored by the cropped board in shallow perspective. A three-line headline leads to a WhatsApp invitation and a direct link to the classes.

## Visual system

- Paper `#f7f4ec`; ink `#252a25`; deep red `#8c302f`; red hover `#712523`; secondary text `#606357`.
- Secondary surface `#eeebe1`; family panel `#eee3d8`; divider `#d9d6ca`; grid lines `#dedbce`.
- Board charcoal `#343b31` and ivory `#e8e3d4`; dark-section secondary text `#c5c8b9` and divider `#505549`.
- Locally hosted Manrope Variable for headings, level names and the discount figure; DM Sans Variable for body text, navigation, controls and prices. Manrope provides weights 400–700, with main headings set to 500. Emphasis uses color while retaining upright lettering.
- A centered frame has a maximum width of 1320 px. The desktop hero uses two columns, a headline up to 99 px and a wooden piece up to 610 px tall. Thin rules, small checker marks and generous spacing connect the sections.

## Composition and responsive behavior

The hero is followed by a compact introduction to the club, a combined class and monthly-fee table, a sibling-discount panel and a dark contact section. Three small chess-piece drawings distinguish the class levels. The table keeps names, learning descriptions and prices comparable; the final contact section provides a second clear WhatsApp invitation and practical location guidance.

Below 760 px, hero copy and actions precede the knight. The header retains “Las clases” and “Hablemos”; the hero also includes “Ver las clases.” Compact button spacing keeps both hero links on one line on 360–399 px phones. Controls can wrap as text grows. The introduction uses two columns between 520 and 759 px and a single column on smaller phones. Below 360 px, narrower gutters and adjusted type and piece sizes preserve the composition.

The class table responds to its own container: at 44em or less, each name sits beside its price with the description underneath. Wrapping flex rows allow the price to move below an enlarged name without a collision. The font-relative query also reflows the table when text is enlarged. Desktop retains the three-column table. Header, contact, family discount and footer content can wrap, while safe-area insets protect the page margins, skip link and footer. The knight remains bounded when adjacent text becomes taller.

The cropped board is an inline SVG pattern with one affine transform and a soft perimeter mask. Broad squares retain the approved relationship between the board and the wooden piece. The coordinate grid, board and checker decorations are hidden from assistive technology; the knight has descriptive alternative text and a visible caption.

## Interaction and accessibility

The page is static Astro output with no client JavaScript or new dependencies. Subtle CSS hover transitions provide feedback on links, buttons and class rows. There is no automatic motion or scroll control, and `prefers-reduced-motion` disables transitions and animation.

A skip link, visible keyboard focus and native `details` payment disclosure support keyboard use. The class list is a native HTML table with a caption, scoped headers, explicit table roles and cell-to-header associations. The description header remains available to assistive technology when visually hidden in compact layouts. All visible links, including the header and footer brands, retain a minimum touch-target height of 44 px.

## Assets and content

`public/media/knight-staunton-v4.webp` is the optimized derivative of the approved knight; its original remains at `assets/originals/knight-staunton-v4.png`. Generation provenance is in `assets/KNIGHT-GENERATION.md`. The image represents a chess piece, not a photograph of the association. The crest remains provisional and replaceable through `src/data/association.ts`.

Manrope's Latin and Latin Extended WOFF2 files are in `public/fonts/`, with the upstream license in `public/Manrope-OFL.txt`. DM Sans is bundled locally through the existing Fontsource dependency; its license is `public/DM-Sans-OFL.txt`. Rendering requires no remote font requests.

Confirmed fees and WhatsApp contact data live in `src/data/association.ts`. Venue, schedules and ages remain unconfirmed; visitors are invited to ask for the venue and schedule. The 25% sibling discount is stated without calculating eligibility. There is no payment portal or enrollment submission.

`HeroBoard.astro` retains an inactive path for an authorized photograph revealed through the light board squares (`heroPhoto: null`). Materialize and inspect the actual photograph before enabling it.

## Design assessment and restore points

Internal design-feasibility assessment: impact 4 + fit 5 + feasibility 5 + performance 4 − risk 3 = **15**. The implementation concentrates the visual change in typography, layout and lightweight local assets.

Local Git restore tags remain `static-knight-v5` (68e7227), `static-poster-v6` (20d4a2b) and `draft-before-whatsapp` (7fa6933). Validation evidence and limits are recorded separately in `QA.md`.
