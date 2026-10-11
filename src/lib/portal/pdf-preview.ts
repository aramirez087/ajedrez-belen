import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

/** Client-only preview: the original PDF stays intact and only page one is rendered. */
export async function renderFirstPdfPage(file: File, signal?: AbortSignal): Promise<{ file: File; pageCount: number }> {
  if (file.size > 3 * 1024 * 1024 || file.size < 8) throw new Error('invalid_file');
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const task = pdfjs.getDocument({
    data: bytes, enableXfa: false, stopAtErrors: true, verbosity: 0,
    useSystemFonts: false, disableFontFace: true, useWorkerFetch: false,
    cMapUrl: '/portal-pdf/cmaps/', cMapPacked: true,
    standardFontDataUrl: '/portal-pdf/fonts/', useWasm: false,
    maxImageSize: 4_000_000, canvasMaxAreaInBytes: 16_000_000,
  });
  let timedOut = false;
  const abort = () => { void task.destroy().catch(() => {}); };
  const timer = window.setTimeout(() => { timedOut = true; abort(); }, 10_000);
  signal?.addEventListener('abort', abort, { once: true });
  let canvas: HTMLCanvasElement | null = null;
  function checkCancelled() {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (timedOut) throw new Error('preview_timeout');
  }
  try {
    const pdf = await task.promise;
    checkCancelled();
    const page = await pdf.getPage(1);
    checkCancelled();
    const initial = page.getViewport({ scale: 1 });
    if (!Number.isFinite(initial.width) || !Number.isFinite(initial.height) || initial.width <= 0 || initial.height <= 0) throw new Error('invalid_pdf');
    const scale = Math.min(2048 / Math.max(initial.width, initial.height), Math.sqrt(4_000_000 / (initial.width * initial.height)), 2);
    const viewport = page.getViewport({ scale });
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('preview_unavailable');
    await page.render({ canvas, canvasContext: context, viewport, background: 'rgb(255,255,255)' }).promise;
    checkCancelled();
    const renderedCanvas = canvas;
    let blob = await new Promise<Blob | null>(resolve => renderedCanvas.toBlob(resolve, 'image/png'));
    if (!blob || blob.size > 1_500_000) blob = await new Promise<Blob | null>(resolve => renderedCanvas.toBlob(resolve, 'image/jpeg', .85));
    checkCancelled();
    if (!blob || blob.size > 1_500_000) throw new Error('preview_too_large');
    return { file: new File([blob], blob.type === 'image/png' ? 'pagina-1.png' : 'pagina-1.jpg', { type: blob.type }), pageCount: pdf.numPages };
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (timedOut) throw new Error('preview_timeout');
    throw error;
  } finally {
    window.clearTimeout(timer); signal?.removeEventListener('abort', abort);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    await task.destroy().catch(() => {});
  }
}
