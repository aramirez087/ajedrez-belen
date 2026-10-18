# Guía para familias

Versión actual: una imagen, tres pasos y video de 22 segundos.

## Archivos para compartir

La carpeta `../../output/guia-padres-2026-10-17/` contiene únicamente:

- `01-guia.jpg`: infografía.
- `02-video.mp4`: video para WhatsApp.
- `03-mensaje-whatsapp.txt`: mensaje para copiar.

## Editar

Fuente: `simple/guide.mjs`. Ejecutar `node build-simple.mjs`, `npm run check` y `npm run dev`.

`node export-simple.mjs` exporta la imagen con Playwright/Chrome. Puede indicarse la ubicación de Playwright con `PLAYWRIGHT_MODULE`.

El proyecto usa HyperFrames 0.8.166. Fuentes y escudo locales incluidos. Los archivos maestros y verificaciones se guardan en `.hyperframes/delivery-assets/`, separados de los archivos para compartir.

La versión anterior fue eliminada a petición del usuario.
