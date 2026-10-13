/** Authentication failures may be plain text; classify them before parsing JSON. */
export async function readSlipResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) throw new Error('session_expired');
  if (response.status === 403) throw new Error('access_denied');
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error('operation_failed'); }
  if (!response.ok) {
    const code = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error : 'operation_failed';
    throw new Error(code);
  }
  return body as T;
}

export function slipAuthRecovery(code: string, restricted: boolean, parentTest = false): { message: string; href: string; label: string } | null {
  if (code !== 'session_expired' && code !== 'access_denied') return null;
  return {
    message: code === 'session_expired'
      ? 'Tu sesión venció o ya no está activa. Inicia sesión de nuevo. Conservamos el archivo y los datos en esta pestaña.'
      : 'Tu cuenta no tiene permiso para esta acción. Revisa tu acceso o consulta a la Asociación. Conservamos el archivo y los datos en esta pestaña.',
    href: restricted ? (parentTest ? '/auth/parent' : '/auth/admin') : '/portal/acceso',
    label: code === 'session_expired' ? 'Iniciar sesión en otra pestaña' : 'Revisar acceso en otra pestaña',
  };
}
