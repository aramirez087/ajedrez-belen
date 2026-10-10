# Validación local — 10 octubre 2026

- Astro check: 6 archivos, 0 errores, 0 advertencias, 0 hints.
- Astro build: sitio estático generado en `dist/`.
- Navegador usado: Codex In-app Browser, macOS. Capturas e inspección visual reales de 390×844, 768×1024, 1440×1000, 1920×1080, 1933×1264 (dimensiones de la captura suministrada) y 3440×1440, más página completa de escritorio y móvil.
- Comprobaciones visuales y de ancho a 320×780, 900×900 y 1024×900. En los nueve anchos, `scrollWidth === clientWidth`: ningún desbordamiento horizontal. La diferencia de 15 px con `innerWidth` corresponde a la barra vertical del navegador.
- Todos los enlaces internos tienen un ID de destino. Los tres enlaces WhatsApp coinciden con `https://wa.me/50687686102` sin texto prellenado; Facebook coincide con la URL autorizada. No se inició una conversación ni se envió contenido.
- Escudo y caballo cargan y tienen dimensiones naturales. Fuentes locales. Registro del navegador: sin errores ni advertencias.
- Teclado: Enter en Saltar al contenido enfoca `main#contenido`; Enter abre y cierra el detalle de pago. Tab desde el detalle llega a WhatsApp. Foco de borde sólido visible en el detalle y el enlace.
- Sitio compilado: 0 etiquetas script, 0 JavaScript cliente. Escenario con posición `static`; caballo con `animation-name: none` y duración de transición 0 s. Se eliminó el código de movimiento, rAF y sticky. La preferencia de movimiento reducido no requiere una rama animada. Regla CSS de reducción conservada, pero no se emuló el ajuste del sistema (el navegador no ofrece esa capacidad).
- HTML compilado: 5822 bytes. Caballo WebP con transparencia: 101094 bytes, 750×1000. Original conservado: PNG 1086×1448, 1335200 bytes. No servicios, APIs o recursos remotos para renderizar la página.

Límites: no se probó en un teléfono físico, lector de pantalla, Safari o Firefox. No se verificó la entrega de una conversación WhatsApp ni disponibilidad remota de Facebook. La futura rama de fotografía no está activada ni probada con imágenes autorizadas. Faltan fotos, escudo original, sede, horarios, edades y condiciones precisas del descuento.

Capturas finales estáticas guardadas en Library:

- `ajedrez-belen-static-390.jpg` — `libfile_7dac44a66a0c81918c2bb41e2858cfbc`
- `ajedrez-belen-static-768.jpg` — `libfile_8e9660b3875c8191829e2d9b979fca40`
- `ajedrez-belen-static-1440.jpg` — `libfile_1c6449fc9c4c819188ff735fcc8dd0fc`
- `ajedrez-belen-static-1920.jpg` — `libfile_9d1aaf3d95d48191916f1c6006b0deae`
- `ajedrez-belen-static-1933.jpg` — `libfile_47fab53010808191b3d30884bdd56446`
- `ajedrez-belen-static-3440.jpg` — `libfile_a1a0ff0ece34819188504d8dd4678c0b`
- `ajedrez-belen-static-desktop-full.jpg` — `libfile_dee1deb208b08191a17a564879637841`
- `ajedrez-belen-static-mobile-full.jpg` — `libfile_28691ee050648191982f5e62325e9159`

Caballo original: `libfile_96f157f76e288191ab06b10b856f13c6`.

Rollback previo: etiqueta local `draft-before-whatsapp`, commit `7fa6933` (versión anterior de tablero, antes del contacto oficial). El proyecto no tiene remoto, publicación ni conexión con MindMaster o GrandMasterStudio.

