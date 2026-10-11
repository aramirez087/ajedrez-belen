import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

const base = new URL(process.env.PORTAL_TEST_URL || "http://127.0.0.1:4322");
assert.equal(
  base.protocol,
  "http:",
  "Integration tests only target local HTTP development",
);
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname),
  "Integration tests only target a loopback development preview",
);
const timings = [];
const cookies = new Map();
const fixture = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const parts = new Intl.DateTimeFormat("en", {
  timeZone: "America/Costa_Rica",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).formatToParts(new Date());
const part = (name) => parts.find((item) => item.type === name).value;
const transferDate = `${part("year")}-${part("month")}-${part("day")}`;
const future = new Date(
  Date.UTC(Number(part("year")), Number(part("month")), 1),
);
const period = `${future.getUTCFullYear()}-${String(future.getUTCMonth() + 1).padStart(2, "0")}`;
const nonce = `${Date.now()}${String(crypto.getRandomValues(new Uint32Array(1))[0]).padStart(10, "0")}`;
const originalReference = `000020261010283002453950810${nonce}01`;
const revisedReference = `000020261010283002453950810${nonce}02`;
const verifiedReference = `000020261010283002453950810${nonce}03`;
const payerName = "=SUM(1,1) · Persona sintética de integración";

async function request(path, role = null, init = {}) {
  const url = new URL(path, base);
  assert.equal(
    url.origin,
    base.origin,
    "A test must never follow an external location",
  );
  const headers = new Headers(init.headers);
  if (role) headers.set("cookie", cookies.get(role));
  return fetch(url, { ...init, headers, redirect: "manual" });
}
async function post(path, role, data, extraHeaders = {}) {
  return request(path, role, {
    method: "POST",
    headers: {
      origin: base.origin,
      accept: "application/json",
      ...extraHeaders,
    },
    body: data,
  });
}
function urlForm(values) {
  return new URLSearchParams(values);
}
function allocations(form, claims) {
  for (const [chargeId, colones] of claims) {
    form.append("allocationChargeId[]", chargeId);
    form.append("allocationAmount[]", String(colones));
  }
  return form;
}
function paymentForm(
  reference,
  claims,
  { revision = false, bytes = fixture, fileType = "image/png", expectedReviewNote = null } = {},
) {
  const form = new FormData();
  form.set("payerName", payerName);
  form.set("amount", "3000.00");
  form.set("transferDate", transferDate);
  form.set("bankReference", reference);
  form.set(
    "slip",
    new Blob([bytes], { type: fileType }),
    "synthetic-portal.png",
  );
  if (revision) {
    form.set("expectedRevision", "1");
    form.set("expectedStatus", "needs_info");
    form.set("expectedReviewNote", expectedReviewNote ?? "");
    form.set(
      "note",
      "Referencia y respaldo corregidos para la prueba de integración.",
    );
  }
  return allocations(form, claims);
}
async function jsonExport(kind) {
  const response = await request(
    `/api/admin/export?kind=${kind}&format=json`,
    "admin",
  );
  assert.equal(response.status, 200, `${kind} export`);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  return response.json();
}
async function paymentRow(paymentId) {
  return (await jsonExport("payments")).find((row) => row.id === paymentId);
}
async function receiptRow(paymentId) {
  return (await jsonExport("receipts")).find(
    (row) => row.payment_id === paymentId,
  );
}
function redirect(response, notice) {
  assert.equal(response.status, 303);
  const location = response.headers.get("location");
  assert.ok(location, "Successful mutation redirects to the saved record");
  assert.equal(new URL(location, base).searchParams.get("notice"), notice);
  return location;
}
async function checked(label, run) {
  const start = performance.now();
  await run();
  timings.push({
    check: label,
    wallMs: Math.round((performance.now() - start) * 10) / 10,
  });
  console.log(`PASS ${label}`);
}

let claims;
let paymentId;
let receiptId;
let beforePaid;
let beforeReceiptSnapshot;
let bankName;
let receivingAccount;
let loadedReviewNote = null;

await checked(
  "unauthenticated access and forged origins fail closed",
  async () => {
    assert.equal((await request("/api/admin/export?format=json")).status, 401);
    const page = await request("/portal");
    assert.equal(page.status, 302);
    assert.equal(page.headers.get("location"), "/portal/acceso");
    for (const origin of [null, "https://unrelated.example"]) {
      const headers = origin ? { origin } : {};
      const response = await request("/api/portal/demo", null, {
        method: "POST",
        headers,
        body: urlForm({ role: "parent-a" }),
      });
      assert.equal(
        response.status,
        403,
        "Demo role selection also needs same-origin CSRF protection",
      );
    }
  },
);

await checked(
  "synthetic demo identities are enabled only in the local preview",
  async () => {
    for (const role of ["admin", "parent-a", "parent-b", "unrelated"]) {
      const response = await post("/api/portal/demo", null, urlForm({ role }));
      assert.equal(response.status, 303, `Demo login ${role}`);
      const cookie = response.headers
        .getSetCookie()
        .find((value) => value.startsWith("portal-demo-role="));
      assert.ok(cookie, "Demo identity is stored in an HTTP-only cookie");
      assert.match(cookie, /HttpOnly/i);
      cookies.set(role, cookie.split(";")[0]);
    }
    assert.equal((await request("/admin", "parent-a")).status, 403);
    assert.equal(
      (
        await request(
          "/api/admin/export?kind=payments&format=json",
          "unrelated",
        )
      ).status,
      403,
    );
    const mailPage = await request("/admin/comprobantes", "admin");
    assert.equal(mailPage.status, 200);
    assert.match(
      await mailPage.text(),
      /Correo en modo simulado/,
      "Abort before payment mutations if any live email mode is configured",
    );
  },
);

await checked(
  "next Costa Rica month publication is idempotent and charges remain private",
  async () => {
    const publish = () =>
      post(
        "/api/admin/charges",
        "admin",
        urlForm({ action: "publish", month: period }),
      );
    redirect(await publish(), "month_published");
    const first = (await jsonExport("charges")).filter(
      (charge) => charge.period === period,
    );
    redirect(await publish(), "month_published");
    const second = (await jsonExport("charges")).filter(
      (charge) => charge.period === period,
    );
    assert.equal(second.length, first.length);
    assert.deepEqual(
      second.map((charge) => charge.id).sort(),
      first.map((charge) => charge.id).sort(),
    );
    const formPage = await (
      await request("/portal/pagos/nuevo", "parent-a")
    ).text();
    const parentChargeIds = new Set(
      Array.from(
        formPage.matchAll(/name="allocationChargeId\[\]"[^>]*value="([^"]+)"/g),
        (match) => match[1],
      ),
    );
    const familyCharges = second.filter((charge) =>
      parentChargeIds.has(charge.id),
    );
    assert.ok(
      familyCharges.length >= 2,
      "Two linked sibling charges exist for the new month",
    );
    claims = familyCharges.slice(0, 2).map((charge) => [charge.id, 1000]);
    beforePaid = Object.fromEntries(
      familyCharges.map((charge) => [charge.id, charge.paid_minor]),
    );
    for (const charge of familyCharges)
      assert.equal(charge.due_date, `${period}-08`);
    const unrelatedPage = await (
      await request("/portal/pagos/nuevo", "unrelated")
    ).text();
    for (const [chargeId] of claims)
      assert.ok(
        !unrelatedPage.includes(chargeId),
        "Other family does not see sibling charge IDs",
      );
  },
);

await checked("charge adjustment forms retain durable IDs across concurrent retries", async () => {
  const chargeId = claims[0][0];
  const before = (await jsonExport("charges")).find(row => row.id === chargeId).adjustments_minor;
  async function adjustmentForm(amount) {
    const html = await (await request(`/admin/mensualidades?month=${period}`, "admin")).text();
    const nativeForm = Array.from(html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g), match => match[0])
      .find(form => form.includes(`name="chargeId" value="${chargeId}"`));
    assert.ok(nativeForm, "Published synthetic charge has an adjustment form");
    const operationId = nativeForm.match(/name="operationId"[^>]*value="([0-9a-f-]{36})"/)?.[1];
    assert.ok(operationId, "The native adjustment form has a durable operation ID");
    return urlForm({ action: "adjust", chargeId, operationId, adjustmentAmount: String(amount), reason: "Ajuste sintético de integración." });
  }
  const form = await adjustmentForm(500);
  const missingId = new URLSearchParams(form); missingId.delete("operationId");
  assert.equal((await post("/api/admin/charges", "admin", missingId)).status, 400);
  const attempts = await Promise.all([
    post("/api/admin/charges", "admin", new URLSearchParams(form)),
    post("/api/admin/charges", "admin", new URLSearchParams(form)),
  ]);
  for (const result of attempts) redirect(result, "charge_adjusted");
  redirect(await post("/api/admin/charges", "admin", new URLSearchParams(form)), "charge_adjusted");
  assert.equal((await jsonExport("charges")).find(row => row.id === chargeId).adjustments_minor, before + 50000);
  const changed = new URLSearchParams(form); changed.set("adjustmentAmount", "1000");
  assert.equal((await post("/api/admin/charges", "admin", changed)).status, 409);
  const events = (await jsonExport("audit")).filter(row => row.entity_id === chargeId && row.action === "adjust" && JSON.parse(row.detail_json).operationId === form.get("operationId"));
  assert.equal(events.length, 1);
  // A fresh form records an explicit inverse adjustment, restoring the synthetic charge.
  redirect(await post("/api/admin/charges", "admin", await adjustmentForm(-500)), "charge_adjusted");
  assert.equal((await jsonExport("charges")).find(row => row.id === chargeId).adjustments_minor, before);
});

await checked(
  "uploads enforce origin, signature, size and explicit guardian allocations",
  async () => {
    const missingOrigin = await request("/api/portal/payments", "parent-a", {
      method: "POST",
      headers: { accept: "application/json" },
      body: paymentForm(originalReference, claims),
    });
    assert.equal(missingOrigin.status, 403);
    assert.equal(
      (
        await post(
          "/api/portal/payments",
          "parent-a",
          paymentForm(originalReference, claims),
          { origin: "https://unrelated.example" },
        )
      ).status,
      403,
    );
    const disguise = await post(
      "/api/portal/payments",
      "parent-a",
      paymentForm(originalReference, claims, {
        bytes: new TextEncoder().encode("<script>not a payment</script>"),
      }),
    );
    assert.equal(disguise.status, 400);
    assert.equal((await disguise.json()).error, "invalid_file");
    const oversized = await post(
      "/api/portal/payments",
      "parent-a",
      paymentForm(originalReference, claims, {
        bytes: new Uint8Array(3 * 1024 * 1024 + 70000),
      }),
    );
    assert.equal(oversized.status, 413);
    const unrelated = await post(
      "/api/portal/payments",
      "unrelated",
      paymentForm(originalReference, claims),
    );
    assert.equal(unrelated.status, 403);
    assert.equal((await unrelated.json()).error, "forbidden");
  },
);

await checked(
  "pending submission stores private evidence without changing balances",
  async () => {
    const submission = paymentForm(originalReference, claims);
    submission.set("recipientEmail", "editable-recipient@example.invalid");
    submission.set("studentEmail", "student@example.invalid");
    const response = await post(
      "/api/portal/payments",
      "parent-a",
      submission,
    );
    const location = redirect(response, "submitted");
    paymentId = new URL(location, base).pathname.split("/").at(-1);
    assert.match(paymentId, /^[0-9a-f-]{36}$/);
    const row = await paymentRow(paymentId);
    assert.equal(row.status, "pending");
    assert.equal(row.bank_reference, originalReference);
    assert.equal(row.amount_minor, 300000);
    const charges = await jsonExport("charges");
    for (const [chargeId] of claims)
      assert.equal(
        charges.find((charge) => charge.id === chargeId).paid_minor,
        beforePaid[chargeId],
      );
    const responsePage = await request(
      `/portal/pagos/${paymentId}`,
      "parent-a",
    );
    assert.match(responsePage.headers.get("cache-control") || "", /no-store/);
    const html = await responsePage.text();
    const fileId = html.match(/\/api\/portal\/files\/([0-9a-f-]{36})/)?.[1];
    assert.ok(fileId);
    for (const role of ["parent-a", "admin"]) {
      const file = await request(`/api/portal/files/${fileId}`, role);
      assert.equal(file.status, 200);
      assert.match(file.headers.get("content-disposition") || "", /attachment/);
      assert.match(
        file.headers.get("content-security-policy") || "",
        /sandbox/,
      );
      assert.deepEqual(new Uint8Array(await file.arrayBuffer()), fixture);
    }
    for (const role of ["parent-b", "unrelated"]) {
      assert.equal(
        (await request(`/api/portal/files/${fileId}`, role)).status,
        404,
      );
      assert.equal(
        (await request(`/portal/pagos/${paymentId}`, role)).status,
        404,
      );
    }
  },
);

await checked(
  "needs-info correction retains both submission references and files",
  async () => {
    redirect(
      await post(
        `/api/admin/payments/${paymentId}/review`,
        "admin",
        urlForm({
          action: "needs_info",
          expectedRevision: "1", expectedStatus: "pending", expectedReviewNote: (await paymentRow(paymentId)).review_note ?? "",
          reason: "Confirma la referencia completa de la transferencia.",
        }),
      ),
      "needs_info",
    );
    assert.equal((await paymentRow(paymentId)).status, "needs_info");
    redirect(
      await post(
        `/api/portal/payments/${paymentId}/revise`,
        "parent-a",
        paymentForm(revisedReference, claims, { revision: true, expectedReviewNote: (await paymentRow(paymentId)).review_note }),
      ),
      "revised",
    );
    assert.equal((await paymentRow(paymentId)).status, "pending");
    const html = await (
      await request(`/portal/pagos/${paymentId}`, "parent-a")
    ).text();
    assert.ok(html.includes(originalReference));
    assert.ok(html.includes(revisedReference));
    assert.equal(
      new Set(
        Array.from(
          html.matchAll(/\/api\/portal\/files\/([0-9a-f-]{36})/g),
          (match) => match[1],
        ),
      ).size,
      2,
    );
  },
);

function approveForm({
  checkedBank = true,
  reason = "La referencia confirmada se transcribió del banco.",
} = {}) {
  const form = urlForm({
    action: "approve",
    expectedRevision: "2", expectedStatus: "pending", expectedReviewNote: loadedReviewNote ?? "",
    verifiedAmount: "3000.00",
    verifiedDate: transferDate,
    verifiedReference,
    verifiedBankName: bankName,
    verifiedReceivingAccount: receivingAccount,
    reason,
  });
  if (checkedBank) form.set("bankChecked", "on");
  return allocations(form, claims);
}

await checked(
  "admin must confirm bank and document corrections before approval",
  async () => {
    const html = await (
      await request(`/admin/pagos/${paymentId}`, "admin")
    ).text();
    bankName = html.match(/name="verifiedBankName"[^>]*value="([^"]+)"/)?.[1];
    receivingAccount = html.match(
      /name="verifiedReceivingAccount"[^>]*value="([^"]+)"/,
    )?.[1];
    assert.ok(bankName && receivingAccount);
    loadedReviewNote = (await paymentRow(paymentId)).review_note;
    assert.match(html, /name="expectedRevision"[^>]*value="2"/);
    assert.match(html, /name="expectedStatus"[^>]*value="pending"/);
    const noteInput = html.match(/<input\b[^>]*name="expectedReviewNote"[^>]*>/)?.[0];
    assert.ok(noteInput, "The review form retains the displayed note snapshot");
    // Astro serializes an empty string as a bare value attribute; both forms submit empty.
    assert.match(noteInput, /\bvalue(?:="")?(?:\s|\/?>)/);
    const tooLongSnapshot = approveForm(); tooLongSnapshot.set("expectedReviewNote", "x".repeat(501));
    assert.equal((await post(`/api/admin/payments/${paymentId}/review`, "admin", tooLongSnapshot)).status, 400);
    const staleNoteSnapshot = approveForm(); staleNoteSnapshot.set("expectedReviewNote", "Otra solicitud anterior.");
    const staleNoteResponse = await post(`/api/admin/payments/${paymentId}/review`, "admin", staleNoteSnapshot);
    assert.equal(staleNoteResponse.status, 409);
    assert.equal((await staleNoteResponse.json()).error, "conflict");
    const missingSnapshot = approveForm();
    missingSnapshot.delete("expectedRevision");
    assert.equal((await post(`/api/admin/payments/${paymentId}/review`, "admin", missingSnapshot)).status, 400);
    const staleSnapshot = approveForm();
    staleSnapshot.set("expectedRevision", "1");
    const staleResponse = await post(`/api/admin/payments/${paymentId}/review`, "admin", staleSnapshot);
    assert.equal(staleResponse.status, 409);
    assert.equal((await staleResponse.json()).error, "conflict");
    assert.equal((await paymentRow(paymentId)).status, "pending");
    assert.equal(await receiptRow(paymentId), undefined);
    const missingCheck = await post(
      `/api/admin/payments/${paymentId}/review`,
      "admin",
      approveForm({ checkedBank: false }),
    );
    assert.equal(missingCheck.status, 400);
    assert.equal((await missingCheck.json()).error, "bank_check_required");
    assert.equal(
      (
        await post(
          `/api/admin/payments/${paymentId}/review`,
          "parent-a",
          approveForm(),
        )
      ).status,
      403,
    );
    const noReason = await post(
      `/api/admin/payments/${paymentId}/review`,
      "admin",
      approveForm({ reason: "" }),
    );
    assert.equal(noReason.status, 400);
    assert.equal((await paymentRow(paymentId)).status, "pending");
  },
);

await checked(
  "concurrent verification issues one immutable receipt, partial balances and simulated email",
  async () => {
    const attempts = await Promise.all([
      post(`/api/admin/payments/${paymentId}/review`, "admin", approveForm()),
      post(`/api/admin/payments/${paymentId}/review`, "admin", approveForm()),
    ]);
    assert.deepEqual(
      attempts.map((response) => response.status).sort(),
      [303, 409],
    );
    const loser = attempts.find((response) => response.status === 409);
    assert.equal((await loser.json()).error, "conflict");
    const result = attempts.find((response) => response.status === 303);
    const location = result.headers.get("location") || "";
    assert.equal(result.status, 303);
    assert.ok(
      ["verified", "verified_email_pending"].includes(
        new URL(location, base).searchParams.get("notice"),
      ),
    );
    const payment = await paymentRow(paymentId);
    assert.equal(payment.status, "verified");
    assert.equal(payment.bank_reference, revisedReference);
    assert.equal(payment.verified_reference, verifiedReference);
    assert.equal(payment.verified_amount_minor, 300000);
    const receipt = await receiptRow(paymentId);
    assert.ok(receipt);
    receiptId = receipt.id;
    assert.match(receipt.number, /^AB-\d{4}-\d{6}$/);
    beforeReceiptSnapshot = receipt.snapshot_json;
    const snapshot = JSON.parse(receipt.snapshot_json);
    assert.equal(snapshot.demo, true);
    assert.equal(snapshot.bankReference, verifiedReference);
    assert.equal(snapshot.unallocatedMinor, 100000);
    assert.equal(snapshot.lines.length, 2);
    const charges = await jsonExport("charges");
    for (const [chargeId] of claims)
      assert.equal(
        charges.find((charge) => charge.id === chargeId).paid_minor,
        beforePaid[chargeId] + 100000,
      );
    const document = await request(
      `/portal/comprobantes/${receiptId}`,
      "parent-a",
    );
    assert.equal(document.status, 200);
    const html = await document.text();
    assert.match(html, /Datos ficticios|DEMO|PRUEBA/i);
    assert.match(html, /Las respuestas a este correo no se atienden/);
    assert.match(html, /href="https:\/\/wa\.me\/50687686102"/);
    assert.ok(html.includes(verifiedReference));
    assert.match(document.headers.get("cache-control") || "", /no-store/);
    for (const role of ["parent-b", "unrelated"])
      assert.equal(
        (await request(`/portal/comprobantes/${receiptId}`, role)).status,
        404,
      );
    const mailHtml = await (
      await request("/admin/comprobantes", "admin")
    ).text();
    const recipientRows = Array.from(
      mailHtml.matchAll(/<tr\b[^>]*>.*?<\/tr>/gs),
      (match) => match[0],
    ).filter(
      (row) =>
        row.includes(receipt.number) && row.includes("ana@example.invalid"),
    );
    assert.equal(recipientRows.length, 1);
    assert.match(recipientRows[0], /Simulado/);
    const issuedEmails = (await jsonExport("email")).filter(row => row.receipt_id === receiptId);
    assert.equal(issuedEmails.length, 1);
    assert.equal(issuedEmails[0].recipient_id, "demo-parent-a");
    assert.equal(issuedEmails[0].recipient_email, "ana@example.invalid");
    assert.ok(!mailHtml.includes("editable-recipient@example.invalid") && !mailHtml.includes("student@example.invalid"));
  },
);

await checked(
  "repeated approval fails without another receipt or duplicate allocation",
  async () => {
    const response = await post(
      `/api/admin/payments/${paymentId}/review`,
      "admin",
      approveForm(),
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "conflict");
    assert.equal(
      (await jsonExport("receipts")).filter(
        (receipt) => receipt.payment_id === paymentId,
      ).length,
      1,
    );
    const charges = await jsonExport("charges");
    for (const [chargeId] of claims)
      assert.equal(
        charges.find((charge) => charge.id === chargeId).paid_minor,
        beforePaid[chargeId] + 100000,
      );
  },
);

await checked(
  "unapplied credit can be allocated while the original receipt remains frozen",
  async () => {
    const htmlBefore = await (await request(`/admin/pagos/${paymentId}`, "admin")).text();
    const operationId = htmlBefore.match(/name="operationId"[^>]*value="([0-9a-f-]{36})"/)?.[1];
    assert.ok(operationId, "The native credit form retains one operation ID across repeated POSTs");
    const form = allocations(
      urlForm({
        action: "apply_credit",
        operationId,
        expectedRevision: "2", expectedStatus: "verified", expectedReviewNote: (await paymentRow(paymentId)).review_note ?? "",
        reason: "Aplicar el saldo confirmado al mismo mes de prueba.",
      }),
      [[claims[0][0], 1000]],
    );
    redirect(
      await post(`/api/admin/payments/${paymentId}/review`, "admin", form),
      "credit_applied",
    );
    // The original response may be lost; the saved form can be sent again safely.
    redirect(await post(`/api/admin/payments/${paymentId}/review`, "admin", form), "credit_applied");
    const changedPayload = new URLSearchParams(form);
    changedPayload.set("reason", "No debe reutilizarse el identificador para otro cambio.");
    const conflict = await post(`/api/admin/payments/${paymentId}/review`, "admin", changedPayload);
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error, "conflict");
    const appliedAudit = (await jsonExport("audit")).filter(row => row.entity_id === paymentId && row.action === "apply_credit");
    assert.equal(appliedAudit.length, 1, "Replays never append duplicate audit entries");
    const charges = await jsonExport("charges");
    assert.equal(
      charges.find((charge) => charge.id === claims[0][0]).paid_minor,
      beforePaid[claims[0][0]] + 200000,
    );
    assert.equal(
      (await receiptRow(paymentId)).snapshot_json,
      beforeReceiptSnapshot,
    );
    const html = await (
      await request(`/admin/pagos/${paymentId}`, "admin")
    ).text();
    assert.match(html, /Saldo a favor sin aplicar/);
    assert.ok(
      !html.includes('name="action" value="apply_credit"'),
      "No remaining credit form after full allocation",
    );
  },
);

await checked(
  "CSV and JSON retain exact long references and protect spreadsheet text",
  async () => {
    const row = await paymentRow(paymentId);
    assert.equal(typeof row.bank_reference, "string");
    assert.equal(typeof row.verified_reference, "string");
    assert.equal(row.bank_reference, revisedReference);
    assert.equal(row.verified_reference, verifiedReference);
    const response = await request("/api/admin/export?kind=payments", "admin");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/csv/);
    const csv = await response.text();
    assert.ok(csv.includes(`"'${revisedReference}"`));
    assert.ok(csv.includes(`"'${verifiedReference}"`));
    assert.ok(csv.includes(`"'${payerName}"`));
    const audits = await jsonExport("audit");
    const events = audits.filter((event) => event.entity_id === paymentId);
    for (const action of [
      "submit",
      "needs_info",
      "revise",
      "verify",
      "apply_credit",
    ])
      assert.ok(
        events.some((event) => event.action === action),
        `${action} is audited`,
      );
  },
);

await checked(
  "held-email preparation is admin-only and cannot replace existing receipt email history",
  async () => {
    const prepare = () => urlForm({ action: "prepare", receiptId, recipientEmail: "replacement@example.invalid" });
    const beforeEmails = (await jsonExport("email")).filter(row => row.receipt_id === receiptId);
    const parentDenied = await post("/api/admin/email", "parent-a", prepare());
    assert.equal(parentDenied.status, 403);
    assert.equal(await parentDenied.text(), "Administrator access required");
    const missingOrigin = await request("/api/admin/email", "admin", {
      method: "POST", headers: { accept: "application/json" }, body: prepare(),
    });
    assert.equal(missingOrigin.status, 403);
    assert.equal((await missingOrigin.json()).error, "same_origin_required");
    const existing = await post("/api/admin/email", "admin", prepare());
    assert.equal(existing.status, 409);
    assert.equal((await existing.json()).error, "existing_receipt_email");
    assert.deepEqual((await jsonExport("email")).filter(row => row.receipt_id === receiptId), beforeEmails);
    assert.equal((await receiptRow(paymentId)).snapshot_json, beforeReceiptSnapshot);
  },
);

await checked(
  "audited void restores balances and preserves receipt number and snapshot",
  async () => {
    redirect(
      await post(
        `/api/admin/payments/${paymentId}/review`,
        "admin",
        urlForm({
          action: "void",
          expectedRevision: "2", expectedStatus: "verified", expectedReviewNote: (await paymentRow(paymentId)).review_note ?? "",
          reason:
            "Anulación de datos ficticios al finalizar la prueba de integración.",
        }),
      ),
      "void",
    );
    assert.equal((await paymentRow(paymentId)).status, "void");
    const receipt = await receiptRow(paymentId);
    assert.equal(receipt.status, "void");
    assert.equal(receipt.snapshot_json, beforeReceiptSnapshot);
    const charges = await jsonExport("charges");
    for (const [chargeId] of claims)
      assert.equal(
        charges.find((charge) => charge.id === chargeId).paid_minor,
        beforePaid[chargeId],
      );
    const html = await (
      await request(`/portal/comprobantes/${receiptId}`, "parent-a")
    ).text();
    assert.match(html, /anulad/i);
    const mailHtml = await (
      await request("/admin/comprobantes", "admin")
    ).text();
    const recipientRows = Array.from(
      mailHtml.matchAll(/<tr\b[^>]*>.*?<\/tr>/gs),
      (match) => match[0],
    ).filter(
      (row) =>
        row.includes(receipt.number) && row.includes("ana@example.invalid"),
    );
    assert.equal(recipientRows.length, 2);
    assert.ok(
      recipientRows.some(
        (row) => row.includes("Aviso de anulación") && row.includes("Simulado"),
      ),
    );
    assert.ok(
      (await jsonExport("audit")).some(
        (event) => event.entity_id === paymentId && event.action === "void",
      ),
    );
  },
);

await checked(
  "staff-assisted confirmation emails only the designated family adult after bank verification",
  async () => {
    const reference = `${originalReference}-staff`;
    const submission = paymentForm(reference, claims);
    submission.set("designatedAdultId", "demo-parent-a");
    submission.set("auditReason", "Carga asistida sintética para verificar el destinatario familiar autorizado.");
    submission.set("recipientEmail", "editable-staff-recipient@example.invalid");
    submission.set("studentEmail", "student@example.invalid");
    const location = redirect(await post("/api/portal/payments", "admin", submission), "submitted");
    const assistedId = new URL(location, base).pathname.split("/").at(-1);
    const pending = await paymentRow(assistedId);
    assert.equal(pending.status, "pending");
    assert.equal(await receiptRow(assistedId), undefined);
    const approval = approveForm({ reason: "" });
    approval.set("expectedRevision", "1");
    approval.set("expectedReviewNote", "");
    approval.set("verifiedReference", reference);
    redirect(await post(`/api/admin/payments/${assistedId}/review`, "admin", approval), "verified");
    assert.equal((await paymentRow(assistedId)).status, "verified");
    const issued = await receiptRow(assistedId);
    assert.equal(issued.status, "issued");
    const issuedEmails = (await jsonExport("email")).filter(row => row.receipt_id === issued.id);
    assert.equal(issuedEmails.length, 1);
    assert.equal(issuedEmails[0].recipient_id, "demo-parent-a");
    assert.equal(issuedEmails[0].recipient_email, "ana@example.invalid");
    assert.equal(issuedEmails[0].status, "dry_run");
    const receiptsHtml = await (await request("/admin/comprobantes", "admin")).text();
    const issuedRow = Array.from(receiptsHtml.matchAll(/<tr\b[^>]*>.*?<\/tr>/gs), match => match[0])
      .find(row => row.includes(issued.number));
    assert.match(issuedRow, /Simulado/);
    assert.doesNotMatch(issuedRow, /Destinatario por revisar|Correo retenido/);
    const document = await request(`/portal/comprobantes/${issued.id}`, "parent-a");
    assert.equal(document.status, 200, "The designated family adult can still access the confirmed receipt");
    redirect(await post(`/api/admin/payments/${assistedId}/review`, "admin", urlForm({
      action: "void", expectedRevision: "1", expectedStatus: "verified",
      expectedReviewNote: (await paymentRow(assistedId)).review_note ?? "",
      reason: "Anulación de la carga asistida sintética al finalizar la prueba.",
    })), "void");
    assert.equal((await receiptRow(assistedId)).snapshot_json, issued.snapshot_json);
    const allEmails = (await jsonExport("email")).filter(row => row.receipt_id === issued.id);
    assert.equal(allEmails.length, 2);
    assert.ok(allEmails.every(row => row.recipient_id === "demo-parent-a" && row.recipient_email === "ana@example.invalid"));
    assert.equal(allEmails.find(row => row.kind === "receipt_void").status, "dry_run");
    const restored = await jsonExport("charges");
    for (const [chargeId] of claims)
      assert.equal(restored.find(row => row.id === chargeId).paid_minor, beforePaid[chargeId]);
  },
);

console.log(
  JSON.stringify(
    {
      runtime: "local development workerd",
      paymentId,
      receiptId,
      period,
      fixture:
        "synthetic PNG only; email mode asserted simulated before mutations",
      timingKind: "HTTP wall time, NOT CPU time or a cloud free-tier guarantee",
      checks: timings,
    },
    null,
    2,
  ),
);
