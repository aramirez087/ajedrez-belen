import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Node library/data verification only. This does not execute the browser worker,
// HTML canvas, uploader, DOM helper, or browser asset routing.
let canvasLibrary;
try {
  canvasLibrary = await import('@napi-rs/canvas');
} catch {
  throw new Error('PDF rendering check unavailable: the optional @napi-rs/canvas package is not installed. No browser fallback is attempted.');
}
const { createCanvas } = canvasLibrary;
assert.equal(typeof createCanvas, 'function', 'A working native Node canvas is required');

function syntheticPdf() {
  const firstText = 'BT /F1 96 Tf 100 2700 Td (PAGE ONE - LOCAL FONT) Tj ET\nBT /F2 96 Tf 100 2300 Td <65e5672c> Tj ET\n';
  const secondText = 'BT /F1 96 Tf 100 2700 Td (PAGE TWO - DO NOT RENDER) Tj ET\n';
  const stream = text => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}endstream`;
  const page = content => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 5000 3000] /Resources << /Font << /F1 7 0 R /F2 8 0 R >> >> /Contents ${content} 0 R >>`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    page(4), stream(firstText), page(6), stream(secondText),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiMin-W3 /Encoding /UniJIS-UTF16-H /DescendantFonts [9 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiMin-W3 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> /FontDescriptor 10 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /HeiseiMin-W3 /Flags 6 /FontBBox [-123 -257 1001 910] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 80 >>',
  ];
  let text = '%PDF-1.4\n';
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}

const original = syntheticPdf();
const originalCopy = Buffer.from(original);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const originalHash = hash(original);
const assets = {
  cMapUrl: fileURLToPath(new URL('../public/portal-pdf/cmaps/', import.meta.url)),
  standardFontDataUrl: fileURLToPath(new URL('../public/portal-pdf/fonts/', import.meta.url)),
};
const loadedAssets = [];

// PDF.js 6 uses BinaryDataFactory for both CMaps and standard fonts. Its Node
// default reads filesystem paths; this equivalent factory additionally proves
// the files are the exact copies shipped under our public, same-origin URLs.
class LocalBinaryDataFactory {
  constructor(options) { this.options = options; }
  async fetch({ kind, filename }) {
    assert.ok(Object.hasOwn(assets, kind), 'Rendering may load only local fonts and CMaps');
    assert.equal(this.options[kind], assets[kind]);
    assert.match(filename, /^[A-Za-z0-9_.-]+$/);
    const copied = await readFile(`${assets[kind]}${filename}`);
    const packageFolder = kind === 'cMapUrl' ? 'cmaps' : 'standard_fonts';
    const installed = await readFile(new URL(`../node_modules/pdfjs-dist/${packageFolder}/${filename}`, import.meta.url));
    assert.equal(hash(copied), hash(installed), 'Self-hosted PDF assets must match the installed library');
    loadedAssets.push({ kind, filename, bytes: copied.length });
    return new Uint8Array(copied);
  }
}

const priorFetch = globalThis.fetch;
let networkRequests = 0;
globalThis.fetch = async () => { networkRequests++; throw new Error('This Node compatibility check permits no network requests'); };
let task;
let canvas;
let timer;
try {
  // The browser build requires newer browser APIs (e.g. Uint8Array.toHex).
  // PDF.js documents the legacy build as its Node entry point.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  task = pdfjs.getDocument({
    // PDF.js can transfer its input buffer. Keep the immutable original separate.
    data: new Uint8Array(original),
    enableXfa: false, stopAtErrors: true, verbosity: 0,
    useSystemFonts: false, disableFontFace: true, useWorkerFetch: false,
    cMapUrl: assets.cMapUrl, cMapPacked: true,
    standardFontDataUrl: assets.standardFontDataUrl, useWasm: false,
    maxImageSize: 4_000_000, canvasMaxAreaInBytes: 16_000_000,
    BinaryDataFactory: LocalBinaryDataFactory,
  });
  timer = setTimeout(() => { void task.destroy().catch(() => {}); }, 10_000);
  const pdf = await task.promise;
  assert.equal(pdf.numPages, 2, 'The original contains both pages');
  const page = await pdf.getPage(1);
  const extracted = (await page.getTextContent()).items.map(item => item.str || '').join(' ').replace(/\s+/g, ' ');
  assert.match(extracted, /PAGE ONE - LOCAL FONT/);
  assert.match(extracted, /日本/, 'The page-one CID font uses the local Japanese CMaps');
  assert.doesNotMatch(extracted, /PAGE TWO/);

  const initial = page.getViewport({ scale: 1 });
  const scale = Math.min(2048 / Math.max(initial.width, initial.height), Math.sqrt(4_000_000 / (initial.width * initial.height)), 2);
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.floor(viewport.width));
  const height = Math.max(1, Math.floor(viewport.height));
  assert.ok(width <= 2048 && height <= 2048 && width * height <= 4_000_000);
  assert.equal(width, 2048, 'An oversized page is scaled to the preview bound');
  canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  await page.render({ canvas, canvasContext: context, viewport, background: 'rgb(255,255,255)' }).promise;

  // This region contains only the first line's Courier glyphs; there are no
  // raster images, vector shapes or borders which could satisfy the ink check.
  const pixels = context.getImageData(20, 50, 1000, 100).data;
  let inkPixels = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] < 150 && pixels[index + 1] < 150 && pixels[index + 2] < 150 && pixels[index + 3] > 200) inkPixels++;
  }
  assert.ok(inkPixels > 500, 'First-page standard-font text actually draws, rather than a blank canvas');
  assert.ok(loadedAssets.some(asset => asset.kind === 'standardFontDataUrl' && asset.filename === 'FoxitFixed.pfb'));
  assert.ok(loadedAssets.some(asset => asset.kind === 'cMapUrl' && asset.filename === 'UniJIS-UTF16-H.bcmap'));
  assert.ok(loadedAssets.some(asset => asset.kind === 'cMapUrl' && asset.filename === 'Adobe-Japan1-UCS2.bcmap'));
  const preview = canvas.toBuffer('image/png');
  assert.ok(preview.length > 100 && preview.length <= 1_500_000, 'Encoded preview fits the image budget');
  assert.equal(hash(original), originalHash);
  assert.deepEqual(original, originalCopy, 'All original PDF bytes and both pages remain unchanged');
  assert.equal(networkRequests, 0);
  console.log(JSON.stringify({ result: 'passed', scope: 'Node PDF.js library/data compatibility only', pdfjs: pdfjs.version,
    pages: pdf.numPages, renderedPage: 1, width, height, inkPixels, pngBytes: preview.length,
    originalSha256: originalHash, networkRequests, loadedAssets }, null, 2));
} finally {
  clearTimeout(timer);
  if (canvas) { canvas.width = 0; canvas.height = 0; }
  await task?.destroy().catch(() => {});
  globalThis.fetch = priorFetch;
}
