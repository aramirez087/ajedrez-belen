# Tipografía compartida y legibilidad — 17 octubre 2026 (Costa Rica)

- Se sustituyó Bodoni por Belen Display, un subconjunto de Lora renombrado según su licencia, en titulares grandes de la portada, portal y páginas legales. DM Sans se usa en textos pequeños, nombres, cifras, horarios y controles. El propósito pasó a texto sans serif recto con interlineado 1,45. La vista previa social también se regeneró.
- `npm run check`: 226 archivos, 0 errores, advertencias o hints. `npm run build` y comprobación de espacios de Git correctos.
- Chromium: portada a 320, 390, 760, 1024 y 1440 px; portal familiar, registro de pagos, administración, eventos, acceso, inicio de sesión, `/app/` y `/privacy/` a 320, 390 y 1440 px. Sin desbordamiento horizontal y con fuentes locales cargadas. Ningún texto visible de la portada usa serif por debajo de 28 px.
- Axe (etiquetas WCAG A/AA 2.0, 2.1 y 2.2): cero infracciones en la portada y las ocho rutas del portal/acceso/revisión comprobadas a 390 px. Esta comprobación automática no certifica conformidad completa.
- Espaciado ampliado (interlineado 1,5, letras 0,12 em, palabras 0,16 em y párrafos 2 em) a 320 px: portada, términos, cuenta familiar y formulario de pago sin desbordamiento. Se corrigió el ajuste de botones, precios y título de cierre de la portada. Ampliación CSS al 200 % comprobada en portada, cuenta y pago a 1440 px.
- Capturas de referencia en `output/playwright/typography-*.png` y `output/playwright/portal-typography-*.png`. Imagen social 1200 × 630 en `public/media/og-portada.jpg`.

Límites de esta pasada: Chromium local y tamaños emulados; sin prueba en teléfono físico, Safari, Firefox o lector de pantalla. No se enviaron mensajes ni se modificaron datos reales. No se realizó despliegue.

---

# Ajuste del caballo y del pliegue — 17 octubre 2026 (Costa Rica)

Petición: un caballo algo más pequeño para que «Ajedrez» se lea completo y, en pantallas grandes, sin la franja vacía bajo el índice.

- Causa medida en 1576×1253 (el tamaño de la captura recibida): la altura del caballo era un porcentaje de la portada, mientras la palabra crece con el ancho; en pantallas altas las orejas subían 0,6 em sobre la línea base y tapaban casi toda la «d». La franja vacía era el margen superior de «01 Clases», porque la portada tenía un tope de 960 px.
- Cambio: el caballo se ancla a la línea base del titular (orejas a 0,17–0,19 em en escritorio, 0,18–0,23 em apilado, máximo 780 px). En pantallas de más de ~1115 px de alto, la portada crece para que el índice termine justo en el pliegue (tope 1200 px). La tarjeta social se volvió a componer con la misma regla.
- Mediciones idénticas en Chrome, WebKit y Firefox: 1576×1253, 1728×1117 y 2560×1300 con el índice exactamente en el pliegue; 1440×900, 1280×720, 1366×768, 1536×864, 1680×1050 y 1920×1080 sin cambios de composición; el botón principal visible en todos. Sin desplazamientos de diseño al cargar en pantallas altas (`layout-shift` vacío).
- `npx astro check` 0/0/0, `npm test` 404/404, build y `git diff --check` correctos; interacción 81/81 y comprobaciones de la segunda pasada 33/33 en tres motores; barrido de 4 páginas × 19 anchos sin desbordamiento en tres motores. Lighthouse: móvil 99/100/100/100 en tres ejecuciones (LCP 2,1 s, CLS 0), escritorio 100/100/100/100.

Límite conocido: en ventanas de escritorio estrechas y muy altas (p. ej. 1000×1400) o a pantalla completa en 2560×1440, la portada llega a su tope; queda algo de margen bajo el índice y el caballo no alcanza la palabra.

---

# Segunda pasada «Portada» — 17 octubre 2026 (Costa Rica)

Cambios: flecha de diagrama sobre la diagonal oscura de los niveles (b2–c3–d4–e5–f6), fotografía del club como lámina monocroma, planilla completa de la partida de la ópera, fuentes recortadas con `scripts/build-fonts.py` (incluido un par de interletrado U+n que Bodoni Moda no trae), `color-scheme: only light`, icono para pantallas de inicio, navegación que marca la sección actual, barra móvil que cede el espacio durante la partida, contorno al pasar el cursor por las casillas del reto, deriva del titular «Ajedrez» hacia arriba y precarga de fuentes en las páginas legales.

- `npx astro check`: 223 archivos, 0 errores, 0 advertencias, 0 hints. `npm test`: 404/404. `npm run build` y `git diff --check`: correctos.
- Lighthouse 12.8.2 sobre el build estático con gzip. Portada, móvil, tres ejecuciones: 99 / 100 / 100 / 100 en las tres (FCP 1,1 s, LCP 2,1 s, TBT 0 ms, CLS 0). Escritorio: 100 / 100 / 100 / 100 (FCP 0,3 s, LCP 0,5 s). `/terminos/`, móvil, dos ejecuciones: 100 / 100 / 100 / 100 (CLS 0; era 99 con CLS 0,009 antes de precargar sus fuentes). Se probó quitar la precarga de la itálica: el LCP no mejoró y el FCP empeoró a 1,5 s, así que se mantiene.
- Interacción: las 27 comprobaciones de la primera pasada en Chrome, WebKit y Firefox 156 (81/81). Comprobaciones nuevas en los tres motores (33/33): `color-scheme`, icono, flecha visible, revelada y de peón a dama, marca de navegación en cuatro posiciones, planilla con 17 jugadas y cinco destacadas anunciadas, interletrado U–n de −0,04 em medido con y sin `font-kerning`, y barra móvil visible en el reto, oculta en la partida y de nuevo visible en el club.
- Barrido de ancho en Chrome, WebKit y Firefox: 4 páginas × 19 anchos (320–2560 px), sin desbordamiento ni controles menores de 44 px.
- Cobertura tipográfica: cada carácter mostrado en las siete páginas con estos estilos (incluidos los mensajes del reto) existe en las fuentes recortadas.
- Modo oscuro forzado de Chrome (`WebContentsForceDark`): con la declaración, la portada conserva papel y tinta; sin ella, el fondo se oscurece y el botón negro del encabezado casi desaparece.
- Comparación píxel a píxel de las fuentes antes y después del recorte: diferencias solo de suavizado (menos de 0,04 % de píxeles con diferencia fuerte).

Límites: los mismos de la primera pasada. Firefox se probó con el navegador de Playwright, no con una instalación de usuario.

---

# Rediseño «Portada» — 17 octubre 2026 (Costa Rica)

Nuevo sistema visual descrito en [DESIGN.md](DESIGN.md): portada de revista con el caballo frente a «Ajedrez» en Bodoni Moda, diagramas impresos, columna de ajedrez con solución invertida, partida de la ópera en escena oscura y contraportada roja. Se reordenó la página para que clases y precios lleguen justo después de la portada (sugerencia 3 de la revisión del 14 de octubre).

- `npx astro check`: 223 archivos, 0 errores, 0 advertencias, 0 hints. `npm test`: 404 pruebas, 404 aprobadas. `npm run build`: correcto.
- Lighthouse 12.8.2 sobre el build estático servido con gzip (`scripts/lighthouse-server.mjs`), simulación móvil, tres ejecuciones: 98 / 100 / 100 / 100 en las tres (FCP 1,1 s, LCP 2,3 s, TBT 0 ms, CLS 0). Escritorio: 100 / 100 / 100 / 100 (FCP 0,3 s, LCP 0,6 s). La línea base anterior era 99 / 100 / 100 / 100 con LCP 2,2 s; la diferencia corresponde a las dos fuentes Bodoni precargadas. Informes en `output/lighthouse/portada-final-*.report.json` (ignorado por Git).
- Interacción, Chrome y WebKit (27 comprobaciones en cada motor, todas aprobadas): selección de la torre y 12 destinos legales, jugada incorrecta con explicación y regreso, mate Ta8#, sello, panel de victoria, solución que gira a su posición legible, reinicio, resolución con flechas y Enter, botón «Ver solución», pasos 1, 3 y 5 de la partida de la ópera con resaltado y sello de mate, apertura de preguntas, desplazamiento del encabezado medido, enlace para saltar al contenido como primera parada de Tab, barra móvil de WhatsApp (oculta con el botón de portada visible, visible a media página, oculta en la contraportada), contenido visible sin JavaScript y con movimiento reducido.
- Barrido de ancho en Chrome y WebKit: `/`, `/terminos/`, `/privacidad/` y `/familias/` a 320, 360, 375, 390, 430, 520, 600, 760, 820, 959, 960, 1024, 1100, 1199, 1280, 1440, 1600, 1920 y 2560 px: sin desbordamiento horizontal y sin controles de menos de 44 px (los enlaces dentro de frases quedan exentos según WCAG 2.5.8).
- Botón principal de la portada visible sin desplazarse en 360×740, 390×844, 412×915, 600×900, 760×1024, 820×1180, 959×800, 960–1199×800, 1280×720, 1366×768, 1440×900, 1536×864 y 2560×1440. En 320×568 queda bajo el pliegue; allí la barra móvil de WhatsApp aparece desde el inicio.
- Los once enlaces a WhatsApp anuncian «WhatsApp» en su nombre accesible; «Empezar aquí» conserva su texto visible dentro del nombre (WCAG 2.5.3).
- Fuentes: cada archivo se descarga una sola vez en Chrome y WebKit. WebKit muestra un aviso heurístico de precarga «no usada» aunque la fuente se usa; no hay doble descarga.

Límites: navegadores automatizados y dispositivos emulados; no se probaron teléfonos físicos, Firefox, lectores de pantalla ni Safari instalado. La puntuación de Lighthouse no equivale a una certificación WCAG. No se publicó el sitio ni se enviaron mensajes.

---

# Revisión actual — 14 octubre 2026 (Costa Rica)

La revisión de la landing con sus interacciones actuales está en [LANDING-REVIEW-2026-10-14.md](docs/LANDING-REVIEW-2026-10-14.md). Los registros siguientes son históricos; las referencias a cero JavaScript corresponden a versiones anteriores.

# Revisión adaptable — 9 octubre 2026 (Costa Rica)

Estado actual: se corrigieron los botones del hero que partían sus etiquetas en teléfonos de 360–375 px, el solapamiento de nombres y precios al ampliar texto y los enlaces de marca con objetivos táctiles menores de 44 px. Cabecera, acciones, descuento y contacto pueden reorganizarse; el caballo tiene límites de tamaño. Se añadieron márgenes de área segura y una consulta de contenedor para adaptar la tabla al espacio y tamaño del texto.

- Chrome y WebKit: 21 anchos principales, de 320 a 3440 px, más 15 comprobaciones junto a puntos de cambio (29 anchos distintos). Sin desbordamiento horizontal, nombres/precios superpuestos ni enlaces visibles de menos de 44 px de alto en los anchos principales.
- Anchos principales: 320, 360, 375, 390, 430, 519, 520, 640, 759, 760, 768, 820, 1024, 1099, 1100, 1280, 1440, 1600, 1920, 2560 y 3440 px. Chrome se probó con barra vertical de 15 px; WebKit con barras superpuestas.
- Texto al 200% simulado duplicando los tamaños computados de los elementos, a 320, 390, 760, 1024 y 1440 px en ambos motores: sin desbordamiento horizontal. Los nombres y precios pasan a filas separadas cuando hace falta. Esta prueba no equivale al zoom nativo del navegador; los titulares largos pueden dividir palabras al ampliar texto en columnas estrechas.
- Emulación móvil con entrada táctil y escala 3×: 320×568, 390×844, 844×390 y 932×430 en ambos motores. Sin desbordamiento; toque abre y cierra el detalle de pago. Inspección visual de páginas completas en móvil, tablet, escritorio y orientación horizontal.
- Teclado: enlace para saltar al contenido enfoca `main`; Enter abre y cierra el detalle; foco visible de 2 px. Chrome incluye enlaces con Tab; WebKit macOS usa Option+Tab con su configuración predeterminada. También se verificó la activación del enlace con foco explícito.
- Enlaces internos con destino válido, cuatro enlaces WhatsApp conservados, imágenes y fuentes cargadas, asociaciones de cabeceras de tabla válidas. Sin errores de consola ni de página durante las pruebas de interacción. La preferencia de movimiento reducido desactiva las transiciones.
- `npm run check`, `npm run build` y `git diff --check`: correctos. Compilación estática con cero etiquetas `script`, sin dependencias nuevas ni cambios a los activos aprobados.

Evidencia local ignorada por Git, en `output/playwright/`: `after.txt`, `webkit.txt`, `text-after.txt`, `text-webkit.txt`, `final-chrome.txt`, `final-webkit.txt`. Capturas completas: `after-320.png`, `after-360.png`, `after-390.png`, `after-760.png`, `after-1440.png`, `webkit-390.png`, `webkit-760.png` y `webkit-1440.png`.

Límites: navegadores automatizados y dispositivos emulados; no se probaron teléfonos físicos, Firefox, Safari instalado, lectores de pantalla ni recortes de pantalla físicos. Los insets de área segura se implementaron en CSS, pero no se simularon valores de notch. No se publicó el sitio ni se enviaron mensajes.

---

# Registro anterior — diseño editorial, 9 octubre 2026 (Costa Rica)

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
