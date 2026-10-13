/** Entry helpers for people arriving from a shared link (usually WhatsApp). */

export const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/**
 * Where a family member was headed before being sent to sign in. Only plain
 * family-portal pathnames survive; anything else (external sites, admin,
 * the sign-in page itself, traversal tricks) becomes null so the caller
 * falls back to /portal.
 */
export function safePortalReturnPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return null;
  if (!value.startsWith('/portal') || value.startsWith('//')) return null;
  if (/[\\?#\u0000-\u001f\u007f]/.test(value)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return null; }
  if (decoded !== value && /[\\?#\u0000-\u001f\u007f]/.test(decoded)) return null;
  const segments = decoded.split('/');
  if (segments.some(segment => segment === '..' || segment === '.')) return null;
  if (decoded !== '/portal' && !decoded.startsWith('/portal/')) return null;
  if (decoded === '/portal/acceso' || decoded.startsWith('/portal/acceso/')) return null;
  return value;
}

/**
 * Accepts what a person can actually paste: the bare code, the full
 * invitation link, or a WhatsApp message that contains the link.
 */
export function extractInvitationToken(input: string): string | null {
  const text = input.trim();
  if (INVITATION_TOKEN_PATTERN.test(text)) return text;
  const fromLink = text.match(/[?&]token=([A-Za-z0-9_-]{32,128})(?![A-Za-z0-9_-])/);
  return fromLink ? fromLink[1] : null;
}

/**
 * The whole WhatsApp message. The link does the talking: tapping it is the
 * only instruction anyone needs, so there are no instructions to read.
 */
export function invitationWhatsAppMessage(link: string): string {
  return `Tu acceso a Ajedrez Belén (vence en 7 días): ${link}`;
}

/** Opens WhatsApp's share picker with the invitation message ready to send. */
export function invitationWhatsAppUrl(link: string): string {
  return `https://wa.me/?text=${encodeURIComponent(invitationWhatsAppMessage(link))}`;
}

/** Where a person lands the moment their invitation is accepted. */
export function invitationDestination(kind: 'link' | 'register' | null | undefined): string {
  return kind === 'register' ? '/portal/inscribir' : '/portal';
}

/** Notice shown on that landing. A new account still has to enroll an athlete. */
export function invitationRedeemNotice(kind: 'link' | 'register' | null | undefined): string {
  return kind === 'register' ? 'register_athlete' : 'invitation_redeemed';
}

/**
 * Registration asks for one "Nombre completo" field; the identity provider
 * wants it split. First word(s) are the given name, the rest the surnames.
 */
export function splitFullName(fullName: string): { firstName: string; lastName: string } | null {
  const words = fullName.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (words.length === 0) return null;
  if (words.length === 1) return { firstName: words[0], lastName: '' };
  return { firstName: words[0], lastName: words.slice(1).join(' ') };
}
