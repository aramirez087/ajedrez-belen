export const MAX_SLIP_BYTES = 3 * 1024 * 1024;
export const BASE_FEE_MINOR = 1_200_000;

export async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) throw new RangeError('Request too large');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new RangeError('Request too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function allowLocalPrototype(
  url: URL,
  isDevelopment: boolean,
  config: { PROTOTYPE_ENABLED?: string; PROTOTYPE_LOCAL?: string },
): boolean {
  return isDevelopment && config.PROTOTYPE_ENABLED === 'true' &&
    config.PROTOTYPE_LOCAL === 'true' &&
    url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
}

export function parseDiscount(value: FormDataEntryValue | null): number {
  if (typeof value !== 'string' || !/^\d{1,5}(\.\d{1,2})?$/.test(value)) {
    throw new Error('Invalid discount');
  }
  const [whole, fraction = ''] = value.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (minor < 0 || minor >= BASE_FEE_MINOR) throw new Error('Invalid discount');
  return minor;
}

export function detectSlipType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 5 && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-') return 'application/pdf';
  return null;
}

export function hasSameOrigin(request: Request, url: URL): boolean {
  return request.headers.get('origin') === url.origin;
}
