# Ajedrez Belén

Página local estática en Astro. No se ha publicado ni conectado a repositorio remoto.

Requiere Node >=22.12.0. Entorno verificado: Node 24.15.0.

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm run dev -- --host 127.0.0.1 --port 4321
```

Vista previa de la compilación: `npm run preview -- --host 127.0.0.1 --port 4321`. La instancia local existente sirve http://127.0.0.1:4321/. La compilación genera `dist/`, compatible con un futuro Cloudflare Workers Static Assets, sin adaptador, API ni servicio de pago. No hay comandos de publicación automática.

Los hechos y los activos reemplazables están en `src/data/association.ts`. WhatsApp confirmado por el usuario: +506 8768 6102. Facebook: https://www.facebook.com/ajedrezbelen. Los enlaces abren esas direcciones; no envían mensajes. No usar un número SINPE como contacto.

Sede, horarios y edades permanecen sin confirmar. Tarifas suministradas: iniciación ₡12.000/mes; cadetes, intermedios y avanzados ₡15.000/mes. 25% entre hermanos, sin calcular facturas porque faltan condiciones. Pago en los primeros 8 días del mes identificando nombre y apellido del atleta.

La composición actual es completamente estática: caballo original, tipografía editorial y cuadrícula gráfica. Cero JavaScript entregado. Procedencia del render: `assets/GENERATION.md`. No representa alumnos ni una foto real de la asociación. DM Sans se sirve localmente; conservar la licencia OFL.

Diseño y sustitución futura de fotos: `DESIGN.md`. Pruebas y límites: `QA.md`. La versión anterior del tablero queda recuperable en la etiqueta Git local `draft-before-whatsapp` (7fa6933), y los originales se conservan en `assets/originals/`.

