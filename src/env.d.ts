/// <reference types="@cloudflare/workers-types" />
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    SLIPS: R2Bucket;
    PROTOTYPE_ENABLED?: string;
    PROTOTYPE_LOCAL?: string;
    PORTAL_ENABLED?: string;
    PORTAL_DEMO?: string;
    OCR_MODE?: string;
    GROQ_API_KEY?: string;
    GROQ_VISION_MODEL?: string;
    GROQ_TIMEOUT_MS?: string;
    PAYMENT_BANK_NAME?: string;
    PAYMENT_ACCOUNT_ID?: string;
    PAYMENT_DESTINATION?: string;
    ASSOCIATION_RECEIPT_NAME?: string;
    EMAIL_MODE?: string;
    WORKOS_API_KEY?: string;
    WORKOS_CLIENT_ID?: string;
    WORKOS_COOKIE_PASSWORD?: string;
    WORKOS_REDIRECT_URI?: string;
    WORKOS_ORGANIZATION_ID?: string;
    ADMIN_USER_IDS?: string;
    BREVO_API_KEY?: string;
    EMAIL_FROM?: string;
    EMAIL_FROM_NAME?: string;
    EMAIL_TEST_RECIPIENT?: string;
    EMAIL_TIMEOUT_MS?: string;
  }
}
