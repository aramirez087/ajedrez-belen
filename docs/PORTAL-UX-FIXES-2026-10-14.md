# Portal UI/UX review and fixes — 14 October 2026

This pass reviewed the current application, implemented corrections, and exercised the main family, administrator, enrollment, payment, event, and authentication journeys. The earlier [review](PORTAL-UX-REVIEW-2026-10-14.md) is a historical findings inventory: several of its proposed fixes had already landed before this pass. This document records the additional work and its actual verification, without treating a source review as proof of usability or production readiness.

## Most consequential findings and fixes

| Priority | Gap found in the current app | Result |
| --- | --- | --- |
| P1 | Family guidance asked for another transfer while a pending payment still counted in the balance. | Pending-payment guidance takes precedence and explains why the balance has not changed. Voided payments no longer tell a family to transfer again without checking its current balance. |
| P1 | Choosing “Pagar todo” could overwrite the amount actually transferred, including an OCR result. | Entered amounts are preserved; untouched amounts can still follow allocations. Errors identify the field and the difference. Future-month allocations open when they contain restored values or errors. |
| P1 | OCR targeted a nonexistent single date input; changing emailed files could retain another file's reference or apply a late response. | OCR fills the actual day/month/year controls, respects manual and recovered values, clears stale references, and ignores canceled responses. |
| P1 | Shared drafts could restore recipient/action fields, attach allocations by row position, clear unrelated forms on any success notice, and lose sibling rows. | Drafts are scoped by account and form, assisted drafts by selected recipient, and allocations by stable charge input ID. Immutable hidden values stay server-owned. Dynamic sibling rows restore before their values. Only a matching successful submission clears its own draft. |
| P1 | Canceling a form submission could disable the unsaved-change warning. | The warning clears only after an uncanceled submission. Confirmation approval belongs to one attempt. |
| P1 | Admin-assisted payment errors returned to the family view, losing the selected family context. | An explicitly authorized admin context returns errors to the selected-family form and successful submissions to the admin payment detail. Context and submitted recipient must agree; nonadmins cannot use it. |
| P1 | Event confirmation could lose “Guardar borrador” and submit the publish default. | The exact submitter survives confirmation. Cancel and Escape leave the form available. New, copied, and edited event drafts have distinct identities, including after server errors. |
| P1 | Added siblings had duplicate date associations and no reliable recovery/removal. | Additional athletes have unique labels/error references, date validation, removal controls, sensible focus, and complete draft recovery. |
| P2 | Athlete cards labeled the entire balance “overdue” even when it included future months. | Cards identify the total pending balance and state the actual overdue portion separately. |
| P2 | Auth errors lacked local guidance; password confirmation required a failed server round trip; OTP entry unexpectedly submitted. | Focusable summaries and inline errors, associated password hints, distinct visibility controls, local password-confirmation validation, explicit code submission, accurate authenticator wording, and recovery links that retain the safe destination. |
| P2 | Admin searches were case/diacritic sensitive and guardian searches did not show linked athletes. | Accent-insensitive matching, linked-family results, exact amount matching, receipt status filters, and bounded pages: payments/receipts 50, athletes/families 20. Checkbox changes now wait for an explicit save. |
| P2 | Overnight events and calendar overflow links were misleading. | Calendar placement includes every occupied local date, excludes an exact-midnight ending from the following date, and exposes additional events as real links. Duplicate family calendar IDs were removed. |

## Presentation and navigation

The existing warm paper, dark green/ink, and deep red visual identity is retained. Small operational labels were raised to a 12px floor, table subtext to 13px, and help copy to 14px. Password visibility controls have a 44px target. A native expandable mobile menu replaces wrapping sticky navigation; it works with keyboard controls and without a framework. Empty action slots no longer consume header spacing.

The family payment introduction is shorter. Transfer instructions and the copy action are available in a secondary disclosure, allowing the upload task to lead. Inline help links no longer create oversized gaps within paragraphs. Payment and receipt history keep recent items visible and expose older resolved records through native disclosures; pending, information-needed, rejected, and credit-bearing payments remain visible. Duplicate dashboard payment actions and receipt-section upload instructions were removed.

The existing payment authorization, explicit bank confirmation, ledger behavior, original evidence preservation, receipt access controls, and private/no-store responses remain in place. No external messages, real transfers, auth recovery emails, deployment, or production writes were performed.

## Verification

- `npm test`: **401 passed, 0 failed**. Eighteen new behavior tests cover event confirmation/calendar boundaries, family controllers and draft recovery, and assisted-payment routing/authorization. The existing OCR quota test now freezes its clock so running near UTC midnight cannot cross its simulated daily limit.
- `npm run check`: **213 files, 0 errors, 0 warnings, 0 hints**.
- `npm run build`: **passed**. The Cloudflare build runtime needed permission to bind its local validation port; this was a local build only.
- `npm run test:portal`: **passed**, including evidence handling, revisions, approval, shared access, credit, immutable receipts, voids, and assisted recipient selection.
- `npm run test:portal:pdf`: **passed**, using synthetic documents.
- `npm run test:portal:ocr`: **passed twice consecutively**, all seven checks, with zero external provider requests. Its fixture setup now reuses unpaid demo charges before inspecting forms, recognizes legitimate empty forms, and does not reset historical data. Retries are bounded to reads and cached demo extraction; publication reads back state after a failed local response.
- Chromium: **42 route/viewport combinations** across family and administrator views at 320, 768, and 1440 pixels. All returned HTTP 200 with no horizontal overflow, duplicate IDs, unlabeled visible form fields, broken description references, or page JavaScript errors. Each had one main heading.
- Family browser interactions: impossible date on a second sibling, removal/reindexing, multi-sibling reload recovery, allocation validation, preserving the transferred amount, simulated OCR, manual-date preservation, and restoring uploaded evidence all passed. Expandable history and a real demo payment detail were checked separately.
- Admin browser interactions: keyboard navigation, selected-family draft isolation, failed-form restoration/focus, confirm/cancel/Escape, preserving draft intent, and clearing only the successful form's draft all passed. The event submission in this browser test was intercepted; route behavior has separate unit coverage. Admin reflow was also checked with 200% CSS zoom.
- WebKit **26.6**: payment, sibling enrollment, and admin menu smoke checks passed at 320 and 390 pixels with no overflow. The family dashboard also passed the 320px overflow check. Invalid dates, the Costa Rica “today” action, unique sibling IDs, removal/focus, and all seven mobile admin destinations worked. No payment or enrollment submissions were made.
- Populated calendar browser check at 320px: four synthetic events exercised overflow links, details, and ICS downloads. The overnight 23:00–01:00 event occupied both dates; 23:00–00:00 occupied only the first. A narrow-cell title-wrapping defect was fixed and rechecked. The four exact fixtures were deleted after verification; no console errors occurred.
- Auth browser interactions at 320px: empty/short password errors, mismatch correction, visibility controls, recovery destinations, and a single focused admin-access notice passed. No successful auth/reset/email submissions were made.

Screenshots and detailed browser probes are in the ignored `output/playwright/serious-review-*` and `output/playwright/ux-auth-*` files. These are local evidence, not a replacement for the committed regression tests.

## Remaining limits and release work

- Payment and receipt searches still operate on the existing 500-record fetch window; the UI now explains this and offers full-history export. Database-level search and pagination should replace that window before the association's history exceeds it. Charge overview statistics derived from the fetched charge list also retain the existing 2,000-row limit.
- This is not a claim of full WCAG conformance. Physical-device testing and an actual VoiceOver/TalkBack session remain appropriate release checks. Automated label/overflow probes and keyboard checks cover only part of accessibility.
- Real WorkOS login/recovery/MFA completion, live receipt email delivery, actual OCR-provider behavior, and cloud recovery/load testing remain the existing launch gates in [CONTINUATION-STATUS.md](CONTINUATION-STATUS.md). Demo and intercepted responses do not establish those outcomes.
- Financial records in the local demo include previous test fixtures; the screenshots are not real family data. The local Miniflare transport can occasionally return transient 500 responses; this is recorded separately from product failures.
