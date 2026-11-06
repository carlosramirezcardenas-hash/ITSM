import { db } from "@/lib/db";
import { matchScore, normalize, tokens } from "@/lib/classify";

/**
 * Aprendizaje del asistente (sin reentrenar modelos):
 * 1. Vocabulario: las palabras con que la gente pide algo quedan asociadas al servicio, guía o solución que le sirvió.
 * 2. Soluciones que funcionaron: cada incidente resuelto aporta su solución (sin datos del solicitante); se oculta sola
 *    si el caso se reabre o recibe mala evaluación, y un administrador puede corregirla, ocultarla o mostrarla.
 * Todo es por organización, visible y editable en Administración → Asistente.
 */

export type TargetType = "SERVICE" | "ARTICLE" | "SOLUTION";

// Palabras genéricas que no aportan al vocabulario (piden algo, pero no dicen qué)
const GENERIC = new Set(
  ("neces quier quisi solic pedir pide ayuda favor nuevo nueva tengo hola graci funci probl puedo dejar algo cosa urgen " +
    "porfa ayude sirve servi poder hacer tener estoy esta ahora todav sigue otra otro mucho poco bien malo " +
    "cuand donde porqu desde hasta tambi siemp nunca cada abro abre abrir hago hace tiene ayer manan tarde noche favor")
    .split(" "),
);
const stem = (w: string) => w.slice(0, 5);

/** Raíces nuevas de la consulta que no están ya en el texto del destino (eso es lo que vale la pena aprender). */
export function learnableTerms(query: string, targetText: string) {
  const known = new Set([...tokens(targetText)].map(stem));
  const out: string[] = [];
  for (const w of tokens(query)) {
    const s = stem(w);
    if (s.length < 3 || GENERIC.has(s) || known.has(s) || /^\d+$/.test(s) || out.includes(s)) continue;
    out.push(s);
    if (out.length >= 6) break;
  }
  return out;
}

export async function learnTerms(orgId: string, query: string, targetType: TargetType, targetId: string, targetText: string, positive: boolean) {
  const terms = learnableTerms(query, targetText);
  for (const term of terms) {
    await db.assistantTerm.upsert({
      where: { orgId_term_targetType_targetId: { orgId, term, targetType, targetId } },
      create: { orgId, term, targetType, targetId, positive: positive ? 1 : 0, negative: positive ? 0 : 1 },
      update: positive ? { positive: { increment: 1 } } : { negative: { increment: 1 } },
    });
  }
  return terms;
}

/**
 * Impulso aprendido por destino para una consulta: suma (positivos − 2×negativos) × 0,5 de cada raíz, acotado a [-0,6; 1].
 * Se ignoran raíces que apuntan a 3 o más destinos del mismo tipo (son genéricas, no distinguen).
 */
export async function learnedBoosts(orgId: string, query: string) {
  const stems = [...new Set([...tokens(query)].map(stem))].filter((s) => s.length >= 3 && !GENERIC.has(s));
  const boosts = new Map<string, number>();
  if (!stems.length) return boosts;
  const rows = await db.assistantTerm.findMany({ where: { orgId, term: { in: stems }, disabled: false } });
  const targetsPerTerm = new Map<string, number>();
  for (const r of rows) if (r.positive > r.negative) targetsPerTerm.set(`${r.term}|${r.targetType}`, (targetsPerTerm.get(`${r.term}|${r.targetType}`) ?? 0) + 1);
  for (const r of rows) {
    if ((targetsPerTerm.get(`${r.term}|${r.targetType}`) ?? 0) >= 3) continue;
    const key = `${r.targetType}:${r.targetId}`;
    boosts.set(key, (boosts.get(key) ?? 0) + (r.positive - 2 * r.negative) * 0.5);
  }
  for (const [k, v] of boosts) boosts.set(k, Math.max(-0.6, Math.min(1, v)));
  return boosts;
}

// ------------------------------------------------------------------ Soluciones que funcionaron
const MIN_RESOLUTION = 20;

/**
 * Actualiza lo aprendido de un incidente según su estado actual. Idempotente (se llama en cada cambio del ticket).
 * - Resuelto con solución útil → se agrega como caso a la solución existente igual (mismo título y solución) o crea una nueva.
 * - Reabierto o con evaluación baja (≤ 2) → ese caso deja de respaldar la solución; sin casos, la solución se oculta.
 * Las soluciones revisadas por un administrador (manual) no cambian de estado automáticamente.
 */
export async function learnFromTicket(ticketId: string) {
  const t = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, orgId: true, type: true, title: true, status: true, resolution: true, csatScore: true, categoryId: true, approvalStatus: true },
  });
  if (!t || t.type !== "INCIDENT") return null;
  const existing = await db.learnedSolution.findFirst({ where: { orgId: t.orgId, ticketIds: { has: t.id } } });
  const resolution = (t.resolution ?? "").trim();
  const resolved = (t.status === "RESOLVED" || t.status === "CLOSED") && t.approvalStatus !== "REJECTED" && resolution.length >= MIN_RESOLUTION;
  const bad = t.csatScore !== null && t.csatScore <= 2;

  if (!resolved || bad) {
    if (!existing) return null;
    const ticketIds = existing.ticketIds.filter((x) => x !== t.id);
    const reason = bad ? `Evaluación baja (${t.csatScore}/5)` : "El caso se reabrió";
    return db.learnedSolution.update({
      where: { id: existing.id },
      data: { ticketIds, ...(ticketIds.length === 0 && !existing.manual ? { status: "HIDDEN", hiddenReason: reason } : {}), ...(bad ? { notHelpful: { increment: 1 } } : {}) },
    });
  }
  if (existing) {
    // Si el agente corrigió la solución de un caso único, se actualiza el texto
    if (!existing.manual && existing.ticketIds.length === 1 && existing.originalResolution !== resolution) {
      return db.learnedSolution.update({ where: { id: existing.id }, data: { resolution: resolution.slice(0, 2000), originalResolution: resolution.slice(0, 2000), categoryId: t.categoryId } });
    }
    return existing;
  }
  const same = await db.learnedSolution.findFirst({ where: { orgId: t.orgId, title: t.title.slice(0, 200), originalResolution: resolution.slice(0, 2000) } });
  if (same) {
    return db.learnedSolution.update({
      where: { id: same.id },
      data: { ticketIds: { push: t.id }, ...(same.status === "HIDDEN" && !same.manual ? { status: "ACTIVE", hiddenReason: null } : {}) },
    });
  }
  return db.learnedSolution.create({
    data: { orgId: t.orgId, ticketIds: [t.id], title: t.title.slice(0, 200), resolution: resolution.slice(0, 2000), originalResolution: resolution.slice(0, 2000), categoryId: t.categoryId },
  });
}

/** Aprende del historial (último año) y aplica la retención de conversaciones (180 días). */
export async function syncLearning(orgId: string) {
  const since = new Date(Date.now() - 365 * 86400_000);
  const known = new Set((await db.learnedSolution.findMany({ where: { orgId }, select: { ticketIds: true } })).flatMap((x) => x.ticketIds));
  const resolved = await db.ticket.findMany({
    where: { orgId, type: "INCIDENT", status: { in: ["RESOLVED", "CLOSED"] }, resolvedAt: { gte: since }, resolution: { not: null } },
    select: { id: true }, orderBy: { resolvedAt: "asc" }, take: 5000,
  });
  const pending = resolved.filter((r) => !known.has(r.id));
  for (const p of pending) await learnFromTicket(p.id);
  const purged = await purgeInteractions(orgId);
  return { learned: pending.length, purged };
}

/** Retención: las conversaciones con el asistente se borran a los 180 días. */
export async function purgeInteractions(orgId?: string) {
  const r = await db.assistantInteraction.deleteMany({ where: { ...(orgId ? { orgId } : {}), createdAt: { lt: new Date(Date.now() - 180 * 86400_000) } } });
  return r.count;
}

/** Ranking de soluciones aprendidas para una consulta (texto + vocabulario aprendido + utilidad observada). */
export async function rankSolutions(orgId: string, query: string, boosts: Map<string, number>, take = 3) {
  const sols = await db.learnedSolution.findMany({
    where: { orgId, status: "ACTIVE" }, orderBy: { updatedAt: "desc" }, take: 500,
    select: { id: true, title: true, resolution: true, helpful: true, notHelpful: true, ticketIds: true, category: { select: { name: true } } },
  });
  const q = normalize(query);
  return sols
    .map((s) => {
      // Más casos resueltos igual y más «me sirvió» = más confianza
      const usefulness = Math.max(-0.3, Math.min(0.3, (s.helpful - s.notHelpful) * 0.1 + Math.min(0.1, (s.ticketIds.length - 1) * 0.02)));
      const score = matchScore(q, `${s.title} ${s.category?.name ?? ""}`) + 0.3 * matchScore(q, s.resolution) + (boosts.get(`SOLUTION:${s.id}`) ?? 0) + usefulness;
      return { ...s, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, take);
}
