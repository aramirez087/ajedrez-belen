# Ajedrez Belén

Primera página local estática en Astro. No se ha publicado ni conectado a repositorio remoto.

Requiere Node >=22.12.0 y npm >=9.6.5.

```sh
npm ci
npm run check
npm run build
npm run dev -- --host 127.0.0.1 --port 4321
```

La compilación genera `dist/`. Preparada para servir como Cloudflare Workers Static Assets en trabajo futuro, sin adaptador, servidor, API ni servicios de pago. No se incluyen comandos que publiquen automáticamente.

Los hechos y los activos reemplazables están en `src/data/association.ts`. El WhatsApp oficial debe confirmarse antes de activar enlaces externos. No usar un número SINPE como contacto. Los datos de sede y horario permanecen pendientes. Tarifas del afiche suministrado: iniciación ₡12.000/mes; cadetes, intermedios y avanzados ₡15.000/mes; 25% entre hermanos con condiciones pendientes. Pago en los primeros 8 días, identificando nombre y apellido del atleta.

Diseño y arquitectura de incorporación de fotografías: `DESIGN.md`. El hero usa un render original generado con imagegen integrado; prompt y procedencia en `assets/GENERATION.md`. No representa una fotografía real de la asociación. La tipografía DM Sans se distribuye localmente mediante Fontsource; conservar su licencia OFL. Evidencia y límites de pruebas: `QA.md`.
