import "server-only";

/**
 * Envío de correo transaccional vía Resend (API HTTP). Opcional: sin RESEND_API_KEY no se envía nada.
 * Variables: RESEND_API_KEY, EMAIL_FROM (p. ej. "ITSM Easy <soporte@tuempresa.com>").
 */
export function emailConfigured() {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderEmail(title: string, body: string, cta?: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f6;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="100%" style="max-width:520px;background:#fff;border-radius:12px;border:1px solid #e6e6ea" cellpadding="0" cellspacing="0"><tr><td style="padding:28px">
<p style="margin:0 0 16px;font-size:13px;color:#6b6b76">ITSM Easy</p>
<h1 style="margin:0 0 12px;font-size:20px">${esc(title)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5">${esc(body).replace(/\n/g, "<br>")}</p>
${cta ? `<a href="${esc(cta.url)}" style="display:inline-block;background:#5b5bd6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">${esc(cta.label)}</a>` : ""}
</td></tr></table></td></tr></table></body></html>`;
}

export async function sendEmail(to: string, subject: string, html: string) {
  if (!emailConfigured()) return { sent: false, reason: "not_configured" as const };
  try {
    const res = await fetch(`${process.env.RESEND_BASE_URL ?? "https://api.resend.com"}/emails`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error("[email] HTTP", res.status);
    return { sent: res.ok, reason: res.ok ? undefined : ("error" as const) };
  } catch (e) {
    console.error("[email]", e);
    return { sent: false, reason: "error" as const };
  }
}
