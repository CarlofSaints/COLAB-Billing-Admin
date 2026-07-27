/**
 * The house style for every email the app sends.
 *
 * Email HTML is not web HTML. Outlook renders through Word, Gmail strips
 * <style> blocks from forwarded copies, and roughly half of recipients see
 * images blocked until they click. So: tables rather than flexbox, inline
 * styles rather than classes, and no images at all.
 *
 * That last point is the nice one — the COLAB mark is a wordmark (the letters
 * C·O·L·A·B, each over its brand-coloured dot, the O over a dash), so it can be
 * rebuilt from table cells and coloured backgrounds. It needs no hosting, never
 * breaks a CDN link, and renders identically whether or not the recipient
 * allows remote content.
 */

/** Brand palette, mirroring globals.css. */
const INK = "#111111";
const CANVAS = "#f6f7f9";
const LINE = "#e2e8f0";
const MUTED = "#64748b";
const BRAND = "#4f46e5";

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** One letter of the wordmark: the character above its coloured dot. */
function mark(letter: string, color: string, dash: boolean): string {
  const width = dash ? 13 : 5;
  return `<td align="center" valign="bottom" style="padding:0 4px">
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:23px;font-weight:900;line-height:23px;letter-spacing:1px;color:#ffffff">${letter}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:6px auto 0"><tr>
      <td width="${width}" height="5" bgcolor="${color}" style="width:${width}px;height:5px;line-height:5px;font-size:0;border-radius:3px">&nbsp;</td>
    </tr></table>
  </td>`;
}

/**
 * The COLAB wordmark in table HTML. Colours are the sub-companies': Atomic
 * Marketing red, iRam green, OuterJoin orange, Atomic Digital blue — which is
 * the whole point of the mark, so they're spelled out rather than themed.
 */
function wordmark(): string {
  const marks = [
    mark("C", "#ed1c24", false),
    mark("O", "#ffffff", true),
    mark("L", "#8dc63f", false),
    mark("A", "#f15a29", false),
    mark("B", "#29abe2", false),
  ].join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${marks}</tr></table>`;
}

/**
 * The inbox preview line, hidden inside the message body. Padded with
 * zero-width characters so the client doesn't pull the first line of real
 * content in after it.
 */
function preheaderBlock(text: string): string {
  const pad = "&#8199;&#65279;&nbsp;".repeat(40);
  return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${CANVAS};opacity:0">${escapeHtml(text)}${pad}</div>`;
}

/** A body paragraph. Pass HTML — callers escape their own interpolations. */
export function p(html: string): string {
  return `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.6;color:#1e293b">${html}</p>`;
}

/** Small muted print, for the "if you weren't expecting this" line. */
export function note(html: string): string {
  return `<p style="margin:20px 0 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED}">${html}</p>`;
}

/** A key/value detail panel — the label column is fixed so rows line up. */
export function detailTable(rows: [string, string][]): string {
  const body = rows
    .map(([label, value], i) => {
      const border = i ? `border-top:1px solid ${LINE};` : "";
      return `<tr>
        <td style="${border}padding:11px 16px;font-family:${FONT};font-size:13px;color:${MUTED};white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td>
        <td style="${border}padding:11px 16px;font-family:${FONT};font-size:14px;color:#1e293b;vertical-align:top">${value}</td>
      </tr>`;
    })
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:18px 0;background-color:#f8fafc;border:1px solid ${LINE};border-radius:10px;border-collapse:separate">${body}</table>`;
}

/** A credential or other value meant to be copied exactly. */
export function codeValue(value: string): string {
  return `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:15px;font-weight:600;color:${INK};background-color:#eef2ff;border:1px solid #dbe1fb;border-radius:5px;padding:3px 8px;display:inline-block">${escapeHtml(value)}</span>`;
}

/** A link rendered as a link, for inside detail rows. */
export function link(href: string, label?: string): string {
  return `<a href="${escapeHtml(href)}" style="color:${BRAND};text-decoration:none;font-weight:500">${escapeHtml(label ?? href)}</a>`;
}

/** Quoted free text, e.g. the body of a reported issue. */
export function quote(text: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0"><tr>
    <td style="padding:14px 18px;background-color:#f8fafc;border-left:3px solid ${BRAND};border-radius:0 8px 8px 0;font-family:${FONT};font-size:15px;line-height:1.6;color:#1e293b;white-space:pre-wrap">${escapeHtml(text)}</td>
  </tr></table>`;
}

/**
 * A call-to-action button. Built from a table cell rather than a styled anchor
 * because Outlook ignores padding on inline elements.
 */
export function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px"><tr>
    <td bgcolor="${BRAND}" style="border-radius:8px">
      <a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(label)}</a>
    </td>
  </tr></table>`;
}

/**
 * Wraps content in the branded shell: black header carrying the wordmark, a
 * white card, and a footer. `preheader` is the line shown next to the subject
 * in the inbox list — worth writing deliberately, since the default is
 * whatever text happens to come first.
 */
export function emailShell(input: {
  preheader: string;
  eyebrow?: string;
  heading: string;
  content: string;
}): string {
  const { preheader, eyebrow, heading, content } = input;

  return `<!--[if mso]><style>body,table,td{font-family:Arial,Helvetica,sans-serif !important}</style><![endif]-->
<div style="background-color:${CANVAS};margin:0;padding:0;width:100%">
${preheaderBlock(preheader)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${CANVAS}"><tr>
  <td align="center" style="padding:28px 12px 40px">

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid ${LINE};border-radius:14px;overflow:hidden">

      <tr>
        <td style="padding:24px 32px;background-color:${INK}">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td>${wordmark()}</td>
          </tr></table>
        </td>
      </tr>

      <tr>
        <td style="padding:32px">
          ${eyebrow ? `<div style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${MUTED};margin:0 0 8px">${escapeHtml(eyebrow)}</div>` : ""}
          <h1 style="margin:0 0 18px;font-family:${FONT};font-size:22px;line-height:1.3;font-weight:700;color:${INK}">${escapeHtml(heading)}</h1>
          ${content}
        </td>
      </tr>

    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px"><tr>
      <td align="center" style="padding:18px 20px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED}">
        Sent by the COLAB hub · Colab Squared (Pty) Ltd
      </td>
    </tr></table>

  </td>
</tr></table>
</div>`;
}

/**
 * The shell for free-text messages (announcements, scheduled reminders) where
 * the body is whatever an admin typed rather than a designed template.
 */
export function plainBodyHtml(body: string, options: { linkify?: boolean } = {}): string {
  const escaped = escapeHtml(body);
  const linked = options.linkify
    ? escaped.replace(
        /(https?:\/\/[^\s<]+)/g,
        `<a href="$1" style="color:${BRAND};text-decoration:none;font-weight:500">$1</a>`,
      )
    : escaped;
  return `<div style="font-family:${FONT};font-size:15px;line-height:1.65;color:#1e293b">${linked.replace(/\n/g, "<br>")}</div>`;
}
