const styles = `
  :root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #292521; background: #f5f1e8; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; min-height: 100svh; display: grid; place-items: center; padding: 24px; line-height: 1.65; }
  main { width: 100%; max-width: 580px; padding: clamp(24px, 6vw, 48px); border: 1px solid #d7cfc1; border-top: 4px solid #a32930; background: #fffcf5; }
  .brand { margin: 0 0 36px; font-size: 15px; font-weight: 650; letter-spacing: -.02em; }
  .eyebrow { margin: 0 0 12px; color: #a32930; font-size: 11px; font-weight: 650; letter-spacing: .12em; text-transform: uppercase; }
  h1 { margin: 0; font-size: clamp(30px, 6vw, 42px); font-weight: 550; line-height: 1.12; letter-spacing: -.04em; overflow-wrap: anywhere; }
  p { margin: 20px 0 0; font-size: 16px; }
  .scope { margin-top: 26px; padding-top: 20px; border-top: 1px solid #d7cfc1; color: #645c54; font-size: 14px; }
  form { margin: 28px 0 0; }
  .action { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; max-width: 100%; margin-top: 28px; padding: 12px 20px; border: 1px solid #a32930; border-radius: 0; background: #a32930; color: #fffdf7; font: inherit; font-size: 16px; font-weight: 600; line-height: 1.5; text-align: center; text-decoration: none; cursor: pointer; touch-action: manipulation; }
  form .action { margin-top: 0; }
  .action:hover { background: #842129; border-color: #842129; }
  .action:focus-visible { outline: 3px solid #a32930; outline-offset: 4px; }
  @media (max-width: 380px) { body { padding: 16px; } .action { width: 100%; } }
`;

function page(title: string, content: string, status = 200): Response {
  return new Response(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>${title} · Ajedrez Belén</title>
    <style>${styles}</style>
  </head>
  <body>
    <main aria-labelledby="page-title">
      <p class="brand">Ajedrez Belén</p>
      <p class="eyebrow">Prueba de acceso</p>
      <h1 id="page-title">${title}</h1>
      ${content}
    </main>
  </body>
</html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export function stagingAuthSetupPage(verified: boolean, portalTest = false): Response {
  if (verified) {
    return page('Inicio de sesión verificado', `
      <p>La cuenta autorizada para esta prueba completó el inicio de sesión.</p>
      ${portalTest ? '<p class="scope">Prueba privada con datos ficticios. No realicés transferencias. Los correos se simulan y la lectura automática está desactivada.</p><a class="action" href="/admin">Abrir administración de prueba</a>' : '<p class="scope">El portal de pagos continúa deshabilitado. Esta prueba no consulta ni modifica datos de pagos.</p>'}
      <form method="post" action="/auth/logout">
        <button class="action" type="submit">Cerrar sesión</button>
      </form>
    `);
  }

  return page('Verificación de acceso', `
    <p>Comprobá el inicio de sesión con la cuenta autorizada para esta prueba.</p>
    <p class="scope">${portalTest ? 'Prueba privada para la cuenta autorizada. Solo datos ficticios; no realicés transferencias.' : 'El portal de pagos continúa deshabilitado. Esta prueba solo verifica el acceso; no consulta ni modifica datos de pagos.'}</p>
    <a class="action" href="/auth/admin">Iniciar sesión</a>
  `);
}

export function stagingAuthDeniedPage(): Response {
  return page('Acceso no autorizado', `
    <p>Esta cuenta no tiene acceso a esta prueba.</p>
    <p class="scope">El acceso está reservado a la cuenta autorizada.</p>
    <a class="action" href="/auth/admin">Volver a intentar</a>
  `, 403);
}

export function stagingAuthFailedPage(parentTest = false): Response {
  return page('No fue posible iniciar sesión', `
    <p>Iniciá un nuevo intento desde el acceso que corresponde a tu cuenta.</p>
    <p class="scope">Si cambiaste de cuenta o cerraste sesión, usá uno de estos accesos. No recargués esta página ni reutilicés una pestaña anterior de inicio de sesión.</p>
    <nav aria-label="Reiniciar el inicio de sesión">
      <a class="action" href="/auth/admin" referrerpolicy="no-referrer">Ingresar como administración</a>
      ${parentTest ? '<a class="action" href="/auth/parent" referrerpolicy="no-referrer">Ingresar como familia</a>' : ''}
    </nav>
  `, 400);
}

export function stagingParentEnrollmentPage(): Response {
  return page('Registro de prueba recibido', `
    <p>La verificación terminó. El acceso al portal sigue cerrado hasta que se autorice esta cuenta.</p>
    <p class="scope">Esperá la confirmación antes de volver a iniciar sesión. Esta prueba utiliza solamente datos ficticios.</p>
    <a class="action" href="/auth/parent">Continuar después de la confirmación</a>
  `, 403);
}
