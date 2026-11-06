import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { classifyCategory, matchScore, normalize, suggestLevels, type Level } from "@/lib/classify";
import { STATUS_USER_LABEL } from "@/lib/labels";
import { ticketRef } from "@/lib/utils";
import type { Ctx } from "./auth";
import { aiAvailable, callJson, clip } from "./ai";
import { throttle } from "./ai-features";

/**
 * Asistente conversacional del portal del empleado.
 * Entiende lo que la persona necesita y PROPONE: una guía, un servicio del catálogo o un reporte ya redactado.
 * Nunca crea nada por su cuenta: la persona confirma con un botón (que llama a las acciones normales con sus permisos).
 * Sin IA configurada funciona en "modo básico" con reglas (palabras clave, catálogo y centro de ayuda).
 */

export const assistantInput = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(1000) })).min(1).max(20),
});

export type AssistantReply = {
  reply: string;
  mode: "ai" | "basic";
  intent: "question" | "problem" | "request" | "status" | "other";
  articles: { slug: string; title: string; summary: string }[];
  service: { id: string; name: string; icon: string; estimatedHours: number; requiresApproval: boolean } | null;
  ticket: { title: string; description: string; impact: Level; urgency: Level } | null;
  tickets: { id: string; ref: string; title: string; status: string }[];
};

const LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
const STATUS_RE = /(como va|en que va|estado de|seguimiento|mis solicitudes|mis reportes|mi solicitud|mi reporte|mi ticket|mis tickets|ya esta listo|cuando estara)/;
const REQUEST_RE = /(necesito|quiero|quisiera|solicit|pedir|me gustaria|nuevo|nueva|instalar|acceso|alta de|dar de alta|habilitar|comprar|licencia)/;
const PROBLEM_RE = /(no funciona|no puedo|no me deja|no carga|no abre|no conecta|error|falla|se cayo|caido|lento|no enciende|no imprime|bloquead|no responde|se congela|no llega)/;

export async function assistantTurn(ctx: Ctx, raw: unknown): Promise<AssistantReply> {
  const { messages } = assistantInput.parse(raw);
  const userText = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const [articles, services, categories, mine] = await Promise.all([
    db.kbArticle.findMany({ where: { orgId: ctx.orgId, status: "PUBLISHED" }, select: { id: true, slug: true, title: true, summary: true, body: true, tags: true } }),
    db.serviceItem.findMany({
      where: { orgId: ctx.orgId, isActive: true },
      select: { id: true, name: true, description: true, icon: true, estimatedHours: true, requiresApproval: true, popularity: true, categoryId: true, category: { select: { name: true } } },
    }),
    db.category.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true, keywords: true } }),
    db.ticket.findMany({
      where: { orgId: ctx.orgId, requesterId: ctx.user.id, status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING", "RESOLVED"] } },
      orderBy: { updatedAt: "desc" }, take: 8, select: { id: true, number: true, type: true, title: true, status: true },
    }),
  ]);

  const rankedArticles = articles
    .map((a) => ({ ...a, score: matchScore(userText, `${a.title} ${a.summary} ${a.tags.join(" ")}`) }))
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const cat = classifyCategory(userText, categories);
  const rankedServices = services
    .map((s) => ({ ...s, score: matchScore(last, `${s.name} ${s.description}`) * 2 + matchScore(userText, `${s.name} ${s.description} ${s.category?.name ?? ""}`) + (cat && s.categoryId === cat.category.id ? 0.15 : 0) }))
    .sort((a, b) => b.score - a.score || b.popularity - a.popularity);
  const myTickets = mine.map((t) => ({ id: t.id, ref: ticketRef(t.type, t.number), title: t.title, status: STATUS_USER_LABEL[t.status] ?? t.status, number: t.number }));

  const pickService = (id: string | null | undefined) => {
    const s = id ? services.find((x) => x.id === id) : null;
    return s ? { id: s.id, name: s.name, icon: s.icon, estimatedHours: s.estimatedHours, requiresApproval: s.requiresApproval } : null;
  };
  const pickArticles = (ids: string[]) => articles.filter((a) => ids.includes(a.id)).slice(0, 3).map(({ slug, title, summary }) => ({ slug, title, summary }));
  const draft = (title: string | null, impact?: Level, urgency?: Level) => {
    const hints = suggestLevels(userText);
    const firstLine = (title?.trim() || messages.find((m) => m.role === "user")!.content).split("\n")[0]!;
    return {
      title: clip(firstLine, 150).replace(/…$/, "").padEnd(5, "."),
      description: `${userText}\n\n(Conversación con el asistente del portal)`.slice(0, 5000),
      impact: impact ?? hints.impact ?? "LOW",
      urgency: urgency ?? hints.urgency ?? "MEDIUM",
    };
  };

  if (await aiAvailable(ctx.orgId)) {
    try {
      throttle(ctx.user.id, 40);
      const transcript = messages.map((m) => `${m.role === "user" ? "Empleado" : "Asistente"}: ${clip(m.content, 1000)}`).join("\n");
      const r = await callJson<{
        reply: string; intent: AssistantReply["intent"]; article_ids: string[]; service_id: string;
        propose_ticket: boolean; ticket_title: string; impact: Level; urgency: Level; ticket_numbers: number[];
      }>(ctx, "assistant", {
        task: `Eres el asistente del portal de servicios de TI. Conversa con un empleado que NO conoce términos técnicos ni ITIL
(nunca uses palabras como incidente, SLA, ITIL, CMDB, prioridad P1). Responde en 1-4 frases cortas y amables, en español neutro.
Decide qué necesita y elige UNA de estas salidas:
- Si una guía de la lista lo resuelve: explica los pasos clave en pocas líneas y pon su id en article_ids (intent "question").
- Si quiere pedir algo que está en el catálogo (equipo, acceso, programa, alta, etc.): elige el service_id exacto de la lista (intent "request").
- Si reporta algo que no funciona y no hay guía que lo resuelva, o ya probó la guía: propose_ticket=true, ticket_title con un título claro de máx. 100 caracteres,
  impact (LOW=solo a la persona, MEDIUM=a su equipo, HIGH=a toda la empresa o clientes) y urgency (LOW=puede trabajar, MEDIUM=le dificulta, HIGH=no puede trabajar) (intent "problem").
- Si pregunta por el estado de algo que ya pidió: responde usando sus solicitudes abiertas y pon sus números en ticket_numbers (intent "status").
- Si falta información para decidir, haz UNA pregunta concreta (intent "other").
Usa service_id "none" si no aplica. Nunca digas que creaste algo: tú solo propones y la persona confirma con un botón.
Nunca inventes servicios, guías ni estados que no estén en los datos.`,
        data: `Conversación:\n${transcript}\n\nGuías del centro de ayuda (las más relacionadas):\n${rankedArticles.map((a) => `### ${a.id} — ${a.title}\n${clip(a.summary, 300)}\n${clip(a.body, 700)}`).join("\n\n") || "(ninguna relacionada)"}\n\nCatálogo de servicios:\n${rankedServices.slice(0, 25).map((s) => `- ${s.id} | ${s.name} | ${clip(s.description, 160)}`).join("\n")}\n\nSolicitudes abiertas del empleado:\n${myTickets.map((t) => `- #${t.number} (${t.ref}) ${clip(t.title, 120)} — estado: ${t.status}`).join("\n") || "(ninguna)"}`,
        schema: {
          type: "object", additionalProperties: false,
          required: ["reply", "intent", "article_ids", "service_id", "propose_ticket", "ticket_title", "impact", "urgency", "ticket_numbers"],
          properties: {
            reply: { type: "string" },
            intent: { type: "string", enum: ["question", "problem", "request", "status", "other"] },
            article_ids: { type: "array", items: { type: "string" } },
            service_id: { type: "string" },
            propose_ticket: { type: "boolean" },
            ticket_title: { type: "string" },
            impact: { type: "string", enum: [...LEVELS] },
            urgency: { type: "string", enum: [...LEVELS] },
            ticket_numbers: { type: "array", items: { type: "integer" } },
          },
        },
        effort: "low",
        maxTokens: 2500,
      });
      return {
        reply: r.reply.trim() || "¿Me cuentas un poco más?",
        mode: "ai",
        intent: r.intent,
        articles: pickArticles(r.article_ids),
        service: r.service_id !== "none" ? pickService(r.service_id) : null,
        ticket: r.propose_ticket ? draft(r.ticket_title, r.impact, r.urgency) : null,
        tickets: myTickets.filter((t) => r.ticket_numbers.includes(t.number)).map(({ number: _n, ...t }) => t),
      };
    } catch (e) {
      console.error("[assistant] fallback a modo básico", e instanceof Error ? e.message : e);
    }
  }

  // ------------------------------------------------------------ Modo básico (reglas)
  const n = normalize(last);
  const base = { mode: "basic" as const, articles: [], service: null, ticket: null, tickets: [] };
  if (STATUS_RE.test(n)) {
    if (!myTickets.length) return { ...base, intent: "status", reply: "No tienes solicitudes abiertas en este momento. ¿Necesitas algo nuevo?" };
    return { ...base, intent: "status", reply: `Tienes ${myTickets.length} solicitud${myTickets.length > 1 ? "es" : ""} en curso. Este es su estado:`, tickets: myTickets.map(({ number: _n, ...t }) => t) };
  }
  const topService = rankedServices[0];
  const isProblem = PROBLEM_RE.test(n);
  const wantsSomething = REQUEST_RE.test(n) && !isProblem;
  if (topService && !isProblem && topService.score >= 0.5 && (wantsSomething || topService.score >= 1.2)) {
    return { ...base, intent: "request", reply: `Para eso tenemos el servicio «${topService.name}». Ábrelo, completa el formulario y listo.`, service: pickService(topService.id) };
  }
  const helpful = rankedArticles.filter((a) => a.score >= 0.34).slice(0, 3);
  const isFollowUp = messages.filter((m) => m.role === "user").length > 1 && /(no funciono|no resulto|sigue|ya lo intente|ya probe|no sirvio|no me sirvio)/.test(n);
  if (helpful.length && !isFollowUp) {
    return {
      ...base, intent: "question",
      reply: "Esto podría resolverlo ahora mismo. Revisa la guía; si no funciona, te dejo el reporte listo para enviarlo al equipo de soporte.",
      articles: helpful.map(({ slug, title, summary }) => ({ slug, title, summary })),
      ticket: PROBLEM_RE.test(n) ? draft(null) : null,
    };
  }
  if (PROBLEM_RE.test(n) || isFollowUp || userText.length > 40) {
    return { ...base, intent: "problem", reply: "Entiendo. Te dejé el reporte redactado: revísalo y envíalo, y el equipo de soporte se pondrá en contacto contigo.", ticket: draft(null) };
  }
  return {
    ...base, intent: "other",
    reply: "Cuéntame con tus palabras qué necesitas: por ejemplo «no me funciona la impresora», «necesito acceso a Salesforce» o «¿cómo va mi solicitud?».",
  };
}
