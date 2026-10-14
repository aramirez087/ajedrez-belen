import { validEmail } from "./receipt";
import { PortalError, type Actor } from "./types";

const iso = () => new Date().toISOString();
const id = () => crypto.randomUUID();
function fail(message: string, status = 400, code = "invalid_request"): never {
  throw new PortalError(status, message, code);
}

export interface StaffMembership {
  id: string;
  status: string;
}

/** The slice of WorkOS user management this flow calls. */
export interface StaffDirectory {
  createOrganizationMembership(options: { organizationId: string; userId: string }): Promise<unknown>;
  listOrganizationMemberships(options: {
    organizationId: string;
    userId: string;
    statuses?: Array<"active" | "inactive" | "pending">;
    limit?: number;
  }): Promise<{ data: StaffMembership[] }>;
  deactivateOrganizationMembership(organizationMembershipId: string): Promise<unknown>;
  deleteOrganizationMembership(organizationMembershipId: string): Promise<unknown>;
}

export interface AdminGrantRow {
  userId: string;
  email: string;
  name: string;
}

export interface PendingAdminInvitation {
  id: string;
  email: string;
  expiresAt: string;
}

export type AdminInvitationPreview = {
  status: "ready" | "used" | "expired" | "not_found";
  email: string | null;
  expiresAt: string | null;
};

function requireAdmin(actor: Actor): void {
  if (!actor.isAdmin) fail("Se requiere una cuenta administrativa.", 403, "forbidden");
}

/** Missing on a database that has not applied 0010 yet: treat as no grant. */
export async function hasActiveAdminGrant(db: D1Database, userId: string): Promise<boolean> {
  try {
    const row = await db.prepare(
      "SELECT 1 AS ok FROM admin_grants WHERE user_id=? AND active=1",
    ).bind(userId).first();
    return Boolean(row);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table/i.test(message)) return false;
    throw error;
  }
}

export async function listAdminAccess(db: D1Database): Promise<{
  grants: AdminGrantRow[];
  pending: PendingAdminInvitation[];
}> {
  const now = iso();
  const grants = (await db.prepare(
    `SELECT g.user_id AS userId, g.email AS email, u.name AS name
     FROM admin_grants g JOIN users u ON u.id=g.user_id
     WHERE g.active=1 ORDER BY u.name COLLATE NOCASE`,
  ).all<AdminGrantRow>()).results ?? [];
  const pending = (await db.prepare(
    `SELECT id, email, expires_at AS expiresAt FROM admin_invitations
     WHERE redeemed_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 20`,
  ).bind(now).all<PendingAdminInvitation>()).results ?? [];
  return { grants, pending };
}

export async function createAdminInvitation(
  db: D1Database,
  actor: Actor,
  input: { email: string; tokenHash: string; protectedUserIds?: readonly string[] },
): Promise<string> {
  requireAdmin(actor);
  const email = input.email.trim().toLowerCase();
  if (!validEmail(email) || email === actor.email.trim().toLowerCase() || !/^[a-f0-9]{64}$/.test(input.tokenHash)) {
    fail(email === actor.email.trim().toLowerCase()
      ? "Ya administras el portal con este correo."
      : "Invitación inválida.", email === actor.email.trim().toLowerCase() ? 409 : 400,
    email === actor.email.trim().toLowerCase() ? "already_admin" : "invalid_request");
  }
  const existing = await db.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE").bind(email).first<{ id: string }>();
  const protectedIds = new Set(input.protectedUserIds ?? []);
  if (existing && protectedIds.has(existing.id)) fail("Esa cuenta ya administra el portal.", 409, "already_admin");
  const active = existing
    ? await db.prepare("SELECT 1 AS ok FROM admin_grants WHERE user_id=? AND active=1").bind(existing.id).first()
    : null;
  if (active) fail("Esa cuenta ya administra el portal.", 409, "already_admin");
  const invitationId = id();
  const now = iso();
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  await db.batch([
    db.prepare(
      "UPDATE admin_invitations SET expires_at=created_at WHERE email=? COLLATE NOCASE AND redeemed_at IS NULL AND expires_at>?",
    ).bind(email, now),
    db.prepare(
      "INSERT INTO admin_invitations(id,token_hash,email,invited_by,expires_at,created_at) VALUES(?,?,?,?,?,?)",
    ).bind(invitationId, input.tokenHash, email, actor.id, expiresAt, now),
    db.prepare(
      "INSERT INTO audit_events(id,actor_id,entity_type,entity_id,action,detail_json,created_at) VALUES(?,?,?,?,?,?,?)",
    ).bind(id(), actor.id, "admin_invitation", invitationId, "create", JSON.stringify({ email }), now),
  ]);
  return invitationId;
}

export async function cancelAdminInvitation(db: D1Database, actor: Actor, invitationId: string): Promise<void> {
  requireAdmin(actor);
  if (!/^[0-9a-f-]{36}$/.test(invitationId)) fail("Invitación inválida.");
  const now = iso();
  const result = await db.prepare(
    "UPDATE admin_invitations SET expires_at=created_at WHERE id=? AND redeemed_at IS NULL AND expires_at>?",
  ).bind(invitationId, now).run();
  if (!result.meta.changes) fail("Esa invitación ya no está pendiente.", 404, "not_found");
  await db.prepare(
    "INSERT INTO audit_events(id,actor_id,entity_type,entity_id,action,detail_json,created_at) VALUES(?,?,?,?,?,?,?)",
  ).bind(id(), actor.id, "admin_invitation", invitationId, "cancel", "{}", now).run();
}

export async function getAdminInvitationPreview(db: D1Database, tokenHash: string): Promise<AdminInvitationPreview> {
  const invite = await db.prepare(
    "SELECT email, expires_at AS expiresAt, redeemed_at AS redeemedAt FROM admin_invitations WHERE token_hash=?",
  ).bind(tokenHash).first<{ email: string; expiresAt: string; redeemedAt: string | null }>();
  if (!invite) return { status: "not_found", email: null, expiresAt: null };
  if (invite.redeemedAt) return { status: "used", email: invite.email, expiresAt: invite.expiresAt };
  if (invite.expiresAt <= iso()) return { status: "expired", email: invite.email, expiresAt: invite.expiresAt };
  return { status: "ready", email: invite.email, expiresAt: invite.expiresAt };
}

async function readyAdminInvitation(db: D1Database, actor: Actor, tokenHash: string): Promise<{ id: string; invitedBy: string }> {
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) fail("Invitación inválida o vencida.", 403, "invitation_invalid");
  const now = iso();
  const invite = await db.prepare(
    "SELECT id, email, invited_by AS invitedBy FROM admin_invitations WHERE token_hash=? AND redeemed_at IS NULL AND expires_at>?",
  ).bind(tokenHash, now).first<{ id: string; email: string; invitedBy: string }>();
  if (!invite || invite.email.toLowerCase() !== actor.email.trim().toLowerCase()) {
    fail("Invitación inválida o vencida.", 403, "invitation_invalid");
  }
  return invite;
}

/** Record the grant. The caller adds the staff-organization membership first. */
export async function acceptAdminInvitation(db: D1Database, actor: Actor, tokenHash: string): Promise<void> {
  const invite = await readyAdminInvitation(db, actor, tokenHash);
  const now = iso();
  const redemption = id();
  const result = await db.batch([
    db.prepare(
      `UPDATE admin_invitations SET redeemed_by=?,redeemed_at=?,redemption_token=?
       WHERE id=? AND redeemed_at IS NULL AND expires_at>? AND email=? COLLATE NOCASE
       AND EXISTS(SELECT 1 FROM users WHERE id=? AND active=1 AND email=admin_invitations.email COLLATE NOCASE)`,
    ).bind(actor.id, now, redemption, invite.id, now, actor.email, actor.id),
    db.prepare(
      `INSERT INTO admin_grants(user_id,email,granted_by,active,created_at,updated_at)
       SELECT ?,email,invited_by,1,?,? FROM admin_invitations
       WHERE id=? AND redeemed_by=? AND redemption_token=?
       ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,granted_by=excluded.granted_by,active=1,updated_at=excluded.updated_at,revoked_by=NULL`,
    ).bind(actor.id, now, now, invite.id, actor.id, redemption),
    db.prepare(
      `INSERT INTO audit_events(id,actor_id,entity_type,entity_id,action,detail_json,created_at)
       SELECT ?,?,'admin_invitation',id,'redeem','{}',? FROM admin_invitations
       WHERE id=? AND redeemed_by=? AND redemption_token=?`,
    ).bind(id(), actor.id, now, invite.id, actor.id, redemption),
  ]);
  if (!result[0].meta.changes) fail("Invitación ya utilizada.", 409, "invitation_invalid");
}

/**
 * Join the staff organization, then record the grant.
 * An administrator who already has a session only consumes the link.
 * Returns `refresh` when the person must sign in again so the session
 * carries the organization (and its MFA).
 */
export async function completeAdminInvite(
  db: D1Database,
  actor: Actor,
  tokenHash: string,
  directory: StaffDirectory | null,
  organizationId: string,
): Promise<"refresh" | "ready"> {
  await readyAdminInvitation(db, actor, tokenHash);
  if (!actor.isAdmin) {
    if (!directory || !organizationId.trim()) {
      fail("El acceso de administración no está disponible en este momento.", 503, "unavailable");
    }
    await ensureStaffMembership(directory, organizationId.trim(), actor.id);
  }
  await acceptAdminInvitation(db, actor, tokenHash);
  return actor.isAdmin ? "ready" : "refresh";
}

export async function ensureStaffMembership(directory: StaffDirectory, organizationId: string, userId: string): Promise<void> {
  try {
    await directory.createOrganizationMembership({ organizationId, userId });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && (error as { status: number }).status === 409) return;
    fail("No pudimos habilitar el ingreso de administración. Vuelve a intentar en un momento.", 503, "unavailable");
  }
}

/** Drop staff-organization membership after the portal grant is already off. */
export async function releaseStaffMembership(directory: StaffDirectory, organizationId: string, userId: string): Promise<void> {
  const listed = await directory.listOrganizationMemberships({
    organizationId, userId, statuses: ["active", "pending"], limit: 10,
  });
  for (const membership of listed.data) {
    if (membership.status === "pending") await directory.deleteOrganizationMembership(membership.id);
    else if (membership.status === "active") await directory.deactivateOrganizationMembership(membership.id);
  }
}

export async function revokeAdminGrant(
  db: D1Database,
  actor: Actor,
  userId: string,
  protectedUserIds: readonly string[],
): Promise<void> {
  requireAdmin(actor);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(userId)) fail("Cuenta inválida.");
  if (protectedUserIds.includes(userId)) fail("La cuenta principal no se quita desde el portal.", 403, "forbidden");
  const now = iso();
  const result = await db.prepare(
    "UPDATE admin_grants SET active=0, revoked_by=?, updated_at=? WHERE user_id=? AND active=1",
  ).bind(actor.id, now, userId).run();
  if (!result.meta.changes) fail("Esa cuenta no es un administrador invitado.", 404, "not_found");
  await db.prepare(
    "INSERT INTO audit_events(id,actor_id,entity_type,entity_id,action,detail_json,created_at) VALUES(?,?,?,?,?,?,?)",
  ).bind(id(), actor.id, "admin_grant", userId, "revoke", "{}", now).run();
}
