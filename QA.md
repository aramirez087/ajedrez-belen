# Validación local — 10 octubre 2026

- Astro check: 0 errores, 0 advertencias, 0 hints.
- Astro build: sitio estático generado correctamente en `dist/`.
- Vista previa compilada: HTTP 200 en `http://127.0.0.1:4321/`.
- Navegador usado: Codex In-app Browser (macOS). Inspección visual y capturas de escritorio 1440×1000 y móvil 390×844. Comprobaciones de desbordamiento a 320, 390, 800, 1024 y 1440 px: ninguna horizontal.
- Todos los enlaces internos tienen destinos reales. El CTA llega a consultas; no hay inscripción, envío ni cobro ficticio.
- Escudo y render cargan; fuentes se sirven localmente. Sin errores ni advertencias registrados por el navegador durante las pruebas.
- Teclado: salto al contenido enfoca `main`; acordeones abren con Enter; Tab llega al texto y al botón; copiar muestra estado y produce el texto correcto. Se restauró el portapapeles previo. Foco visible en los controles.
- Movimiento: entrada CSS de 700 ms y después quietud. Regla compilada de `prefers-reduced-motion: reduce` inspeccionada: elimina animaciones y transiciones, conserva scroll automático. El navegador soportado no expone emulación de esa preferencia; no se verificó con el sistema configurado en movimiento reducido.
- No hay manejadores de scroll, scroll hijacking, carruseles automáticos ni dependencias de animación.

Límites: no pruebas con teléfono físico, lector de pantalla, Safari o Firefox. No se ha probado una llamada real por WhatsApp, ni la rama de fotos por casillas: faltan contacto oficial y fotos autorizadas. Sede, horarios, edades y aplicabilidad exacta del descuento entre hermanos siguen pendientes. Escudo provisional hasta recibir el original.

Capturas finales guardadas en Library:

- `ajedrez-belen-v2-desktop.jpg` — `libfile_d112e495bb1c8191b9f9fc4d3e67cccd`
- `ajedrez-belen-v2-desktop-full.jpg` — `libfile_4ca1901b50748191b23ad2d66a63ab25`
- `ajedrez-belen-v2-mobile.jpg` — `libfile_892e4e6ee9948191b37f9a674a88044f`
- `ajedrez-belen-v2-mobile-hero.jpg` — `libfile_4033645163a08191aa00ab834b9596b4`

El proyecto no tiene remoto, publicación, cuentas nuevas ni conexión con MindMaster o GrandMasterStudio.
