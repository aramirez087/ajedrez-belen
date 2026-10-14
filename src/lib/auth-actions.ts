import type { WorkOS } from '@workos-inc/node';
import type { AuthEnvironment } from './auth';
import {
  parseWorkosAuthError, spanishAuthError, staffOrganizationChoice,
  type AuthDestino, type AuthErrorContext, type PendingAuth,
} from './auth-flow';
import { hasActiveAdminGrant } from './portal/admin-access';

/**
 * Server-side WorkOS calls behind the app's own Spanish sign-in pages.
 * Sessions are still sealed and validated by @workos/authkit-session:
 * every successful call returns a sealed session for saveSession(), so
 * middleware, refresh and logout keep working exactly as before.
 */

export type AuthOutcome =
  | { kind: 'session'; sealedSession: string; userId: string; organizationId: string | null }
  | { kind: 'pending'; pending: PendingAuth }
  | { kind: 'error'; message: string };

interface FlowContext {
  destino: AuthDestino;
  next: string | null;
  email: string;
}

type PortalAuthEnvironment = AuthEnvironment & { DB?: D1Database };

interface AuthenticatedUser {
  sealedSession?: string;
  refreshToken: string;
  organizationId?: string;
  user: { id: string; locale: string | null };
}

function sessionOptions(environment: AuthEnvironment, meta: { ipAddress?: string; userAgent?: string }) {
  return {
    clientId: environment.WORKOS_CLIENT_ID!.trim(),
    ...meta,
    session: { sealSession: true as const, cookiePassword: environment.WORKOS_COOKIE_PASSWORD! },
  };
}

async function sessionOutcome(
  client: WorkOS,
  result: { sealedSession?: string; organizationId?: string; user: { id: string; locale: string | null } },
  flow: FlowContext,
  mfaAlreadyVerified = false,
  staffOrganizationId?: string,
): Promise<AuthOutcome> {
  if (!result.sealedSession) return { kind: 'error', message: spanishAuthError(null, 'generic') };
  // Keep every future WorkOS email (verification, invitations) in Spanish,
  // even for accounts created before this UI existed.
  if (result.user.locale !== 'es-419') {
    try { await client.userManagement.updateUser({ userId: result.user.id, locale: 'es-419' }); } catch { /* best effort */ }
  }
  // Hosted AuthKit always challenged a TOTP-enrolled person; the API only
  // does so when the environment/organization requires MFA. Hold the sealed
  // session back until one code passes so this UI never weakens that.
  // A staff session with no authenticator at all does not open: attaching
  // the organization by refresh does not replace that enrollment.
  const staffOrg = staffOrganizationId?.trim() ?? '';
  if (!mfaAlreadyVerified) {
    try {
      const factors = await client.multiFactorAuth.listUserAuthFactors({ userId: result.user.id });
      const totp = factors.data.find((factor) => factor.type === 'totp');
      if (totp) {
        const challenge = await client.multiFactorAuth.challengeFactor({ authenticationFactorId: totp.id });
        return { kind: 'pending', pending: {
          kind: 'mfa_totp', token: 'app-mfa-step', challengeId: challenge.id,
          sealedSession: result.sealedSession, userId: result.user.id,
          email: flow.email, destino: flow.destino, next: flow.next,
          ...(result.organizationId ? { organizationId: result.organizationId } : {}),
        } };
      }
      if (staffOrg && result.organizationId === staffOrg) {
        return { kind: 'error', message: 'Tu cuenta necesita configurar la verificación en dos pasos antes de entrar. Escríbenos por WhatsApp y te ayudamos a activarla.' };
      }
    } catch { /* WorkOS enforcement still applies; never lock everyone out on a lookup failure. */ }
  }
  return {
    kind: 'session', sealedSession: result.sealedSession,
    userId: result.user.id, organizationId: result.organizationId ?? null,
  };
}

/**
 * A staff member who signed in without an organization still needs that
 * organization's session, because administration and its MFA live there.
 * Everyone else keeps the user session. A directory or refresh failure
 * keeps the user session too, so a family is never locked out of the portal.
 */
async function withStaffOrganization(
  client: WorkOS,
  environment: PortalAuthEnvironment,
  result: AuthenticatedUser,
  meta: { ipAddress?: string; userAgent?: string },
): Promise<AuthenticatedUser> {
  const associationId = environment.WORKOS_ORGANIZATION_ID?.trim() ?? '';
  if (!associationId || result.organizationId === associationId) return result;
  const allowlist = new Set(environment.ADMIN_USER_IDS?.split(',').map((id) => id.trim()).filter(Boolean) ?? []);
  let candidate = allowlist.has(result.user.id);
  if (!candidate && environment.DB) {
    try { candidate = await hasActiveAdminGrant(environment.DB, result.user.id); } catch { candidate = false; }
  }
  if (!candidate) return result;
  try {
    const listed = await client.userManagement.listOrganizationMemberships({
      organizationId: associationId, userId: result.user.id, statuses: ['active'], limit: 1,
    });
    if (listed.data.length === 0) return result;
    return await client.userManagement.authenticateWithRefreshToken({
      refreshToken: result.refreshToken, organizationId: associationId,
      ...sessionOptions(environment, meta),
    });
  } catch (error) {
    const parsed = parseWorkosAuthError(error);
    // MFA and other real authentication steps must surface. A directory
    // miss or a refresh the session cannot complete leaves the family session.
    if (parsed.code) throw error;
    return result;
  }
}

async function finishAuthentication(
  client: WorkOS,
  environment: PortalAuthEnvironment,
  result: AuthenticatedUser,
  flow: FlowContext,
  meta: { ipAddress?: string; userAgent?: string },
  mfaAlreadyVerified = false,
): Promise<AuthOutcome> {
  try {
    const bound = await withStaffOrganization(client, environment, result, meta);
    return sessionOutcome(client, bound, flow, mfaAlreadyVerified, environment.WORKOS_ORGANIZATION_ID);
  } catch (error) {
    return pendingOutcome(client, error, flow, 'generic');
  }
}

/** When WorkOS asks which organization, continue straight into the staff one. */
async function continueStaffOrganization(
  client: WorkOS,
  environment: AuthEnvironment,
  outcome: AuthOutcome,
  meta: { ipAddress?: string; userAgent?: string },
): Promise<AuthOutcome> {
  if (outcome.kind !== 'pending' || outcome.pending.kind !== 'organization') return outcome;
  const associationId = staffOrganizationChoice(outcome.pending.organizations, environment.WORKOS_ORGANIZATION_ID);
  if (!associationId) return outcome;
  return selectOrganization(client, environment, outcome.pending, associationId, meta);
}

/** Translate a thrown provider outcome into the next Spanish step. */
async function pendingOutcome(client: WorkOS, error: unknown, flow: FlowContext, context: AuthErrorContext): Promise<AuthOutcome> {
  const parsed = parseWorkosAuthError(error);
  if (parsed.pendingToken && parsed.code === 'email_verification_required') {
    return { kind: 'pending', pending: {
      kind: 'email_verification', token: parsed.pendingToken,
      email: parsed.email ?? flow.email, destino: flow.destino, next: flow.next,
      ...(parsed.userId ? { userId: parsed.userId } : {}),
      ...(parsed.verificationId ? { verificationId: parsed.verificationId } : {}),
    } };
  }
  if (parsed.pendingToken && parsed.code === 'radar_email_challenge' && parsed.radarChallengeId) {
    return { kind: 'pending', pending: {
      kind: 'radar_email', token: parsed.pendingToken, challengeId: parsed.radarChallengeId,
      email: parsed.email ?? flow.email, destino: flow.destino, next: flow.next,
      ...(parsed.userId ? { userId: parsed.userId } : {}),
    } };
  }
  if (parsed.pendingToken && parsed.code === 'mfa_challenge' && parsed.totpFactorId) {
    try {
      const challenge = await client.multiFactorAuth.challengeFactor({ authenticationFactorId: parsed.totpFactorId });
      return { kind: 'pending', pending: {
        kind: 'mfa_totp', token: parsed.pendingToken, challengeId: challenge.id,
        email: parsed.email ?? flow.email, destino: flow.destino, next: flow.next,
        ...(parsed.userId ? { userId: parsed.userId } : {}),
      } };
    } catch { /* fall through to the generic message */ }
  }
  if (parsed.pendingToken && parsed.code === 'organization_selection_required' && parsed.organizations.length > 0) {
    return { kind: 'pending', pending: {
      kind: 'organization', token: parsed.pendingToken,
      email: parsed.email ?? flow.email, destino: flow.destino, next: flow.next,
      organizations: parsed.organizations,
      ...(parsed.userId ? { userId: parsed.userId } : {}),
    } };
  }
  if (parsed.code === 'mfa_enrollment') {
    return { kind: 'error', message: 'Tu cuenta necesita configurar la verificación en dos pasos antes de entrar. Escríbenos por WhatsApp y te ayudamos a activarla.' };
  }
  if (parsed.code === 'sso_required') {
    return { kind: 'error', message: 'Este correo entra con el sistema de su organización, no con contraseña. Escríbenos por WhatsApp si necesitas ayuda.' };
  }
  if (parsed.code === 'radar_sms_challenge') {
    return { kind: 'error', message: 'Por seguridad necesitamos una verificación adicional para tu cuenta. Escríbenos por WhatsApp y te ayudamos a entrar.' };
  }
  return { kind: 'error', message: spanishAuthError(error, context) };
}

export async function signInWithPassword(
  client: WorkOS, environment: PortalAuthEnvironment,
  input: { email: string; password: string } & FlowContext & { meta: { ipAddress?: string; userAgent?: string } },
): Promise<AuthOutcome> {
  try {
    const result = await client.userManagement.authenticateWithPassword({
      email: input.email, password: input.password,
      ...sessionOptions(environment, input.meta),
    });
    return finishAuthentication(client, environment, result, input, input.meta);
  } catch (error) {
    const outcome = await pendingOutcome(client, error, input, 'password');
    return continueStaffOrganization(client, environment, outcome, input.meta);
  }
}

export async function completeWithCode(
  client: WorkOS, environment: PortalAuthEnvironment,
  pending: PendingAuth, code: string, meta: { ipAddress?: string; userAgent?: string },
): Promise<AuthOutcome> {
  const flow: FlowContext = { destino: pending.destino, next: pending.next, email: pending.email };
  // App-level TOTP step: the sealed session is only released by a valid code.
  // The staff organization, when one was bound, was stored with that session.
  if (pending.sealedSession) {
    try {
      const verified = await client.multiFactorAuth.verifyChallenge({
        authenticationChallengeId: pending.challengeId!, code,
      });
      if (!verified.valid) return { kind: 'error', message: spanishAuthError(null, 'code') };
      return {
        kind: 'session', sealedSession: pending.sealedSession,
        userId: pending.userId ?? '', organizationId: pending.organizationId ?? null,
      };
    } catch (error) {
      return { kind: 'error', message: spanishAuthError(error, 'code') };
    }
  }
  try {
    const options = sessionOptions(environment, meta);
    const result = pending.kind === 'email_verification'
      ? await client.userManagement.authenticateWithEmailVerification({ code, pendingAuthenticationToken: pending.token, ...options })
      : pending.kind === 'radar_email'
        ? await client.userManagement.authenticateWithRadarEmailChallenge({ code, radarChallengeId: pending.challengeId!, pendingAuthenticationToken: pending.token, ...options })
        : await client.userManagement.authenticateWithTotp({ code, authenticationChallengeId: pending.challengeId!, pendingAuthenticationToken: pending.token, ...options });
    return finishAuthentication(client, environment, result, flow, meta, pending.kind === 'mfa_totp');
  } catch (error) {
    const outcome = await pendingOutcome(client, error, flow, 'code');
    return continueStaffOrganization(client, environment, outcome, meta);
  }
}

/**
 * Finish "Continuar con Google": exchange the authorization code from the
 * callback for the same sealed session the password flow produces, so MFA
 * checks, locale pinning and session handling stay identical.
 */
export async function signInWithGoogleCode(
  client: WorkOS, environment: PortalAuthEnvironment,
  input: { code: string; codeVerifier: string } & FlowContext & { meta: { ipAddress?: string; userAgent?: string } },
): Promise<AuthOutcome> {
  try {
    const result = await client.userManagement.authenticateWithCode({
      code: input.code, codeVerifier: input.codeVerifier,
      ...sessionOptions(environment, input.meta),
    });
    return finishAuthentication(client, environment, result, { ...input, email: result.user.email }, input.meta);
  } catch (error) {
    const outcome = await pendingOutcome(client, error, input, 'generic');
    return continueStaffOrganization(client, environment, outcome, input.meta);
  }
}

export async function selectOrganization(
  client: WorkOS, environment: PortalAuthEnvironment,
  pending: PendingAuth, organizationId: string, meta: { ipAddress?: string; userAgent?: string },
): Promise<AuthOutcome> {
  const flow: FlowContext = { destino: pending.destino, next: pending.next, email: pending.email };
  try {
    const result = await client.userManagement.authenticateWithOrganizationSelection({
      organizationId, pendingAuthenticationToken: pending.token, ...sessionOptions(environment, meta),
    });
    return finishAuthentication(client, environment, result, flow, meta);
  } catch (error) {
    return pendingOutcome(client, error, flow, 'code');
  }
}

export async function registerWithPassword(
  client: WorkOS, environment: PortalAuthEnvironment,
  input: { firstName: string; lastName: string; email: string; password: string } & FlowContext & { meta: { ipAddress?: string; userAgent?: string } },
): Promise<AuthOutcome> {
  let userId: string;
  try {
    const created = await client.userManagement.createUser({
      email: input.email, password: input.password,
      firstName: input.firstName, ...(input.lastName ? { lastName: input.lastName } : {}), ...input.meta,
    });
    userId = created.id;
  } catch (error) {
    return { kind: 'error', message: spanishAuthError(error, 'signup') };
  }
  // Pin the locale before any verification email is triggered.
  try { await client.userManagement.updateUser({ userId, locale: 'es-419' }); } catch { /* best effort */ }
  const outcome = await signInWithPassword(client, environment, input);
  // Carry the new user id so the code step can offer "send a new code".
  if (outcome.kind === 'pending' && outcome.pending.kind === 'email_verification' && !outcome.pending.userId) {
    outcome.pending.userId = userId;
  }
  return outcome;
}

export async function resendVerificationCode(client: WorkOS, pending: PendingAuth): Promise<boolean> {
  try {
    let userId = pending.userId;
    if (!userId) {
      const users = await client.userManagement.listUsers({ email: pending.email, limit: 1 });
      userId = users.data[0]?.id;
    }
    if (!userId) return false;
    await client.userManagement.sendVerificationEmail({ userId });
    return true;
  } catch { return false; }
}

export interface PasswordResetRequest { token: string; expiresAt: string; email: string }

/** Create a reset token. The app emails the link itself, in Spanish. */
export async function createPasswordReset(client: WorkOS, email: string): Promise<PasswordResetRequest | null> {
  try {
    const reset = await client.userManagement.createPasswordReset({ email });
    return { token: reset.passwordResetToken, expiresAt: reset.expiresAt, email: reset.email };
  } catch { return null; }
}

export async function completePasswordReset(client: WorkOS, token: string, newPassword: string): Promise<{ ok: boolean; message: string }> {
  try {
    await client.userManagement.resetPassword({ token, newPassword });
    return { ok: true, message: '' };
  } catch (error) {
    const { status } = parseWorkosAuthError(error);
    if (status === 422) {
      return { ok: false, message: 'La contraseña nueva no cumple los requisitos de seguridad. Usa al menos 10 caracteres, mezclando letras y números.' };
    }
    return { ok: false, message: spanishAuthError(error, 'reset') };
  }
}
