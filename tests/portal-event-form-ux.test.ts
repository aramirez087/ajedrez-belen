import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import ts from 'typescript';

// Exercise the actual browser handler without posting an event or depending on
// mutable demo data. The DOM doubles model only the controls used by this flow.
const source = readFileSync(new URL('../src/components/portal/EventForm.astro', import.meta.url), 'utf8');
const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'Event form has a browser controller');
const javascript = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

class Input {
  value: string;
  checked = false;
  required = false;
  validationMessage = '';
  constructor(value = '') { this.value = value; }
  setCustomValidity(message: string) { this.validationMessage = message; }
}
class Button extends Input { name = 'statusIntent'; }

function eventForm(confirmed = true, endTime = '20:00') {
  const handlers = new Map<string, Array<(event: any) => void>>();
  const controls = new Map<string, Input>([
    ['#ev-date', new Input('2020-01-01')],
    ['#ev-start', new Input('19:00')],
    ['#ev-end', new Input(endTime)],
    ['[data-freq]', new Input('none')],
    ['[data-all-day]', new Input()],
    ['input[name="locationType"]:checked', new Input('online')],
  ]);
  const submitted: Button[] = [];
  const prompts: string[] = [];
  const form = {
    dataset: {} as Record<string, string>,
    querySelector(selector: string) { return controls.get(selector) ?? null; },
    querySelectorAll() { return []; },
    addEventListener(type: string, handler: (event: any) => void) {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
    },
    requestSubmit(submitter?: Button) {
      const event = { submitter, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      handlers.get('submit')?.forEach(handler => handler(event));
      if (!event.defaultPrevented && submitter) submitted.push(submitter);
      return event;
    },
  };
  runInNewContext(javascript, {
    document: { querySelectorAll: () => [form], querySelector: () => null },
    window: { confirm: (message: string) => { prompts.push(message); return confirmed; }, location: { search: '' } },
    HTMLButtonElement: Button, HTMLInputElement: Input, URLSearchParams,
  });
  return { form, submitted, prompts };
}

test('past-event confirmation preserves Guardar borrador instead of silently publishing', async () => {
  const { form, submitted, prompts } = eventForm();
  const draft = new Button('draft');
  const first = form.requestSubmit(draft);
  assert.equal(first.defaultPrevented, true);
  await setImmediate();
  assert.equal(prompts.length, 1);
  assert.deepEqual(submitted, [draft]);
  assert.equal(submitted[0].name, 'statusIntent');
  assert.equal(submitted[0].value, 'draft');
  assert.equal(form.dataset.eventConfirmed, undefined, 'confirmation applies only to the approved submission');
});

test('cancelling event confirmation leaves the form editable and does not submit', async () => {
  const { form, submitted, prompts } = eventForm(false);
  const draft = new Button('draft');
  form.requestSubmit(draft);
  await setImmediate();
  assert.equal(submitted.length, 0);
  form.requestSubmit(draft);
  await setImmediate();
  assert.equal(prompts.length, 2, 'a second attempt may ask again after cancellation');
  assert.equal(submitted.length, 0);
});

test('an event that is both long and in the past uses one confirmation and one submission', async () => {
  const { form, submitted, prompts } = eventForm(true, '18:00');
  const publish = new Button('published');
  form.requestSubmit(publish);
  await setImmediate();
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /más de 12 horas/);
  assert.match(prompts[0], /fecha ya pasó/);
  assert.deepEqual(submitted, [publish]);
});

const calendarSource = readFileSync(new URL('../src/components/portal/EventCalendar.astro', import.meta.url), 'utf8');
const calendarFrontmatter = calendarSource.match(/^---\n([\s\S]*?)\n---/)?.[1];
assert.ok(calendarFrontmatter);
const calendarJavascript = ts.transpileModule(
  calendarFrontmatter.replace(/^import .*;\n/gm, '') + '\ncalendarByDay = byDay;',
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

async function calendarDays(startsAt: string, endsAt: string, yearMonth = '2026-10') {
  const { crDateKey } = await import('../src/lib/portal/events.ts');
  const context = {
    Astro: { props: { yearMonth, todayKey: '2026-10-14', occurrences: [{ startsAt, endsAt, event: { id: 'overnight' } }] } },
    crDateKey, MONTHS_ES: [], calendarByDay: new Map<string, unknown[]>(),
  };
  runInNewContext(calendarJavascript, context);
  return Array.from(context.calendarByDay.keys());
}

test('calendar shows an overnight event on both Costa Rica dates', async () => {
  assert.deepEqual(await calendarDays('2026-10-14T05:00:00Z', '2026-10-14T07:00:00Z'), ['2026-10-13', '2026-10-14']);
});

test('calendar excludes an exclusive midnight end and includes a month-boundary overnight', async () => {
  assert.deepEqual(await calendarDays('2026-10-14T05:00:00Z', '2026-10-14T06:00:00Z'), ['2026-10-13']);
  assert.deepEqual(await calendarDays('2026-11-01T05:00:00Z', '2026-11-01T07:00:00Z', '2026-11'), ['2026-11-01']);
});

test('new, copied and existing events have separate draft identities', async () => {
  const { crWallParts } = await import('../src/lib/portal/events.ts');
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---/)![1];
  const code = ts.transpileModule(frontmatter.replace(/^import .*;\n/gm, '') + '\ndraftResult = draftKey;', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const keyFor = (eventId?: string, duplicate = false) => {
    const context = {
      Astro: { props: { action: '/api/admin/events', duplicate, event: eventId ? {
        id: eventId, startsAt: '2026-10-14T01:00:00Z', endsAt: '2026-10-14T02:00:00Z', recurrenceFreq: 'none',
      } : undefined } },
      crWallParts, crypto: { randomUUID: () => 'submission-id' }, draftResult: '',
    };
    runInNewContext(code, context);
    return context.draftResult;
  };
  const keys = [keyFor(), keyFor('source-a', true), keyFor('source-b', true), keyFor('source-a')];
  assert.equal(new Set(keys).size, keys.length, 'copying another event never replaces a new-event or edit draft');
});

test('create-event error returns keep a valid copy source and reject malformed return locations', async () => {
  const route = readFileSync(new URL('../src/pages/api/admin/events/index.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(route.replace(/^import .*;\n/gm, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: { POST?: (context: { url: URL }) => string } = {};
  runInNewContext(code, {
    exports, env: {}, portalMutation: (_context: unknown, _env: unknown, options: { back: string }) => options.back,
  });
  assert.equal(exports.POST!({ url: new URL('https://portal.example/api/admin/events?from=source-a') }), '/admin/eventos/nuevo?from=source-a');
  assert.equal(exports.POST!({ url: new URL('https://portal.example/api/admin/events?from=https://other.example') }), '/admin/eventos/nuevo');
  assert.equal(exports.POST!({ url: new URL('https://portal.example/api/admin/events') }), '/admin/eventos/nuevo');
});
