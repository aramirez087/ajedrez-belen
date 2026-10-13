/**
 * The app sends its own password-reset email (Brevo, same sender as the
 * receipts) so the message and the link are always in Spanish and land on
 * our own reset page. WorkOS only creates the one-time token.
 */

export interface AuthEmailEnvironment {
  EMAIL_MODE?: string;
  BREVO_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  EMAIL_TIMEOUT_MS?: string | number;
}

export type AuthEmailResult = 'sent' | 'dry_run' | 'failed';

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

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

  const url = escapeHtml(message.resetUrl);
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f7f4ec;color:#23281f;font-family:'DM Sans',Arial,sans-serif;line-height:1.65">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<p style="font-weight:700;margin:0 0 24px">Ajedrez Belén</p>
<div style="border-top:4px solid #8c302f;background:#fffdf7;border-left:1px solid #d8d3c2;border-right:1px solid #d8d3c2;border-bottom:1px solid #d8d3c2;padding:28px">
<h1 style="font-size:24px;margin:0 0 14px">Restablece tu contraseña</h1>
<p style="margin:0 0 14px">Recibimos una solicitud para restablecer la contraseña de tu cuenta del portal de Ajedrez Belén. Toca el botón para elegir una contraseña nueva:</p>
<p style="margin:22px 0"><a href="${url}" style="display:inline-block;background:#8c302f;color:#f7f4ec;padding:13px 20px;text-decoration:none;font-weight:600">Elegir contraseña nueva</a></p>
<p style="margin:0 0 14px;font-size:14px">Si el botón no funciona, copia este enlace en tu navegador:<br><span style="overflow-wrap:anywhere">${url}</span></p>
<p style="margin:0;font-size:14px">El enlace vence pronto y solo se puede usar una vez. Si no pediste este cambio, ignora este mensaje: tu contraseña sigue siendo la misma.</p>
</div>
<p style="font-size:13px;color:#5d6152;margin-top:20px">¿Necesitas ayuda? Escríbenos por WhatsApp al 8768-6102.</p>
</div></body></html>`;
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
