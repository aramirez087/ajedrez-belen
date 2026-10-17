# Club photographs

Selected from 26 WhatsApp photographs supplied by the site owner on 2026-10-17 for the landing page. Original files are preserved in `assets/originals/club/`; only responsive WebP derivatives are served from `public/media/club/`.

| Original WhatsApp filename | Saved original | Placement and selection |
| --- | --- | --- |
| WhatsApp Image 2026-10-17 at 12.41.49 (3).jpeg | equipo-belen.jpeg | Feature after classes/prices: complete team, clear club flag, natural setting. Keep every person in frame. |
| WhatsApp Image 2026-10-17 at 12.41.51 (1).jpeg | concentracion.jpeg | Club story: an actual chess game and a strong expression of concentration. |
| WhatsApp Image 2026-10-17 at 12.41.50 (5).jpeg | alegria.jpeg | Club story: clear, warm portrait showing the athlete's medals. |
| WhatsApp Image 2026-10-17 at 12.41.49 (4).jpeg | amistad.jpeg | Club story: spontaneous warmth and friendship, with a complementary landscape composition. |

The selection avoids near-duplicates and repetitive awards backdrops. Captions do not invent names, dates, results, or tournament titles. Photographs retain their original colors; no retouching or generative edits. The action photograph uses a bottom-aligned 4:5 CSS crop below 480px to remove excess wall while retaining the face and board. Other photos retain their full frames.

Derivatives: Sharp auto-orientation, no enlargement, WebP quality 80 / effort 6, metadata omitted. Widths are 480/800/1200/1600 for the team, 360/600/960 for portraits, and 480/800/1200 for friends. `ClubPhoto.astro` supplies matching `srcset`, intrinsic dimensions, lazy loading, and asynchronous decoding. No carousel or additional JavaScript.

To regenerate from the repository root with its installed dependencies:

```sh
node --input-type=module <<'JS'
import sharp from 'sharp';
const photos = {
  'equipo-belen': [480, 800, 1200, 1600],
  concentracion: [360, 600, 960],
  alegria: [360, 600, 960],
  amistad: [480, 800, 1200],
};
for (const [name, widths] of Object.entries(photos)) {
  for (const width of widths) {
    await sharp(`assets/originals/club/${name}.jpeg`).rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 80, effort: 6 })
      .toFile(`public/media/club/${name}-${width}.webp`);
  }
}
JS
```
