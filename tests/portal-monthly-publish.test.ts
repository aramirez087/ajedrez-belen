import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  SYSTEM_MONTHLY_ACTOR,
  billingPeriod,
  enrollAthlete,
  ensureUser,
  publishCurrentMonth,
} from "../src/lib/portal/domain";
import type { Actor } from "../src/lib/portal/types";

/** Same real-SQLite adapter pattern as portal-domain.test.ts. */
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
      async all() {
        return { results: database.sqlite.prepare(sql).all(...(values as never[])), success: true, meta: { changes: 0 } };
      },
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
    try {
      const results = statements.map((s) => s.execute());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  db() { return this as unknown as D1Database; }
}

const admin: Actor = { id: "admin-1", email: "admin@example.test", name: "Admin", isAdmin: true, mode: "workos" };

async function setup() {
  const adapter = new SQLiteD1();
  const db = adapter.db();
  await ensureUser(db, admin);
  await enrollAthlete(db, admin, { name: "Atleta Uno", category: "Cadetes", feeMinor: 1500000, discountMinor: 0, startPeriod: "2026-10" });
  return { adapter, db };
}

test("billing period flips at Costa Rica midnight, not UTC midnight", () => {
  assert.equal(billingPeriod("2026-11-01T05:59:59.000Z"), "2026-10"); // 31 oct, 23:59 CR
  assert.equal(billingPeriod("2026-11-01T06:00:00.000Z"), "2026-11"); // 1.º nov, 00:00 CR
  assert.equal(billingPeriod("2027-01-01T06:00:00.000Z"), "2027-01"); // año nuevo CR
});

test("automatic publish creates the month once, under the system actor, and repeats as a no-op", async () => {
  const { adapter, db } = await setup();
  const first = await publishCurrentMonth(db, "2026-11-01T06:00:00.000Z"); // 1.º nov 00:00 CR
  assert.deepEqual(first, { period: "2026-11", created: 1 });
  const october = await publishCurrentMonth(db, "2026-10-01T06:00:00.000Z");
  assert.deepEqual(october, { period: "2026-10", created: 1 });
  const again = await publishCurrentMonth(db, "2026-10-15T06:00:00.000Z");
  assert.deepEqual(again, { period: "2026-10", created: 0 });
  const rows = adapter.sqlite.prepare(
    "SELECT period, due_date AS dueDate, published_by AS publishedBy FROM charges ORDER BY period",
  ).all() as Array<{ period: string; dueDate: string; publishedBy: string }>;
  assert.deepEqual(rows.map((r) => r.period), ["2026-10", "2026-11"]);
  assert.ok(rows.every((r) => r.dueDate === `${r.period}-08`));
  assert.ok(rows.every((r) => r.publishedBy === SYSTEM_MONTHLY_ACTOR.id));
  const audits = adapter.sqlite.prepare(
    "SELECT count(*) AS n FROM audit_events WHERE actor_id=? AND action='publish'",
  ).get(SYSTEM_MONTHLY_ACTOR.id) as { n: number };
  assert.equal(audits.n, 2);
});
