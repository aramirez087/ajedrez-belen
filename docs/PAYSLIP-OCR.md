# Private evidence and optional payslip reading

Implemented locally on 10 October 2026: upload-first drafts, image/PDF previews, optional field suggestions, editable parent fields, separate extraction history and private administrator evidence review. The Groq adapter is implemented and tested with controlled responses. A real Groq request, model access and extraction quality have not been verified; no bank evidence has been sent to the provider during these checks. Browser checks verified private uploads of the supplied images, fixed demo suggestions, edit preservation, household-name navigation, keyboard image zoom, first-page PDF worker rendering and mobile layout. See [verification results](PORTAL-VERIFICATION.md) for the exact tested scope.

## Parent and administrator flow

The parent first selects a JPG, PNG or PDF of up to 3 MB. JavaScript saves the exact original to private R2 as an owned draft; this does not create a payment or reduce a balance. The original file input remains part of the normal multipart form, so manual submission works without JavaScript or when temporary saving fails. Submitting with a saved draft links that same original to the payment.

In live mode, **Leer datos** explicitly discloses that the image will be sent to Groq. Reading is optional. Validated amount, date, reference and payer suggestions fill only fields the parent has not edited. Unknown or ambiguous values remain manual. Bank references stay exact strings, including leading zeros. Changing the selected file cancels pending requests, clears the draft/results and removes earlier automatic values while preserving manual edits. In the portal form the parent always selects the authorized athlete/month allocations; a detected description cannot create a link or allocate money. The exception is a slip emailed to pagos@: when its amount and date are read, the email worker requests the allocations itself on a pending payment that the administrator still confirms. There the detail only orders already linked athletes, never adds a link; see [PORTAL-EMAIL.md](PORTAL-EMAIL.md#inbound-bank-slips-by-email-email-routing).

The detected bank detail is also shown for review. A local matcher compares only that detail with the athletes currently linked to the parent's account, or the administrator's selected/designated adult. The browser receives only those authorized IDs and names; that list is never sent to Groq. Exact normalized full or partial names can suggest an athlete, while multiple matches ask the user to choose and no match leaves selection manual. A partial match is not confirmation. **Ver mensualidades de [athlete]** focuses and highlights that athlete's existing rows without entering amounts or choosing a month. File changes and new reading failures clear suggestions/highlights and preserve manual allocations. Suspicious instruction-like text suppresses matching; missing detail never falls back to the payer or receiving-account name.

The form compares the selected allocation total with the transfer amount using exact integer minor units. It reports a match, excess distribution or the credit remaining after bank verification, and blocks client submission only for excess distribution. Suggestions trigger the same comparison; they never choose monthly allocations. Server validation remains authoritative. If a saved draft expires while the form is open and its original file is still selected, submission clears only the temporary ID and uploads the original through the normal route; no server draft or attached evidence is deleted.

Parents and administrators can view protected original JPG/PNG files and enlarge them in a keyboard-accessible dialog. A PDF preview renders only page one in the browser with the self-hosted PDF.js compatibility (`legacy`) build, its matching worker, fonts and character maps. The library loads only when a PDF preview is requested; it adds no custom global polyfills. The complete original PDF remains the stored/downloadable evidence. Rendering has a 10-second timeout, a 2,048-pixel longest-edge limit, a four-million-pixel canvas/image cap and a 1.5 MB derived-image limit. A derived image is used for PDF reading, labelled separately and hashed; it does not replace the original or prove the PDF's contents. If rendering fails, downloading and manual entry remain available.

The review page keeps the original, family-submitted values and extraction suggestions separate, flags differences and retains previous file versions. Suggestions do not change the bank-confirmation form. Approval still requires the administrator's independent receiving-bank check, reconciled fields, valid allocations and the mandatory checkbox. Reading a screenshot does not establish that funds arrived or that the screenshot is authentic.

## Configuration and modes

Requires Node >=22.13.0 and the pending D1 migrations. `npm run db:local` applies them locally. The actual development/build commands explicitly copy PDF.js fonts/maps and their licences, even with npm `ignore-scripts=true`, to `public/portal-pdf/`; those generated assets are served from the application origin.

| Server setting | Behavior |
| --- | --- |
| `OCR_MODE=off` | No extraction; original uploads, previews and manual forms remain usable. Production defaults to this. |
| `OCR_MODE=demo` | Fixed fictitious suggestions only for synthetic demo accounts in a DEV/HTTP-loopback session. No external request and no analysis of the uploaded file. |
| `OCR_MODE=groq` | External reading only for an authenticated WorkOS account with a configured server key, after the explicit reading action. A demo identity cannot call Groq. |
| `GROQ_API_KEY` | Server-only secret in `.dev.vars` or Workers secrets; never put it in chat, Git, public variables or browser code. |
| `GROQ_VISION_MODEL` | Optional; adapter default `qwen/qwen3.8-27b`. Reconfirm model availability and account access before enabling. |
| `GROQ_TIMEOUT_MS` | Optional; 15,000 ms adapter default, bounded to 30,000 ms. The example uses 12,000 ms. |

For the local demonstration use `PORTAL_ENABLED=true`, `PORTAL_DEMO=true`, `EMAIL_MODE=dry_run` and `OCR_MODE=demo`. **Probar lectura simulada** always returns the system's fictitious example, even when a different file is selected. It is a UI/workflow demonstration, not a test of OCR accuracy. Set `OCR_MODE=off` to try purely manual entry.

New demo extractions use the fixed fictitious detail `Timothy · muestra fija de demostración`, which can suggest the seeded `Timothy de prueba` through a partial-name match. Older cached demo extractions may show no match; both outcomes remain manual and explicitly simulated.

Groq documents image input, base64 data URLs and JSON mode for the configured vision model. The server sends image bytes directly instead of exposing a private bucket URL. [Images and Vision — GroqDocs](https://console.groq.com/docs/vision).

## Budgets, validation and temporary files

The server reserves attempts before an external request: at most 50 Groq attempts per UTC day across the portal, 10 per user/day, two per minute globally and one in flight globally. Each draft permits at most three reading attempts/day; a successful result for the same owner, original/derived hashes and mode is reused. Failed attempts consume their reservation. There is no automatic retry or provider failover. A reading failure or quota exhaustion leaves the manual payment form available.

The adapter requests at most 600 completion tokens, bounds the provider response to 64 KiB and validates an exact field schema. It rejects extra keys, coerced/numeric bank references, unsupported currency and uncertain dates/references. Text inside an image is untrusted document data; the reader has no tools, bank credentials, permissions or approval authority. Validated suggestions, source hashes, mode/model and timestamps are recorded separately. No model confidence score is used, and images/base64/full responses are not logged by the integration.

Temporary storage permits five open drafts and 15 MB per user, with a 100 MB global draft budget. Drafts expire after one hour. Cleanup waits another hour and removes only unreferenced expired objects; database guards protect payment evidence even when submission interrupted draft attachment. Administration can run **Limpiar borradores vencidos** in `/admin/comprobantes`, up to 20 rows per action. This does not remove submitted evidence or prior revisions. There is no background cleanup scheduler.

These are application safeguards, not a provider-wide billing cap. Confirm organization/model allowances and remaining usage before relying on a free tier. [Rate Limits — GroqDocs](https://console.groq.com/docs/rate-limits).

## Before enabling real reading

1. Use staging with `PORTAL_DEMO=false`, `PROTOTYPE_ENABLED=false`, `PROTOTYPE_LOCAL=false` and `EMAIL_MODE=dry_run`. First test a real WorkOS session with `OCR_MODE=off`; verify that demo identities and unrelated families are denied.
2. Confirm account/model access, quotas and data controls. Groq provides Zero Data Retention controls; without them, limited reliability/abuse monitoring may retain inputs and outputs. Review and deliberately configure the account before sending bank evidence. [Your Data in GroqCloud — GroqDocs](https://console.groq.com/docs/your-data).
3. Store the server key, select `OCR_MODE=groq` deliberately and make an explicit reading request with a synthetic slip. Verify actual extracted fields, leading zeros, unknown fields, warnings, timeout/manual fallback and account usage. Test a PDF's first-page rendering against its preserved complete original.
4. Verify that corrections survive a later read or file change, athlete suggestions stay within the authorized family, their navigation action leaves allocations unchanged, suggestions never populate approval authority, and provider failures never block manual submission. Keep the feature off for real families until these checks and the association's external-processing disclosure are reviewed.

Provider tests use mocked responses; the local demo uses fixed fictitious data. Neither proves real recognition accuracy, deployed CPU usage or the account's free-tier fit. Local HTTP checks are available with `npm run test:portal:ocr`; they create synthetic records and do not call Groq. WorkOS, Brevo, cloud deployment and restore checks remain described in [portal setup](PORTAL-SETUP.md).
