---
workflow: general-video
flow: automation
storyboard: no
message: "Enviar la captura del pago por correo y revisar la respuesta."
destination: WhatsApp e Instagram
aspect: "9:16"
language: es-CR
audience: Madres, padres y encargados de atletas de Ajedrez Belén
length: 72 segundos
---

## Intent
El usuario pide infografías muy sencillas y un posible tutorial con Remotion / HyperFrames para explicar el sistema, sobre todo el envío de comprobantes. Aclara que el correo con la imagen es la vía más sencilla y probablemente la más utilizada.

## Decisiones de producción
Seis tarjetas 1080 × 1350 y un tutorial vertical 1080 × 1920 sin sonido, legible en teléfono. El video usa cinco escenas del recorrido por correo; el portal queda como tarjeta alternativa. Letras grandes, redacción breve, ejemplos ficticios y vistas simplificadas. Los tiempos dejan espacio para leer. Sin música ni locución: el mensaje completo vive en pantalla y las tarjetas permiten consultarlo sin límite de tiempo.

## Hechos y límites
Enviar JPG o PNG hasta 3 MB a pagos@ajedrezbelen.com desde el correo vinculado a una cuenta con atleta. Revisar la respuesta: “Registramos tu pago” significa En revisión; si falta información seguir instrucciones. Los PDF no se leen automáticamente por correo. Confirmado significa revisión bancaria completada. No repetir transferencia ni duplicar registro solo porque el saldo aún no cambia. Ayuda WhatsApp 8768-6102.

## Assets
Escudo, DM Sans y Belen Display locales del repositorio. Interfaz dibujada con código para mantener texto exacto y evitar exponer cuentas reales. No se necesitan imágenes generadas para este material de instrucciones.

## Verificación
Fuentes en output/guia-padres-2026-10-17/HECHOS.md. Comprobar tipografía, contraste, desbordes y cada escena. Render local autorizado por la solicitud de generar material compartible; no publicar ni enviar a terceros.

## Revisión 2 · 17 de octubre de 2026

El usuario pide menos texto. La versión activa pasa a una sola imagen con 36 palabras y tres pasos: guardar captura, adjuntar/enviar, leer respuesta. Video de 22 segundos, una acción por escena. Se conserva correo de cuenta como condición visible; límites JPG/PNG y 3 MB van en el primer paso del video y en el texto para acompañar la imagen. No se promete registro ni aprobación automática. La guía anterior de seis tarjetas se conserva como referencia. La fuente activa es `simple/guide.mjs` y se reconstruye con `build-simple.mjs`.

## Ajuste del cierre
El usuario pide presentar la confirmación como resultado normal, sin sugerir pasos adicionales. Cierre: “Recibí la confirmación”; respuesta ilustrada “Registramos tu pago”; aclaración “Tu pago quedó en revisión”. Se distingue el registro de la aprobación bancaria.

## Preferencia de tratamiento
Usar tuteo estándar en todos los materiales. Cierre definitivo: “Recibe la confirmación” y “Tu pago quedó en revisión”. No usar “Leé la respuesta” ni “El correo te dice qué sigue”.

## Simplificación del comprobante
El usuario pide enviar directamente el comprobante generado por el banco. Se elimina toda instrucción sobre capturas, monto y fecha. Primer paso: “Guarda el comprobante”, “El que genera tu banco”. Se actualizan imagen, video y mensaje en los mismos archivos.
