import { safePortalReturnPath } from './portal/invitation-entry';

/**
 * Pure helpers for the app's own Spanish sign-in UI. WorkOS still owns
 * credentials, verification codes, MFA and sessions; these helpers only
 * carry a pending second step between our pages and translate provider
 * outcomes into Spanish. No provider message is ever shown to a person.
 */

export type AuthDestino = 'familia' | 'admin';
export type PendingKind = 'email_verification' | 'radar_email' | 'mfa_totp' | 'organization';

export const PENDING_AUTH_COOKIE = 'wos-pending-auth';
export const PENDING_AUTH_MAX_AGE_SECONDS = 600;

export interface PendingOrganization { id: string; name: string }

export interface PendingAuth {
  kind: PendingKind;
  token: string;
  email: string;
  destino: AuthDestino;
  next: string | null;
  challengeId?: string;
  userId?: string;
  verificationId?: string;
  /** Sealed session held back until an app-level TOTP step passes. */
  sealedSession?: string;
  organizations?: PendingOrganization[];
}

export function parseDestino(value: string | null | undefined): AuthDestino {
  return value === 'admin' ? 'admin' : 'familia';
}

/** Where a completed sign-in lands. An invitation always wins for families. */
export function afterLoginPath(destino: AuthDestino, next: string | null | undefined, hasPendingInvitation: boolean): string {
  if (destino === 'admin') return '/admin';
  if (hasPendingInvitation) return '/portal/invitacion';
  return safePortalReturnPath(next) ?? '/portal';
}

const TOKEN_PATTERN = /^[A-Za-z0-9_\-.]{8,1024}$/;
const CHALLENGE_PATTERN = /^auth_challenge_[A-Za-z0-9]+$/;
const USER_PATTERN = /^user_[A-Za-z0-9]+$/;
const ORG_PATTERN = /^org_[A-Za-z0-9]+$/;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlToBytes(raw: string): Uint8Array {
  const base64 = raw.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function pendingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(`ajedrez-belen/pending-auth/${secret}`),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

/**
 * The pending-step cookie is HMAC-signed with the session cookie password:
 * a step can only be completed exactly as the server issued it, never with
 * a swapped destination, challenge or token.
 */
export async function encodePendingAuth(pending: PendingAuth, secret: string): Promise<string> {
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(pending)));
  const key = await pendingKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

/** Strictly decode the pending-step cookie; anything unexpected is no step. */
export async function decodePendingAuth(raw: string | null | undefined, secret: string): Promise<PendingAuth | null> {
  if (!raw || raw.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw)) return null;
  const [payload, signature] = raw.split('.');
  let value: unknown;
  try {
    const key = await pendingKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC', key, base64UrlToBytes(signature) as BufferSource, new TextEncoder().encode(payload),
    );
    if (!valid) return null;
    value = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
  } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (p.kind !== 'email_verification' && p.kind !== 'radar_email' && p.kind !== 'mfa_totp' && p.kind !== 'organization') return null;
  if (typeof p.token !== 'string' || !TOKEN_PATTERN.test(p.token)) return null;
  if (typeof p.email !== 'string' || p.email.length > 254) return null;
  if (p.destino !== 'familia' && p.destino !== 'admin') return null;
  const next = safePortalReturnPath(typeof p.next === 'string' ? p.next : null);
  const pending: PendingAuth = {
    kind: p.kind, token: p.token, email: p.email, destino: p.destino,
    next: p.destino === 'admin' ? null : next,
  };
  if (p.challengeId !== undefined) {
    if (typeof p.challengeId !== 'string' || !CHALLENGE_PATTERN.test(p.challengeId)) return null;
    pending.challengeId = p.challengeId;
  }
  if (p.userId !== undefined) {
    if (typeof p.userId !== 'string' || !USER_PATTERN.test(p.userId)) return null;
    pending.userId = p.userId;
  }
  if (p.verificationId !== undefined) {
    if (typeof p.verificationId !== 'string' || !/^email_verification_[A-Za-z0-9]+$/.test(p.verificationId)) return null;
    pending.verificationId = p.verificationId;
  }
  if (p.sealedSession !== undefined) {
    if (typeof p.sealedSession !== 'string' || p.sealedSession.length < 16 || p.sealedSession.length > 3200 ||
        /[\s\u0000-\u001f\u007f]/.test(p.sealedSession)) return null;
    if (pending.kind !== 'mfa_totp') return null;
    pending.sealedSession = p.sealedSession;
  }
  if (p.organizations !== undefined) {
    if (!Array.isArray(p.organizations) || p.organizations.length === 0 || p.organizations.length > 10) return null;
    const organizations: PendingOrganization[] = [];
    for (const entry of p.organizations) {
      if (!entry || typeof entry !== 'object') return null;
      const org = entry as Record<string, unknown>;
      if (typeof org.id !== 'string' || !ORG_PATTERN.test(org.id)) return null;
      if (typeof org.name !== 'string' || org.name.length === 0 || org.name.length > 120) return null;
      organizations.push({ id: org.id, name: org.name });
    }
    pending.organizations = organizations;
  }
  if (pending.kind === 'mfa_totp' && !pending.challengeId) return null;
  if (pending.kind === 'organization' && !pending.organizations) return null;
  return pending;
}

export interface ParsedAuthError {
  code: string | null;
  status: number | null;
  pendingToken: string | null;
  radarChallengeId: string | null;
  organizations: PendingOrganization[];
  totpFactorId: string | null;
  userId: string | null;
  email: string | null;
  verificationId: string | null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Read only the documented fields of a WorkOS authentication error. */
export function parseWorkosAuthError(error: unknown): ParsedAuthError {
  const e = record(error);
  const raw = record(e.rawData);
  const user = record(raw.user ?? e.user);
  const organizations: PendingOrganization[] = [];
  const rawOrgs = Array.isArray(raw.organizations) ? raw.organizations : [];
  for (const entry of rawOrgs.slice(0, 10)) {
    const org = record(entry);
    if (typeof org.id === 'string' && typeof org.name === 'string') organizations.push({ id: org.id, name: org.name });
  }
  let totpFactorId: string | null = null;
  const factors = Array.isArray(raw.authentication_factors) ? raw.authentication_factors : [];
  for (const entry of factors) {
    const factor = record(entry);
    if (factor.type === 'totp' && typeof factor.id === 'string') { totpFactorId = factor.id; break; }
  }
  return {
    code: text(e.code) ?? text(raw.code) ?? text(raw.error),
    status: typeof e.status === 'number' ? e.status : null,
    pendingToken: text(e.pendingAuthenticationToken) ?? text(raw.pending_authentication_token),
    radarChallengeId: text(e.radarChallengeId) ?? text(raw.radar_challenge_id),
    organizations,
    totpFactorId,
    userId: text(user.id),
    email: text(user.email) ?? text(raw.email),
    verificationId: text(raw.email_verification_id),
  };
}

export type AuthErrorContext = 'password' | 'code' | 'signup' | 'reset' | 'generic';

/** Every message a person can see, in Costa Rican Spanish. */
export function spanishAuthError(error: unknown, context: AuthErrorContext): string {
  const { code, status } = parseWorkosAuthError(error);
  if (status === 429 || code === 'rate_limit_exceeded') {
    return 'Hubo demasiados intentos seguidos. Espera unos minutos y vuelve a intentarlo.';
  }
  if (context === 'signup' && (status === 409 || code === 'email_already_exists' || code === 'user_already_exists')) {
    return 'Ya existe una cuenta con este correo. Inicia sesión con ese correo o recupera tu contraseña.';
  }
  if (context === 'signup' && (status === 422 || code === 'password_too_weak' || code === 'invalid_password')) {
    return 'La contraseña no cumple los requisitos de seguridad. Usa al menos 10 caracteres, mezclando letras y números, y evita contraseñas comunes.';
  }
  if (context === 'code') {
    return 'Ese código no es correcto o ya venció. Revisa el código más reciente e inténtalo de nuevo.';
  }
  if (context === 'password') {
    return 'El correo o la contraseña no son correctos. Revisa los datos e inténtalo de nuevo.';
  }
  if (context === 'reset') {
    return 'Este enlace ya venció o ya se usó. Pide un enlace nuevo y úsalo apenas llegue.';
  }
  return 'No pudimos completar el acceso en este momento. Espera un momento y vuelve a intentarlo; si se repite, escríbenos por WhatsApp.';
}

export function validAuthEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && value === value.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Forward the real client hints so WorkOS Radar/MFA see the actual device. */
export function clientMeta(request: Request): { ipAddress?: string; userAgent?: string } {
  const forwarded = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const userAgent = request.headers.get('user-agent');
  return {
    ...(forwarded ? { ipAddress: forwarded } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}
