import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { decrypt, encrypt, randomToken, sha256 } from "@/lib/crypto";
import { type Ctx, assertCan } from "./auth";
import { invalid, notFound } from "./errors";
import { audit } from "./audit";

export const EVENTS = {
  "ticket.created": "Ticket creado",
  "ticket.critical": "Incidente crítico (P1)",
  "ticket.resolved": "Ticket resuelto",
  "sla.breached": "SLA vencido",
  "change.pending_approval": "Cambio esperando al CAB",
  "change.closed": "Cambio cerrado",
  "problem.known_error": "Nuevo error conocido",
} as const;
export type EventName = keyof typeof EVENTS;
export const INTEGRATION_TYPES = { teams: "Microsoft Teams", slack: "Slack", webhook: "Webhook (JSON firmado)" } as const;

type Config = { url: string; secret?: string };
export type EventPayload = { title: string; text: string; link: string; fields?: Record<string, string> };

/** Protección SSRF: solo HTTPS a hosts públicos (en desarrollo se permite localhost para pruebas). */
export function validateWebhookUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return "URL inválida."; }
  const devLocal = process.env.ALLOW_PRIVATE_WEBHOOKS === "true" && ["localhost", "127.0.0.1"].includes(u.hostname);
  if (u.protocol !== "https:" && !devLocal) return "La URL debe usar HTTPS.";
  const h = u.hostname.toLowerCase();
  if (!devLocal && (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^(10|127|0)\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h) || h.includes(":") || /^\d+$/.test(h))) {
    return "No se permiten direcciones internas o privadas.";
  }
  return null;
}

/** Formato del mensaje según el destino. */
export function buildBody(type: string, event: EventName, p: EventPayload, appUrl: string) {
  const link = `${appUrl}${p.link}`;
  if (type === "teams") {
    return {
      type: "message",
      attachments: [{
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4",
          body: [
            { type: "TextBlock", text: EVENTS[event], size: "Small", isSubtle: true },
            { type: "TextBlock", text: p.title, weight: "Bolder", size: "Medium", wrap: true },
            { type: "TextBlock", text: p.text, wrap: true },
            ...(p.fields ? [{ type: "FactSet", facts: Object.entries(p.fields).map(([title, value]) => ({ title, value })) }] : []),
          ],
          actions: [{ type: "Action.OpenUrl", title: "Abrir en ITSM Easy", url: link }],
        },
      }],
    };
  }
  if (type === "slack") {
    return { text: `*${EVENTS[event]}* · <${link}|${p.title}>\n${p.text}${p.fields ? "\n" + Object.entries(p.fields).map(([k, v]) => `• ${k}: ${v}`).join("\n") : ""}` };
  }
  return { event, occurredAt: new Date().toISOString(), data: { ...p, url: link } };
}

export function sign(secret: string, body: string, timestamp: string) {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

async function deliver(integration: { id: string; type: string; configEnc: string }, event: EventName, p: EventPayload) {
  const cfg = JSON.parse(decrypt(integration.configEnc)) as Config;
  const body = JSON.stringify(buildBody(integration.type, event, p, process.env.APP_URL ?? ""));
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "ITSM-Easy-Webhooks/1.0" };
  if (integration.type === "webhook" && cfg.secret) {
    const ts = String(Math.floor(Date.now() / 1000));
    headers["x-itsm-timestamp"] = ts;
    headers["x-itsm-signature"] = sign(cfg.secret, body, ts);
  }
  const started = Date.now();
  let ok = false, status: number | null = null, error: string | null = null;
  try {
    const res = await fetch(cfg.url, { method: "POST", headers, body, signal: AbortSignal.timeout(5000), redirect: "manual" });
    status = res.status;
    ok = res.ok;
    if (!ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 200) : "error";
  }
  await db.integrationDelivery.create({ data: { integrationId: integration.id, event, ok, status, error, ms: Date.now() - started } });
  await db.integration.update({ where: { id: integration.id }, data: { lastDeliveryAt: new Date(), lastStatus: ok ? "ok" : error } });
  return { ok, status, error };
}

/** Envía un evento a todas las integraciones activas suscritas (llamar con after() para no demorar al usuario). */
export async function dispatch(orgId: string, event: EventName, p: EventPayload) {
  const list = await db.integration.findMany({ where: { orgId, isActive: true, events: { has: event } } });
  await Promise.all(list.map((i) => deliver(i, event, p).catch((e) => console.error("[integration]", i.id, e))));
}

export const integrationInput = z.object({
  type: z.enum(["teams", "slack", "webhook"]),
  name: z.string().trim().min(2, "Ponle un nombre.").max(80),
  url: z.string().trim().max(2000).optional(),
  events: z.array(z.enum(Object.keys(EVENTS) as [EventName, ...EventName[]])).min(1, "Elige al menos un evento."),
  isActive: z.boolean().default(true),
});

export async function saveIntegration(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "org:manage");
  const input = integrationInput.parse(raw);
  let configEnc: string | undefined;
  let secret: string | undefined;
  if (input.url) {
    const err = validateWebhookUrl(input.url);
    if (err) throw invalid(err, { url: err });
    const prev = id ? await db.integration.findFirst({ where: { id, orgId: ctx.orgId } }) : null;
    const prevCfg = prev ? (JSON.parse(decrypt(prev.configEnc)) as Config) : null;
    secret = input.type === "webhook" ? prevCfg?.secret ?? randomToken(24) : undefined;
    configEnc = encrypt(JSON.stringify({ url: input.url, secret }));
  } else if (!id) throw invalid("Indica la URL del webhook.", { url: "Requerida." });
  const data = { type: input.type, name: input.name, events: input.events, isActive: input.isActive, ...(configEnc ? { configEnc } : {}) };
  let r;
  if (id) {
    if (!(await db.integration.findFirst({ where: { id, orgId: ctx.orgId } }))) throw notFound();
    r = await db.integration.update({ where: { id }, data });
  } else r = await db.integration.create({ data: { ...data, configEnc: configEnc!, orgId: ctx.orgId } });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: id ? "integration.updated" : "integration.created", entity: "integration", entityId: r.id, meta: { type: r.type, events: r.events } });
  return { id: r.id, secret: !id ? secret : undefined };
}

export async function deleteIntegration(ctx: Ctx, id: string) {
  assertCan(ctx, "org:manage");
  const r = await db.integration.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!r) throw notFound();
  await db.integration.delete({ where: { id } });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "integration.deleted", entity: "integration", entityId: id, meta: { name: r.name } });
}

export async function testIntegration(ctx: Ctx, id: string) {
  assertCan(ctx, "org:manage");
  const r = await db.integration.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!r) throw notFound();
  return deliver(r, r.events[0] as EventName, { title: "Prueba de integración", text: `Mensaje de prueba enviado por ${ctx.user.name} desde ITSM Easy.`, link: "/home", fields: { Organización: ctx.user.orgName ?? "" } });
}

export function maskUrl(configEnc: string) {
  try {
    const u = new URL((JSON.parse(decrypt(configEnc)) as Config).url);
    return `${u.protocol}//${u.host}/…`;
  } catch { return "—"; }
}

// ------------------------------------------------------------------ Claves de API
export async function createApiKey(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "org:manage");
  const input = z.object({
    name: z.string().trim().min(2, "Ponle un nombre.").max(80),
    scope: z.enum(["read", "read_write"]).default("read"),
    expiresInDays: z.coerce.number().int().min(0).max(730).default(365),
  }).parse(raw);
  const key = `itsm_${randomToken(30)}`;
  const k = await db.apiKey.create({
    data: { orgId: ctx.orgId, name: input.name, scope: input.scope, prefix: key.slice(0, 12), keyHash: sha256(key), createdById: ctx.user.id, expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400_000) : null },
  });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "apikey.created", entity: "api_key", entityId: k.id, meta: { name: k.name, scope: k.scope } });
  return { id: k.id, key }; // se muestra una sola vez
}

export async function revokeApiKey(ctx: Ctx, id: string) {
  assertCan(ctx, "org:manage");
  const k = await db.apiKey.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!k) throw notFound();
  await db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "apikey.revoked", entity: "api_key", entityId: id, meta: { name: k.name } });
}
