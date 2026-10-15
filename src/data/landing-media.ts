// Shared by the image and its preload so they select the same resource.
// Only advertise generated variants for the assets we actually have.
export function knightImage(src: string) {
  return {
    src,
    srcset: src === '/media/knight-staunton-v4.webp'
      ? '/media/knight-staunton-v4-400.webp 400w, /media/knight-staunton-v4-560.webp 560w, /media/knight-staunton-v4.webp 750w'
      : undefined,
    sizes: '(max-width: 359px) 264px, (max-width: 759px) 310px, (max-width: 1099px) 330px, 495px',
  };
}

export function crestImage(src: string | null) {
  const resolved = src ?? '/media/crest-provisional.webp';
  return {
    src: resolved,
    srcset: resolved === '/media/crest-provisional.webp'
      ? '/media/crest-provisional-96.webp 96w, /media/crest-provisional.webp 196w'
      : undefined,
    sizes: '(max-width: 759px) 33px, 44px',
  };
}
