// Shared by the image and its preload so they select the same resource.
// Only advertise generated variants for the assets we actually have.
export function knightImage(src: string) {
  return {
    src,
    srcset: src === '/media/knight-staunton-v4.webp'
      ? '/media/knight-staunton-v4-400.webp 400w, /media/knight-staunton-v4-560.webp 560w, /media/knight-staunton-v4.webp 750w, /media/knight-staunton-v4-1086.webp 1086w'
      : undefined,
    // On desktop the knight is about 0.53 × the viewport height wide, at most 585 px (780 px tall); on phones up to 82% of the frame.
    sizes: '(max-width: 959px) min(58vw, 420px), min(52vh, 585px)',
  };
}

export function crestImage(src: string | null) {
  const resolved = src ?? '/media/crest-provisional.webp';
  return {
    src: resolved,
    srcset: resolved === '/media/crest-provisional.webp'
      ? '/media/crest-provisional-96.webp 96w, /media/crest-provisional.webp 196w'
      : undefined,
    sizes: '(max-width: 759px) 30px, 36px',
  };
}
