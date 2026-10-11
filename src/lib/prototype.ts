import type { APIContext } from 'astro';
import { getAuthConfigurationStatus, getIdentity } from './auth';
import { allowLocalPrototype, BASE_FEE_MINOR, detectSlipType, MAX_SLIP_BYTES, parseDiscount } from './prototype-policy';
import { createReceiptSnapshot, type ReceiptSnapshot } from './receipt';

export interface PrototypeActor { id: string; mode: 'local' | 'workos' }
export interface PrototypeRun {
  id: string; owner_id: string; receipt_number: string; receipt_json: string;
  amount_minor: number; discount_minor: number; created_at: string;
  file_key: string; file_type: string; file_size: number; file_sha256: string;
  email_status: string; email_provider_id: string | null;
}

export function privateResponse(body: BodyInit | null, status = 200, headers: HeadersInit = {}): Response {
  const merged = new Headers(headers);
  merged.set('Cache-Control', 'private, no-store');
  merged.set('X-Content-Type-Options', 'nosniff');
  merged.set('X-Robots-Tag', 'noindex, nofollow');
  merged.set('Referrer-Policy', 'same-origin');
  return new Response(body, { status, headers: merged });
}

export async function authorizePrototype(context: APIContext, bindings: Cloudflare.Env): Promise<
  { ok: true; actor: PrototypeActor } | { ok: false; response: Response }
> {
  if (bindings.PROTOTYPE_ENABLED !== 'true') return { ok: false, response: privateResponse('Not found', 404) };
  const identity = getIdentity(context, bindings);
  if (context.locals.auth?.user) {
    if (!identity?.isAdmin) return { ok: false, response: privateResponse('Administrator access required', 403) };
    return { ok: true, actor: { id: identity.userId, mode: 'workos' } };
  }
  if (allowLocalPrototype(context.url, import.meta.env.DEV, bindings)) {
    return { ok: true, actor: { id: 'local-synthetic-admin', mode: 'local' } };
  }
  if (!identity) return { ok: false, response: privateResponse('WorkOS sign-in required. Use /auth/login.', 401) };
  if (!identity.isAdmin) return { ok: false, response: privateResponse('Administrator access required', 403) };
  return { ok: true, actor: { id: identity.userId, mode: 'workos' } };
}

export async function getPrototypeStatus(bindings: Cloudflare.Env) {
  const statuses: Array<{ name: string; state: 'ready' | 'pending' | 'error'; detail: string }> = [
    { name: 'Astro + Workers', state: 'ready', detail: 'Esta página se ejecuta en workerd. El límite de CPU en la nube aún requiere validación.' },
  ];
  try {
    await bindings.DB.prepare('SELECT id FROM prototype_runs LIMIT 1').all();
    statuses.push({ name: 'D1 · SQLite', state: 'ready', detail: 'Conexión y migración disponibles. Crear un caso prueba la escritura y lectura.' });
  } catch {
    statuses.push({ name: 'D1 · SQLite', state: 'error', detail: 'Pendiente de migración local: npm run db:local.' });
  }
  try {
    const latest = await bindings.DB.prepare('SELECT file_key, file_size FROM prototype_runs ORDER BY created_at DESC LIMIT 1')
      .first<{ file_key: string; file_size: number }>();
    const object = latest ? await bindings.SLIPS.head(latest.file_key) : null;
    const ready = object !== null && object.size === latest?.file_size;
    statuses.push({ name: 'R2 · Archivos privados', state: ready ? 'ready' : 'pending', detail: ready
      ? 'Archivo de prueba guardado y consultado. Descárguelo para comprobar el contenido.'
      : 'Binding configurado. Crear un caso y descargar su archivo valida el recorrido.' });
  } catch {
    statuses.push({ name: 'R2 · Archivos privados', state: 'pending', detail: 'Crear un caso después de migrar D1 valida el recorrido.' });
  }
  const auth = getAuthConfigurationStatus(bindings);
  statuses.push({ name: 'WorkOS · Acceso y MFA', state: 'pending', detail: auth.configured ? 'Configuración presente; completar acceso, renovación de sesión y MFA en la cuenta real.' : 'Falta completar la configuración de WorkOS. No se ha probado el acceso real.' });
  statuses.push({ name: 'Brevo · Correo', state: 'pending', detail: bindings.EMAIL_MODE === 'live' ? 'Envío de prueba habilitado solo al destinatario configurado. La aceptación de API no confirma entrega.' : 'Vista previa sin envío. Configuración del remitente, dominio y entrega real pendientes.' });
  return statuses;
}

export async function listPrototypeRuns(bindings: Cloudflare.Env, actor: PrototypeActor): Promise<PrototypeRun[]> {
  const result = await bindings.DB.prepare('SELECT * FROM prototype_runs WHERE owner_id = ? ORDER BY created_at DESC LIMIT 20').bind(actor.id).all<PrototypeRun>();
  return result.results;
}

export async function getPrototypeRun(bindings: Cloudflare.Env, actor: PrototypeActor, id: string): Promise<PrototypeRun | null> {
  return bindings.DB.prepare('SELECT * FROM prototype_runs WHERE id = ? AND owner_id = ?').bind(id, actor.id).first<PrototypeRun>();
}

export async function createPrototypeRun(bindings: Cloudflare.Env, actor: PrototypeActor, form: FormData): Promise<PrototypeRun> {
  const discount = parseDiscount(form.get('discount'));
  const file = form.get('slip');
  if (!(file instanceof File) || file.size < 8 || file.size > MAX_SLIP_BYTES) throw new Error('Invalid file');
  const bytes = await file.arrayBuffer();
  const type = detectSlipType(new Uint8Array(bytes));
  if (!type || (file.type && type !== file.type)) throw new Error('Invalid file');
  // Bound the synthetic lab's storage without creating a live billing system.
  const count = await bindings.DB.prepare('SELECT count(*) AS total FROM prototype_runs').first<number>('total');
  if ((count ?? 0) >= 100) throw new Error('Prototype limit reached');
  const id = crypto.randomUUID();
  const created = new Date().toISOString();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  const date = `${part('year')}-${part('month')}-${part('day')}`;
  const receipt = createReceiptSnapshot({
    receiptNumber: `TEST-${id}`, payerName: 'Persona de prueba', athleteName: 'Atleta de prueba',
    period: date.slice(0, 7), amountMinor: BASE_FEE_MINOR - discount, discountMinor: discount,
    bankReference: 'TEST-000000000000000000000001', transferDate: date, issuedAt: created,
  });
  const key = `prototype/${id}/slip`;
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  await bindings.SLIPS.put(key, bytes, { httpMetadata: { contentType: type } });
  try {
    await bindings.DB.prepare(`INSERT INTO prototype_runs
      (id, owner_id, receipt_number, receipt_json, amount_minor, discount_minor, file_key, file_type, file_size, file_sha256, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        id, actor.id, receipt.receiptNumber, JSON.stringify(receipt), receipt.amountMinor, discount,
        key, type, file.size, hash, created,
      ).run();
  } catch (error) {
    await bindings.SLIPS.delete(key);
    throw error;
  }
  return (await getPrototypeRun(bindings, actor, id))!;
}

export function receiptFromRun(run: PrototypeRun): ReceiptSnapshot {
  return createReceiptSnapshot(JSON.parse(run.receipt_json));
}
