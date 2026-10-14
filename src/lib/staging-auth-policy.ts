import type { APIContext } from 'astro';
import { getAuthConfigurationStatus, isSameOriginMutation, type AuthEnvironment } from './auth';

export const STAGING_AUTH_SETUP_PATH = '/auth/setup';

export interface StagingAuthEnvironment extends AuthEnvironment {
  STAGING_AUTH_SETUP?: string;
  STAGING_PORTAL_TEST?: string;
  STAGING_PARENT_TEST?: string;
  STAGING_PARENT_EMAIL?: string;
  STAGING_PARENT_USER_ID?: string;
  PORTAL_ENABLED?: string;
  PORTAL_DEMO?: string;
  PROTOTYPE_LOCAL?: string;
  EMAIL_MODE?: string;
  OCR_MODE?: string;
}

export type StagingAuthSetupGate =
  | { status: 200 }
  | { status: 404 | 403 | 405 | 503; allow?: string };

const methodsByPath = new Map([
  ['/auth/admin', ['GET', 'HEAD']],
  ['/auth/callback', ['GET', 'HEAD']],
  [STAGING_AUTH_SETUP_PATH, ['GET', 'HEAD']],
  ['/auth/logout', ['POST']],
]);

export function stagingAuthSetupRequested(environment: StagingAuthEnvironment): boolean {
  return environment.STAGING_AUTH_SETUP === 'true';
}

export function stagingPortalTestRequested(environment: StagingAuthEnvironment): boolean {
  return environment.STAGING_PORTAL_TEST === 'true';
}

/** A present but malformed staging flag must never fall through to the normal portal. */
export function restrictedModeRequested(environment: StagingAuthEnvironment): boolean {
  return environment.STAGING_AUTH_SETUP !== undefined || environment.STAGING_PORTAL_TEST !== undefined ||
    environment.STAGING_PARENT_TEST !== undefined || environment.STAGING_PARENT_EMAIL !== undefined ||
    environment.STAGING_PARENT_USER_ID !== undefined;
}

function soleAdminId(environment: StagingAuthEnvironment): string | null {
  const value = environment.ADMIN_USER_IDS;
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return /^user_[A-Za-z0-9]+$/.test(id) ? id : null;
}

function setupConfigurationValid(environment: StagingAuthEnvironment): boolean {
  const authOnly = environment.PORTAL_ENABLED === 'false' &&
    (environment.STAGING_PORTAL_TEST === undefined || environment.STAGING_PORTAL_TEST === 'false');
  const portalTest = environment.PORTAL_ENABLED === 'true' && stagingPortalTestRequested(environment);
  if (!stagingAuthSetupRequested(environment) ||
      (!authOnly && !portalTest) || environment.PORTAL_DEMO !== 'false' ||
      environment.PROTOTYPE_ENABLED !== 'false' || environment.PROTOTYPE_LOCAL !== 'false' ||
      environment.EMAIL_MODE !== 'dry_run' || environment.OCR_MODE !== 'off') return false;

  // Validate scalar bindings before calling the shared configuration validator.
  // No enumerating bindings: data stores and provider credentials are untouched.
  for (const key of ['WORKOS_API_KEY', 'WORKOS_CLIENT_ID', 'WORKOS_REDIRECT_URI',
    'WORKOS_COOKIE_PASSWORD', 'WORKOS_ORGANIZATION_ID'] as const) {
    if (typeof environment[key] !== 'string' || !environment[key]?.trim()) return false;
  }
  return /^client_[A-Za-z0-9]+$/.test(environment.WORKOS_CLIENT_ID!.trim()) &&
    /^org_[A-Za-z0-9]+$/.test(environment.WORKOS_ORGANIZATION_ID!.trim()) &&
    soleAdminId(environment) !== null && getAuthConfigurationStatus(environment).configured;
}

export interface StagingParentTestConfiguration {
  email: string;
  userId?: string;
}

/** An explicit, canonical mailbox is a second pin, never a replacement for the immutable user ID. */
export function stagingParentTestConfiguration(environment: StagingAuthEnvironment): StagingParentTestConfiguration | null {
  if (environment.STAGING_PARENT_TEST !== 'true' || !stagingPortalTestRequested(environment) ||
      !setupConfigurationValid(environment)) return null;
  const email = environment.STAGING_PARENT_EMAIL;
  if (typeof email !== 'string' || email.length > 254 || email !== email.trim().toLowerCase() ||
      !/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(email) ||
      email.slice(0, email.indexOf('@')).length > 64) return null;
  const userId = environment.STAGING_PARENT_USER_ID;
  if (userId === undefined) return { email };
  if (typeof userId !== 'string' || !/^user_[A-Za-z0-9]+$/.test(userId) || userId === soleAdminId(environment)) return null;
  return { email, userId };
}

const blockedBusinessPaths = [
  '/portal/acceso', '/portal/invitacion', '/portal/admin-invitacion',
  '/api/admin/invitations', '/api/admin/administradores',
  '/api/portal/invitations/redeem', '/api/portal/admin-invitations',
  '/api/admin/email', '/api/portal/demo',
];

function isBusinessPath(pathname: string): boolean {
  // Keep routing unambiguous before Astro handles a route or decodes an ID.
  if (pathname.includes('%') || pathname.includes('//')) return false;
  const lower = pathname.toLowerCase();
  if (blockedBusinessPaths.some(path => lower === path || lower.startsWith(`${path}/`))) return false;
  return ['/admin', '/portal', '/api/admin', '/api/portal']
    .some(path => pathname === path || pathname.startsWith(`${path}/`));
}

/** Route/origin gate only: middleware must verify the permitted actor before any business route runs. */
export function stagingAuthSetupGate(request: Request, environment: StagingAuthEnvironment): StagingAuthSetupGate {
  if (!restrictedModeRequested(environment)) return { status: 404 };
  const url = new URL(request.url);
  const methods = url.pathname === '/auth/parent' && stagingParentTestConfiguration(environment)
    ? ['GET', 'HEAD'] : methodsByPath.get(url.pathname);
  const business = stagingPortalTestRequested(environment) && isBusinessPath(url.pathname);
  if (!methods && !business) return { status: 404 };
  if (!setupConfigurationValid(environment)) return { status: 503 };
  if (methods && !methods.includes(request.method)) return { status: 405, allow: methods.join(', ') };
  if (url.origin !== new URL(environment.WORKOS_REDIRECT_URI!).origin) return { status: 403 };
  if (!isSameOriginMutation(request)) return { status: 403 };
  return { status: 200 };
}

/** Consume only identity fields populated by the validating WorkOS SDK. */
export function isStagingSetupOwner(context: Pick<APIContext, 'locals'>, environment: StagingAuthEnvironment): boolean {
  if (!setupConfigurationValid(environment)) return false;
  const auth = context.locals.auth;
  return Boolean(auth?.user && auth.user.emailVerified === true &&
    typeof auth.sessionId === 'string' && auth.sessionId.length > 0 &&
    typeof auth.accessToken === 'string' && auth.accessToken.length > 0 &&
    auth.impersonator == null && auth.user.id === soleAdminId(environment) &&
    auth.organizationId === environment.WORKOS_ORGANIZATION_ID!.trim());
}

function isVerifiedParentIdentity(context: Pick<APIContext, 'locals'>, email: string, environment: StagingAuthEnvironment): boolean {
  const auth = context.locals.auth;
  return Boolean(auth?.user && auth.user.emailVerified === true && auth.user.email === email &&
    typeof auth.user.id === 'string' && /^user_[A-Za-z0-9]+$/.test(auth.user.id) &&
    auth.user.id !== soleAdminId(environment) &&
    typeof auth.sessionId === 'string' && auth.sessionId.length > 0 &&
    typeof auth.accessToken === 'string' && auth.accessToken.length > 0 &&
    auth.impersonator == null && auth.organizationId == null);
}

/** Authorization requires a pinned immutable ID; enrollment alone cannot authorize portal access. */
export function isStagingTestParent(context: Pick<APIContext, 'locals'>, environment: StagingAuthEnvironment): boolean {
  const configuration = stagingParentTestConfiguration(environment);
  return Boolean(configuration?.userId && isVerifiedParentIdentity(context, configuration.email, environment) &&
    context.locals.auth?.user?.id === configuration.userId);
}

/** A verified bootstrap callback may report enrollment, but must discard its session. Not authorization. */
export function isStagingParentEnrollment(context: Pick<APIContext, 'locals'>, environment: StagingAuthEnvironment): boolean {
  const configuration = stagingParentTestConfiguration(environment);
  return Boolean(configuration && configuration.userId === undefined &&
    isVerifiedParentIdentity(context, configuration.email, environment));
}

/** Business routes still apply administrator roles and individual guardian links after this outer gate. */
export function isStagingPortalActor(context: Pick<APIContext, 'locals'>, environment: StagingAuthEnvironment): boolean {
  return isStagingSetupOwner(context, environment) || isStagingTestParent(context, environment);
}
