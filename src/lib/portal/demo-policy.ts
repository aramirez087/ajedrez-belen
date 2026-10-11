export function allowPortalDemo(url: URL, development: boolean, env: {PORTAL_ENABLED?: string; PORTAL_DEMO?: string}) {
  return development && env.PORTAL_ENABLED === 'true' && env.PORTAL_DEMO === 'true' &&
    url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname);
}

export const demoIdentities = {
  admin: { id: 'demo-admin', email: 'admin@example.invalid', name: 'Administración de prueba', isAdmin: true, mode: 'demo' as const },
  'parent-a': { id: 'demo-parent-a', email: 'ana@example.invalid', name: 'Ana · Familia de prueba', isAdmin: false, mode: 'demo' as const },
  'parent-b': { id: 'demo-parent-b', email: 'diego@example.invalid', name: 'Diego · Segundo encargado', isAdmin: false, mode: 'demo' as const },
  unrelated: { id: 'demo-unrelated', email: 'otra@example.invalid', name: 'Otra familia de prueba', isAdmin: false, mode: 'demo' as const },
};

export function getDemoIdentity(role: string | undefined) {
  return role && Object.hasOwn(demoIdentities, role) ? demoIdentities[role as keyof typeof demoIdentities] : null;
}
