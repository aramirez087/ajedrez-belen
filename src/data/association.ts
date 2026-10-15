// Confirmed facts only. Set contact and media once the association authorizes them.
export const association = {
  name: 'Ajedrez Belén',
  fullName: 'Asociación Deportiva Ajedrez Belén Capablanca',
  location: 'Belén, Heredia, Costa Rica',
  whatsapp: '50687686102' as string | null,
  venue: 'Polideportivo de Belén, edificio de Ajedrez',
  schedule: 'Principiantes: sábados a las 8:00 a. m. o a la 1:00 p. m.',
  minimumAge: 6,
  email: 'ajedrezbelen1@gmail.com',
  crest: '/media/crest-provisional.webp' as string | null,
  heroPhoto: null as string | null,
  heroKnight: '/media/knight-staunton-v4.webp',
  heroPhotoDescription: '',
  fees: [
    { level: 'Iniciación', amount: '₡12.000', description: 'Para dar los primeros pasos en el tablero.' },
    { level: 'Cadetes, intermedios y avanzados', amount: '₡15.000', description: 'Para seguir construyendo tu juego.' },
  ],
};
