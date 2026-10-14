import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  acceptAdminInvitation, cancelAdminInvitation, completeAdminInvite, createAdminInvitation,
  ensureStaffMembership, getAdminInvitationPreview, hasActiveAdminGrant, listAdminAccess, revokeAdminGrant,
  type StaffDirectory,
} from "../src/lib/portal/admin-access";
import { hashInvitationToken } from "../src/lib/portal/routes";
import { adminInvitationWhatsAppMessage } from "../src/lib/portal/invitation-entry";
import { PortalError, type Actor } from "../src/lib/portal/types";

class SQLiteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(readFileSync(new URL("../migrations/0002_portal.sql", import.meta.url), "utf8"));
    this.sqlite.exec(readFileSync(new URL("../migrations/0010_admin_invitations.sql", import.meta.url), "utf8"));
    const now = "2026-10-13T12:00:00.000Z";
    const insert = this.sqlite.prepare(
      "INSERT INTO users(id,email,name,active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
    );
    insert.run("user_owner", "owner@example.test", "Owner", now, now);
    insert.run("user_guest", "guest@example.test", "Guest", now, now);
  }
  prepare(sql: string) {
    const database = this;
    let values: unknown[] = [];
    const statement = {
      bind(...args: unknown[]) { values = args; return statement; },
      async all() {
        return { results: database.sqlite.prepare(sql).all(...(values as never[])), success: true, meta: { changes: 0 } };
      },
      async first() {
        return database.sqlite.prepare(sql).get(...(values as never[])) ?? null;
      },
      async run() { return statement.execute(); },
      execute() {
        const result = database.sqlite.prepare(sql).run(...(values as never[]));
        return { results: [], success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      },
    };
    return statement;
  }
  async batch(statements: Array<ReturnType<SQLiteD1["prepare"]>>) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map(statement => statement.execute());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  db() { return this as unknown as D1Database; }
}

const owner: Actor = { id: "user_owner", email: "owner@example.test", name: "Owner", isAdmin: true, mode: "workos" };
const guest: Actor = { id: "user_guest", email: "guest@example.test", name: "Guest", isAdmin: false, mode: "workos" };
const stranger: Actor = { id: "user_stranger", email: "stranger@example.test", name: "Stranger", isAdmin: false, mode: "workos" };

async function invite(db: D1Database, email = "guest@example.test"): Promise<string> {
  const token = "admin-invite-token-admin-invite-token-32";
  await createAdminInvitation(db, owner, { email, tokenHash: await hashInvitationToken(token), protectedUserIds: ["user_owner"] });
  return token;
}

test("an administrator invitation grants access once, only to that email", async () => {
  const db = new SQLiteD1().db();
  const token = await invite(db);
  const hash = await hashInvitationToken(token);
  assert.equal((await getAdminInvitationPreview(db, hash)).status, "ready");
  await assert.rejects(() => acceptAdminInvitation(db, stranger, hash), (error: unknown) => error instanceof PortalError && error.code === "invitation_invalid");
  assert.equal((await getAdminInvitationPreview(db, hash)).status, "ready");
  await acceptAdminInvitation(db, guest, hash);
  assert.equal(await hasActiveAdminGrant(db, guest.id), true);
  const listed = await listAdminAccess(db);
  assert.deepEqual(listed.grants.map(grant => grant.email), ["guest@example.test"]);
  assert.equal(listed.pending.length, 0);
  assert.equal((await getAdminInvitationPreview(db, hash)).status, "used");
  await assert.rejects(() => acceptAdminInvitation(db, guest, hash), (error: unknown) => error instanceof PortalError && error.code === "invitation_invalid");
});

test("a parent cannot invite, and an active or principal account is not invited again", async () => {
  const adapter = new SQLiteD1();
  const db = adapter.db();
  const hash = await hashInvitationToken("admin-invite-token-admin-invite-token-32");
  await assert.rejects(() => createAdminInvitation(db, guest, { email: "new@example.test", tokenHash: hash }), (error: unknown) => error instanceof PortalError && error.code === "forbidden");
  await assert.rejects(() => createAdminInvitation(db, owner, { email: owner.email, tokenHash: hash }), (error: unknown) => error instanceof PortalError && error.code === "already_admin");
  adapter.sqlite.prepare("INSERT INTO users(id,email,name,active,created_at,updated_at) VALUES(?,?,?,1,?,?)")
    .run("user_principal", "principal@example.test", "Principal", "2026-10-13T12:00:00.000Z", "2026-10-13T12:00:00.000Z");
  await assert.rejects(() => createAdminInvitation(db, owner, { email: "principal@example.test", tokenHash: hash, protectedUserIds: ["user_principal"] }), (error: unknown) => error instanceof PortalError && error.code === "already_admin");
  const token = await invite(db);
  await acceptAdminInvitation(db, guest, await hashInvitationToken(token));
  const repeatHash = await hashInvitationToken("another-admin-token-another-admin-token");
  await assert.rejects(() => createAdminInvitation(db, owner, { email: guest.email, tokenHash: repeatHash }), (error: unknown) => error instanceof PortalError && error.code === "already_admin");
});

test("revoking removes the grant and a new invitation can restore it", async () => {
  const db = new SQLiteD1().db();
  const token = await invite(db);
  await acceptAdminInvitation(db, guest, await hashInvitationToken(token));
  await assert.rejects(() => revokeAdminGrant(db, owner, "user_owner", ["user_owner"]), (error: unknown) => error instanceof PortalError && error.code === "forbidden");
  await revokeAdminGrant(db, owner, guest.id, ["user_owner"]);
  assert.equal(await hasActiveAdminGrant(db, guest.id), false);
  const again = "second-admin-token-second-admin-token-32";
  await createAdminInvitation(db, owner, { email: guest.email, tokenHash: await hashInvitationToken(again), protectedUserIds: ["user_owner"] });
  await acceptAdminInvitation(db, guest, await hashInvitationToken(again));
  assert.equal(await hasActiveAdminGrant(db, guest.id), true);
});

test("cancelling a pending link leaves it unusable", async () => {
  const adapter = new SQLiteD1();
  const db = adapter.db();
  const token = await invite(db);
  const id = adapter.sqlite.prepare("SELECT id FROM admin_invitations").get() as { id: string };
  await cancelAdminInvitation(db, owner, id.id);
  assert.equal((await getAdminInvitationPreview(db, await hashInvitationToken(token))).status, "expired");
});

test("joining the staff organization treats an existing membership as success and skips it when the email does not match", async () => {
  let created = 0;
  const directory: StaffDirectory = {
    async createOrganizationMembership() { created += 1; },
    async listOrganizationMemberships() { return { data: [] }; },
    async deactivateOrganizationMembership() {},
    async deleteOrganizationMembership() {},
  };
  const conflict: StaffDirectory = {
    ...directory,
    async createOrganizationMembership() { throw { status: 409 }; },
  };
  await ensureStaffMembership(conflict, "org_test", "user_guest");
  const db = new SQLiteD1().db();
  const missingHash = await hashInvitationToken("admin-invite-token-admin-invite-token-32");
  await assert.rejects(
    () => completeAdminInvite(db, stranger, missingHash, directory, "org_test"),
    (error: unknown) => error instanceof PortalError && error.code === "invitation_invalid",
  );
  assert.equal(created, 0);
  await invite(db);
  const outcome = await completeAdminInvite(db, guest, await hashInvitationToken("admin-invite-token-admin-invite-token-32"), directory, "org_test");
  assert.equal(outcome, "refresh");
  assert.equal(created, 1);
  assert.equal(await hasActiveAdminGrant(db, guest.id), true);
});

test("the WhatsApp line for an administrator is the link itself", () => {
  const link = "https://ajedrezbelen.com/portal/admin-invitacion?token=abc";
  const message = adminInvitationWhatsAppMessage(link);
  assert.equal(message, `Tu acceso de administración en Ajedrez Belén (vence en 7 días): ${link}`);
  assert.ok(!message.includes("\n"));
});
