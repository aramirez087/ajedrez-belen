import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  enrollAthlete, ensureUser, getMonthlyPreview, linkGuardian, publishMonth, seedDemo, setAthletePaused,
} from "../src/lib/portal/domain";
import type { Actor } from "../src/lib/portal/types";

class SQLiteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(readFileSync(new URL("../migrations/0002_portal.sql", import.meta.url), "utf8"));
    this.sqlite.exec(readFileSync(new URL("../migrations/0004_financial_operations.sql", import.meta.url), "utf8"));
    this.sqlite.exec(readFileSync(new URL("../migrations/0006_self_registration.sql", import.meta.url), "utf8"));
    this.sqlite.exec(readFileSync(new URL("../migrations/0011_athlete_approval.sql", import.meta.url), "utf8"));
  }
  prepare(sql: string) {
    const database = this;
    let values: unknown[] = [];
    const statement = {
      bind(...args: unknown[]) { values = args; return statement; },
      async all() { return { results: database.sqlite.prepare(sql).all(...(values as never[])), success: true, meta: { changes: 0 } }; },
      async first(column?: string) {
        const row = database.sqlite.prepare(sql).get(...(values as never[])) as Record<string, unknown> | undefined;
        return column ? (row?.[column] ?? null) : (row ?? null);
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
    try { const results = statements.map((s) => s.execute()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
  db() { return this as unknown as D1Database; }
}

const admin: Actor = { id: "demo-admin", email: "admin@example.invalid", name: "Administración de prueba", isAdmin: true, mode: "demo" };
const parentA: Actor = { id: "parent-a", email: "a@example.invalid", name: "Familia A", isAdmin: false, mode: "demo" };
const parentB: Actor = { id: "parent-b", email: "b@example.invalid", name: "Familia B", isAdmin: false, mode: "demo" };

async function familyDb() {
  const adapter = new SQLiteD1();
  const db = adapter.db();
  await seedDemo(db);
  await ensureUser(db, admin);
  await ensureUser(db, parentA);
  await ensureUser(db, parentB);
  return { adapter, db };
}

test("sibling discount: 25% off the family total only when a guardian has more than one kid", async () => {
  const { db } = await familyDb();
  const kid1 = await enrollAthlete(db, admin, { name: "Hermana Uno", category: "Avanzados", feeMinor: 1500000, discountMinor: 0, startPeriod: "2027-01" });
  const kid2 = await enrollAthlete(db, admin, { name: "Hermano Dos", category: "Iniciación", feeMinor: 1200000, discountMinor: 0, startPeriod: "2027-01" });
  const solo = await enrollAthlete(db, admin, { name: "Solo Tres", category: "Avanzados", feeMinor: 1500000, discountMinor: 0, startPeriod: "2027-01" });
  await linkGuardian(db, admin, { userId: parentA.id, athleteId: kid1 });
  await linkGuardian(db, admin, { userId: parentA.id, athleteId: kid2 });
  await linkGuardian(db, admin, { userId: parentB.id, athleteId: solo });

  const preview = await getMonthlyPreview(db, "2027-02");
  const byId = new Map(preview.athletes.map((a) => [a.id, a]));
  // Family A gross 2,700,000 -> 25% off -> 2,025,000 total.
  assert.equal(byId.get(kid1)!.totalMinor, 1125000);
  assert.equal(byId.get(kid2)!.totalMinor, 900000);
  assert.equal(byId.get(solo)!.totalMinor, 1500000);

  await publishMonth(db, admin, "2027-02", preview.snapshot);
  const db2 = db as unknown as D1Database;
  void db2;
});

test("published sibling charges persist the combined discount and reason", async () => {
  const { adapter, db } = await familyDb();
  const kid1 = await enrollAthlete(db, admin, { name: "Hermana Uno", category: "Avanzados", feeMinor: 1500000, discountMinor: 0, startPeriod: "2027-01" });
  const kid2 = await enrollAthlete(db, admin, { name: "Hermano Dos", category: "Avanzados", feeMinor: 1500000, discountMinor: 0, startPeriod: "2027-01" });
  await linkGuardian(db, admin, { userId: parentA.id, athleteId: kid1 });
  await linkGuardian(db, admin, { userId: parentA.id, athleteId: kid2 });
  const preview = await getMonthlyPreview(db, "2027-02");
  await publishMonth(db, admin, "2027-02", preview.snapshot);
  const rows = adapter.sqlite.prepare(
    "SELECT discount_minor AS d, discount_reason AS r FROM charges WHERE period='2027-02' AND athlete_id IN (?,?) ORDER BY athlete_id",
  ).all(kid1, kid2) as Array<{ d: number; r: string }>;
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.d, 375000);
    assert.match(row.r, /hermanos 25%/i);
  }
});

test("a paused sibling keeps the family rate; a deactivated sibling does not", async () => {
  const { adapter, db } = await familyDb();
  const kid1 = await enrollAthlete(db, admin, { name: "Hermana Uno", category: "Avanzados", feeMinor: 1500000, discountMinor: 0, startPeriod: "2027-01" });
  const kid2 = await enrollAthlete(db, admin, { name: "Hermano Dos", category: "Avanzados", feeMinor: 1500000, discountMinor: 0, startPeriod: "2027-01" });
  await linkGuardian(db, admin, { userId: parentA.id, athleteId: kid1 });
  await linkGuardian(db, admin, { userId: parentA.id, athleteId: kid2 });
  await setAthletePaused(db, admin, kid2, true);
  const paused = await getMonthlyPreview(db, "2027-02");
  const pausedBilled = paused.athletes.find((a) => a.id === kid1);
  assert.equal(paused.athletes.some((a) => a.id === kid2), false);
  assert.equal(pausedBilled?.familySize, 2);
  assert.equal(pausedBilled?.totalMinor, 1125000);
  await setAthletePaused(db, admin, kid2, false);
  adapter.sqlite.prepare("UPDATE athletes SET active=0 WHERE id=?").run(kid2);
  const left = await getMonthlyPreview(db, "2027-02");
  const leftBilled = left.athletes.find((a) => a.id === kid1);
  assert.equal(left.athletes.some((a) => a.id === kid2), false);
  assert.equal(leftBilled?.familySize, 1);
  assert.equal(leftBilled?.totalMinor, 1500000);
});
