# Ajedrez Belén — static poster, v6

The approved wooden knight is the central visual asset. A single muted red chess square anchors it; a three-line headline, supporting copy and WhatsApp invitation form one clear reading path. The compact community introduction leads into one combined class and fee table, followed by a dark contact section. No decorative numbering, card grid, statistics, or invented achievements.

## Tokens and composition

- Paper #f3f0e7; ink #1c211d; crest red #a32930; square red #b8756f; secondary text #555e55; sage #e4e8df.
- Locally hosted DM Sans Variable. Display weight 500, body 400. Desktop headline scales up to 118 px.
- Maximum frame 1376 px. Desktop knight height 610 px with a 344 px square; both remain within a centered composition on wide screens.
- Below 740 px, copy and CTA precede the knight. Between 740 and 899 px, a compact two-column hero uses explicit grid rows. Small phones retain the complete silhouette when scrolling.
- Classes and monthly fees share rows. The sibling discount states the confirmed 25% without calculating eligibility. Payment instructions use a native details element.
- Fully static, with no client JavaScript, animation, sticky scenes or scroll control. No new dependencies.

## Assets and content

`public/media/knight-staunton-v4.webp` is the optimized derivative of the same approved knight; the original is retained at `assets/originals/knight-staunton-v4.png`. Generation provenance is in `assets/KNIGHT-GENERATION.md`. The render represents a chess piece, not a real association photograph. The crest remains provisional and replaceable through `src/data/association.ts`.

The confirmed contact URLs and fees live in `src/data/association.ts`. Venue, schedules and ages remain unconfirmed; the visible page invites visitors to ask for venue and schedule when contacting the association. There is no payment portal or enrollment submission.

`HeroBoard.astro` retains an inactive path for an authorized photograph revealed through light board squares (`heroPhoto: null`). Materialize and inspect the actual photograph before enabling it. This component remains static.

Rollback points are local Git tags: `static-knight-v5` for the previous design and `draft-before-whatsapp` for the earlier board version.
