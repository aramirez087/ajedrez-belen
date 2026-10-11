import type { Actor } from './types';

export type OcrMode = 'off' | 'demo' | 'groq';

/** Configuration never turns a synthetic identity into a live provider caller. */
export function getOcrAvailability(
  actor: Actor,
  env: Pick<Cloudflare.Env, 'OCR_MODE' | 'GROQ_API_KEY'>,
  options: { demoAllowed: boolean },
): { mode: OcrMode; available: boolean } {
  if (env.OCR_MODE === 'demo') {
    return { mode: 'demo', available: actor.mode === 'demo' && options.demoAllowed };
  }
  if (env.OCR_MODE === 'groq') {
    return { mode: 'groq', available: actor.mode === 'workos' && !!env.GROQ_API_KEY?.trim() };
  }
  return { mode: 'off', available: false };
}
