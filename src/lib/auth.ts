import type { APIContext } from 'astro';
import type { AuthResult } from '@workos/authkit-session';

declare global {
  namespace App {
    interface Locals { auth?: AuthResult }
  }
}

/** Server-only bindings. Never expose these values through a status endpoint. */
export interface AuthEnvironment {
  WORKOS_API_KEY?: string;
  WORKOS_CLIENT_ID?: string;
  WORKOS_REDIRECT_URI?: string;
  WORKOS_COOKIE_PASSWORD?: string;
  WORKOS_ORGANIZATION_ID?: string;
  ADMIN_USER_IDS?: string;
  PROTOTYPE_ENABLED?: string;
}

const requiredSettings = [
  'WORKOS_API_KEY',
  'WORKOS_CLIENT_ID',
  'WORKOS_REDIRECT_URI',
  'WORKOS_COOKIE_PASSWORD',
  'WORKOS_ORGANIZATION_ID',
] as const;

export function getAuthConfigurationStatus(environment: AuthEnvironment) {
  const missing = requiredSettings.filter((name) => !environment[name]?.trim());
  const invalid: string[] = [];

  if (environment.WORKOS_COOKIE_PASSWORD && environment.WORKOS_COOKIE_PASSWORD.length < 32) {
    invalid.push('WORKOS_COOKIE_PASSWORD');
  }

  if (environment.WORKOS_REDIRECT_URI) {
    try {
      const callback = new URL(environment.WORKOS_REDIRECT_URI);
      const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(callback.hostname);
      if (
        (callback.protocol !== 'https:' && !(isLocal && callback.protocol === 'http:')) ||
        callback.pathname !== '/auth/callback' ||
        callback.username || callback.password || callback.search || callback.hash
      ) invalid.push('WORKOS_REDIRECT_URI');
    } catch {
      invalid.push('WORKOS_REDIRECT_URI');
    }
  }

  return {
    configured: missing.length === 0 && invalid.length === 0,
    adminConfigured: Boolean(environment.ADMIN_USER_IDS?.split(',').some((id) => id.trim())),
    missing,
    invalid,
  };
}

export interface Identity {
  userId: string;
  email: string;
  organizationId: string;
  isAdmin: boolean;
}

/**
 * Read only middleware-populated, SDK-verified session data. Request fields,
 * email addresses, and client-selected roles never grant administrative access.
 * Every real user of this prototype must belong to the configured association.
 */
export function getIdentity(
  context: Pick<APIContext, 'locals'>,
  environment: AuthEnvironment,
): Identity | null {
  if (!getAuthConfigurationStatus(environment).configured) return null;

  const auth = context.locals.auth;
  if (!auth?.user || !auth.sessionId || !auth.accessToken) return null;
  const organizationId = environment.WORKOS_ORGANIZATION_ID!.trim();
  if (auth.organizationId !== organizationId) return null;

  const adminUserIds = new Set(
    environment.ADMIN_USER_IDS?.split(',').map((id) => id.trim()).filter(Boolean) ?? [],
  );

  return {
    userId: auth.user.id,
    email: auth.user.email,
    organizationId,
    isAdmin: !auth.impersonator && adminUserIds.has(auth.user.id),
  };
}

/** Cookie-authenticated mutations must originate on the same origin. */
export function isSameOriginMutation(request: Request): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return true;
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return false;
  try {
    const parsed = new URL(origin);
    // The browser Origin header is exactly an origin, not a URL with a path.
    return origin === parsed.origin && parsed.origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function authUnavailableResponse(): Response {
  return new Response(
    'El inicio de sesión todavía no está configurado. Consulte docs/WORKOS-SETUP.md.',
    { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}
