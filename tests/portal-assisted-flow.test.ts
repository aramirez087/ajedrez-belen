import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { formBankReference, formText, InputError, mutationError, parseAllocations, parseMoney, successRedirect } from '../src/lib/portal/http.ts';
import { formDate } from '../src/lib/portal/forms.ts';

// Execute the real route with its financial submission dependency replaced.
// Actual role/origin gates are covered by portal-business-config.test.ts.
const route = readFileSync(new URL('../src/pages/api/portal/payments/index.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(route.replace(/^import .*;\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

async function submit(path: string, overrides: Record<string, string> = {}) {
  const form = new FormData();
  Object.entries({
    submissionId: '00000000-0000-4000-8000-000000000001', payerName: 'Persona de prueba', amount: '15000',
    transferDate: '2026-10-14', bankReference: '', 'allocationChargeId[]': 'charge-a', 'allocationAmount[]': '15000',
    designatedAdultId: 'user_family', auditReason: 'Registro asistido', ...overrides,
  }).forEach(([key, value]) => form.set(key, value));
  const request = new Request(`https://portal.example${path}`, { method: 'POST' });
  const context = { request, url: new URL(request.url) };
  let submitted = 0;
  let adminRequired: boolean | undefined;
  const exports: { POST?: (context: unknown) => Promise<Response> } = {};
  runInNewContext(code, {
    exports, env: {}, formBankReference, formText, InputError, parseAllocations, parseMoney, formDate, successRedirect,
    submitPaymentForm: async () => { submitted++; return 'payment-created'; },
    portalMutation: async (ctx: any, _env: unknown, options: { admin?: boolean; back: string }, action: (actor: unknown, form: FormData) => Promise<Response>) => {
      adminRequired = options.admin;
      try { return await action({ isAdmin: true }, form); }
      catch (error) { return mutationError(ctx, error, options.back); }
    },
  });
  return { response: await exports.POST!(context), submitted, get adminRequired() { return adminRequired; } };
}

test('assisted payment errors return to the selected family for draft recovery', async () => {
  const result = await submit('/api/portal/payments?context=admin&adult=user_family', { amount: 'invalid' });
  assert.equal(result.adminRequired, true);
  assert.equal(result.submitted, 0);
  assert.equal(result.response.headers.get('Location'), '/admin/pagos/nuevo?adult=user_family&error=invalid_amount');
});

test('assisted payment success opens administration and retains the submitted success notice', async () => {
  const result = await submit('/api/portal/payments?context=admin&adult=user_family');
  assert.equal(result.adminRequired, true);
  assert.equal(result.submitted, 1);
  assert.equal(result.response.headers.get('Location'), '/admin/pagos/payment-created?notice=submitted');
});

test('return context cannot disagree with the submitted family or contain a redirect URL', async () => {
  const mismatch = await submit('/api/portal/payments?context=admin&adult=user_other');
  assert.equal(mismatch.submitted, 0);
  assert.equal(mismatch.response.headers.get('Location'), '/admin/pagos/nuevo?adult=user_other&error=invalid_fields');
  const invalid = await submit('/api/portal/payments?context=admin&adult=https://other.example');
  assert.equal(invalid.submitted, 0);
  assert.equal(invalid.response.headers.get('Location'), '/admin/pagos/nuevo?error=invalid_fields');
});

test('ordinary family registration keeps its existing return context', async () => {
  const success = await submit('/api/portal/payments', { designatedAdultId: '', auditReason: '' });
  assert.equal(success.adminRequired, false);
  assert.equal(success.response.headers.get('Location'), '/portal/pagos/payment-created?notice=submitted');
  const failure = await submit('/api/portal/payments', { amount: 'invalid', designatedAdultId: '', auditReason: '' });
  assert.equal(failure.response.headers.get('Location'), '/portal/pagos/nuevo?error=invalid_amount');
});
