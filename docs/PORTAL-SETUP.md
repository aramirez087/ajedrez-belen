# Portal de pagos

El MVP local está implementado: cuentas de encargados vinculadas a atletas, mensualidades, transferencias con respaldo privado, lectura opcional del archivo, revisión bancaria, comprobantes numerados y correo con Brevo. La página pública y el laboratorio de compatibilidad siguen disponibles.

Estado al 11 de octubre de 2026: `ajedrezbelen.com` figura **Authenticated** en Brevo después de añadir el dominio y los tres registros exactos de Cloudflare con autorizaciones separadas del propietario. Los registros se verificaron en DNS autoritativo; se conservaron DMARC `p=quarantine` y los sitios raíz/www, que siguen respondiendo HTTPS 200. Después de otra autorización explícita, se creó únicamente el remitente `no-reply@ajedrezbelen.com`, nombre **Ajedrez Belén**: figura **Verified**, con DKIM `ajedrezbelen.com` y DMARC configurado. Se omitió el branding opcional y no hubo nuevos cambios DNS. No se creó ni leyó una clave ni se envió correo. El siguiente paso del propietario es crear e instalar la clave API de forma privada; continúa `EMAIL_MODE=dry_run`. Existe el proyecto WorkOS en Staging, pero sus callbacks y retornos de cierre de sesión no están configurados; la organización de prueba no es una organización de personal aprobada. No se han creado recursos remotos D1/R2 ni publicado el portal durante esta continuación. El recorrido local usa datos ficticios, lectura simulada y correo simulado; autenticación/MFA reales, lectura Groq, entrega y consumo en la nube siguen pendientes. [Resumen actual](CONTINUATION-STATUS.md) y [pasos exactos](SETUP-HANDOFF.md).

## Ejecutar la demostración local

Requiere Node >=22.13.0 por la dependencia PDF.js; el entorno de desarrollo se verificó con Node 24.15. El servidor usa Astro y el runtime de Cloudflare; D1 ofrece SQLite mediante un binding. No usa `bun:sqlite` ni un archivo SQLite local en producción.

Desde la raíz del repositorio:

```sh
npm install
# Solo en la primera instalación. Conserva una .dev.vars existente.
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev:portal
```

La demostración necesita estos valores en `.dev.vars`:

```dotenv
PORTAL_ENABLED=true
PORTAL_DEMO=true
EMAIL_MODE=dry_run
OCR_MODE=demo
```

Abre [http://127.0.0.1:4322/demo](http://127.0.0.1:4322/demo). Si el puerto está ocupado, usa el que muestre Astro y actualiza los enlaces y el callback local de WorkOS para ese origen. `npm run dev -- --host 127.0.0.1 --port 4322` es equivalente a `dev:portal`.

El selector incluye una administración, Ana con dos atletas, Diego como segundo encargado de un atleta y otra familia independiente. No pide credenciales. La demostración requiere un build de desarrollo, HTTP sobre loopback y ambos flags; un build de producción nunca acepta estas cuentas. La lectura simulada devuelve un ejemplo fijo ficticio: no analiza el archivo elegido ni llama a Groq.

`npm run db:local` aplica las migraciones pendientes. Los datos D1 y archivos R2 locales quedan en `.wrangler/`; `.dev.vars`, `.wrangler/` y `output/` están ignorados por Git. En el sandbox de Codex puede ser necesario anteponer `WRANGLER_LOG_PATH=.wrangler/logs WRANGLER_SEND_METRICS=false` a los comandos de Astro/Wrangler.

La migración `0004_financial_operations.sql` es necesaria para ajustes de cargos y aplicación de saldo a favor. Conserva identificadores de operación para que un reenvío del mismo formulario no duplique movimientos. Debe incluirse en una futura migración revisada de staging; nunca ejecutar `--remote` como parte de las pruebas locales.

## Recorrido del producto

1. Administración inscribe un atleta con cuota de ₡12.000 o ₡15.000, mes inicial y descuento manual. Todo descuento requiere motivo; no se calcula automáticamente un porcentaje entre hermanos.
2. Administración crea una invitación para el correo de cada encargado y selecciona sus atletas. Copia y comparte el enlace mostrado; estas invitaciones no se envían automáticamente por correo. Vencen en siete días y deben aceptarse con el correo indicado.
3. Administración revisa y publica el mes. Los cargos vencen el día 8. Publicar otra vez agrega solo los cargos faltantes; los existentes conservan su cuota. Las correcciones posteriores se registran como ajustes con motivo.
4. La familia transfiere por SINPE incluyendo el nombre completo del atleta y adjunta primero un JPG, PNG o PDF de hasta 3 MB. Revisa o completa monto, fecha, referencia y persona que transfirió, y distribuye el pago. La lectura opcional conserva sus correcciones; el formulario manual sigue funcionando. El saldo conserva su valor mientras el pago está pendiente.
5. Administración comprueba el ingreso directamente en el banco. Puede pedir información, rechazar con motivo o confirmar los datos y la distribución. Las diferencias respecto a lo declarado requieren una nota. También puede registrar un pago para un encargado indicando el motivo.
6. La confirmación emite un comprobante `AB-AÑO-NÚMERO`, guarda sus datos y prepara el correo. Los excedentes quedan como saldo a favor; administración puede aplicarlos después. Una anulación revierte la aplicación y conserva el comprobante marcado como anulado.

El alcance es un comprobante numerado de la Asociación; no incluye integración de facturación electrónica con Hacienda. El documento es HTML imprimible: el navegador puede guardarlo como PDF desde **Imprimir**. Los recibos de demostración identifican claramente sus datos ficticios.

Los encargados comparten los saldos de los atletas a los que están vinculados. El pago y su archivo conservan permisos propios. El correo se dirige únicamente a la cuenta verificada que registró originalmente el pago familiar; no se envían copias automáticas a otros encargados. Se vuelven a comprobar cuenta, correo y vínculos antes de enviar. En los registros asistidos por administración, el destinatario es la persona adulta responsable seleccionada, usando el correo verificado de su cuenta familiar. Los datos de contacto inválidos o la falta de elegibilidad retienen el correo; no se elige un destinatario alternativo. Los permisos de consulta de comprobantes históricos se conservan.

## Completar el WorkOS Staging existente

Usa el proyecto existente **Ajedrez Belen’s Project / Staging**. Sus Redirect URIs y Sign-out URIs muestran **Not set**. La organización generada **Test Organization / example.com / Test Provider** no está aprobada como organización del personal; no se debe usar por suposición. No se han leído claves ni cambiado ajustes de WorkOS. Configura el callback exacto `http://127.0.0.1:4322/auth/callback` para local y el origen HTTPS correspondiente para la futura instalación. Añade el origen de la página principal como retorno permitido al cerrar sesión.

Las familias entran por `/auth/parent`: AuthKit no fuerza una organización y la aplicación concede acceso a los atletas mediante sus vínculos en D1. Administración entra por `/auth/admin`: la sesión se solicita para la organización fija del personal. El portal exige correo verificado y deniega sesiones suplantadas. Un administrador también necesita que su ID de WorkOS figure en `ADMIN_USER_IDS`; el correo o una etiqueta de rol no bastan. El modelo de usuarios y organizaciones está descrito en [Users and Organizations de WorkOS](https://workos.com/docs/authkit/users-organizations).

Configura una política de MFA obligatoria en la organización del personal para sus miembros que ingresan sin SSO, antes de usar datos reales. Esa exigencia depende de la configuración de WorkOS y aún no se ha comprobado con una cuenta real; la aplicación no implementa su propio desafío MFA. Consulta [Organization Authentication Policies de WorkOS](https://workos.com/docs/authkit/organization-policies).

| Variable del servidor | Valor que debe configurarse |
| --- | --- |
| `WORKOS_API_KEY` | Clave secreta del entorno correspondiente |
| `WORKOS_CLIENT_ID` | Client ID de ese entorno |
| `WORKOS_COOKIE_PASSWORD` | Secreto aleatorio de al menos 32 caracteres; puede generarse con `openssl rand -base64 32` |
| `WORKOS_REDIRECT_URI` | Callback exacto del origen de la aplicación |
| `WORKOS_ORGANIZATION_ID` | ID de la organización del personal |
| `ADMIN_USER_IDS` | IDs verificados `user_...` separados por comas |

Para comprobar autenticación real localmente usa `PORTAL_ENABLED=true` y `PORTAL_DEMO=false`. Las claves van en `.dev.vars` o en Workers secrets; no se pegan en chat ni se incluyen en variables públicas. Las pruebas deben cubrir ingreso familiar sin organización, invitación con correo correcto, MFA del personal, usuario no autorizado, refresh/expiración y cierre de sesión. [WORKOS-SETUP.md](WORKOS-SETUP.md) documenta el SDK y el hallazgo de compatibilidad previo; su `/auth/login` sigue reservado al laboratorio.

## Completar la configuración de Brevo

Usa la cuenta existente de la Asociación. El dominio `ajedrezbelen.com` ya está autenticado; los tres registros DNS aprobados se añadieron y verificaron, sin alterar DMARC `p=quarantine`. El remitente `no-reply@ajedrezbelen.com`, nombre **Ajedrez Belén**, ya se creó con autorización explícita y figura **Verified**, con DKIM del dominio y DMARC configurado. Ahora el propietario debe crear e instalar la clave API de manera privada y aprobar cualquier envío; se mantiene `EMAIL_MODE=dry_run`. No crear otra cuenta, repetir los registros DNS ni cambiar DMARC. No se necesita buzón receptor ni reenvío; las respuestas no se atienden y las consultas se dirigen al WhatsApp oficial. [BREVO-SETUP.md](BREVO-SETUP.md) detalla la evidencia observada y cada aprobación pendiente. Consulta [Authenticate your domain with Brevo](https://help.brevo.com/hc/en-us/articles/12163873383186-Authenticate-your-domain-with-Brevo-Brevo-code-DKIM-DMARC) y [Send a transactional email de Brevo](https://developers.brevo.com/docs/send-a-transactional-email).

| Variable del servidor | Uso |
| --- | --- |
| `EMAIL_MODE` | `dry_run` por defecto; solo `live` permite peticiones a Brevo |
| `BREVO_API_KEY` | Clave secreta API |
| `EMAIL_FROM` | Dirección del remitente configurado |
| `EMAIL_FROM_NAME` | Nombre de la Asociación mostrado como remitente |
| `EMAIL_TIMEOUT_MS` | Opcional; 10.000 ms por defecto |

La aprobación intenta procesar los correos de ese comprobante. El lote pendiente también puede procesarse desde `/admin/comprobantes`. El portal obtiene los destinatarios de sus registros y vínculos verificados, no de un campo libre del formulario. `EMAIL_TEST_RECIPIENT` pertenece al laboratorio anterior y **no limita los destinatarios del portal**; valida primero en un entorno separado con cuentas y buzones de prueba controlados.

Si se reparan los datos de una cuenta después de retener un correo, administración debe pulsar **Preparar correo** en el comprobante. La acción vuelve a comprobar el destinatario almacenado, prepara el primer correo y deja auditoría; no envía. `Receipt.canPrepareEmail` solo la muestra para un comprobante emitido, pago verificado y sin ningún registro previo de correo original, ni siquiera uno cancelado o de un destinatario anterior. No acepta direcciones libres, no redirige ni reactiva correos existentes y no se ofrece para comprobantes anulados. Después hay que revisar el destinatario y procesar el lote por separado. Corregir una cuenta no libera un envío automáticamente.

En modo simulado no se envía nada. Una cuenta de demostración o un recibo ficticio no puede enviar correo aunque se active `live`. El envío real exige administrador autenticado con WorkOS. El estado `accepted` significa aceptación por Brevo, no entrega en el buzón. Ante un resultado ambiguo se conserva `unknown` y se revisan los logs del proveedor; no se reintenta automáticamente. Los reintentos seguros requieren una acción explícita y respetan la espera registrada. Hay un máximo interno de cinco envíos por lote y 250 intentos por día UTC en modo real; confirma también la cuota disponible en la cuenta.

[BREVO-SETUP.md](BREVO-SETUP.md) conserva los detalles del adaptador de pruebas y los límites de idempotencia del proveedor. Para el portal, los comprobantes quedan disponibles aunque el envío falle. Webhooks de entrega y notificaciones automáticas de atraso no están implementados.

## Configurar la lectura opcional con Groq

`OCR_MODE=off` es el valor de producción. `demo` devuelve datos ficticios solamente en la demostración local. `groq` necesita una sesión real de WorkOS y `GROQ_API_KEY` como secreto del servidor; seleccionar un archivo no llama al proveedor. La acción **Leer datos** explica el envío externo y debe pulsarse expresamente. `GROQ_VISION_MODEL` es opcional (por defecto `qwen/qwen3.8-27b`); `GROQ_TIMEOUT_MS` permite ajustar la espera dentro del límite de 30 segundos.

El original se guarda sin modificación. JPG/PNG tienen vista privada ampliable; un PDF muestra y lee solamente la primera página convertida, con el documento completo disponible para descarga. Las sugerencias se registran aparte y nunca sustituyen la comprobación bancaria. El build de compatibilidad de PDF.js, su worker correspondiente, fuentes y mapas se sirven desde el mismo origen; los comandos de desarrollo y compilación copian sus activos explícitamente, incluso si npm tiene `ignore-scripts=true`.

Antes de habilitar `groq`, comprueba en staging el modelo y las cuotas de la cuenta, configura sus controles de datos y prueba una imagen ficticia con un usuario real. Mantén correo simulado y los flags de demostración/laboratorio apagados. El adaptador está implementado, pero la llamada real y la precisión no se han verificado. [PAYSLIP-OCR.md](PAYSLIP-OCR.md) describe modos, presupuestos, validación y limpieza de borradores.

## Preparar una instalación en Cloudflare

Esto está pendiente; los comandos locales anteriores no crean recursos remotos.

1. Crear una base D1 y un bucket R2 privado para staging, con cuenta de la Asociación. Sustituir el `database_id` de ejemplo y los nombres en `wrangler.jsonc`, conservando los bindings `DB` y `SLIPS`. No habilitar acceso público al bucket. Referencias: [comandos D1 de Wrangler](https://developers.cloudflare.com/d1/wrangler-commands/) y [Create new buckets de R2](https://developers.cloudflare.com/r2/buckets/create-buckets/).
2. Aplicar todas las migraciones al entorno elegido con `npx wrangler d1 migrations apply DB --remote`, revisando antes la cuenta y configuración. Las migraciones locales no se copian por sí solas a la nube. [Migrations de D1](https://developers.cloudflare.com/d1/reference/migrations/).
3. Configurar secretos, origen HTTPS/callback, dominio o ruta del Worker y datos receptores aprobados: `PAYMENT_BANK_NAME`, `PAYMENT_ACCOUNT_ID`, `PAYMENT_DESTINATION` y `ASSOCIATION_RECEIPT_NAME`. Los valores actuales son la configuración inicial SINPE y deben confirmarse antes del piloto.
4. Mantener `PORTAL_DEMO=false`, `PROTOTYPE_ENABLED=false` y `PROTOTYPE_LOCAL=false`. Habilitar el portal deliberadamente con `PORTAL_ENABLED=true`. Mantener correo simulado y `OCR_MODE=off` durante las pruebas iniciales. Habilitar lectura real solo después de sus comprobaciones específicas.
5. Compilar y publicar en staging con la configuración generada del adaptador; comprobar permisos, login, migraciones, archivos privados y un envío controlado. Medir CPU y consumo D1/R2/WorkOS/Brevo para confirmar que el uso real cabe en los niveles gratuitos. No se ha ejecutado esa publicación.

El presupuesto de niveles gratuitos y las decisiones de arquitectura están en [PAYMENTS-PLAN.md](../PAYMENTS-PLAN.md). El costo cero y el rendimiento en la nube siguen sujetos a las cuentas, sus cuotas y la medición real.

## Verificación y límites actuales

Estado actual: **158 pruebas unitarias aprobadas**, revisión Astro de **99 archivos sin diagnósticos** y compilación correcta. El recorrido HTTP final de **15 grupos fue aprobado**; la limitación intermitente del transporte de desarrollo Vite está documentada en el informe de verificación. Los resultados y el alcance exacto de las pruebas están en [PORTAL-VERIFICATION.md](PORTAL-VERIFICATION.md). La operación mensual y el procedimiento de respaldo pendiente están en [PORTAL-OPERATIONS.md](PORTAL-OPERATIONS.md).

```sh
npm test
npm run check
npm run build
# Con la demostración local en ejecución; crea datos ficticios:
npm run test:portal
# Con OCR_MODE=demo; solo datos ficticios, sin peticiones a Groq:
npm run test:portal:ocr
```

Para repetir las comprobaciones del build de producción, inicia el Worker compilado en otra terminal con valores ficticios y sin cargar credenciales locales:

```sh
WRANGLER_LOG_PATH=.wrangler/logs WRANGLER_SEND_METRICS=false \
  npx wrangler dev --config dist/server/wrangler.json \
  --env-file /dev/null --local --ip 127.0.0.1 --port 4323 \
  --inspector-ip 127.0.0.1 --inspector-port 9233 \
  --var PORTAL_ENABLED:true --var PORTAL_DEMO:true \
  --var EMAIL_MODE:dry_run --var OCR_MODE:demo \
  --var WORKOS_API_KEY:sk_test_FIXTURE_ONLY \
  --var WORKOS_CLIENT_ID:client_fixture \
  --var WORKOS_COOKIE_PASSWORD:synthetic-local-worker-password-at-least-32 \
  --var WORKOS_REDIRECT_URI:http://127.0.0.1:4323/auth/callback \
  --var WORKOS_ORGANIZATION_ID:org_fixture \
  --var ADMIN_USER_IDS:user_fixture
```

En la primera terminal ejecuta `npm run test:portal:locked`. El selector de demostración debe devolver 404 aunque sus flags estén activados. El script inspecciona los redirects PKCE y las denegaciones de acceso; no sigue los enlaces a WorkOS ni intercambia un código de login. Detén ese servidor al terminar.

La revisión visual local incluye el panel familiar y el formulario a 320 px con un PDF sintético de dos páginas guardado de forma privada; el detalle de las pruebas actuales y anteriores está en [PORTAL-VERIFICATION.md](PORTAL-VERIFICATION.md). Las pruebas de cancelación lenta, interrupción real de red y restauración de pestañas no constituyen aún una matriz completa de navegadores. Las tablas muestran un número limitado de registros para mantener las páginas manejables; administración puede exportar los historiales completos de cargos, pagos, comprobantes, correo y auditoría en CSV o JSON. Los saldos se calculan sobre el registro completo.

Los archivos se validan por tamaño y firma, conservan sus bytes originales, permiten vista/descarga privada según el formato y no se adjuntan al correo. Esto no constituye un servicio de análisis de malware. Antes del piloto quedan pendientes cuentas y pruebas reales, medición de recursos, política de conservación/recuperación y aprobación de la identidad y texto del comprobante por la Asociación.
