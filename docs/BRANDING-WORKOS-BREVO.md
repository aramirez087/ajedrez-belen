# Branding — WorkOS and Brevo (free tier)

Applied 12 October 2026. Source palette: paper `#f7f4ec`, ink `#23281f`, deep red
`#8c302f` (hover `#6e2422`), ivory `#e8e3d4`, line `#d8d3c2` — see `DESIGN.md` and
`src/styles/global.css`. Font: DM Sans (Manrope only in receipt headings).

## WorkOS — applied in both environments

Staging `environment_01M4M8D1CWTQJ4CRDMMJDKVV69` and Production
`environment_01M4M8D28MCESFP37FPY1JQEJW` had every branding field null. Both now have:

| Setting | Value |
| --- | --- |
| Display name | `Ajedrez Belén` |
| Light page background / button / button text / link | `#f7f4ec` / `#8c302f` / `#f7f4ec` / `#8c302f` |
| Dark page background / button / button text / link | `#23281f` / `#bc312e` / `#ffffff` / `#e8e3d4` |
| Theme, radius, font | `Light`, `None` (square, matches portal), `DM Sans` |
| Logo style (AuthKit + email), icon fit | `Icon`, `Contain` |
| Sign-in / sign-up headings | `Te damos la bienvenida a Ajedrez Belén` / `Creá tu cuenta de Ajedrez Belén` |

This branding covers hosted AuthKit, WorkOS transactional emails (invitation,
verification, magic auth, password reset) and the Admin Portal. Read-back verified
in both environments; billing read-back remains $0 / Pay as you go with no paid add-on.

### Spanish localization — fixed 13 October 2026

The login screen was still in English because both environments had
`defaultLocale: en-US` (localization enabled), the sign-up heading was
`Create your Ajedrez Belén account`, Staging's sign-in heading was
`Welcome to Ajedrez Belén`, and every existing user had `locale: en-US`/`en-GB`
— which also made WorkOS invitation/verification emails arrive in English
(e.g. `You've been invited to Ajedrez Belen`, `[STAGING] Verify your email address`).
Fixed in Staging and Production, read-back verified:

- `defaultLocale: es-419` (Latin-American Spanish), localization still enabled.
  This localizes all AuthKit UI labels and future WorkOS transactional emails.
- Sign-in/sign-up headings above, also pinned in Spanish for `es`, `es-419`,
  `es-ES`, `en`, `en-US` and `en-GB` so a browser set to English cannot fall
  back to an English heading.
- Existing users updated to `locale: es-419`: Production
  `user_01M4SQMQKETQMKM1254C25V224`; Staging `user_01M4MJY2GGNK2GTTH9AYRDTP78`
  and `user_01M4P8D7B09WZD8A27CB7MG72P`. Emails already sent stay English;
  no test email was sent to prove the new wording.

### One manual step remains (dashboard upload)

Logo and favicon files cannot be uploaded through the WorkOS API
(`Upload — not settable via the MCP transport`). Prepared files, all under the
100 KB limit and derived from the provisional crest, are in `assets/branding/`:

- `workos-logo.png` — 512×512, 66,992 bytes — upload as **Logo** (light and dark)
- `workos-logo-icon.png` — 512×512, 66,992 bytes — upload as **Logo icon** (light and dark)
- `workos-favicon.png` — 256×256, 20,385 bytes — upload as **Favicon** (light and dark)

Steps: WorkOS Dashboard → Branding → select Staging → upload the three files →
Save → repeat for Production (or use Copy from environment). Until then the
logo paths stay null and AuthKit shows the branded name/colors without an image.
Replace all three when the crest stops being provisional.

Update 13 October 2026: Production light logo, logo icon and favicon are now
uploaded (paths non-null on read-back). Still pending: Production dark variants
and all Staging files.

### Google sign-in in Production — disabled 13 October 2026 (broken path removed)

Symptom: portal → “login with Google” ended on a **Not found** page. Cause:
Production had `isGoogleOauthEnabled: true` but no Google OAuth credentials
(`connectionsByType: GoogleOAuth → []`). WorkOS's default Google credentials are
Staging-only; Production requires your own Google Cloud client (see
[WorkOS Google OAuth](https://workos.com/docs/integrations/google-oauth.md)).
The owner's account has `googleOauthProfile: null` and only password+MFA events;
no Google attempt ever authenticated. Fix applied: `isGoogleOauthEnabled: false`
in Production only (read-back verified; Staging unchanged, where the default
credentials work). Email/password login is unaffected.

To enable Google properly later (free, ~10 minutes, owner-only in Google Cloud):

1. WorkOS Dashboard → Production → Authentication → OAuth providers → Google →
   Manage: copy the **Redirect URI** WorkOS shows.
2. Google Cloud Console → APIs & Services → OAuth consent screen: External,
   app name `Ajedrez Belén`, support/developer email, logo
   `assets/branding/workos-logo.png`; publish the app.
3. APIs & Services → Credentials → Create OAuth client ID (Web): paste the
   WorkOS Redirect URI as an authorized redirect URI.
4. Back in the WorkOS Google dialog: paste the Google Client ID and Secret,
   enable Google, save.
5. Tell the agent “Google credentials are in” — it will read back
   `connectionsByType: GoogleOAuth` (non-empty), re-enable if needed, and verify
   a real Google sign-in links to the existing account before calling it done.
   Never paste the Google secret in chat.

Note: even with Google working, `/auth/parent` self-registration only creates
the WorkOS user; portal access still needs the guardian/athlete link in D1, and
`/auth/admin` still needs organization membership plus `ADMIN_USER_IDS`.

### Deliberately not done (paid)

- Custom AuthKit domain (`auth.ajedrezbelen.com`) — $99/month add-on. Hosted
  `*.authkit.app` domain stays.
- Custom WorkOS email domain — activates billing. WorkOS mail keeps its default
  sending domain; only its logo/name/colors above are branded.
- No privacy-policy or terms URLs were invented; none are published yet.

## Brevo — branded in code, free limits kept

Already done before this pass: domain `ajedrezbelen.com` authenticated (DKIM/DMARC)
and sender `no-reply@ajedrezbelen.com` / `Ajedrez Belén` verified. See
`docs/BREVO-SETUP.md`.

Branded now in the emails the app itself renders (transactional API, no Brevo
template): `src/lib/portal/receipt.ts` and `src/lib/receipt.ts` use the paper
background, ink text, deep-red top rule, association name and links, DM Sans with
Arial fallback and Manrope headings. No remote logo image is embedded — the
receipt tests require no `<img>` and blocked images would break the document.
The pre-login pages in `src/lib/staging-auth-view.ts` use the same palette.
Covered by the palette test in `tests/portal-receipt.test.ts`.

### Free-plan limits accepted (not paid)

- Brevo's Free plan always includes the **Sent with Brevo** sticker; removal needs
  a paid plan/add-on, so it stays. The app limit of 250 live attempts/day (below
  the 300/day free allowance) is unchanged.
- Dashboard-only, free, still to do by the owner in Brevo: Settings → company
  profile — set company name `Ajedrez Belén` and upload `assets/branding/workos-logo.png`
  as the account logo (used by any future campaign/form, not by API receipts);
  Transactional settings — confirm open/click tracking choice, since tracked
  links are rewritten through Brevo's domain. No API key was read or used here.
