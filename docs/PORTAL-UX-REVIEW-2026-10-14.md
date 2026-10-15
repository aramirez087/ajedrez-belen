# Portal review — UI/UX, bugs and ease of use (14 October 2026)

> Historical review. See [the implementation and verification follow-up](PORTAL-UX-FIXES-2026-10-14.md) for the current corrections, evidence, and remaining limits.

Full review of the Ajedrez Belén payment portal (family + administration + auth + events),
judged against a world-class standard: Vercel Web Interface Guidelines, WCAG 2.2 AA,
and task-completion usability for non-technical parents on phones.

**How this was verified (this session, local demo `PORTAL_DEMO=true`):**

- `npm test` → **377 pass / 2 fail** of 379 (see B-1).
- `npm run check` → 197 Astro files, **0 errors / 0 warnings / 0 hints**.
- `npm run build` → passes.
- `npm run test:portal` → passes. `test:portal:pdf` → passes.
  `test:portal:ocr` → **fails** (see B-3).
- Live browser audit (Playwright, Chromium) on every portal/admin/auth page at
  1440×1000 and 390×844, screenshots in `output/playwright/review-*.png`,
  plus scripted probes for labels, duplicate IDs, target sizes, overflow,
  console errors (0), and computed WCAG contrast ratios.

Severity: **P0** breaks or blocks a core task · **P1** likely to confuse real users or
fail a launch gate · **P2** polish, scale, or world-class refinement.

---

## Executive verdict

The engineering underneath is unusually strong for a club portal: plain-language
Spanish copy, a «¿Qué hago ahora?» next-step panel on every dashboard, idempotent
financial mutations, optimistic-concurrency snapshots, draft recovery for payment
forms, accessible tables that become labelled cards on mobile, and zero console
errors in the audit. **The gap to world class is not correctness — it is effort.**
The one task the whole portal exists for (a parent registers a SINPE transfer)
still asks that parent to scroll past two instruction panels, copy a destination
by hand, type the same total twice, distribute it across up to four money fields,
and recover from errors that are announced at the top of the page instead of at
the field. Fix the P1 list below and this portal is genuinely best-in-class for
its category; the P2 list is what turns «very good» into «memorable».

| Area | Grade | One-line reason |
|---|---|---|
| Visual design / identity | A− | Distinctive editorial system, consistent; tiny type and endless pages hold it back |
| Family usability | B | Next-step guidance is excellent; payment form effort is the weak link |
| Admin usability | B− | Solid queues, but no search/filter/pagination at any scale |
| Accessibility (WCAG 2.2) | A− | Labels, focus, headings, targets all clean; input-border contrast and 9–11 px text are the risks |
| Forms & error recovery | C+ | Drafts and live allocation math are great; errors are not inline and focus is not managed |
| Performance | A | SSR ~15 ms TTFB locally, minimal JS; PDF.js only where needed |
| Robustness / tests | B+ | 377/379 unit tests, E2E passes; 2 failing tests + flaky OCR script need attention before launch |
| Security posture (reviewed surface) | A− | Same-origin checks, no-store headers, CSV formula sanitization, CSP on receipts |

---

## Bugs found (code defects, not opinions)

### B-1 · P1 — Two unit tests fail on `main`; the new admin-grant lookup can lock out families

`tests/portal-business-config.test.ts` fails twice:

```
✖ new submission and eager upload reject before form parsing…  403 !== 503 (line 178)
✖ unrelated historical/corrective mutations are not globally disabled…  403 !== 200 (line 210)
```

Root cause: commit `becc215` added `hasActiveAdminGrant(env.DB, actor.id)` inside
`authorizePortal` (`src/lib/portal/access.ts`). The business-config test fixture's
mock D1 only allows profile SQL, so the grant query throws — and the `catch`
returns **403 for every request**, before the business-setup 503 is ever reached.
The fixture is stale, but it exposes a real design risk worth fixing in product
code, not just in the test: **today, any failure reading the admin-grant table
(missing migration 0010, transient D1 error) denies the entire portal to a
signed-in family user**, instead of simply treating them as a non-admin.
Recommended fix: on grant-read failure, continue with `isAdmin: false` (fail to
least privilege, not to lockout), and update the fixture to allow the grant SELECT.

### B-2 · P1 — Typing an invalid amount gives no error at the amount field

Verified live on `/portal/pagos/nuevo`: entering `abc` in «Monto que
transferiste» sets **no** validity message on that input. The only feedback is
the allocation status paragraph far below the fold, and its first message is
about allocations, not the amount. A parent who mistypes the amount and taps
«Pagar todo» sees a correct-looking total while the amount field still holds
garbage, and only learns of the problem at submit. The amount input needs its
own inline error (`aria-invalid`, described-by message, focus on submit), like
the allocation inputs already have.

### B-3 · P2 — `test:portal:ocr` is not reliably runnable after `test:portal`

Running the documented sequence against one demo server, the OCR script failed
twice with different assertions (a 500 from the known Miniflare `fetch failed`
transport flake, then «Each payment form contains one explicitly scoped athlete
list — 0 !== 1», because earlier E2E mutations had settled the charges the OCR
script expects to find). The E2E scripts share mutable demo state and are
order-dependent; a fresh-clone developer following the README hits red tests
that are not product bugs. Give each E2E script its own seed/reset step or
document the required order and fresh DB.

### B-4 · P2 — Intermittent Miniflare `fetch failed` 500s during local E2E

Observed repeatedly in the dev-server log during `test:portal` (documented
before in `docs/CONTINUATION-STATUS.md` as a dev-tool limitation). It did not
occur in manual browser use. Keep as a known local-only flake, but it is one
more reason the OCR script (B-3) reports confusing failures.

Verified **not** bugs: CSV export sanitizes spreadsheet formulas
(`src/pages/api/admin/export.ts:24`); all `target="_blank"` links carry
`rel="noopener"`; no `transition: all`, no TODO/FIXME, no console errors on any
audited page; every input on every audited page has an associated label; no
duplicate IDs; no horizontal overflow at 390 px; exactly one `<h1>` per page.

---

## P1 — Fix before real families rely on this

### 1. The payment form starts below two instruction panels (biggest single defect)

On a 390×844 phone, the first viewport of `/portal/pagos/nuevo` contains **zero
form controls**: heading, intro, then the full «¿Prefieres enviar el comprobante
por correo?» panel, then «Antes de empezar: ¿ya transferiste?», and only then
step 01. The secondary path (email) is presented before and larger than the
primary path (upload). World-class task pages put the first input in the first
viewport. Fix: collapse the email instructions into a `<details>` («Otra forma:
enviarlo por correo») placed *after* step 01 or in the side rail; keep the
SINPE-destination strip but shrink it to one line with the copy button. The same
email wall of text also sits inside «Comprobantes» on `/portal`, where it is
about registering a payment, not about receipts — move it to the payment flow
only. (`src/pages/portal/pagos/nuevo.astro`, `src/pages/portal/index.astro:39`)

### 2. Parents must type the same total twice — and distribute it by hand

Verified live: after tapping «Pagar todo» on all four charges (total ₡40.500),
the amount field is still whatever the user typed, and submit then demands the
two numbers reconcile. For the overwhelmingly common case (one transfer pays
the full balance), the ideal flow is one tap: «Pagar todo lo que debo:
₡40.500» fills amount + allocations together. Keep manual distribution as the
advanced path, but (a) add a single pay-everything action, (b) when allocations
change and the amount field is empty or untouched, mirror the allocation total
into it, and (c) if the two still differ, say so inline with the difference
(«Te faltan ₡3.000 por distribuir») instead of a generic mismatch at submit.
Also change every allocation placeholder from the identical `27000…` example to
that row's own balance — today a ₡9.000 row suggests typing 27000.
(`src/components/portal/ChargeAllocator.astro`)

### 3. Server errors lose the user's place and most of their input

`mutationError` redirects to `?error=code` (`src/lib/portal/http.ts:115`). The
message itself is well written (`Notice.astro`), but: it appears at the very
top of a reloaded page, names no field, never moves focus, and every form
except the two payment forms (which have the excellent sessionStorage draft)
comes back empty — including the 205-line event form and athlete registration.
Pattern to adopt portal-wide: keep the redirect (it suits the no-framework
architecture), but render the error summary with anchor links to the offending
fields (the event form already maps codes to fields — generalize it), give the
draft treatment to `inscribir` and `EventForm`, and on pages with `?error=`,
move focus to the error summary (`tabindex="-1"` + focus) so keyboard and
screen-reader users land on it. WCAG 3.3.1/3.3.3 and the Web Interface
Guidelines both require errors inline next to fields; B-2 is the same issue
client-side.

### 4. No overdue state anywhere

Today is day 14; October charges due on the 8th still read «vence el 8 oct
2026» in the next-step panel, the stats, and the table. There is no «vencido»
concept in the codebase (`grep vencid/overdue` → nothing in the UI). For a
payments portal this is the most important status distinction after «paid».
Add: due-date state computed at render (por vencer / vence hoy / vencido hace
N días), red treatment reserved for overdue only, and admin-side «saldos
vencidos» count. This also fixes the copy bug where the family «¿Qué hago
ahora?» panel states one combined balance «y vence el 8 oct» even when part of
that balance is November's charge that is not due for weeks — split «a pagar
ya» from «próximo mes» in both the panel and the payment form's charge list
(future-month charges should be visually separate, collapsed under «Adelantar
el próximo mes (opcional)»).

### 5. Admin lists have no search, filter, or pagination

Admin renders up to 500 payments/receipts and every family/athlete on single
pages (`LIMIT 500`, `src/lib/portal/domain.ts:376,489`; Familias measured at
4 viewports tall with 24 forms and 83 inputs for a handful of demo athletes).
There is no text search («buscar» appears nowhere outside the events estado
filter). A treasurer looking for «the ₡15.000 from María on Tuesday» must
Ctrl+F a 500-row table. Minimum viable: a GET search box (name, reference,
amount) + status filter chips + 50-per-page pagination on payments, receipts,
and families; athlete search on Familias. This is also the performance fix —
500-row tables with per-row forms will get heavy on low-end phones.

### 6. Destructive confirmations use `window.confirm`

Revoke link, pause membership, deactivate athlete, publish/email batches all
use the native browser confirm (`PortalLayout.astro:102`, `EventForm.astro:194,199`).
It is functional and accessible, but it is the one visibly «unfinished» surface
in an otherwise designed product: it cannot explain consequences, style the
danger action, or require typing. A small shared `<dialog>` (the codebase
already uses native dialog well for image zoom) with the consequence in plain
words and the destructive button in red closes this gap cheaply.

### 7. Login asks users to classify themselves first

`/auth/entrar` forces a Familias/Administración choice before credentials —
yet dual-role users exist and the portal already handles role switching
*after* login. Parents who tap the wrong tab get a failure they cannot
diagnose. Prefer one form: authenticate, then route by granted role (the
role-switch already exists for dual accounts). If WorkOS organization
boundaries truly require the split, label the tabs by outcome («Soy padre o
encargado» / «Soy de la Asociación») and make the Google button state which
context it continues in. Related: the email field uses
`autocomplete="username"` while registro/recuperar use `autocomplete="email"`
— unify so password managers fill consistently.

### 8. Tiny text is the visual system's weakest point

`portal.css` declares font sizes of 9–11.5 px forty times (table headers
10 px uppercase, subtext 11 px, badges 9–10 px). Contrast is fine (muted
`#5d6152` measures 5.8:1 on paper, 5.2:1 on surface — AA pass), but size is
the barrier for the actual audience: parents and grandparents on phones in
bright light. Raise the floor: body/help to 13–14 px minimum, table headers
to 11 px, and reserve 10 px strictly for non-essential labels. This single
change does more for «easier to understand» than any redesign.

---

## P2 — Path to world class

**Family dashboard (`/portal`, measured 8.3 viewports tall on mobile).**
Everything-on-one-page was right for the MVP; now it buries Comprobantes under
Mensualidades + Pagos. Keep one page (parents should never hunt), but: add the
subnav chips the admin Familias page already has (Atletas · Mensualidades ·
Pagos · Comprobantes); collapse settled history (verified/void payments and
receipts older than the current month behind «Ver meses anteriores»); remove
one of the four duplicate «Registrar pago» CTAs visible without scrolling
(header action + next-step button duplicate each other — keep the next-step
one, it has the amount); and explain the «Correo —» dash on voided receipts
with real words («Anulado: no se envía correo»). Athlete cards should be links
or have a per-athlete «Pagar» shortcut — today they look tappable (hover state)
but do nothing.

**Payment detail / review.** The admin review correctly requires an explicit
bank-check confirmation («bankChecked») before confirming — keep it, and add
the one thing treasurers need beside it: a copy button for the bank reference
(they must paste it into their banking app), plus previous/next navigation
through the review queue so clearing five payments is not five round trips to
the dashboard. On the family side, the status vocabulary (En revisión /
Necesita información / Confirmado) is good; add a simple 3-step progress
indicator (Registrado → En revisión → Confirmado) so «what happens next» is
visible without reading paragraphs.

**Receipts.** The standalone receipt page (strict CSP, role-aware back link) is
well built. Add an explicit «Imprimir / Guardar PDF» button — print CSS exists
portal-wide but nothing invites the action families most want from a receipt —
and a WhatsApp share link, since WhatsApp is already the association's channel
for everything else.

**Events.** Empty state is duplicated («No hay eventos próximos» + «No hay
eventos en Octubre» on the same screen) — show one. The calendar table is
exemplary on mobile (dot + sr text), but month navigation loses the list
position; keep «Lo que viene» pinned to upcoming regardless of the browsed
month (it already is — say so in the heading). Add «Agregar a mi calendario»
(ICS download already exists at `/api/portal/events/[id]/ics` — surface it on
the card, not only the detail page).

**Accessibility refinements.** (a) Input borders `--line-strong #b9b29c`
measure ~1.9:1 against paper — below WCAG 1.4.11's 3:1 for identifying UI
components; darken input borders specifically (fields also sit on `#fffdf7`,
nearly identical to the page). (b) Add `color-scheme: light` (absent today) so
native controls/scrollbars do not invert on dark-mode phones. (c) Evidence and
event images lack explicit `width`/`height` in a few places
(`EvidenceViewer.astro`, `eventos/[id].astro:43` hero) — minor CLS risk.
(d) `scroll-margin-top: 84px` is set — good — but verify anchored headings are
not hidden under the sticky nav at 200% zoom, which this audit did not test
with a screen reader or physical device (stated limit, same as `QA.md`).

**Design-system hygiene.** 38 inline `style="margin-top:…"` attributes have
crept into pages (mostly invitation/inscribir) — replace with two spacing
utilities before they become the de-facto system. Money renders as «₡40 500»
(space separator via es-CR) consistently — correct, but confirm the
association prefers it over «₡40.500», which is what most CR bank apps show;
consistency with the user's banking app reduces misreads. The date entry
(three selects) is defensible for locale safety, but on mobile it is three
scroll-wheels for «today» 90% of the time — add a «Hoy» quick-fill and default
transfer date to today already happens server-side; surface the same for
birth dates with a native `<input type="date">` fallback test on real Android.

**Performance & platform.** Local timings are excellent (TTFB 15 ms, ~6 KB
resource transfer on the payment page; PDF.js 476 KB loads only in evidence
views). Remaining headroom: `font-display: swap` is set, but no font preload —
acceptable given local hosting. Consider `theme-color` meta and an
installable-web-app manifest: for parents, «add to home screen» is the
difference between a bookmark they lose and an icon they tap monthly. That is
arguably the highest-leverage P2 for a monthly-payment product.

**Copy consistency passes.** «Registrar pago / Registrar un pago / Registrar
mi pago / Registrar para una familia» — four labels, one destination family;
pick one verb phrase per context. Status «En revisión» (family) vs «Pagos por
revisar» (admin) is fine. The demo banner and staging banner are clear; keep
them byte-identical in production gating. Error catalog in `Notice.astro` is
a strength — extend the same plain-language treatment to the two remaining
raw surfaces: `window.confirm` texts (see P1-6) and the English browser file
picker label («Choose File») by using a fully custom upload button (the
dropzone already exists; hide the native button text behind it).

---

## What is already world class (do not regress)

- «¿Qué hago ahora?» next-step panels that compute the user's actual state
  (balance owed, pending review, needs-info, up-to-date) on both dashboards.
- Payment-form session drafts that restore typed values *and* the already
  uploaded slip after a failed submit or accidental exit, plus unsaved-changes
  guards and duplicate-submit protection that preserves the clicked button's
  name/value (`PortalLayout.astro` script).
- Financial safety UX: allocations capped per charge with live totals,
  optimistic-concurrency snapshots that stop stale-page reviews, explicit
  bank-verification checkbox, immutable receipt snapshots, void preserves
  history.
- Mobile tables that reflow into `data-label` cards with visually-hidden
  headers retained; 44 px+ targets verified in the browser (no target under
  24 px anywhere; nearly all ≥ 44 px).
- Copy in plain Costa-Rican Spanish throughout, including error recovery
  («haz una captura de pantalla…») and honest email semantics («el correo no
  registra el pago»).
- Privacy/security chrome: `noindex`, `private, no-store`, `nosniff`,
  frame denial, same-origin mutation checks, bounded uploads with magic-byte
  type detection, CSV formula neutralization, strict CSP on receipt HTML.

## Suggested implementation order

1. **B-1 + B-2** (half a day): grant-read fails open to non-admin; fixture
   updated; amount field gets inline validation. Test suite back to green.
2. **P1-1 + P1-2** (the payment page): form first, email collapsed,
   pay-everything in one tap. Re-run the plain-UX tests + one phone pass.
3. **P1-4** overdue states + due-now vs next-month split.
4. **P1-3** error anchoring/focus + drafts for inscribir/event forms.
5. **P1-5** admin search/filter/pagination. 6. **P1-8** type floor.
   7. **P1-6/P1-7** dialogs and login simplification.
8. P2 in order of leverage: home-screen manifest, dashboard subnav +
   history collapse, receipt print/share, review-queue navigation.

*Audit limits: local demo data only (staging/production not touched); Chromium
via Playwright — no physical phone, no screen reader, no Safari/Firefox this
pass; OCR real-provider path (Groq) and live email were off/dry-run as
configured. Screenshots: `output/playwright/review-*.png`.*
