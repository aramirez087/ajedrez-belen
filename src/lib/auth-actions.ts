import type { WorkOS } from '@workos-inc/node';
import type { AuthEnvironment } from './auth';
import {
  parseWorkosAuthError, spanishAuthError,
  type AuthDestino, type AuthErrorContext, type PendingAuth,
} from './auth-flow';

/**
 * Server-side WorkOS calls behind the app's own Spanish sign-in pages.
 * Sessions are still sealed and validated by @workos/authkit-session:
 * every successful call returns a sealed session for saveSession(), so
 * middleware, refresh and logout keep working exactly as before.
 */

export type AuthOutcome =
  | { kind: 'session'; sealedSession: string }
  | { kind: 'pending'; pending: PendingAuth }
  | { kind: 'error'; message: string };

interface FlowContext {
  destino: AuthDestino;
  next: string | null;
  email: string;
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
  result: { sealedSession?: string; user: { id: string; locale: string | null } },
  flow: FlowContext,
  mfaAlreadyVerified = false,
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
        } };
      }
    } catch { /* WorkOS enforcement still applies; never lock everyone out on a lookup failure. */ }
  }
  return { kind: 'session', sealedSession: result.sealedSession };
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
  client: WorkOS, environment: AuthEnvironment,
  input: { email: string; password: string } & FlowContext & { meta: { ipAddress?: string; userAgent?: string } },
): Promise<AuthOutcome> {
  try {
    const result = await client.userManagement.authenticateWithPassword({
      email: input.email, password: input.password,
      ...sessionOptions(environment, input.meta),
    });
    return sessionOutcome(client, result, input);
  } catch (error) {
    // Administration may be able to skip the organization chooser at once.
    const outcome = await pendingOutcome(client, error, input, 'password');
    if (outcome.kind === 'pending' && outcome.pending.kind === 'organization' && input.destino === 'admin') {
      const associationId = environment.WORKOS_ORGANIZATION_ID!.trim();
      if (outcome.pending.organizations?.some(org => org.id === associationId)) {
        return selectOrganization(client, environment, outcome.pending, associationId, input.meta);
      }
    }
    return outcome;
  }
}

export async function completeWithCode(
  client: WorkOS, environment: AuthEnvironment,
  pending: PendingAuth, code: string, meta: { ipAddress?: string; userAgent?: string },
): Promise<AuthOutcome> {
  const flow: FlowContext = { destino: pending.destino, next: pending.next, email: pending.email };
  // App-level TOTP step: the sealed session is only released by a valid code.
  if (pending.sealedSession) {
    try {
      const verified = await client.multiFactorAuth.verifyChallenge({
        authenticationChallengeId: pending.challengeId!, code,
      });
      if (!verified.valid) return { kind: 'error', message: spanishAuthError(null, 'code') };
      return { kind: 'session', sealedSession: pending.sealedSession };
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
    return sessionOutcome(client, result, flow, pending.kind === 'mfa_totp');
  } catch (error) {
    return pendingOutcome(client, error, flow, 'code');
  }
}

/**
 * Finish "Continuar con Google": exchange the authorization code from the
 * callback for the same sealed session the password flow produces, so MFA
 * checks, locale pinning and session handling stay identical.
 */
export async function signInWithGoogleCode(
  client: WorkOS, environment: AuthEnvironment,
  input: { code: string; codeVerifier: string } & FlowContext & { meta: { ipAddress?: string; userAgent?: string } },
): Promise<AuthOutcome> {
  try {
    const result = await client.userManagement.authenticateWithCode({
      code: input.code, codeVerifier: input.codeVerifier,
      ...sessionOptions(environment, input.meta),
    });
    return sessionOutcome(client, result, { ...input, email: result.user.email });
  } catch (error) {
    return pendingOutcome(client, error, input, 'generic');
  }
}

export async function selectOrganization(
  client: WorkOS, environment: AuthEnvironment,
  pending: PendingAuth, organizationId: string, meta: { ipAddress?: string; userAgent?: string },
): Promise<AuthOutcome> {
  const flow: FlowContext = { destino: pending.destino, next: pending.next, email: pending.email };
  try {
    const result = await client.userManagement.authenticateWithOrganizationSelection({
      organizationId, pendingAuthenticationToken: pending.token, ...sessionOptions(environment, meta),
    });
    return sessionOutcome(client, result, flow);
  } catch (error) {
    return pendingOutcome(client, error, flow, 'code');
  }
}

export async function registerWithPassword(
  client: WorkOS, environment: AuthEnvironment,
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
