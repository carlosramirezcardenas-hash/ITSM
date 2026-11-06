import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { classifyCategory, matchScore, normalize, suggestLevels, type Level } from "@/lib/classify";
import { STATUS_USER_LABEL } from "@/lib/labels";
import { ticketRef } from "@/lib/utils";
import type { Ctx } from "./auth";
import { aiAvailable, callJson, clip } from "./ai";
import { throttle } from "./ai-features";
import { learnTerms, learnedBoosts, rankSolutions } from "./learning";
import { invalid, notFound } from "./errors";

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
  articles: { id: string; slug: string; title: string; summary: string }[];
  service: { id: string; name: string; icon: string; estimatedHours: number; requiresApproval: boolean } | null;
  /** Soluciones que funcionaron en casos parecidos (aprendidas de incidentes resueltos) */
  solutions: { id: string; steps: string }[];
  ticket: { title: string; description: string; impact: Level; urgency: Level } | null;
  tickets: { id: string; ref: string; title: string; status: string }[];
  /** Para registrar si le sirvió y aprender (null si no se pudo registrar) */
  interactionId: string | null;
};
type Decision = Omit<AssistantReply, "interactionId">;

const LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
const STATUS_RE = /(como va|en que va|estado de|seguimiento|mis solicitudes|mis reportes|mi solicitud|mi reporte|mi ticket|mis tickets|ya esta listo|cuando estara)/;
const REQUEST_RE = /(necesito|quiero|quisiera|solicit|pedir|me gustaria|nuevo|nueva|instalar|acceso|alta de|dar de alta|habilitar|comprar|licencia)/;
const PROBLEM_RE = /(no funciona|no puedo|no me deja|no carga|no abre|no conecta|error|falla|se cayo|caido|lento|no enciende|no imprime|bloquead|no responde|se congela|no llega)/;

export async function assistantTurn(ctx: Ctx, raw: unknown): Promise<AssistantReply> {
  const { messages } = assistantInput.parse(raw);
  const r = await decide(ctx, messages);
  const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const interaction = await db.assistantInteraction.create({
    data: {
      orgId: ctx.orgId, userId: ctx.user.id, query: last.slice(0, 300), intent: r.intent, mode: r.mode,
      articleIds: r.articles.map((a) => a.id), serviceId: r.service?.id ?? null, solutionIds: r.solutions.map((x) => x.id), proposedTicket: !!r.ticket,
    },
    select: { id: true },
  }).catch((e) => { console.error("[assistant] no se pudo registrar la interacción", e); return null; });
  if (r.solutions.length) await db.learnedSolution.updateMany({ where: { id: { in: r.solutions.map((x) => x.id) }, orgId: ctx.orgId }, data: { shown: { increment: 1 } } }).catch(() => {});
  return { ...r, interactionId: interaction?.id ?? null };
}

async function decide(ctx: Ctx, messages: z.infer<typeof assistantInput>["messages"]): Promise<Decision> {
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

  // Lo aprendido de conversaciones anteriores ajusta el ranking de guías, servicios y soluciones
  const boosts = await learnedBoosts(ctx.orgId, userText);
  const rankedArticles = articles
    .map((a) => ({ ...a, score: matchScore(userText, `${a.title} ${a.summary} ${a.tags.join(" ")}`) + (boosts.get(`ARTICLE:${a.id}`) ?? 0) }))
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const cat = classifyCategory(userText, categories);
  const rankedServices = services
    .map((s) => ({ ...s, score: matchScore(last, `${s.name} ${s.description}`) * 2 + matchScore(userText, `${s.name} ${s.description} ${s.category?.name ?? ""}`) + (cat && s.categoryId === cat.category.id ? 0.15 : 0) + 1.5 * (boosts.get(`SERVICE:${s.id}`) ?? 0) }))
    .sort((a, b) => b.score - a.score || b.popularity - a.popularity);
  const rankedSolutions = await rankSolutions(ctx.orgId, userText, boosts, 4);
  const myTickets = mine.map((t) => ({ id: t.id, ref: ticketRef(t.type, t.number), title: t.title, status: STATUS_USER_LABEL[t.status] ?? t.status, number: t.number }));

  const pickService = (id: string | null | undefined) => {
    const s = id ? services.find((x) => x.id === id) : null;
    return s ? { id: s.id, name: s.name, icon: s.icon, estimatedHours: s.estimatedHours, requiresApproval: s.requiresApproval } : null;
  };
  const pickArticles = (ids: string[]) => articles.filter((a) => ids.includes(a.id)).slice(0, 3).map(({ id, slug, title, summary }) => ({ id, slug, title, summary }));
  const pickSolutions = (ids: string[]) => rankedSolutions.filter((x) => ids.includes(x.id)).slice(0, 2).map((x) => ({ id: x.id, steps: x.resolution.slice(0, 700) }));
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
        reply: string; intent: AssistantReply["intent"]; article_ids: string[]; solution_ids: string[]; service_id: string;
        propose_ticket: boolean; ticket_title: string; impact: Level; urgency: Level; ticket_numbers: number[];
      }>(ctx, "assistant", {
        task: `Eres el asistente del portal de servicios de TI. Conversa con un empleado que NO conoce términos técnicos ni ITIL
(nunca uses palabras como incidente, SLA, ITIL, CMDB, prioridad P1). Responde en 1-4 frases cortas y amables, en español neutro.
Decide qué necesita y elige UNA de estas salidas:
- Si una guía de la lista lo resuelve: explica los pasos clave en pocas líneas y pon su id en article_ids (intent "question").
- Si una «solución que funcionó» en un caso parecido aplica: resume qué intentar y pon su id en solution_ids (intent "question").
  Son casos reales resueltos por el equipo de soporte; no menciones a otras personas.
- Si quiere pedir algo que está en el catálogo (equipo, acceso, programa, alta, etc.): elige el service_id exacto de la lista (intent "request").
- Si reporta algo que no funciona y no hay guía que lo resuelva, o ya probó la guía: propose_ticket=true, ticket_title con un título claro de máx. 100 caracteres,
  impact (LOW=solo a la persona, MEDIUM=a su equipo, HIGH=a toda la empresa o clientes) y urgency (LOW=puede trabajar, MEDIUM=le dificulta, HIGH=no puede trabajar) (intent "problem").
- Si pregunta por el estado de algo que ya pidió: responde usando sus solicitudes abiertas y pon sus números en ticket_numbers (intent "status").
- Si falta información para decidir, haz UNA pregunta concreta (intent "other").
Usa service_id "none" si no aplica. Nunca digas que creaste algo: tú solo propones y la persona confirma con un botón.
Nunca inventes servicios, guías ni estados que no estén en los datos.`,
        data: `Conversación:\n${transcript}\n\nGuías del centro de ayuda (las más relacionadas):\n${rankedArticles.map((a) => `### ${a.id} — ${a.title}\n${clip(a.summary, 300)}\n${clip(a.body, 700)}`).join("\n\n") || "(ninguna relacionada)"}\n\nSoluciones que funcionaron en casos parecidos:\n${rankedSolutions.map((x) => `### ${x.id} — ${clip(x.title, 150)}\n${clip(x.resolution, 600)}`).join("\n\n") || "(ninguna)"}\n\nCatálogo de servicios:\n${rankedServices.slice(0, 25).map((s) => `- ${s.id} | ${s.name} | ${clip(s.description, 160)}`).join("\n")}\n\nSolicitudes abiertas del empleado:\n${myTickets.map((t) => `- #${t.number} (${t.ref}) ${clip(t.title, 120)} — estado: ${t.status}`).join("\n") || "(ninguna)"}`,
        schema: {
          type: "object", additionalProperties: false,
          required: ["reply", "intent", "article_ids", "solution_ids", "service_id", "propose_ticket", "ticket_title", "impact", "urgency", "ticket_numbers"],
          properties: {
            reply: { type: "string" },
            intent: { type: "string", enum: ["question", "problem", "request", "status", "other"] },
            article_ids: { type: "array", items: { type: "string" } },
            solution_ids: { type: "array", items: { type: "string" } },
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
        solutions: pickSolutions(r.solution_ids),
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
  const base = { mode: "basic" as const, articles: [], solutions: [], service: null, ticket: null, tickets: [] };
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
  const worked = rankedSolutions.filter((x) => x.score >= 0.4).slice(0, 2);
  const isFollowUp = messages.filter((m) => m.role === "user").length > 1 && /(no funciono|no resulto|sigue|ya lo intente|ya probe|no sirvio|no me sirvio)/.test(n);
  if ((helpful.length || worked.length) && !isFollowUp) {
    return {
      ...base, intent: "question",
      reply: helpful.length
        ? "Esto podría resolverlo ahora mismo. Revisa la guía; si no funciona, te dejo el reporte listo para enviarlo al equipo de soporte."
        : "Un caso parecido se resolvió así. Pruébalo y cuéntame si te sirvió; si no, te dejo el reporte listo para enviar.",
      articles: helpful.map(({ id, slug, title, summary }) => ({ id, slug, title, summary })),
      solutions: worked.map((x) => ({ id: x.id, steps: x.resolution.slice(0, 700) })),
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

// ------------------------------------------------------------------ Retroalimentación y resultados (aprendizaje)
const feedbackInput = z.object({ interactionId: z.string().min(1).max(40), value: z.union([z.literal(1), z.literal(-1)]) });
const outcomeInput = z.discriminatedUnion("kind", [
  z.object({ interactionId: z.string().min(1).max(40), kind: z.literal("service"), targetId: z.string().min(1).max(40) }),
  z.object({ interactionId: z.string().min(1).max(40), kind: z.literal("resolved"), targetType: z.enum(["ARTICLE", "SOLUTION"]), targetId: z.string().min(1).max(40) }),
  z.object({ interactionId: z.string().min(1).max(40), kind: z.literal("ticket"), ticketId: z.string().min(1).max(40) }),
  z.object({ interactionId: z.string().min(1).max(40), kind: z.literal("unhelpful"), targetType: z.enum(["ARTICLE", "SOLUTION"]), targetId: z.string().min(1).max(40) }),
]);

async function ownInteraction(ctx: Ctx, id: string) {
  const i = await db.assistantInteraction.findFirst({ where: { id, orgId: ctx.orgId, userId: ctx.user.id } });
  if (!i) throw notFound();
  return i;
}

async function targetText(ctx: Ctx, type: "SERVICE" | "ARTICLE" | "SOLUTION", id: string) {
  if (type === "SERVICE") { const s = await db.serviceItem.findFirst({ where: { id, orgId: ctx.orgId }, select: { name: true, description: true } }); return s ? `${s.name} ${s.description}` : null; }
  if (type === "ARTICLE") { const a = await db.kbArticle.findFirst({ where: { id, orgId: ctx.orgId }, select: { title: true, summary: true, tags: true } }); return a ? `${a.title} ${a.summary} ${a.tags.join(" ")}` : null; }
  const x = await db.learnedSolution.findFirst({ where: { id, orgId: ctx.orgId }, select: { title: true } });
  return x ? x.title : null;
}

/** «¿Te sirvió?» 👍/👎 sobre una respuesta. Se aprende una sola vez por respuesta. */
export async function assistantFeedback(ctx: Ctx, raw: unknown) {
  const { interactionId, value } = feedbackInput.parse(raw);
  const i = await ownInteraction(ctx, interactionId);
  if (i.feedback !== null) return { learned: false };
  await db.assistantInteraction.update({ where: { id: i.id }, data: { feedback: value } });
  const positive = value === 1;
  const targets: ["SERVICE" | "ARTICLE" | "SOLUTION", string][] = [
    ...(i.serviceId ? [["SERVICE", i.serviceId] as ["SERVICE", string]] : []),
    ...i.articleIds.map((a) => ["ARTICLE", a] as ["ARTICLE", string]),
    ...i.solutionIds.map((x) => ["SOLUTION", x] as ["SOLUTION", string]),
  ];
  for (const [type, id] of targets) {
    const text = await targetText(ctx, type, id);
    if (text !== null) await learnTerms(ctx.orgId, i.query, type, id, text, positive);
  }
  if (i.solutionIds.length) {
    await db.learnedSolution.updateMany({ where: { id: { in: i.solutionIds }, orgId: ctx.orgId }, data: positive ? { helpful: { increment: 1 } } : { notHelpful: { increment: 1 } } });
  }
  return { learned: targets.length > 0 };
}

/** Lo que la persona hizo con la respuesta: abrió el servicio sugerido, una guía/solución le sirvió o envió el reporte. */
export async function assistantOutcome(ctx: Ctx, raw: unknown) {
  const input = outcomeInput.parse(raw);
  const i = await ownInteraction(ctx, input.interactionId);
  if (input.kind === "ticket") {
    const t = await db.ticket.findFirst({ where: { id: input.ticketId, orgId: ctx.orgId, requesterId: ctx.user.id }, select: { id: true } });
    if (!t) throw notFound();
    await db.assistantInteraction.update({ where: { id: i.id }, data: { outcome: "ticket", ticketId: t.id } });
    return { learned: false };
  }
  if (input.kind === "unhelpful") {
    // «No me sirvió» sobre una guía o solución concreta: baja su relevancia para estas palabras
    const shownList = input.targetType === "ARTICLE" ? i.articleIds : i.solutionIds;
    if (!shownList.includes(input.targetId)) throw invalid("Esa sugerencia no fue mostrada en esta respuesta.");
    if (i.feedback !== null) return { learned: false };
    await db.assistantInteraction.update({ where: { id: i.id }, data: { feedback: -1 } });
    const text = await targetText(ctx, input.targetType, input.targetId);
    if (text !== null) await learnTerms(ctx.orgId, i.query, input.targetType, input.targetId, text, false);
    if (input.targetType === "SOLUTION") await db.learnedSolution.updateMany({ where: { id: input.targetId, orgId: ctx.orgId }, data: { notHelpful: { increment: 1 } } });
    return { learned: true };
  }
  if (i.outcome === "service" || i.outcome === "self_resolved") return { learned: false }; // ya se aprendió de esta respuesta
  if (input.kind === "service") {
    if (i.serviceId !== input.targetId) throw invalid("Ese servicio no fue sugerido en esta respuesta.");
    const text = await targetText(ctx, "SERVICE", input.targetId);
    await db.assistantInteraction.update({ where: { id: i.id }, data: { outcome: "service", outcomeTarget: input.targetId } });
    if (text !== null) await learnTerms(ctx.orgId, i.query, "SERVICE", input.targetId, text, true);
    return { learned: true };
  }
  const shown = input.targetType === "ARTICLE" ? i.articleIds : i.solutionIds;
  if (!shown.includes(input.targetId)) throw invalid("Esa sugerencia no fue mostrada en esta respuesta.");
  const text = await targetText(ctx, input.targetType, input.targetId);
  await db.assistantInteraction.update({ where: { id: i.id }, data: { outcome: "self_resolved", outcomeTarget: input.targetId, feedback: i.feedback ?? 1 } });
  if (i.feedback === 1) return { learned: false }; // ya aprendió con el 👍 de esta misma respuesta
  if (text !== null) await learnTerms(ctx.orgId, i.query, input.targetType, input.targetId, text, true);
  if (input.targetType === "SOLUTION") await db.learnedSolution.updateMany({ where: { id: input.targetId, orgId: ctx.orgId }, data: { helpful: { increment: 1 } } });
  return { learned: true };
}
