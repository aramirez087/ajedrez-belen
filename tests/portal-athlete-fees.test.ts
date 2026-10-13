import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { feeForCategory, ATHLETE_CATEGORIES, enrollAthlete, getAdminDashboard, getFeeSchedule, getMonthlyPreview, seedDemo, updateFeeSchedule } from "../src/lib/portal/domain";
import { athleteFromForm, formDate, formPeriod } from "../src/lib/portal/forms";
import type { Actor } from "../src/lib/portal/types";

class SQLiteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    for (const file of ["0002_portal.sql", "0004_financial_operations.sql", "0006_self_registration.sql", "0007_fee_schedule.sql"])
      this.sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  prepare(sql: string) {
    const database = this; let values: unknown[] = [];
    const statement = {
      bind(...args: unknown[]) { values = args; return statement; },
      async all() { return { results: database.sqlite.prepare(sql).all(...(values as never[])), success: true, meta: { changes: 0 } }; },
      async first(column?: string) { const row = database.sqlite.prepare(sql).get(...(values as never[])) as Record<string, unknown> | undefined; return column ? (row?.[column] ?? null) : (row ?? null); },
      async run() { return statement.execute(); },
      execute() { const result = database.sqlite.prepare(sql).run(...(values as never[])); return { results: [], success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; },
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

test("la cuota se infiere de la categoría", () => {
  assert.deepEqual([...ATHLETE_CATEGORIES], ["Iniciación", "Cadetes", "Intermedios", "Avanzados"]);
  assert.equal(feeForCategory("Iniciación"), 1200000);
  assert.equal(feeForCategory("Cadetes"), 1500000);
  assert.equal(feeForCategory("Intermedios"), 1500000);
  assert.equal(feeForCategory("Avanzados"), 1500000);
  assert.equal(feeForCategory("Otra"), null);
});

test("el formulario ignora cuota y descuento manuales enviados", () => {
  const form = new FormData();
  form.set("name", "Atleta de prueba");
  form.set("category", "Cadetes");
  form.set("monthlyFee", "12000");
  form.set("manualDiscount", "5000");
  form.set("discountReason", "Descuento inventado");
  form.set("startPeriodMonth", "3");
  form.set("startPeriodYear", "2027");
  const athlete = athleteFromForm(form);
  assert.equal(athlete.feeMinor, 1500000);
  assert.equal(athlete.discountMinor, 0);
  assert.equal(athlete.discountReason, undefined);
  assert.equal(athlete.startPeriod, "2027-03");
});

test("un aumento de montos se aplica a los atletas de la categoría y a la vista previa", async () => {
  const adapter = new SQLiteD1(); const db = adapter.db();
  await seedDemo(db);
  const kid = await enrollAthlete(db, admin, { name: "Atleta Cuota", category: "Iniciación", feeMinor: 1, discountMinor: 99900, discountReason: "Manual", startPeriod: "2027-01" });
  let saved = (await getAdminDashboard(db)).athletes.find((a) => a.id === kid)!;
  assert.equal(saved.feeMinor, 1200000);
  assert.equal(saved.discountMinor, 0);
  const fees = await getFeeSchedule(db);
  await updateFeeSchedule(db, admin, { ...fees, "Iniciación": 1300000 });
  saved = (await getAdminDashboard(db)).athletes.find((a) => a.id === kid)!;
  assert.equal(saved.feeMinor, 1300000);
  const preview = await getMonthlyPreview(db, "2027-02");
  assert.equal(preview.athletes.find((a) => a.id === kid)!.totalMinor, 1300000);
  await assert.rejects(updateFeeSchedule(db, admin, { ...fees, "Cadetes": 0 }));
});

test("los selectores de fecha componen valores ISO y rechazan partes incompletas", () => {
  const form = new FormData();
  form.set("transferDateDay", "8");
  form.set("transferDateMonth", "10");
  form.set("transferDateYear", "2026");
  assert.equal(formDate(form, "transferDate"), "2026-10-08");
  assert.equal(formPeriod(form, "start"), "");
  form.set("startMonth", "1");
  form.set("startYear", "2027");
  assert.equal(formPeriod(form, "start"), "2027-01");
  // Un campo único heredado sigue funcionando.
  const legacy = new FormData();
  legacy.set("transferDate", "2026-02-03");
  assert.equal(formDate(legacy, "transferDate"), "2026-02-03");
});
