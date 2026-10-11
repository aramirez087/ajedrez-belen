import { cpSync, mkdirSync } from 'node:fs';

// PDF.js requests these fonts/maps only when a PDF needs them. Keep them on our origin.
const target = new URL('../public/portal-pdf/', import.meta.url);
mkdirSync(target, { recursive: true });
for (const [source, destination] of [['standard_fonts', 'fonts'], ['cmaps', 'cmaps']]) {
  cpSync(new URL(`../node_modules/pdfjs-dist/${source}/`, import.meta.url), new URL(`${destination}/`, target), { recursive: true });
}
