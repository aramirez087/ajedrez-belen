/**
 * The app sends its own password-reset email (Brevo, same sender as the
 * receipts) so the message and the link are always in Spanish and land on
 * our own reset page. WorkOS only creates the one-time token.
 */

import { emailButton, emailNote, emailParagraph, emailShell, escapeEmailHtml } from './email-layout';

export interface AuthEmailEnvironment {
  EMAIL_MODE?: string;
  BREVO_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  EMAIL_TIMEOUT_MS?: string | number;
}

export type AuthEmailResult = 'sent' | 'dry_run' | 'failed';

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function sendPasswordResetEmail(
  environment: AuthEmailEnvironment,
  message: { to: string; resetUrl: string },
  fetcher: Fetcher = fetch,
): Promise<AuthEmailResult> {
  if (environment.EMAIL_MODE !== 'live') return 'dry_run';
  const apiKey = environment.BREVO_API_KEY?.trim();
  const from = environment.EMAIL_FROM?.trim();
  const fromName = environment.EMAIL_FROM_NAME?.trim();
  if (!apiKey || !from || !fromName) return 'failed';
  const timeoutMs = Number(environment.EMAIL_TIMEOUT_MS ?? 10_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30_000) return 'failed';

  const html = emailShell({
    headline: 'Restablece tu contraseña',
    preheader: 'Elige una contraseña nueva para tu cuenta del portal.',
    body: [
      emailParagraph('Recibimos una solicitud para restablecer la contraseña de tu cuenta del portal de Ajedrez Belén. Toca el botón para elegir una contraseña nueva:'),
      emailButton('Elegir contraseña nueva', message.resetUrl),
      emailNote('Si el botón no funciona, copia este enlace en tu navegador:'),
      `<p style="margin:4px 0 16px;font-size:13px;line-height:1.5;overflow-wrap:anywhere;word-break:break-word">${escapeEmailHtml(message.resetUrl)}</p>`,
      emailParagraph('El enlace vence pronto y solo se puede usar una vez. Si no pediste este cambio, ignora este mensaje: tu contraseña sigue siendo la misma.'),
    ].join('\n'),
  });
  const text = `Ajedrez Belén\n\nRecibimos una solicitud para restablecer la contraseña de tu cuenta del portal. Abre este enlace para elegir una contraseña nueva:\n\n${message.resetUrl}\n\nEl enlace vence pronto y solo se puede usar una vez. Si no pediste este cambio, ignora este mensaje.\n\n¿Necesitas ayuda? WhatsApp 8768-6102.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: from, name: fromName },
        to: [{ email: message.to }],
        subject: 'Restablece tu contraseña · Ajedrez Belén',
        htmlContent: html,
        textContent: text,
      }),
    });
    return response.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  } finally {
    clearTimeout(timeout);
  }
}
