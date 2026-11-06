"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/auth";
import { type ActionResult, toActionError } from "@/server/errors";
import * as AI from "@/server/ai-features";
import * as AU from "@/server/automation";
import * as IN from "@/server/integrations";
import { assistantTurn } from "@/server/assistant";
import { getMetrics, getItsmMetrics } from "@/server/metrics";
import { updateTicket } from "@/server/tickets";
import { db } from "@/lib/db";
import { audit } from "@/server/audit";

async function run<T>(fn: () => Promise<T>, message?: string, paths: string[] = []): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    for (const p of paths) revalidatePath(p);
    return { ok: true, data, message };
  } catch (e) {
    return toActionError(e);
  }
}

// ------------------------------------------------ IA
export async function aiSelfHelpAction(text: string) {
  return run(async () => AI.selfHelp(await getCtx(), text));
}
export async function aiSummarizeAction(ticketId: string) {
  return run(async () => AI.summarizeTicket(await getCtx("tickets:work"), ticketId), undefined, [`/tickets/${ticketId}`]);
}
export async function aiSuggestReplyAction(ticketId: string) {
  return run(async () => AI.suggestReply(await getCtx("tickets:work"), ticketId));
}
export async function aiTriageAction(ticketId: string) {
  return run(async () => AI.triageTicket(await getCtx("tickets:work"), ticketId), "Sugerencia actualizada.", [`/tickets/${ticketId}`]);
}
/** El agente confirma la sugerencia de la IA: recién ahí se cambian impacto, urgencia y categoría. */
export async function aiApplySuggestionAction(ticketId: string) {
  return run(async () => {
    const ctx = await getCtx("tickets:work");
    const s = await AI.acceptSuggestion(ctx, ticketId);
    await updateTicket(ctx, ticketId, s);
    await audit({ orgId: ctx.orgId, actor: ctx.user, action: "ai.suggestion_applied", entity: "ticket", entityId: ticketId, meta: s });
  }, "Sugerencia aplicada.", [`/tickets/${ticketId}`]);
}
export async function aiRootCauseAction(problemId: string) {
  return run(async () => AI.suggestRootCause(await getCtx("problems:manage"), problemId));
}
export async function aiTrendsAction(filters: Record<string, string>) {
  return run(async () => {
    const ctx = await getCtx("reports:view");
    const [m, x] = await Promise.all([getMetrics(ctx, filters), getItsmMetrics(ctx, filters)]);
    // Solo agregados: sin nombres de personas ni textos de tickets
    const metrics = {
      range: m.range, kpis: m.kpis, byPriority: m.byPriority, trend: m.trend,
      complianceByTeam: m.complianceByTeam.map(({ name, total, compliance }) => ({ name, total, compliance })),
      complianceByCategory: m.complianceByCategory.map(({ name, total, compliance }) => ({ name, total, compliance })),
      recurring: m.recurring.map(({ name, count, reopened }) => ({ name, count, reopened })),
      workload: m.workload.map((w, i) => ({ agent: `Agente ${i + 1}`, open: w.open, resolved: w.resolved, breached: w.breached })),
      changes: x.changes, problems: x.problems, topCIs: x.topCIs.map(({ name, count }) => ({ name, count })), mttrByPriority: x.mttrByPriority,
    };
    return AI.analyzeTrends(ctx, metrics);
  });
}
export async function setAiEnabledAction(enabled: boolean) {
  return run(async () => {
    const ctx = await getCtx("org:manage");
    await db.organization.update({ where: { id: ctx.orgId }, data: { aiEnabled: enabled } });
    await audit({ orgId: ctx.orgId, actor: ctx.user, action: enabled ? "ai.enabled" : "ai.disabled", entity: "organization", entityId: ctx.orgId });
  }, enabled ? "Asistente de IA activado." : "Asistente de IA desactivado.", ["/admin/integrations"]);
}

// ------------------------------------------------ Automatizaciones
export async function saveRuleAction(id: string | null, input: unknown) {
  return run(async () => { await AU.saveRule(await getCtx("catalog:manage"), id, input); }, "Regla guardada.", ["/admin/automations"]);
}
export async function deleteRuleAction(id: string) {
  return run(async () => AU.deleteRule(await getCtx("catalog:manage"), id), "Regla eliminada.", ["/admin/automations"]);
}
export async function toggleRuleAction(id: string, active: boolean) {
  return run(async () => AU.toggleRule(await getCtx("catalog:manage"), id, active), active ? "Regla activada." : "Regla pausada.", ["/admin/automations"]);
}

// ------------------------------------------------ Integraciones y claves
export async function saveIntegrationAction(id: string | null, input: unknown) {
  return run(async () => IN.saveIntegration(await getCtx("org:manage"), id, input), "Integración guardada.", ["/admin/integrations"]);
}
export async function deleteIntegrationAction(id: string) {
  return run(async () => IN.deleteIntegration(await getCtx("org:manage"), id), "Integración eliminada.", ["/admin/integrations"]);
}
export async function testIntegrationAction(id: string) {
  return run(async () => {
    const r = await IN.testIntegration(await getCtx("org:manage"), id);
    if (!r.ok) throw new (await import("@/server/errors")).AppError("CONFLICT", `La prueba falló: ${r.error ?? "sin respuesta"}`);
    return r;
  }, "Mensaje de prueba entregado.", ["/admin/integrations"]);
}
export async function createApiKeyAction(input: unknown) {
  return run(async () => IN.createApiKey(await getCtx("org:manage"), input), "Clave creada. Cópiala ahora: no se volverá a mostrar.", ["/admin/integrations"]);
}
export async function revokeApiKeyAction(id: string) {
  return run(async () => IN.revokeApiKey(await getCtx("org:manage"), id), "Clave revocada.", ["/admin/integrations"]);
}

// ------------------------------------------------ Asistente del portal (solo propone; la persona confirma)
export async function assistantAction(messages: { role: "user" | "assistant"; content: string }[]) {
  return run(async () => {
    return assistantTurn(await getCtx("tickets:create"), { messages });
  });
}
