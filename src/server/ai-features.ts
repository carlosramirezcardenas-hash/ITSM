import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { priorityMatrix, similarity, type Level } from "@/lib/classify";
import { ticketRef } from "@/lib/utils";
import { type Ctx, assertCan } from "./auth";
import { AppError, forbidden, notFound } from "./errors";
import { callJson, clip } from "./ai";
import { pickAssignee } from "./tickets";

const LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const str = { type: "string" };
const strArr = { type: "array", items: { type: "string" } };

// Límite por usuario para evitar abuso/costos (en memoria por instancia)
const hits = new Map<string, number[]>();
function throttle(userId: string, max = 30, windowMs = 10 * 60_000) {
  const now = Date.now();
  const list = (hits.get(userId) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new AppError("RATE_LIMIT", "Usaste muchas veces la IA en poco tiempo. Espera unos minutos.");
  list.push(now);
  hits.set(userId, list);
}

async function rankArticles(orgId: string, text: string, take: number) {
  const arts = await db.kbArticle.findMany({ where: { orgId, status: "PUBLISHED" }, select: { id: true, slug: true, title: true, summary: true, body: true, tags: true } });
  return arts
    .map((a) => ({ ...a, score: similarity(text, `${a.title} ${a.summary} ${a.tags.join(" ")}`) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, take);
}

// ------------------------------------------------------------------ Triage (clasificación y prioridad)
export type AiSuggestion = {
  categoryId: string | null; categoryName: string | null; impact: Level; urgency: Level; priority: string;
  confidence: number; rationale: string; articles: { id: string; slug: string; title: string }[]; applied: boolean; at: string;
};

/** Clasifica un incidente recién creado. Solo aplica sola la categoría (enrutamiento) si la regla no la encontró y la confianza es alta. */
export async function triageTicket(ctx: Ctx, ticketId: string) {
  const t = await db.ticket.findFirst({ where: { id: ticketId, orgId: ctx.orgId } });
  if (!t) throw notFound();
  const categories = await db.category.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true, keywords: true, teamId: true } });
  const articles = await rankArticles(ctx.orgId, `${t.title} ${t.description}`, 8);
  const r = await callJson<{ category_id: string; impact: Level; urgency: Level; confidence: number; rationale: string; article_ids: string[] }>(ctx, "triage", {
    task: `Clasifica este reporte de una mesa de ayuda.
- category_id: el id de la categoría más adecuada de la lista, o "none" si ninguna aplica.
- impact: a cuántas personas afecta (LOW = una persona, MEDIUM = un equipo/área, HIGH = toda la empresa o clientes).
- urgency: cuánto impide trabajar (LOW = puede seguir, MEDIUM = le dificulta, HIGH = no puede trabajar).
- confidence: tu confianza de 0 a 1 en la categoría.
- rationale: una frase que explique la clasificación.
- article_ids: hasta 3 ids de artículos que podrían resolverlo (solo de la lista; vacío si ninguno aplica).`,
    data: `Título: ${clip(t.title, 300)}\nDescripción: ${clip(t.description)}\nImpacto declarado por el usuario: ${t.impact}\nUrgencia declarada: ${t.urgency}\n\nCategorías:\n${categories.map((c) => `- ${c.id}: ${c.name} (${c.keywords.slice(0, 8).join(", ")})`).join("\n")}\n\nArtículos:\n${articles.map((a) => `- ${a.id}: ${a.title} — ${a.summary}`).join("\n")}`,
    schema: obj({ category_id: { type: "string", enum: [...categories.map((c) => c.id), "none"] }, impact: { type: "string", enum: LEVELS }, urgency: { type: "string", enum: LEVELS }, confidence: { type: "number" }, rationale: str, article_ids: strArr }),
    effort: "low",
    maxTokens: 2000,
  });
  const category = categories.find((c) => c.id === r.category_id) ?? null;
  const confidence = Math.max(0, Math.min(1, Number(r.confidence) || 0));
  const autoApply = !!category && !t.categoryId && confidence >= 0.8 && t.status !== "CLOSED";
  const suggestion: AiSuggestion = {
    categoryId: category?.id ?? null, categoryName: category?.name ?? null, impact: r.impact, urgency: r.urgency,
    priority: priorityMatrix(r.impact, r.urgency), confidence, rationale: clip(r.rationale, 400),
    articles: articles.filter((a) => r.article_ids.includes(a.id)).slice(0, 3).map(({ id, slug, title }) => ({ id, slug, title })),
    applied: autoApply, at: new Date().toISOString(),
  };
  await db.$transaction(async (tx) => {
    const data: Record<string, unknown> = { aiSuggestion: suggestion };
    if (autoApply && category) {
      data.categoryId = category.id;
      if (!t.teamId && category.teamId) {
        data.teamId = category.teamId;
        if (!t.assigneeId) {
          const a = await pickAssignee(ctx.orgId, category.teamId);
          if (a) { data.assigneeId = a; if (t.status === "NEW") data.status = "ASSIGNED"; }
        }
      }
      await tx.ticketActivity.create({ data: { ticketId: t.id, action: "classified", toValue: category.name, note: `Clasificación por IA (confianza ${Math.round(confidence * 100)}%)` } });
    }
    await tx.ticket.update({ where: { id: t.id }, data });
  });
  return suggestion;
}

/** Aplica la prioridad/categoría sugerida tras la confirmación de un agente. */
export async function acceptSuggestion(ctx: Ctx, ticketId: string) {
  assertCan(ctx, "tickets:work");
  const t = await db.ticket.findFirst({ where: { id: ticketId, orgId: ctx.orgId } });
  if (!t) throw notFound();
  const s = t.aiSuggestion as AiSuggestion | null;
  if (!s) throw new AppError("VALIDATION", "Este ticket no tiene sugerencias de IA.");
  return { impact: s.impact, urgency: s.urgency, categoryId: s.categoryId ?? t.categoryId };
}

// ------------------------------------------------------------------ Resumen
export async function summarizeTicket(ctx: Ctx, ticketId: string) {
  assertCan(ctx, "tickets:work");
  throttle(ctx.user.id);
  const t = await db.ticket.findFirst({
    where: { id: ticketId, orgId: ctx.orgId },
    include: {
      requester: { select: { name: true } },
      comments: { include: { author: { select: { name: true, role: true } } }, orderBy: { createdAt: "asc" }, take: 80 },
      activities: { orderBy: { createdAt: "asc" }, take: 80 },
    },
  });
  if (!t) throw notFound();
  const thread = t.comments.map((c) => `[${c.createdAt.toISOString().slice(0, 16)}] ${c.author.name}${can(c.author.role, "tickets:work") ? " (soporte)" : ""}${c.isInternal ? " [nota interna]" : ""}: ${clip(c.body, 1200)}`).join("\n");
  const events = t.activities.map((a) => `[${a.createdAt.toISOString().slice(0, 16)}] ${a.action} ${a.fromValue ?? ""}→${a.toValue ?? ""} ${a.note ?? ""}`).join("\n");
  const r = await callJson<{ summary: string; key_points: string[]; next_step: string; sentiment: string }>(ctx, "summary", {
    task: "Resume este ticket para un agente que lo toma recién. summary: 2-4 frases. key_points: hasta 5 hechos relevantes (qué se probó, qué falta). next_step: la acción concreta siguiente. sentiment: ánimo del solicitante.",
    data: `${ticketRef(t.type, t.number)} · ${t.title}\nEstado: ${t.status} · Prioridad: ${t.priority}\nSolicitante: ${t.requester.name}\nDescripción: ${clip(t.description)}\nSolución registrada: ${clip(t.resolution, 800) || "—"}\n\nConversación:\n${thread || "(sin mensajes)"}\n\nEventos:\n${events}`,
    schema: obj({ summary: str, key_points: strArr, next_step: str, sentiment: { type: "string", enum: ["tranquilo", "preocupado", "molesto", "satisfecho"] } }),
    effort: "medium",
  });
  const text = JSON.stringify(r);
  await db.ticket.update({ where: { id: t.id }, data: { aiSummary: text, aiSummaryAt: new Date() } });
  return r;
}

// ------------------------------------------------------------------ Respuesta sugerida
export async function suggestReply(ctx: Ctx, ticketId: string) {
  assertCan(ctx, "tickets:work");
  throttle(ctx.user.id);
  const t = await db.ticket.findFirst({
    where: { id: ticketId, orgId: ctx.orgId },
    include: { requester: { select: { name: true } }, comments: { where: { isInternal: false }, include: { author: { select: { name: true } } }, orderBy: { createdAt: "asc" }, take: 40 }, problem: { select: { workaround: true, status: true } } },
  });
  if (!t) throw notFound();
  const articles = await rankArticles(ctx.orgId, `${t.title} ${t.description}`, 3);
  const r = await callJson<{ reply: string; used_article_ids: string[] }>(ctx, "reply", {
    task: `Redacta la próxima respuesta del agente (${ctx.user.name}) al solicitante. Tono cercano y profesional, frases cortas, pasos numerados si corresponde.
Usa solo información de los artículos, la solución temporal del problema conocido o la conversación; si no basta, pide los datos que faltan.
No prometas plazos ni acciones que no consten. reply: el texto listo para revisar (sin firma). used_article_ids: ids de artículos usados.`,
    data: `Ticket: ${t.title}\nDescripción: ${clip(t.description)}\nSolicitante: ${t.requester.name}\nEstado: ${t.status}${t.problem?.workaround ? `\nSolución temporal conocida (error conocido): ${clip(t.problem.workaround, 1500)}` : ""}\n\nConversación:\n${t.comments.map((c) => `${c.author.name}: ${clip(c.body, 1000)}`).join("\n") || "(sin mensajes)"}\n\nArtículos:\n${articles.map((a) => `### ${a.id} — ${a.title}\n${clip(a.body, 1500)}`).join("\n\n")}`,
    schema: obj({ reply: str, used_article_ids: strArr }),
    effort: "medium",
  });
  return { reply: r.reply.trim(), articles: articles.filter((a) => r.used_article_ids.includes(a.id)).map(({ id, slug, title }) => ({ id, slug, title })) };
}

// ------------------------------------------------------------------ Causa raíz
export async function suggestRootCause(ctx: Ctx, problemId: string) {
  assertCan(ctx, "problems:manage");
  throttle(ctx.user.id);
  const p = await db.problem.findFirst({
    where: { id: problemId, orgId: ctx.orgId },
    include: {
      incidents: { select: { number: true, title: true, description: true, resolution: true, createdAt: true, configItem: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 30 },
      configItems: { select: { id: true, name: true, type: true, version: true } },
    },
  });
  if (!p) throw notFound();
  const ciIds = p.configItems.map((c) => c.id);
  const changes = ciIds.length ? await db.change.findMany({
    where: { orgId: ctx.orgId, configItems: { some: { id: { in: ciIds } } }, plannedStart: { gt: new Date(Date.now() - 60 * 86400_000) } },
    select: { number: true, title: true, status: true, outcome: true, plannedStart: true },
  }) : [];
  const r = await callJson<{ hypotheses: { cause: string; evidence: string; confidence: string }[]; workaround: string; next_steps: string[] }>(ctx, "rca", {
    task: `Eres un analista de gestión de problemas (ITIL 4). Propón hipótesis de causa raíz basadas en los incidentes, los elementos de configuración y los cambios recientes.
hypotheses: 1-4, ordenadas de más a menos probable, cada una con la evidencia concreta de los datos y confidence (baja/media/alta).
workaround: una solución temporal plausible (vacío si no hay base). next_steps: 2-5 verificaciones para confirmar o descartar.`,
    data: `Problema: ${p.title}\nDescripción: ${clip(p.description)}\nCausa ya documentada: ${clip(p.rootCause, 1500) || "—"}\n\nElementos: ${p.configItems.map((c) => `${c.name} (${c.type}${c.version ? ` ${c.version}` : ""})`).join(", ") || "—"}\n\nCambios recientes en esos elementos:\n${changes.map((c) => `- CHG-${c.number} ${c.title} · ${c.status}${c.outcome ? ` · ${c.outcome}` : ""} · ${c.plannedStart?.toISOString().slice(0, 10)}`).join("\n") || "—"}\n\nIncidentes vinculados (${p.incidents.length}):\n${p.incidents.map((i) => `- INC-${i.number} [${i.createdAt.toISOString().slice(0, 10)}] ${i.title}${i.configItem ? ` (${i.configItem.name})` : ""}: ${clip(i.description, 300)}${i.resolution ? ` | Resolución: ${clip(i.resolution, 300)}` : ""}`).join("\n")}`,
    schema: obj({ hypotheses: { type: "array", items: obj({ cause: str, evidence: str, confidence: { type: "string", enum: ["baja", "media", "alta"] } }) }, workaround: str, next_steps: strArr }),
    effort: "high",
    maxTokens: 6000,
  });
  return r;
}

// ------------------------------------------------------------------ Tendencias
export async function analyzeTrends(ctx: Ctx, metrics: unknown) {
  assertCan(ctx, "reports:view");
  throttle(ctx.user.id);
  return callJson<{ insights: { title: string; detail: string; severity: string }[]; problem_candidates: { title: string; reason: string }[]; recommendations: string[] }>(ctx, "trends", {
    task: `Analiza estos indicadores agregados de una mesa de ayuda (no contienen datos personales).
insights: 3-6 hallazgos accionables con severity (info/atencion/critico). problem_candidates: patrones recurrentes que conviene investigar como problema (ITIL). recommendations: 2-5 acciones concretas para el gestor.`,
    data: JSON.stringify(metrics).slice(0, 20000),
    schema: obj({ insights: { type: "array", items: obj({ title: str, detail: str, severity: { type: "string", enum: ["info", "atencion", "critico"] } }) }, problem_candidates: { type: "array", items: obj({ title: str, reason: str }) }, recommendations: strArr }),
    effort: "medium",
    maxTokens: 5000,
  });
}

// ------------------------------------------------------------------ Autoayuda para usuarios
export const selfHelpInput = z.string().trim().min(6, "Describe tu problema con un poco más de detalle.").max(1000);

export async function selfHelp(ctx: Ctx, raw: string) {
  const text = selfHelpInput.parse(raw);
  throttle(ctx.user.id, 15);
  const articles = (await rankArticles(ctx.orgId, text, 4)).filter((a) => a.score > 0);
  if (!articles.length) return { answer: "", articles: [], resolvedLikely: false };
  const r = await callJson<{ answer: string; article_ids: string[]; can_self_solve: boolean }>(ctx, "selfhelp", {
    task: `Un empleado describe un problema. Si alguno de los artículos lo resuelve, explica los pasos en 3-6 líneas simples (sin tecnicismos) y cita los artículos usados en article_ids.
Si ningún artículo aplica, answer debe decir brevemente que lo mejor es enviar el reporte al equipo de soporte, con article_ids vacío y can_self_solve=false.
Nunca inventes pasos que no estén en los artículos.`,
    data: `Problema: ${clip(text, 1000)}\n\nArtículos:\n${articles.map((a) => `### ${a.id} — ${a.title}\n${clip(a.body, 1500)}`).join("\n\n")}`,
    schema: obj({ answer: str, article_ids: strArr, can_self_solve: { type: "boolean" } }),
    effort: "low",
    maxTokens: 2000,
  });
  return {
    answer: r.answer.trim(),
    articles: articles.filter((a) => r.article_ids.includes(a.id)).map(({ slug, title }) => ({ slug, title })),
    resolvedLikely: r.can_self_solve,
  };
}

export async function aiUsageStats(ctx: Ctx) {
  assertCan(ctx, "org:manage");
  const since = new Date(Date.now() - 30 * 86400_000);
  const rows = await db.aiUsage.groupBy({ by: ["feature", "ok"], where: { orgId: ctx.orgId, createdAt: { gte: since } }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true }, _avg: { ms: true } });
  return rows;
}

export function ensureStaff(ctx: Ctx) {
  if (!can(ctx.user.role, "tickets:work")) throw forbidden();
}
