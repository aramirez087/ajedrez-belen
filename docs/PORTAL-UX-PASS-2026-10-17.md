# Portal usability pass — 17 October 2026

Follows [PORTAL-UX-FIXES-2026-10-14.md](PORTAL-UX-FIXES-2026-10-14.md). Presentation and navigation only: no server logic, payment, ledger or auth behaviour changed. New styles live in `src/styles/portal-ux.css`, loaded after `portal-brand.css`.

## Changes

- **Phone navigation.** Family accounts get a fixed bottom tab bar (Mi cuenta, Eventos, Registrar pago, Mis atletas). It hides while a field has focus so the keyboard keeps the room. Administration gets the same bar in the third round (see below). The phone header puts the signed-in name and role on one line.
- **Dashboard.** When money is owed, "¿Qué hago ahora?" shows two numbered steps: "Transfiere a" (destination with a copy button) and "Registrar mi pago".
- **Payment form.** The transfer destination is a visible strip above the form instead of a disclosure at the bottom. The browser's own file button ("Choose File"), which follows the phone's language, is replaced by "Elegir foto o PDF" (the real input stays in the page, covering the drop area, so keyboard, drag-and-drop and drafts are unchanged). The amount placeholder shows an example from what is due, not a fixed 27000.
- **Athletes page.** Order is now athletes, enrol form, then "Dar acceso al otro padre" (the `#compartir` anchor still works). Fieldset groups use the same 20 px rhythm as the rest of the form.
- **Links.** 36 in-site links used the external-link arrow (↗); they now use → or ←. ↗ remains only for links that leave the portal.
- **Help.** The WhatsApp help line is a button; the duplicate footer link is removed.
- **Reading size.** Links, navigation, table text, form labels and helper copy are larger (14 px floor for text that carries information; 12 px stays for tracked capitals and tab labels). Filter chips, role switch and month navigation share the pill shape.
- **Admin.** The email-delivery list on Comprobantes is collapsed unless a receipt is held or an email is queued (a hash link to a row opens it). Admin payment and receipt lists page at 25 rows (was 50). The search block no longer touches the list under it.

## Verification

- `npm test`: 404 passed. `npm run check`: 0 errors, 0 warnings, 0 hints.
- Chromium screenshots at 390 and 1440 px of the family dashboard, payment form, athletes, events, and admin overview, families, receipts and payment review. An audit at 390 px found no tap target under 40 px and no text under 13 px other than tracked capitals, the demo banner and tab labels.
- `npm run test:portal` printed its normal results. `npm run test:portal:ocr` stopped at its simulated-OCR date check (the demo returned 14 Oct, the test expected the current date); this code was not touched, but the check was not run on the unchanged code.

## Second round: events and remaining surfaces

- **Events page (`/portal/eventos`).** Rebuilt around four questions. A dark spotlight card shows the next or live event with its own actions (enter by Zoom, directions, add to calendar). "Próximos 14 días" is an agenda grouped by day with one compact row per activity. "Más adelante" lists one-off events beyond that window. "Cada semana" shows each recurring series once with "Agregar todas las fechas". Before, every weekly class was a full card and past dates came first. The month is a real calendar grid (start time on each entry, past days muted, up to three per day) at 761 px and wider. On phones it becomes the same agenda, skipping what is already shown above, with earlier days folded. New component: `EventAgenda.astro`. The family dashboard's "Próximos eventos" uses it too.
- **Event detail.** An action card (date, primary action, add to calendar, Google Calendar, share, copy) sits beside the facts and stays visible while scrolling on desktop. It comes first on phones. The date and time are no longer printed three times. "Próximas fechas" uses the agenda rows.
- **Admin events.** The filter chips show which one is active. Each card's actions are attached to it. In the event form, each question ("¿Cuándo es?", "¿Dónde es?", "¿Se repite?") is its own block, the place fields sit inside "¿Dónde es?", the "Todo el día" checkbox is aligned, and the image picker is localized.
- **Payment detail.** The three-step status (Registrado → En revisión → Confirmación) is a stepper: horizontal on desktop, vertical on phones.
- **Dashboard.** Zero-value stats ("Pagos en revisión", "Saldo a favor") shrink to one line so the balance leads. Section chips scroll on one row on phones.
- **Payment form.** The read-only "Referencia bancaria" field shows only when slip reading (OCR) is available. Otherwise it is a hidden empty value and the step text says to type the amount and date as the bank shows them.

Second-round verification: `npm test` 404 passed; `npm run check` 0 errors; `npm run test:portal` exit 0. A Chromium sweep of 17 family and admin page loads at 320, 390, 768 and 1440 px found no horizontal overflow, duplicate IDs, unlabeled fields, page errors, or missing/duplicate `h1`. Six fictional events were added to the local demo database to review the calendar.

## Third round: administration on phones, shorter family copy

- **Administration on phones.** The bottom bar serves administrators too: Pagos, Familias, Eventos and Más. Más opens a sheet above the bar with Comprobantes, Registrar pago, Mensualidades and Administradores. The current section is marked in the bar. The "Menú" disclosure is hidden on phones.
- **Family dashboard.** Monthly charges show only what is still owed. Paid months fold under "Ver N mensualidades pagadas", so a year of payments no longer pushes everything else down. The "¿Qué hago ahora?" panel is shorter in both states; the note about paying ahead now lives on the payment form, which already explains it.
- **Bank references.** Families see the last eight characters (…XXXXXXXX) in payment lists. The full reference stays in administration and on the payment detail.
- **Payment form.** Repeated explanations are collapsed into one line about where the receipt goes and one about what "en revisión" means.
- **Administration home.** Shorter intro and queue instruction. The paragraph about search and the 500-payment window moved into the history caption.
- **Receipts and payment review.** Shorter receipts intro and held-receipt message. The review page's three-step box links to the bank proof, which sits below the form on phones. The step that said "columna derecha" now names the section instead.
- **Code.** `ChargesTable.astro` renders both the open and the paid lists. `shortReferenceLabel()` in `format.ts`. `.portal-status-tag` replaces an inline style.

Third-round verification: `npm test` 404 passed; `npm run check` 0 errors, 0 warnings, 0 hints; `npm run test:portal` exit 0 (run twice); the 17-page sweep found no problems. The demo accounts have no paid months, so the folded list was checked on a temporary page with sample rows, which was deleted afterwards.

## Fourth round: accessibility, admin scale and the families page

- **Accessibility, measured.** axe-core 4.10.2 was run locally against about 30 pages in Chromium, WebKit and Firefox, at phone and desktop widths (the library is not added to the project). It found and fixed:
  - stat blocks put a `<p>` inside a `<dl>`, which is invalid. The note is now a `<dd class="portal-stat-note">` on the family dashboard, the admin home and monthly charges. The figure keeps its size and face.
  - the demo banner sat outside any landmark. It is now an `<aside>`.
  - two admin lists shared one region name. `PaymentsTable` takes its own `label` and `caption`.
  - past agenda items, past calendar chips and cancelled chips faded with `opacity`, which fails contrast. They use the muted ink. Calendar chips keep readable text on hover.
- **Cross-engine sweep.** The 320–1440 px sweep (72 page loads per engine) ran in WebKit (Safari's engine) and Firefox as well as Chromium. No overflow, duplicate IDs, unlabelled fields, or page errors.
- **Admin families.** One page, five views: Atletas inscritos, Cuentas familiares, Inscribir atleta, Invitar a un padre, Montos por categoría. The bar opens a view, and a link's hash wins over the default. A finished action returns to the view it changed (its notice names the view). A search lists athletes and accounts together. Focus moves into the view that opens. Captions are shorter, and on phones the search keeps its button on the same line. Every POST form and redirect is unchanged; the search form now submits to the page itself.
- **Monthly charges.** The charge list and the preview each page at 20 rows, so a club-sized month is not one long scroll.
- **Payment review.** After a decision the payment leaves the queue. The page now offers "Revisar la siguiente", with the count left, instead of a trip back to the summary. The three-step box links to the bank proof.
- **Assisted registration.** Before the form, a "Familia seleccionada" summary shows the name, email, number of athletes, and pending balance.
- **Navigation order.** Administrator desktop tabs follow the phone bar: Pagos, Familias, Eventos, Registrar pago, Comprobantes, Mensualidades, Administradores. "Resumen" is now "Pagos", the same name as the bar.
- **Family copy.** The enrolment billing rule is two sentences. The email route for a correction sits in a closed "¿El comprobante está en tu correo?" disclosure.

Fourth-round verification: `npm test` 404 passed; `npm run check` 0 errors, 0 warnings, 0 hints; `npm run test:portal` exit 0 on the second run (see Not done); sweep 0 problems in each of Chromium, WebKit and Firefox; axe 0 violations on the scanned pages in all three engines. One early axe reading showed contrast failures on the families chips. The cause was a colour transition still running when the scan started, not the colours. The default view is now marked on the server, and the scan waits for transitions to settle. Paging was checked by temporarily setting the page size to 2 and restoring it.

## Not done

- Server errors still arrive as a top banner. It links to the field only for amount and allocation errors.
- Search reads at most 500 payments. Fixing that is a server change.
- 81 inline `style` attributes remain, mostly margins. They follow the existing pattern, so converting them would be churn with no visible change.
- No real-phone or screen-reader session. axe catches automated problems only. A person using VoiceOver, TalkBack or NVDA still needs to run the payment and enrolment flows.
- `test:portal` fails on its unrelated-account upload check (409 `draft_limit` instead of 403) after five runs within an hour. Each run leaves one draft in `draft` state for the unrelated family, because `POST /api/portal/payments` registers the draft before it checks permissions (`src/lib/portal/slip-upload.ts`, then `src/lib/portal/ocr.ts`). Five drafts is the cap (`migrations/0003_ocr.sql`). Drafts expire after an hour and are released on the next upload. Options: check permissions before the draft is registered (a server change; needs approval), or give the check a fresh account. This is not caused by the interface changes in this round.
