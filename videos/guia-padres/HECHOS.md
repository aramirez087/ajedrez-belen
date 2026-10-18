# Guía para familias: hechos y revisión editorial

Revisado el 17 de octubre de 2026 contra el código del repositorio. Esta revisión no consultó cuentas ni comprobantes reales, no envió correos y no certifica el estado del despliegue remoto.

## Checklist de las piezas

- [ ] Priorizar la captura enviada por correo: destinatario visible y fácil de leer, **pagos@ajedrezbelen.com**.
- [ ] Decir **mismo correo de tu cuenta**, con la cuenta vinculada al atleta. No basta enviar desde cualquier dirección.
- [ ] Indicar **JPG o PNG · máximo 3 MB**. Una captura ayuda; no garantizar que cualquier captura tenga el tamaño adecuado.
- [ ] Mostrar **adjuntar** la captura y **enviar** el correo como acciones separadas.
- [ ] Pedir que se lea la respuesta. Enviar el archivo no garantiza que el pago se registre automáticamente.
- [ ] Diferenciar **«Registramos tu pago» / «En revisión»** de **«Confirmado»**.
- [ ] Explicar que el saldo puede seguir igual mientras se verifica el banco; no volver a transferir por esa misma mensualidad.
- [ ] Aclarar que el PDF se puede usar en el portal. Por correo se guarda, pero no se lee ni se registra automáticamente.
- [ ] Mostrar el portal como alternativa y acceso al estado: **ajedrezbelen.com/portal**.
- [ ] Cerrar con ayuda por WhatsApp: **8768-6102**. Las piezas no contienen cuentas, transferencias ni personas reales.
- [ ] En el video sin voz, dar tiempo para leer cada tarjeta y mantener los mismos términos.
- [ ] No prometer aprobación instantánea, plazo de revisión, lectura infalible ni entrega inmediata del comprobante oficial por correo.

## Hechos que sostienen el contenido

| Hecho | Consecuencia para el mensaje | Fuente local |
| --- | --- | --- |
| El destinatario público es `pagos@ajedrezbelen.com`. | Usar la dirección corta en todas las piezas. | `src/lib/portal/inbound-address.ts:1` |
| El remitente debe coincidir con una cuenta activa, vinculada a un atleta. | Escribir desde el mismo correo de la cuenta; pedir invitación si no hay vinculación. | `workers/email-inbound/src/index.ts:478`, `:499`; `docs/PORTAL-EMAIL.md:57` |
| El correo admite archivos hasta 3 MB. El autorregistro lee JPG y PNG; el PDF se guarda sin lectura. | Recomendar captura JPG/PNG; ofrecer el portal para PDF. | `src/components/portal/EmailSlipHelp.astro:8`; `workers/email-inbound/src/index.ts:178` |
| El autorregistro necesita leer monto y fecha y superar las validaciones. | Pedir una captura clara y leer la respuesta; no prometer que siempre se registra solo. | `src/lib/portal/email-payment.ts:115`; `docs/PORTAL-EMAIL.md:59` |
| La respuesta «Registramos tu pago» deja el pago en revisión. | Esa respuesta confirma registro, no aprobación bancaria. | `workers/email-inbound/src/index.ts:149` |
| Si falta monto o fecha, la respuesta nombra el dato y ofrece terminar en el portal. | Seguir las instrucciones recibidas. Puede responderse a `pagos@` con una foto más clara. | `workers/email-inbound/src/index.ts:169` |
| Un archivo recibido puede quedar sin registrar; vence después de siete días. | No presentar «Recibimos tu comprobante» como confirmación de pago. | `docs/PORTAL-EMAIL.md:57`, `:61`; `src/pages/portal/index.astro:48` |
| Si hay un pago que necesita corrección, el correo dirige al pago existente. | Corregir el registro indicado; evitar enseñar que cada correo crea un pago nuevo. | `workers/email-inbound/src/index.ts:212` |
| El estado literal de espera es «En revisión» y el final aceptado es «Confirmado». | Mantener los nombres tal como aparecen en el sistema. | `src/components/portal/format.ts:29` |
| Los pagos en revisión todavía no bajan el saldo. | No volver a transferir por esas mensualidades mientras se revisan. | `src/pages/portal/index.astro:46`, `:50` |
| El comprobante oficial aparece cuando se confirma el ingreso bancario. | Consultarlo en Mi cuenta → Comprobantes → Abrir comprobante. | `src/pages/portal/index.astro:55`; `src/components/portal/FamilyReceipts.astro:7` |
| El sitio público enlaza a `/portal`. | Publicar `https://ajedrezbelen.com/portal`. | `src/pages/index.astro:211`, `:349`; `workers/email-inbound/src/index.ts:52` |
| La pantalla de acceso usa «Iniciar sesión»; hay «Continuar con Google». | No inventar un botón «Ingresar». | `src/pages/portal/acceso.astro:33`; `src/components/portal/GoogleButton.astro:7` |
| La invitación conecta la cuenta con los atletas al entrar con el correo correcto. | Primera vez: abrir el enlace recibido y usar ese correo. | `src/pages/portal/invitacion.astro:20`; `src/pages/auth/registro.astro:91` |
| En el detalle de SINPE se pide el nombre completo del atleta. | Incluirlo como recordatorio antes de enviar el comprobante. | `src/pages/portal/pagos/nuevo.astro:53` |
| El contacto de ayuda es 8768-6102. | Enlazar `https://wa.me/50687686102`. | `src/layouts/PortalLayout.astro:64` |

## Alternativa por portal

**Registrar pago → Elegir foto o PDF → revisar nombre de quien transfirió, monto y fecha → elegir mensualidades → Enviar mi pago.**

La carga admite JPG, PNG o PDF de hasta 3 MB. La referencia bancaria se completa mediante lectura automática y no hay que escribirla. Si no se lee, el pago puede enviarse igual. Adjuntar el archivo no termina el formulario: hace falta **Enviar mi pago**.

Fuentes: `src/components/portal/SlipUploader.astro:10`; `src/pages/portal/pagos/nuevo.astro:60–68`.

## Distinciones importantes

- **Comprobante del banco:** captura, foto o PDF que envía la familia para registrar una transferencia ya hecha.
- **Comprobante oficial de la Asociación:** documento emitido después de confirmar el ingreso bancario.
- **Correo de recepción:** `pagos@ajedrezbelen.com`, admite responder con una captura más clara cuando lo solicita.
- **Correos oficiales automáticos:** los enviados desde `no-reply` no se usan para consultas. La ayuda se solicita por WhatsApp.
- **Mensualidades por correo:** el sistema propone la distribución automáticamente y la Asociación la revisa al confirmar. No enseñar que el familiar elige meses dentro del correo.

No se deben compartir identificadores internos, datos de familias, enlaces privados ni configuraciones del servicio. El texto listo para copiar está en `texto-whatsapp.txt`.
