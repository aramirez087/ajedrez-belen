# Ajedrez Belén

Página pública prerenderizada en Astro y MVP local del portal de pagos de Ajedrez Belén. El portal registra mensualidades, transferencias privadas con vista de imagen/PDF y lectura opcional, revisión bancaria y comprobantes numerados con correo Brevo. La página pública está publicada; el nuevo portal sigue local, sin despliegue ni cambios remotos durante esta revisión. Existe una cuenta Brevo con remitente de correo gratuito verificado, pero sin dominio ni claves API configurados en las pantallas revisadas. WorkOS y la entrega real aún requieren validación. [Estado y próximos pasos](docs/CONTINUATION-STATUS.md).

Requiere Node >=22.13.0 (PDF.js). Entornos verificados: Node 24.15.0 y 26.0.0.

```sh
npm install
# Primera instalación solamente: conserva una .dev.vars existente.
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev:portal
```

Abre [la demostración del portal](http://127.0.0.1:4322/demo) y elige una cuenta familiar o administrativa. Requiere `PORTAL_ENABLED=true`, `PORTAL_DEMO=true`, `EMAIL_MODE=dry_run` y `OCR_MODE=demo`, incluidos en el ejemplo local. Usa datos ficticios y no envía correo. La lectura simulada devuelve un ejemplo fijo; no analiza el archivo elegido ni llama a Groq. Si Astro selecciona otro puerto, usa el origen que muestre la terminal. La demostración nunca autoriza un build de producción.

Configuración, recorrido, cuentas externas y pasos pendientes para Cloudflare: [docs/PORTAL-SETUP.md](docs/PORTAL-SETUP.md). Los comandos de desarrollo/compilación preparan explícitamente las fuentes y mapas PDF, incluso con `ignore-scripts=true`. La compilación genera recursos estáticos y un Worker con D1 y R2 mediante el adaptador oficial. La página pública conserva su contenido. No hay publicación automática.

Verificación: `npm test`, `npm run check` y `npm run build`. Con la demostración en ejecución, `npm run test:portal` verifica el recorrido HTTP y crea registros ficticios. `npm run test:portal:ocr` prueba borradores y lectura simulada con el servidor local. `npm run test:portal:pdf` comprueba el motor PDF de compatibilidad en Node con un documento sintético; no verifica su interacción visual en navegador. Vista previa de compilación: `npm run preview -- --host 127.0.0.1 --port 4322`; requiere autenticación real para las rutas del portal.

El laboratorio previo sigue en [/prototype](http://127.0.0.1:4322/prototype), con sus propios flags `PROTOTYPE_ENABLED` y `PROTOTYPE_LOCAL`. Sus hallazgos y límites están en [docs/COMPATIBILITY-PROTOTYPE.md](docs/COMPATIBILITY-PROTOTYPE.md); esa guía describe la prueba de compatibilidad anterior, mientras [PORTAL-SETUP.md](docs/PORTAL-SETUP.md) describe el MVP actual. Arquitectura y presupuesto de niveles gratuitos: [PAYMENTS-PLAN.md](PAYMENTS-PLAN.md). El original se conserva completo: el PDF muestra su primera página y permite descargar todas. Las sugerencias respetan las correcciones y no confirman pagos. [Configuración y límites de OCR](docs/PAYSLIP-OCR.md). La verificación visual local y sus límites están en [PORTAL-VERIFICATION.md](docs/PORTAL-VERIFICATION.md). Las cuentas, MFA, lectura real con Groq, entrega real y consumo en la nube siguen pendientes de validar.

Los hechos y los activos reemplazables están en `src/data/association.ts`. WhatsApp confirmado por el usuario: +506 8768 6102. Facebook: [Ajedrez Belén](https://www.facebook.com/ajedrezbelen). Los enlaces abren esas direcciones; no envían mensajes. No usar un número SINPE como contacto.

Sede, horarios y edades permanecen sin confirmar. Tarifas suministradas: iniciación ₡12.000/mes; cadetes, intermedios y avanzados ₡15.000/mes. El descuento entre hermanos se registra como monto manual con motivo mientras se confirma la regla. Las mensualidades vencen el día 8 y la transferencia debe identificar nombre y apellido del atleta. El portal emite comprobantes numerados de la Asociación; no integra facturación electrónica con Hacienda.

La dirección visual es la de un club de ajedrez con composición editorial moderna: títulos en Manrope, textos en DM Sans y una paleta de marfil cálido, tinta y rojo profundo. El caballo de madera aprobado conserva su activo original, con una cuadrícula de coordenadas de fondo y el tablero recortado en perspectiva. Las clases y mensualidades comparten una tabla HTML adaptable, con roles explícitos y asociaciones entre celdas y encabezados. En móvil se mantiene el acceso directo a las clases. Un panel presenta el descuento entre hermanos y una sección oscura reúne la invitación de contacto.

La tabla adapta sus filas al ancho disponible y al tamaño del texto mediante una consulta de contenedor. Los controles se reorganizan cuando falta espacio, los enlaces conservan al menos 44 px de altura y los márgenes contemplan las áreas seguras de pantalla. La revisión adaptable incluye Chrome y WebKit, pantallas de 320 a 3440 px y ampliación de texto simulada al 200%; detalle y límites en `QA.md`.

La página pública entrega cero JavaScript de cliente. Las transiciones sutiles de CSS responden al cursor y se desactivan con la preferencia de movimiento reducido. Incluye enlace para saltar al contenido, foco visible y un desplegable nativo para las instrucciones de pago. Procedencia del render: `assets/KNIGHT-GENERATION.md`; no representa alumnos ni una foto real de la asociación.

Las fuentes se sirven localmente, sin peticiones a Google Fonts durante la visita. Manrope Variable (pesos 400–700) usa `public/fonts/manrope-latin-variable.woff2` y `public/fonts/manrope-latin-ext-variable.woff2`, obtenidos de Google Fonts; conservar `public/Manrope-OFL.txt`. DM Sans Variable se incluye mediante la dependencia existente `@fontsource-variable/dm-sans`; conservar `public/DM-Sans-OFL.txt`. El rediseño de la página pública no añade dependencias; el portal incorpora PDF.js para sus vistas privadas.

Diseño y sustitución futura de fotos: `DESIGN.md`. Pruebas y límites: `QA.md`. Las composiciones anteriores quedan recuperables en las etiquetas Git locales `static-knight-v5` (68e7227), `static-poster-v6` (20d4a2b) y `draft-before-whatsapp` (7fa6933). Los originales se conservan en `assets/originals/`.

