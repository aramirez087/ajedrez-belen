# Ajedrez Belén

Página local estática en Astro. No se ha publicado ni conectado a repositorio remoto.

Requiere Node >=22.12.0. Entorno verificado: Node 24.15.0.

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm run dev -- --host 127.0.0.1 --port 4322
```

Vista previa de la compilación: `npm run preview -- --host 127.0.0.1 --port 4322`. El servidor de esta revisión seleccionó automáticamente el puerto 4322 y sirve [http://127.0.0.1:4322/](http://127.0.0.1:4322/); el comando anterior fija ese puerto para futuras sesiones. La compilación genera `dist/`, compatible con un futuro Cloudflare Workers Static Assets, sin adaptador, API ni servicio de pago. No hay comandos de publicación automática.

Los hechos y los activos reemplazables están en `src/data/association.ts`. WhatsApp confirmado por el usuario: +506 8768 6102. Facebook: [Ajedrez Belén](https://www.facebook.com/ajedrezbelen). Los enlaces abren esas direcciones; no envían mensajes. No usar un número SINPE como contacto.

Sede, horarios y edades permanecen sin confirmar. Tarifas suministradas: iniciación ₡12.000/mes; cadetes, intermedios y avanzados ₡15.000/mes. 25% entre hermanos, sin calcular facturas porque faltan condiciones. Pago en los primeros 8 días del mes identificando nombre y apellido del atleta.

La dirección visual es la de un club de ajedrez con composición editorial moderna: títulos en Manrope, textos en DM Sans y una paleta de marfil cálido, tinta y rojo profundo. El caballo de madera aprobado conserva su activo original, con una cuadrícula de coordenadas de fondo y el tablero recortado en perspectiva. Las clases y mensualidades comparten una tabla HTML adaptable, con roles explícitos y asociaciones entre celdas y encabezados. En móvil se mantiene el acceso directo a las clases. Un panel presenta el descuento entre hermanos y una sección oscura reúne la invitación de contacto.

La tabla adapta sus filas al ancho disponible y al tamaño del texto mediante una consulta de contenedor. Los controles se reorganizan cuando falta espacio, los enlaces conservan al menos 44 px de altura y los márgenes contemplan las áreas seguras de pantalla. La revisión adaptable incluye Chrome y WebKit, pantallas de 320 a 3440 px y ampliación de texto simulada al 200%; detalle y límites en `QA.md`.

El sitio entrega cero JavaScript de cliente. Las transiciones sutiles de CSS responden al cursor y se desactivan con la preferencia de movimiento reducido. Incluye enlace para saltar al contenido, foco visible y un desplegable nativo para las instrucciones de pago. Procedencia del render: `assets/KNIGHT-GENERATION.md`; no representa alumnos ni una foto real de la asociación.

Las fuentes se sirven localmente, sin peticiones a Google Fonts durante la visita. Manrope Variable (pesos 400–700) usa `public/fonts/manrope-latin-variable.woff2` y `public/fonts/manrope-latin-ext-variable.woff2`, obtenidos de Google Fonts; conservar `public/Manrope-OFL.txt`. DM Sans Variable se incluye mediante la dependencia existente `@fontsource-variable/dm-sans`; conservar `public/DM-Sans-OFL.txt`. El rediseño no añade dependencias.

Diseño y sustitución futura de fotos: `DESIGN.md`. Pruebas y límites: `QA.md`. Las composiciones anteriores quedan recuperables en las etiquetas Git locales `static-knight-v5` (68e7227), `static-poster-v6` (20d4a2b) y `draft-before-whatsapp` (7fa6933). Los originales se conservan en `assets/originals/`.

