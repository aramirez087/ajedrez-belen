import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import ts from 'typescript';
import { allocationSummary, minorAmount } from '../src/lib/portal/allocation-validation.ts';

// Run the shipping browser controllers with narrow DOM doubles. This catches
// ordering bugs between allocation, OCR and native events without remote OCR,
// payment mutations or a browser server with shared mutable demo data.
function controller(file: string) {
  const source = readFileSync(new URL(`../src/components/portal/${file}.astro`, import.meta.url), 'utf8');
  const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  return ts.transpileModule(script.replace(/^\s*import .*;$/gm, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
class UiEvent {
  target: Control | null = null;
  defaultPrevented = false;
  constructor(public type: string, public options: { bubbles?: boolean } = {}) {}
  preventDefault() { this.defaultPrevented = true; }
}
class Control {
  value = ''; textContent = ''; hidden = false; disabled = false; required = false; open = false;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  style: Record<string, string> = {};
  handlers = new Map<string, Array<(event: UiEvent) => void>>();
  one = new Map<string, Control>();
  many = new Map<string, Control[]>();
  parent: Control | null = null;
  validationMessage = '';
  selectedOptions: Control[] = [];
  options: Control[] = [];
  files: unknown[] = [];
  classList = { add() {}, remove() {}, toggle() {} };
  constructor(public fallback = false) {}
  get validity() { return { valid: !this.validationMessage && !(this.required && !this.value) }; }
  setCustomValidity(message: string) { this.validationMessage = message; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  querySelector(selector: string): Control | null {
    if (!this.one.has(selector) && this.fallback) this.one.set(selector, new Control(true));
    return this.one.get(selector) ?? null;
  }
  querySelectorAll(selector: string) { return this.many.get(selector) ?? []; }
  closest(selector: string) { return selector === 'form' ? this.parent : this.one.get(`closest:${selector}`) ?? null; }
  addEventListener(type: string, callback: (event: UiEvent) => void) { this.handlers.set(type, [...this.handlers.get(type) ?? [], callback]); }
  dispatchEvent(event: UiEvent) {
    event.target ??= this;
    this.handlers.get(event.type)?.forEach(handler => handler(event));
    if (event.options.bubbles) this.parent?.dispatchEvent(event);
    return !event.defaultPrevented;
  }
  appendChild() {} insertBefore() {} replaceChildren() {} focus() {} scrollIntoView() {} reportValidity() {}
}
const emit = (control: Control, type: string) => control.dispatchEvent(new UiEvent(type, { bubbles: true }));
const windowDouble = (search = '') => ({ addEventListener() {}, setTimeout, clearTimeout, location: { search } });

function allocator() {
  const form = new Control();
  const group = new Control(); group.parent = form;
  const amount = new Control(); amount.parent = form;
  const rowAmount = new Control(); rowAmount.parent = form; rowAmount.dataset = { maxMinor: '2400000', payAllTarget: '1' };
  const button = new Control();
  const status = new Control();
  const error = new Control();
  form.one.set('input[name="amount"], input[name="verifiedAmount"]', amount);
  form.one.set('[data-amount-error]', error);
  group.one.set('[data-allocation-total]', new Control());
  group.one.set('[data-allocation-status]', status);
  group.one.set('[data-pay-all]', button);
  group.many.set('[data-allocation]', [rowAmount]);
  runInNewContext(controller('ChargeAllocator'), {
    document: { querySelectorAll: () => [group] }, window: windowDouble(),
    Event: UiEvent, HTMLInputElement: Control, allocationSummary, minorAmount,
    Intl, queueMicrotask, CSS: { escape: (value: string) => value },
  });
  return { form, amount, rowAmount, button, status, error };
}

test('pay-all preserves an entered transfer amount and exposes a real mismatch', () => {
  const flow = allocator();
  flow.amount.value = '1000'; emit(flow.amount, 'input');
  emit(flow.button, 'click');
  assert.equal(flow.rowAmount.value, '24000');
  assert.equal(flow.amount.value, '1000', 'a convenience action must not change what was actually transferred');
  assert.match(flow.error.textContent, /supera tu transferencia/);
  assert.equal(flow.error.hidden, false);
  assert.equal(flow.amount.validity.valid, false);
});

test('pay-all still fills an empty transfer amount and permits a later manual correction', () => {
  const flow = allocator();
  emit(flow.button, 'click');
  assert.equal(flow.amount.value, '24000');
  assert.equal(flow.amount.validity.valid, true);
  flow.amount.value = '25000'; emit(flow.amount, 'input');
  emit(flow.button, 'click');
  assert.equal(flow.amount.value, '25000');
  assert.match(flow.status.textContent, /quedarán a tu favor/);
});

function uploader(search = '') {
  const form = new Control();
  const component = new Control(true); component.parent = form;
  component.dataset = { authorizedAthletes: '[]', eagerUpload: 'true', ocrMode: 'demo', ocrAvailable: 'true' };
  const fields = new Map(['amount', 'bankReference', 'payerName'].map(name => {
    const control = new Control(); control.parent = form;
    form.one.set(`[name="${name}"]`, control);
    return [name, control];
  }));
  const dates = ['Year', 'Month', 'Day'].map((part, index) => {
    const field = new Control(); field.parent = form; field.value = ['2026', '10', '14'][index];
    form.one.set(`[name="transferDate${part}"]`, field); return field;
  });
  const saved = component.querySelector('[data-slip-saved]')!;
  const draft = component.querySelector('[data-slip-draft]')!;
  const option = new Control(); option.dataset.type = 'image/png'; option.value = 'draft-1'; saved.selectedOptions = [option]; saved.options = [option];
  let responseDate = '2026-09-30';
  const reference = () => fields.get('bankReference')!;
  runInNewContext(controller('SlipUploader'), {
    document: { querySelectorAll: () => [component], createElement: () => new Control(), documentElement: { style: { overflow: '' } } },
    window: windowDouble(search), Event: UiEvent, Intl, AbortController, FormData, URL, URLSearchParams,
    fetch: async () => ({}),
    readSlipResponse: async () => ({ extraction: { status: 'ready', mode: 'demo', suggestions: {
      amount: '24000', currency: 'CRC', transferDate: responseDate, bankReference: 'REF-123', payerName: 'Nombre del banco', description: null, warnings: [],
    } } }),
    suggestAthletes: () => ({ kind: 'none', candidates: [] }), slipAuthRecovery: () => null,
    renderFirstPdfPage: () => { throw new Error('Unexpected PDF operation'); },
  });
  return {
    dates, fields, reference, draft,
    choose() { saved.value = 'draft-1'; emit(saved, 'change'); },
    clear() { saved.value = ''; emit(saved, 'change'); },
    reread(date: string) { responseDate = date; emit(component.querySelector('[data-slip-extract]')!, 'click'); },
  };
}

test('OCR fills the composite date controls and replaces an inferred amount', async () => {
  const flow = uploader();
  flow.fields.get('amount')!.value = '1000';
  flow.fields.get('amount')!.dataset.autoAmount = '1';
  flow.choose(); await setImmediate();
  assert.deepEqual(flow.dates.map(field => field.value), ['2026', '9', '30']);
  assert.equal(flow.fields.get('amount')!.value, '24000');
  assert.equal(flow.fields.get('amount')!.dataset.autoAmount, undefined, 'OCR amount must not be snapped back to allocation total');
  assert.equal(flow.reference().value, 'REF-123');
});

test('a reply link with ?correo= opens the form with that emailed file chosen and read', async () => {
  const flow = uploader('?correo=draft-1'); await setImmediate();
  assert.equal(flow.draft.value, 'draft-1');
  assert.equal(flow.fields.get('amount')!.value, '24000');
  assert.equal(flow.reference().value, 'REF-123');
  const unknown = uploader('?correo=otro'); await setImmediate();
  assert.equal(unknown.draft.value, '');
});

test('OCR preserves a manually selected date and clears the reference when an emailed file is removed', async () => {
  const flow = uploader();
  flow.choose(); await setImmediate();
  flow.dates[1].value = '8'; flow.dates[2].value = '20'; emit(flow.dates[2], 'change');
  flow.reread('2026-10-01'); await setImmediate();
  assert.deepEqual(flow.dates.map(field => field.value), ['2026', '8', '20']);
  flow.clear();
  assert.equal(flow.reference().value, '');
  assert.equal(flow.draft.value, '');
});

class CustomUiEvent extends UiEvent {
  detail: unknown;
  constructor(type: string, options: { detail?: unknown; bubbles?: boolean } = {}) { super(type, options); this.detail = options.detail; }
}
class NamedControl extends Control {
  type = 'text'; checked = false;
  get name() { return this.getAttribute('name') ?? ''; }
  set name(value: string) { this.setAttribute('name', value); }
  get id() { return this.getAttribute('id') ?? ''; }
  set id(value: string) { this.setAttribute('id', value); }
}
class AthleteBlock extends Control {
  controls: NamedControl[];
  label: Control;
  constructor() {
    super();
    this.controls = ['name-0', 'birthDate-0Year', 'birthDate-0Month', 'birthDate-0Day', 'nationalId-0', 'school-0', 'category-0'].map(name => {
      const field = new NamedControl(); field.name = name; field.id = name; return field;
    });
    this.label = new Control(); this.label.setAttribute('id', 'birthDate-0-label');
    this.one.set('legend', new Control());
    this.one.set('[data-cedula-hint]', new Control());
    this.one.set('input', this.controls[0]);
    this.one.set('input[name^="nationalId-"]', this.controls[4]);
  }
  override querySelector(selector: string) {
    const dateSuffix = selector.match(/name\$="(Year|Month|Day)"/);
    return dateSuffix ? this.controls.find(field => field.name.endsWith(dateSuffix[1])) ?? null : super.querySelector(selector);
  }
  override querySelectorAll(selector: string) {
    return selector === 'input, select' ? this.controls : selector === '*' ? [...this.controls, this.label] : [];
  }
  cloneNode() { return new AthleteBlock(); }
  override appendChild(child?: Control) { if (child) this.one.set('[data-remove-athlete]', child); }
}

function sourceScript(path: string) {
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
  const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  return ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

test('enrollment creates every saved sibling before shared draft restoration fills their fields', () => {
  const blocks = [new AthleteBlock()];
  const container = new Control();
  container.querySelectorAll = selector => selector === '.athlete-block' ? blocks : [];
  container.appendChild = (block?: Control) => { if (block instanceof AthleteBlock) { blocks.push(block); block.parent = container; } };
  const form = new Control();
  form.dataset = { draftKey: 'inscribir-atleta', draftSuccess: 'athletes_registered' };
  form.one.set('#athlete-blocks', container); form.one.set('#add-athlete', new Control()); form.one.set('#add-athlete-note', new Control());
  Object.defineProperty(form, 'elements', { get: () => blocks.flatMap(block => block.controls) });
  container.parent = form;
  const saved = { at: Date.now(), data: {
    'name-0#0': 'Ana', 'name-1#0': 'Beto', 'name-2#0': 'Clara',
    'birthDate-2Year#0': '2010', 'birthDate-2Month#0': '1', 'birthDate-2Day#0': '1',
  } };
  const storage = new Map([['portal-draft:v2:family:inscribir-atleta', JSON.stringify(saved)]]);
  const document = {
    body: { dataset: { portalAccount: 'family' } },
    querySelector: (selector: string) => selector === '#self-register-form' ? form : null,
    querySelectorAll: () => [form],
    createElement: () => new Control(),
  };
  const environment = {
    document, window: {}, navigator: {}, Intl, Event: UiEvent, CustomEvent: CustomUiEvent,
    HTMLInputElement: NamedControl, HTMLSelectElement: NamedControl, HTMLTextAreaElement: NamedControl,
    queueMicrotask,
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  };
  // Initialization mirrors Astro: the page installs hooks, then the shared
  // controller restores the draft after all page scripts have registered.
  runInNewContext(sourceScript('pages/portal/inscribir.astro'), environment);
  const layout = readFileSync(new URL('../src/layouts/PortalLayout.astro', import.meta.url), 'utf8');
  const restore = layout.match(/const initializeDrafts = \(\) => \{[\s\S]*?\n  \};/)?.[0];
  assert.ok(restore);
  runInNewContext(ts.transpileModule(`${restore}\ninitializeDrafts();`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, environment);
  assert.equal(blocks.length, 3, 'the before-restore hook materializes all siblings');
  assert.deepEqual(blocks.map(block => block.controls[0].value), ['Ana', 'Beto', 'Clara']);
  assert.deepEqual(blocks.map(block => block.label.getAttribute('id')), ['birthDate-0-label', 'birthDate-1-label', 'birthDate-2-label']);
  assert.equal(blocks[2].controls[4].required, true, 'post-restore recomputes age-dependent ID requirements');
});

test('clearing an emailed file during OCR prevents the late response from filling another payment', async () => {
  const flow = uploader();
  flow.choose();
  flow.clear();
  await setImmediate();
  assert.equal(flow.draft.value, '');
  assert.equal(flow.reference().value, '');
  assert.equal(flow.fields.get('amount')!.value, '');
  assert.deepEqual(flow.dates.map(field => field.value), ['2026', '10', '14']);
});
