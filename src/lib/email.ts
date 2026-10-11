import { renderReceipt, type ReceiptData } from './receipt.ts';

export interface ReceiptEmailConfig {
  EMAIL_MODE?: string;
  BREVO_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  EMAIL_TEST_RECIPIENT?: string;
  EMAIL_TIMEOUT_MS?: string | number;
}

export interface ReceiptEmailMessage {
  to: string;
  /** Persist one UUID with the outbox item; do not regenerate it during a retry. */
  idempotencyKey: string;
  receipt: ReceiptData;
}

export type ReceiptEmailResult =
  | { status: 'dry_run' }
  | { status: 'accepted'; providerMessageId: string }
  | {
    status: 'blocked' | 'rejected' | 'unknown';
    code: 'invalid_message' | 'missing_configuration' | 'recipient_not_allowed' |
      'invalid_configuration' | 'provider_auth' | 'provider_limit' | 'provider_rejected' |
      'provider_error' | 'duplicate_request' | 'invalid_provider_response' | 'network_or_timeout';
    /** Only an explicit refusal, such as HTTP 429, can be safely deferred and tried later. */
    retryable: boolean;
    httpStatus?: number;
  };

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function validEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 &&
    /^[^\s\u0000-\u001f\u007f<>(),;:"\\@]+@[^\s\u0000-\u001f\u007f<>(),;:"\\@]+\.[^\s\u0000-\u001f\u007f<>(),;:"\\@]+$/.test(value);
}

/**
 * One HTTPS attempt, intentionally without an SDK retry policy.
 * Call only from a deliberate, authenticated test action. Default mode never calls fetch.
 * An accepted message is queued by Brevo, NOT confirmed delivered to the recipient.
 */
export async function sendReceiptEmail(
  config: ReceiptEmailConfig,
  message: ReceiptEmailMessage,
  fetcher: Fetcher = fetch,
): Promise<ReceiptEmailResult> {
  let rendered;
  try {
    rendered = renderReceipt(message.receipt);
    if (!validEmail(message.to) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(message.idempotencyKey)) {
      return { status: 'blocked', code: 'invalid_message', retryable: false };
    }
  } catch {
    return { status: 'blocked', code: 'invalid_message', retryable: false };
  }

  if (config.EMAIL_MODE !== 'live') return { status: 'dry_run' };

  if (!config.BREVO_API_KEY || !config.EMAIL_FROM || !config.EMAIL_FROM_NAME || !config.EMAIL_TEST_RECIPIENT) {
    return { status: 'blocked', code: 'missing_configuration', retryable: false };
  }
  const timeoutMs = Number(config.EMAIL_TIMEOUT_MS ?? 10_000);
  if (!validEmail(config.EMAIL_FROM) || !validEmail(config.EMAIL_TEST_RECIPIENT) ||
      /[\u0000-\u001f\u007f]/.test(config.BREVO_API_KEY + config.EMAIL_FROM_NAME) ||
      config.EMAIL_FROM_NAME.trim().length === 0 || config.EMAIL_FROM_NAME.length > 160 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30_000) {
    return { status: 'blocked', code: 'invalid_configuration', retryable: false };
  }
  if (message.to !== config.EMAIL_TEST_RECIPIENT) {
    return { status: 'blocked', code: 'recipient_not_allowed', retryable: false };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': config.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { email: config.EMAIL_FROM, name: config.EMAIL_FROM_NAME },
        to: [{ email: message.to }],
        subject: rendered.subject,
        htmlContent: rendered.html,
        textContent: rendered.text,
        // Brevo's idempotency guide uses this JSON-body header, not an HTTP header.
        // Protection expires; the application outbox remains the durable dedupe authority.
        headers: { idempotencyKey: message.idempotencyKey },
        tags: ['compatibility-prototype'],
      }),
    });

    // Never expose a raw response or exception: either could include API keys or personal data.
    let body: unknown;
    try { body = await response.json(); } catch { body = undefined; }
    const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    if (response.status === 201) {
      if (typeof record.messageId !== 'string' || record.messageId.length === 0 ||
          record.messageId.length > 512 || /[\u0000-\u001f\u007f]/.test(record.messageId)) {
        return { status: 'unknown', code: 'invalid_provider_response', retryable: false, httpStatus: response.status };
      }
      return { status: 'accepted', providerMessageId: record.messageId };
    }
    if (record.code === 'duplicate_parameter') {
      return { status: 'unknown', code: 'duplicate_request', retryable: false, httpStatus: response.status };
    }
    if (response.status === 401 || response.status === 403) {
      return { status: 'rejected', code: 'provider_auth', retryable: false, httpStatus: response.status };
    }
    if (response.status === 429) {
      return { status: 'rejected', code: 'provider_limit', retryable: true, httpStatus: response.status };
    }
    if (response.status >= 400 && response.status < 500 && response.status !== 408) {
      return { status: 'rejected', code: 'provider_rejected', retryable: false, httpStatus: response.status };
    }
    // A timeout, 5xx, unexpected 2xx/redirect, or malformed success may follow acceptance.
    return { status: 'unknown', code: 'provider_error', retryable: false, httpStatus: response.status };
  } catch {
    return { status: 'unknown', code: 'network_or_timeout', retryable: false };
  } finally {
    clearTimeout(timeout);
  }
}
