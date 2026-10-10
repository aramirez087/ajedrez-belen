# Validación — diseño editorial, 9 octubre 2026 (Costa Rica)

- Tipografía final: Manrope Variable en titulares y DM Sans en texto. Fuentes locales, con licencias OFL conservadas. Sin círculo ni sello junto al caballo.
- Astro check: 6 archivos, 0 errores, 0 advertencias, 0 hints. Astro build estático correcto. `git diff --check` correcto.
- DOM compilado: 0 etiquetas script. No se añadieron dependencias JavaScript. Los dos archivos Manrope suman 39.816 bytes; el caballo aprobado conserva sus 101.094 bytes y no cambió.
- Inspección de navegador en Codex In-app Browser: páginas completas en escritorio (1440 px), tablet (820 px) y móvil (320 y 390 px). Comprobación de ancho en 320, 390, 640, 760, 820, 1024, 1440 y 1920 px: `scrollWidth === clientWidth`, sin desbordamiento horizontal. El titular se mantiene en tres líneas en esos anchos.
- Se revisó la composición completa, incluidos niveles, precios, descuento, información de pago y contacto. Se aumentaron los tamaños de los textos prácticos y se separó el símbolo de moneda de los importes.
- En móvil, «Las clases» permanece en la navegación y «Ver las clases» lleva a la sección correcta. Todos los enlaces internos tienen destino. Los cuatro enlaces WhatsApp apuntan a `https://wa.me/50687686102`; Facebook conserva su dirección confirmada. Ningún enlace envía un mensaje automáticamente.
- Escudo y caballo cargan correctamente. Fuentes cargadas. Registro del navegador sin errores ni advertencias.
- Teclado: Enter en «Saltar al contenido» enfoca `main#contenido`; Enter abre y cierra el detalle de pago. Foco sólido visible en el control.
- Tabla nativa con caption, grupos, filas, cabeceras y celdas. Roles explícitos preservan la estructura al adaptar filas a grid; las celdas describen sus cabeceras con `headers`. «Lo que exploramos» permanece en la estructura accesible aunque se oculta visualmente en móvil.
- Las transiciones se limitan a hover de controles; `prefers-reduced-motion` las elimina. Sin animación del caballo ni control de desplazamiento.

Capturas locales (directorio ignorado por Git):

- `output/ajedrez-belen-desktop.jpg`
- `output/ajedrez-belen-desktop-full.jpg`
- `output/ajedrez-belen-mobile-full.jpg`

Límites: no se probó en teléfono físico, lector de pantalla, Safari o Firefox, ni con zoom de texto al 200%. No se verificó entrega de mensajes WhatsApp. Sede, horarios, edades y condiciones precisas del descuento siguen sin confirmar. No se publicó el sitio.

---

# Actualización v7 — tablero recortado, 9 octubre 2026 (Costa Rica)

- Restaurado el tablero recortado y angulado preferido por el usuario; mismo caballo original. Solo cambian la decoración del hero y sus estilos.
- Astro check: 6 archivos, 0 errores, 0 advertencias, 0 hints. Build estático correcto tras el último cambio.
- Inspección de capturas reales en Codex In-app Browser: escritorio 1440×1000 y móvil 390×844. Anchos 320, 390, 740, 1024 y 1440 sin desbordamiento horizontal. Se corrigió el ancho del tablero en tablet.
- Tablero SVG decorativo, oculto a tecnología asistiva; sin JavaScript ni animación nuevos. Los controles y enlaces de v6 permanecen sin cambios.
- Library escritorio: `libfile_fe80160a585881918c70f3616730fb8a` — `ajedrez-belen-v7-cropped-desktop.jpg`.
- Library móvil: `libfile_53a5a270df98819195648d1a9c055b77` — `ajedrez-belen-v7-cropped-mobile.jpg`.
- Los límites de pruebas de dispositivos y navegadores detallados abajo siguen aplicando. La versión anterior con casilla roja es recuperable en `static-poster-v6` (20d4a2b).

## Registro anterior

# Validación local — v6, 9 octubre 2026 (Costa Rica)

- Astro check: 6 archivos; 0 errores, 0 advertencias, 0 hints. Astro build generó el sitio estático en `dist/` después del último cambio de código.
- Navegador: Codex In-app Browser, macOS. Capturas reales e inspección visual del hero a 320×780, 390×844, 640×1000, 740×1024, 768×1024, 1440×1000 y 1933×1264. También se revisaron capturas completas de escritorio y móvil. Se corrigió una separación vertical incorrecta en tablet detectada durante la revisión.
- En esos siete anchos y también a 1024×900 y 3440×1440, `scrollWidth === clientWidth`: sin desbordamiento horizontal. La barra vertical ocupa 15 px.
- Todos los enlaces internos tienen destino existente. Los tres enlaces WhatsApp son `https://wa.me/50687686102`, sin texto prellenado. Facebook apunta a `https://www.facebook.com/ajedrezbelen`. No se envió ningún mensaje.
- Escudo y caballo cargan con dimensiones naturales. Fuentes locales. Registro del navegador: sin errores ni advertencias.
- Teclado: Enter en «Saltar al contenido» enfoca `main#contenido`. Enter abre y cierra el detalle de pago. Tab desde el detalle llega a WhatsApp. Foco sólido visible en ambos controles.
- DOM compilado: 0 etiquetas script. Caballo con `animation-name: none` y transición de 0 s. El sitio no tiene animaciones ni control de scroll. Existe una regla CSS para movimiento reducido; no se emuló la preferencia del sistema porque el navegador no expone esa capacidad.
- El caballo WebP conserva los mismos bytes del activo aprobado: 101094 bytes, 750×1000, con transparencia. No se añadieron dependencias, APIs ni recursos remotos para renderizar el sitio.

## Límites

No se probó en teléfono físico, lector de pantalla, Safari o Firefox. Los anchos de pantalla son emulados por el navegador y no constituyen una prueba de entrada táctil física. No se verificó entrega de mensajes WhatsApp ni disponibilidad remota de Facebook. La futura rama de fotografía sigue inactiva. Faltan fotos autorizadas, escudo original, sede, horarios, edades y condiciones precisas del descuento.

## Capturas finales en Library

- Móvil, 390×844: `libfile_4b409489f3448191818621e2c5e59114` — `ajedrez-belen-v6-mobile.jpg`
- Página móvil completa: `libfile_7d927718d8bc81919bd09c00635a22a2` — `ajedrez-belen-v6-mobile-full.jpg`
- Escritorio, 1440×1000: `libfile_f062bc02a014819188c5ff33f86c58a1` — `ajedrez-belen-v6-desktop.jpg`
- Página de escritorio completa: `libfile_481ffb9dd94c8191aa5695418a4e331d` — `ajedrez-belen-v6-desktop-full.jpg`
- Pantalla amplia, 1933×1264: `libfile_144e5e35e3508191b051cfa94cea5448` — `ajedrez-belen-v6-wide.jpg`

Caballo original: `libfile_96f157f76e288191ab06b10b856f13c6`. La versión anterior se conserva en `static-knight-v5` (68e7227). No existe despliegue ni repositorio remoto.
