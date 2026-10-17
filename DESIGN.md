# Ajedrez Belén — modern editorial chess club

The design presents a welcoming local chess community through confident sans-serif typography, warm paper surfaces and a restrained deep-red accent. The approved wooden knight is the central visual asset, framed by a quiet coordinate grid and anchored by the cropped board in shallow perspective. A three-line headline leads to a WhatsApp invitation and a direct link to the classes.

The elevated landing (v2) keeps this identity and adds numbered editorial sections (01 El club, 02 El reto, 03 Las clases, 04 Cómo empezar, 05 Preguntas frecuentes), a dark notation marquee in Spanish algebraic notation beneath the hero, an interactive mate-in-one puzzle (the back-rank "mate del pasillo", Ta8#) built as `PuzzleBoard.astro`, the full-board `chess-staunton-v2.webp` photograph in the club section, hard-shadow square buttons, a sticky translucent header, hero quick-facts (price, levels, sibling discount), per-level WhatsApp deep links with prefilled messages, a red sibling-discount panel, FAQ disclosures, a giant "¿Jugamos?" contact close and a mobile sticky WhatsApp bar that appears after the hero. Motion is limited to staggered hero entrances, reveal-on-scroll, subtle knight parallax and the marquee, all disabled under `prefers-reduced-motion`; the small vanilla scripts are the only client JavaScript on the page.

The v3 "living board" pass turns the page into a playable board: the knight scene tilts in 3D under the cursor with layered depth, cursor glare and an animated knight's-tour path in legal L-hops; hero facts count up; calls to action are magnetic on fine pointers; a fixed coordinate rail reads the scroll as a pawn climbing the e-file from e2 to e8; a giant outlined "Ajedrez Belén" drifts behind the classes; and a new section (02 La partida) replays Morphy's 1858 Opera Game as scrollytelling — a sticky board (`OperaGame.astro`) glides through five verified positions (3…Ag4, 9.Ag5, 12.O-O-O, 16.Db8+, 17.Td8#) with move highlights, progress markers and Spanish commentary, pinning above the text on mobile. All effects respect `prefers-reduced-motion` and degrade to a fully readable static page.

The v4 polish pass tightens the system without changing it. Both boards draw Colin M.L. Burnett's Staunton set from one inline SVG sprite (`ChessPieceSprite.astro`, referenced through `ChessPiece.astro`). Pieces are sized in container-query units to about three quarters of a square; white pieces keep a solid ink outline and black pieces an ivory halo. The same symbols replace the Unicode glyphs in the class icons, the notation band, the scroll rail and the principles. Hero facts are a three-column grid at every width, with subgrid-aligned labels and figures and consistent dividers, and a single knight caption carries the scroll cue. The principles (Jugar, Pensar, Compartir) form three columns with large piece glyphs on desktop and stack with the glyph at the side on phones. The knight-scene coordinates are real 8 × 5 grids aligned with the backdrop squares. The giant outlined word has its own band above “04 Las clases”, reserved by the section's top padding, so its parallax never crosses the label or heading. Opera steps mark the active move with a red rule that extends rather than shifting the text. The scroll rail appears only from 1520 px, centred in the outer margin clear of the hero board. The puzzle's keyboard instructions stay in `aria-describedby` but are shown only while a square has keyboard focus, fading in within reserved space at the end of the panel so nothing shifts.

## Visual system

- Paper `#f7f4ec`; ink `#252a25`; deep red `#8c302f`; red hover `#712523`; secondary text `#606357`.
- Secondary surface `#eeebe1`; family panel `#eee3d8`; divider `#d9d6ca`; grid lines `#dedbce`.
- Board charcoal `#343b31` and ivory `#e8e3d4`; dark-section secondary text `#c5c8b9` and divider `#505549`.
- Accent tokens for dark and red surfaces: `--red-on-dark` `#e0a09c` (6.9:1 on ink) and `--on-red` `#eec9c4` (5.3:1 on red). Boards use `--board-frame`, `--board-mate`, `--piece-ink` and `--piece-ivory`. Colors are referenced only through `:root` tokens.
- Type scale tokens: `--fs-label` 12 px (the floor for labels and captions), `--fs-small` 13, `--fs-ui` 14, `--fs-body` 15, `--fs-lead` 17, `--fs-title` 23 and `--fs-figure` 28. Display sizes remain fluid `clamp()` values. The decorative in-board coordinates (8–11 px, sized to the square) are the only text below the floor.
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

The chess pieces are Colin M.L. Burnett's set from Wikimedia Commons (`Chess_klt45.svg` and its eleven siblings), used under the BSD option of the author's GFDL/BSD/GPL multi-license. Provenance, modifications and the license text are in `public/Cburnett-Pieces-BSD.txt`.

Confirmed fees and WhatsApp contact data live in `src/data/association.ts`. Venue, schedules and ages remain unconfirmed; visitors are invited to ask for the venue and schedule. The 25% sibling discount is stated without calculating eligibility. There is no payment portal or enrollment submission.

`HeroBoard.astro` retains an inactive path for an authorized photograph revealed through the light board squares (`heroPhoto: null`). Materialize and inspect the actual photograph before enabling it.

## Design assessment and restore points

Internal design-feasibility assessment: impact 4 + fit 5 + feasibility 5 + performance 4 − risk 3 = **15**. The implementation concentrates the visual change in typography, layout and lightweight local assets.

Local Git restore tags remain `static-knight-v5` (68e7227), `static-poster-v6` (20d4a2b) and `draft-before-whatsapp` (7fa6933). Validation evidence and limits are recorded separately in `QA.md`.
