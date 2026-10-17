import { test } from "node:test";
import assert from "node:assert/strict";
import { sendPasswordResetEmail } from "../src/lib/auth-email";

const live = { EMAIL_MODE: "live", BREVO_API_KEY: "test-key", EMAIL_FROM: "no-reply@ajedrezbelen.com", EMAIL_FROM_NAME: "Ajedrez Belén" };

test("the reset email is branded, links the exact reset page, and keeps a plain-text copy", async () => {
  let sent: { to: Array<{ email: string }>; subject: string; htmlContent: string; textContent: string } | null = null;
  const url = "https://ajedrezbelen.com/auth/restablecer?token=abc&x=1";
  const result = await sendPasswordResetEmail(live, { to: "familia@example.cr", resetUrl: url }, async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return new Response("{}", { status: 201 });
  });
  assert.equal(result, "sent");
  assert.equal(sent!.to[0]?.email, "familia@example.cr");
  assert.equal(sent!.subject, "Restablece tu contraseña · Ajedrez Belén");
  assert.ok(sent!.htmlContent.includes("https://ajedrezbelen.com/media/crest-provisional.png"));
  assert.match(sent!.htmlContent, /<h1[^>]*>Restablece tu contraseña<\/h1>/);
  assert.ok(sent!.htmlContent.includes('href="https://ajedrezbelen.com/auth/restablecer?token=abc&amp;x=1"'));
  assert.ok(sent!.textContent.includes(url));
});

test("without live mode nothing is requested", async () => {
  const result = await sendPasswordResetEmail({ ...live, EMAIL_MODE: "dry_run" }, { to: "a@b.cr", resetUrl: "https://x.test" },
    async () => { throw new Error("must not fetch"); });
  assert.equal(result, "dry_run");
});
