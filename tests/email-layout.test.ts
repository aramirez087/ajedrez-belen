import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMAIL_LOGO_URL, emailButton, emailParagraph, emailRows, emailShell,
} from "../src/lib/email-layout";

const page = (body = "", extra: Partial<Parameters<typeof emailShell>[0]> = {}) =>
  emailShell({ headline: "Registramos tu pago", preheader: "No tienes que hacer nada más.", body, ...extra });

test("every email carries the crest, the red rule, the headline and one WhatsApp footer", () => {
  const html = page(emailParagraph("Hola"));
  assert.match(html, /^<!doctype html>/);
  assert.ok(html.includes(`<img src="${EMAIL_LOGO_URL}"`));
  assert.match(html, /alt="Ajedrez Belén"/);
  assert.ok(html.includes("border-top:4px solid #b3222b"));
  assert.match(html, /<h1[^>]*>Registramos tu pago<\/h1>/);
  assert.ok(html.includes('href="https://wa.me/50687686102"'));
  assert.match(html, /<title>Registramos tu pago<\/title>/);
});

test("mail apps get inline styles, the Portada palette and a light-only scheme", () => {
  const html = page();
  assert.ok(html.includes("background:#f3eee3") && html.includes('bgcolor="#f3eee3"'));
  assert.ok(html.includes("color:#16130f"));
  assert.ok(html.includes('<meta name="color-scheme" content="light only">'));
  assert.ok(!/<link |@import|<script/i.test(html), "no external resources");
  assert.ok(!html.includes("#8c302f") && !html.includes("#f7f4ec"), "no leftover old palette");
});

test("the preheader is hidden in the page and everything dynamic is escaped", () => {
  const html = page(emailParagraph("<b>x</b>") + emailRows("Datos", [["Quien transfirió", "Ana <b>"]]) + emailButton("Ver", 'https://x.test/?a="b"'), {
    preheader: "Vista <previa>",
  });
  assert.match(html, /display:none[^>]*>Vista &lt;previa&gt;</);
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
  assert.ok(html.includes("Ana &lt;b&gt;") && !html.includes("Ana <b>"));
  assert.ok(html.includes('href="https://x.test/?a=&quot;b&quot;"'));
});

test("rows keep a long bank reference inside the card", () => {
  const html = emailRows("Esto es lo que leímos:", [["Referencia", "2026100310283002403934978"]]);
  assert.match(html, /Esto es lo que leímos:/);
  assert.match(html, /overflow-wrap:anywhere[^>]*>2026100310283002403934978</);
});

test("the first button is the filled pill; a second one is outlined", () => {
  const first = emailButton("Ver el pago", "https://ajedrezbelen.com/portal");
  const second = emailButton("Registrar otra", "https://ajedrezbelen.com/portal", false);
  assert.match(first, /border-radius:999px/);
  assert.match(first, /background:#b3222b/);
  assert.match(second, /border:2px solid #b3222b/);
  assert.doesNotMatch(second, /background:#b3222b/);
});

test("a custom footer replaces the default line", () => {
  const html = page("", { footer: "Las respuestas a este correo no se atienden." });
  assert.ok(html.includes("Las respuestas a este correo no se atienden."));
  assert.ok(!html.includes("¿Algo no está bien?"));
});

test("on a phone, labels stack over values and the card padding narrows", () => {
  const html = page(emailRows("Datos", [["Monto", "₡12 000"]]));
  assert.match(html, /@media only screen and \(max-width:480px\)\{\.eb-label,\.eb-value\{display:block!important/);
  assert.match(html, /class="eb-label"/);
  assert.match(html, /class="eb-value"/);
  assert.match(html, /class="eb-pad"/);
});
