# Portal usability pass — 17 October 2026

Follows [PORTAL-UX-FIXES-2026-10-14.md](PORTAL-UX-FIXES-2026-10-14.md). Presentation and navigation only: no server logic, payment, ledger or auth behaviour changed. New styles live in `src/styles/portal-ux.css`, loaded after `portal-brand.css`.

## Changes

- **Phone navigation.** Family accounts get a fixed bottom tab bar (Mi cuenta, Eventos, Registrar pago, Mis atletas). It hides while a field has focus so the keyboard keeps the room. Administration keeps the "Menú" disclosure (seven destinations do not fit a tab bar). The phone header puts the signed-in name and role on one line.
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

## Not done

- Inline field errors with focus on the error summary, a one-tap "pay everything" action, receipt print/share, and database-level search (the 500-row fetch window remains).
- No physical-device, screen-reader, Safari or Firefox testing.
