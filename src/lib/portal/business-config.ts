import { restrictedModeRequested, stagingAuthSetupGate, stagingParentTestConfiguration, stagingPortalTestRequested, type StagingAuthEnvironment } from '../staging-auth-policy';

export interface BusinessEnvironment extends StagingAuthEnvironment {
  PORTAL_BUSINESS_CONFIG_APPROVED?: string;
  PAYMENT_BANK_NAME?: string;
  PAYMENT_ACCOUNT_ID?: string;
  PAYMENT_DESTINATION?: string;
  ASSOCIATION_RECEIPT_NAME?: string;
}

export interface BusinessConfiguration {
  // A payment-channel label (for example SINPE Móvil), not required bank access.
  bankName: string;
  // Generic receiving identifier: a confirmed SINPE phone is valid; no IBAN required.
  receivingAccount: string;
  paymentDestination: string;
  associationName: string;
}

// Fictional destination for the loopback-only local demo (PORTAL_DEMO).
// It is never a payment instruction and can only appear on http loopback.
const demoBusiness: BusinessConfiguration = {
  bankName: 'PRUEBA — no transferir',
  receivingAccount: 'demo-synthetic-only',
  paymentDestination: 'ENTORNO DE PRUEBA — no realizar transferencias',
  associationName: 'PRUEBAS — Ajedrez Belén (datos ficticios)',
};

function isLoopbackHttp(request: Request): boolean {
  try {
    const url = new URL(request.url);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

// These are the already approved fictional staging labels, never payment instructions.
const stagingBusiness: BusinessConfiguration = {
  bankName: 'PRUEBA — no transferir',
  receivingAccount: 'staging-synthetic-only',
  paymentDestination: 'ENTORNO DE PRUEBA — no realizar transferencias',
  associationName: 'PRUEBAS — Ajedrez Belén (datos ficticios)',
};

function validText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum &&
    value === value.trim() && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value);
}

/** Resolve public business bindings only; no stores, provider requests or fallback identity. */
export function resolveBusinessConfiguration(request: Request, environment: BusinessEnvironment): BusinessConfiguration | null {
  // Local demo only: fictional labels on http loopback so the demo portal can
  // exercise the full payment form. Production/staging never set PORTAL_DEMO.
  if (environment.PORTAL_DEMO === 'true' && environment.PORTAL_ENABLED === 'true' && isLoopbackHttp(request)) return demoBusiness;
  if (!validText(environment.PAYMENT_BANK_NAME, 80) || !validText(environment.PAYMENT_ACCOUNT_ID, 100) ||
      !validText(environment.PAYMENT_DESTINATION, 200) || !validText(environment.ASSOCIATION_RECEIPT_NAME, 200)) return null;
  const configuration: BusinessConfiguration = {
    bankName: environment.PAYMENT_BANK_NAME,
    receivingAccount: environment.PAYMENT_ACCOUNT_ID,
    paymentDestination: environment.PAYMENT_DESTINATION,
    associationName: environment.ASSOCIATION_RECEIPT_NAME,
  };
  if (restrictedModeRequested(environment)) {
    // Readiness validates the complete pinned configuration, not the actor's session.
    // Middleware and authorizePortal still enforce identity, role and family access.
    const parentModePresent = environment.STAGING_PARENT_TEST !== undefined || environment.STAGING_PARENT_EMAIL !== undefined ||
      environment.STAGING_PARENT_USER_ID !== undefined;
    if (parentModePresent && !stagingParentTestConfiguration(environment)?.userId) return null;
    // A malformed restricted mode can never fall back to a production approval flag.
    if (!stagingPortalTestRequested(environment) || stagingAuthSetupGate(request, environment).status !== 200 ||
        Object.keys(stagingBusiness).some(key => configuration[key as keyof BusinessConfiguration] !== stagingBusiness[key as keyof BusinessConfiguration])) return null;
    return configuration;
  }
  if (environment.PORTAL_BUSINESS_CONFIG_APPROVED !== 'true' || environment.PORTAL_ENABLED !== 'true' ||
      environment.PORTAL_DEMO !== 'false' || environment.PROTOTYPE_ENABLED !== 'false' || environment.PROTOTYPE_LOCAL !== 'false') return null;
  return configuration;
}
