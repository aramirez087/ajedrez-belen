/**
 * One frame for every email the app sends: crest, Portada colours, one footer.
 * Mail apps ignore stylesheets and web fonts, so everything is inline and the
 * headline falls back to Georgia (the closest common match to Belen Display).
 * Callers pass plain text to the helpers; escaping happens here.
 */

export const EMAIL_LOGO_URL = 'https://ajedrezbelen.com/media/crest-provisional.png';
const WHATSAPP_URL = 'https://wa.me/50687686102';

const paper = '#f3eee3';
const card = '#fffdf7';
const newsprint = '#ebe4d4';
const ink = '#16130f';
const red = '#b3222b';
const muted = '#655d50';
const line = '#d8cfba';
const bodyFont = "'DM Sans',Arial,Helvetica,sans-serif";
const headlineFont = "Georgia,'Times New Roman',serif";

export type EmailRow = [label: string, value: string];

export function escapeEmailHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function emailParagraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:16px;line-height:1.55">${escapeEmailHtml(text)}</p>`;
}

/** Small print under the content, such as how long a saved file is kept. */
export function emailNote(text: string): string {
  return `<p style="margin:8px 0 0;font-size:13px;line-height:1.5;color:${muted}">${escapeEmailHtml(text)}</p>`;
}

/** A titled box of label and value pairs, for what was read or how a payment was applied. */
export function emailRows(title: string, rows: EmailRow[]): string {
  const cells = rows.map(([label, value]) =>
    `<tr><td class="eb-label" valign="top" style="padding:7px 12px 7px 0;font-size:14px;color:${muted};width:38%">${escapeEmailHtml(label)}</td>` +
    `<td class="eb-value" valign="top" style="padding:7px 0;font-size:15px;font-weight:700;overflow-wrap:anywhere;word-break:break-word">${escapeEmailHtml(value)}</td></tr>`).join('');
  return `<table role="presentation" width="100%" bgcolor="${newsprint}" style="border-collapse:collapse;margin:0 0 20px;background:${newsprint}"><tr><td style="padding:16px 18px">` +
    `<p style="margin:0 0 6px;font-size:14px;font-weight:700">${escapeEmailHtml(title)}</p>` +
    `<table role="presentation" width="100%" style="border-collapse:collapse"><tbody>${cells}</tbody></table></td></tr></table>`;
}

/** Pill button. The first one on a page is filled; further ones are outlined. */
export function emailButton(label: string, url: string, primary = true): string {
  const look = primary
    ? `background:${red};border:2px solid ${red};color:#ffffff`
    : `background:${card};border:2px solid ${red};color:${red}`;
  return `<p style="margin:0 0 12px"><a href="${escapeEmailHtml(url)}" style="display:inline-block;${look};border-radius:999px;padding:12px 26px;font-size:16px;font-weight:700;text-decoration:none">${escapeEmailHtml(label)}</a></p>`;
}

export interface EmailShellInput {
  headline: string;
  /** Inbox preview line: hidden in the message itself. */
  preheader?: string;
  /** Built from the helpers above. */
  body: string;
  /** Replaces the default WhatsApp line; plain text with no markup. */
  footer?: string;
}

export function emailShell({ headline, preheader = '', body, footer }: EmailShellInput): string {
  const footerHtml = footer
    ? escapeEmailHtml(footer)
    : `¿Algo no está bien? Escríbenos por <a href="${WHATSAPP_URL}" style="color:${red};font-weight:700">WhatsApp</a>.`;
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><style>@media only screen and (max-width:480px){.eb-label,.eb-value{display:block!important;width:100%!important;padding-right:0!important}.eb-label{padding-bottom:0!important}.eb-value{padding-top:1px!important}.eb-pad{padding-left:18px!important;padding-right:18px!important}}</style><title>${escapeEmailHtml(headline)}</title></head>
<body style="margin:0;padding:0;background:${paper};color:${ink};font-family:${bodyFont}" bgcolor="${paper}">
<div aria-hidden="true" style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeEmailHtml(preheader)}</div>
<table role="presentation" width="100%" bgcolor="${paper}" style="border-collapse:collapse;background:${paper}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" bgcolor="${card}" style="border-collapse:collapse;width:100%;max-width:600px;background:${card};border:1px solid ${line};border-top:4px solid ${red}">
<tr><td class="eb-pad" style="padding:24px 28px 0"><table role="presentation" style="border-collapse:collapse"><tr>
<td valign="middle" style="padding:0 14px 0 0"><img src="${EMAIL_LOGO_URL}" alt="Ajedrez Belén" width="56" height="56" style="display:block;width:56px;height:56px;border:0"></td>
<td valign="middle" style="font-family:${headlineFont};font-size:22px;font-weight:700;color:${ink}">Ajedrez Belén</td>
</tr></table></td></tr>
<tr><td class="eb-pad" style="padding:20px 28px 28px">
<h1 style="margin:0 0 14px;font-family:${headlineFont};font-size:28px;line-height:1.2;font-weight:700;color:${ink}">${escapeEmailHtml(headline)}</h1>
${body}
</td></tr></table>
<p style="max-width:600px;margin:18px auto 0;font-size:13px;line-height:1.5;color:${muted};text-align:center">${footerHtml}<br>Ajedrez Belén · Belén, Heredia, Costa Rica</p>
</td></tr></table>
</body></html>`;
}
