"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/auth";
import { type ActionResult, toActionError } from "@/server/errors";
import * as P from "@/server/problems";
import * as C from "@/server/changes";
import * as M from "@/server/cmdb";
import { linkArticle } from "@/server/tickets";

async function run<T>(fn: () => Promise<T>, message?: string, paths: string[] = []): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    for (const p of paths) revalidatePath(p);
    return { ok: true, data, message };
  } catch (e) {
    return toActionError(e);
  }
}

// ------------------------------------------------ Problemas
export async function createProblemAction(input: unknown) {
  return run(async () => { const p = await P.createProblem(await getCtx("problems:manage"), input); return { id: p.id, number: p.number }; }, "Problema registrado.");
}
export async function updateProblemAction(id: string, input: unknown) {
  return run(async () => P.updateProblem(await getCtx("problems:manage"), id, input), "Problema actualizado.", [`/problems/${id}`]);
}
export async function linkIncidentsAction(id: string, refs: string[]) {
  return run(async () => P.linkIncidents(await getCtx("problems:manage"), id, refs), "Incidentes vinculados.", [`/problems/${id}`]);
}
export async function unlinkIncidentAction(id: string, ticketId: string) {
  return run(async () => P.unlinkIncident(await getCtx("problems:manage"), id, ticketId), "Incidente desvinculado.", [`/problems/${id}`]);
}
export async function addTaskAction(id: string, input: unknown) {
  return run(async () => P.addTask(await getCtx("problems:manage"), id, input), "Acción agregada al plan.", [`/problems/${id}`]);
}
export async function toggleTaskAction(taskId: string) {
  return run(async () => P.toggleTask(await getCtx("problems:manage"), taskId));
}
export async function deleteTaskAction(taskId: string) {
  return run(async () => P.deleteTask(await getCtx("problems:manage"), taskId), "Acción eliminada.");
}
export async function addNoteAction(entityType: "problem" | "change", id: string, note: string) {
  return run(async () => P.addNote(await getCtx(), entityType, id, note), "Nota registrada.");
}
export async function publishWorkaroundAction(id: string) {
  return run(async () => ({ slug: await P.publishWorkaround(await getCtx("kb:manage"), id) }), "Solución temporal publicada en el centro de ayuda.", [`/problems/${id}`, "/help"]);
}
export async function resolveLinkedIncidentsAction(id: string) {
  return run(async () => ({ count: await P.resolveLinkedIncidents(await getCtx("tickets:work"), id) }), "Incidentes resueltos y usuarios notificados.", [`/problems/${id}`]);
}

// ------------------------------------------------ Cambios
export async function previewChangeAction(input: unknown) {
  return run(async () => C.previewChange(await getCtx("changes:create"), input));
}
export async function createChangeAction(input: unknown) {
  return run(async () => { const c = await C.createChange(await getCtx("changes:create"), input); return { id: c.id, number: c.number }; }, "Cambio registrado como borrador.");
}
export async function updateChangeAction(id: string, input: unknown) {
  return run(async () => C.updateChange(await getCtx("changes:create"), id, input), "Cambio actualizado.", [`/changes/${id}`]);
}
export async function submitChangeAction(id: string) {
  return run(async () => C.submitChange(await getCtx("changes:create"), id), "Cambio enviado.", [`/changes/${id}`]);
}
export async function decideChangeAction(id: string, input: unknown) {
  return run(async () => C.decideChange(await getCtx("changes:approve"), id, input), "Decisión registrada.", [`/changes/${id}`, "/approvals"]);
}
export async function transitionChangeAction(id: string, input: unknown) {
  return run(async () => C.transitionChange(await getCtx("changes:create"), id, input), "Cambio actualizado.", [`/changes/${id}`]);
}

// ------------------------------------------------ CMDB
export async function saveCIAction(id: string | null, input: unknown) {
  return run(async () => { const ci = await M.saveCI(await getCtx("cmdb:manage"), id, input); return { id: ci.id }; }, "Elemento guardado.", ["/cmdb"]);
}
export async function deleteCIAction(id: string) {
  return run(async () => M.deleteCI(await getCtx("cmdb:manage"), id), "Elemento eliminado.", ["/cmdb"]);
}
export async function addRelationAction(input: unknown) {
  return run(async () => M.addRelation(await getCtx("cmdb:manage"), input), "Relación agregada.");
}
export async function removeRelationAction(id: string) {
  return run(async () => M.removeRelation(await getCtx("cmdb:manage"), id), "Relación eliminada.");
}

// ------------------------------------------------ Conocimiento ↔ tickets
export async function linkArticleAction(ticketId: string, articleId: string, link: boolean) {
  return run(async () => linkArticle(await getCtx("tickets:work"), ticketId, articleId, link), link ? "Artículo vinculado." : "Artículo desvinculado.", [`/tickets/${ticketId}`]);
}
