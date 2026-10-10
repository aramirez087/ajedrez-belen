// Confirmed facts only. Set contact and media once the association authorizes them.
export const association = {
  name: 'Ajedrez Belén',
  location: 'Belén, Heredia, Costa Rica',
  whatsapp: null as string | null,
  venue: null as string | null,
  schedule: null as string | null,
  crest: '/media/crest-provisional.webp' as string | null,
  heroPhoto: null as string | null,
  heroIllustration: '/media/chess-staunton-v2.webp',
  heroPhotoDescription: '',
  fees: [
    { level: 'Iniciación', amount: '₡12.000', description: 'Para dar los primeros pasos en el tablero.' },
    { level: 'Cadetes, intermedios y avanzados', amount: '₡15.000', description: 'Para seguir construyendo tu juego.' },
  ],
};
