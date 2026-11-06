"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { EXPERIENCE_COOKIE, canUseOps } from "@/server/experience";
import { z } from "zod";
import { db } from "@/lib/db";
import { createPasswordReset, getCtx, getSessionUser, hashPassword, login, logout, resetPassword, validatePasswordStrength } from "@/server/auth";
import { type ActionResult, AppError, invalid, toActionError } from "@/server/errors";
import * as T from "@/server/tickets";
import * as A from "@/server/admin";
import { audit } from "@/server/audit";
import bcrypt from "bcryptjs";

async function run<T>(fn: () => Promise<T>, message?: string, paths: string[] = []): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    for (const p of paths) revalidatePath(p, p.includes("[") ? "page" : undefined);
    return { ok: true, data, message };
  } catch (e) {
    return toActionError(e);
  }
}

// ----------------------------------------------------------- Autenticación
export async function loginAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    if (!email || !password) return { ok: false, error: "Ingresa tu correo y contraseña." };
    await login(email, password);
  } catch (e) {
    return toActionError(e);
  }
  const next = String(form.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/home");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

/** Cambia entre el Portal del empleado y Operaciones TI (solo el equipo de TI puede ir a Operaciones). */
export async function setExperienceAction(mode: "employee" | "ops") {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const target = mode === "ops" && canUseOps(user.role) ? "ops" : "employee";
  (await cookies()).set(EXPERIENCE_COOKIE, target, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/home");
}

export async function forgotPasswordAction(_: unknown, form: FormData): Promise<ActionResult<{ demoLink?: string }>> {
  try {
    const email = z.string().trim().email("Ingresa un correo válido.").parse(form.get("email"));
    const token = await createPasswordReset(email);
    const link = token ? `/reset-password?token=${token}` : undefined;
    if (link) {
      const { emailConfigured, renderEmail, sendEmail } = await import("@/server/email");
      if (emailConfigured()) {
        await sendEmail(email, "Restablece tu contraseña", renderEmail("Restablece tu contraseña", "Recibimos una solicitud para crear una contraseña nueva. El enlace vence en 30 minutos. Si no fuiste tú, ignora este correo.", { label: "Crear contraseña nueva", url: `${process.env.APP_URL ?? ""}${link}` }));
      } else console.info(`[password-reset] enlace generado para ${email} (correo no configurado)`);
    }
    // Sin servicio de correo aún (Fase 3): en modo demo mostramos el enlace en pantalla.
    return { ok: true, message: "Si el correo está registrado, enviamos un enlace para restablecer tu contraseña.", data: process.env.DEMO_MODE === "true" ? { demoLink: link } : {} };
  } catch (e) {
    return toActionError(e);
  }
}

export async function resetPasswordAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    const pw = String(form.get("password") ?? "");
    if (pw !== String(form.get("confirm") ?? "")) return { ok: false, error: "Las contraseñas no coinciden.", fields: { confirm: "No coincide." } };
    await resetPassword(String(form.get("token") ?? ""), pw);
    return { ok: true, message: "Contraseña actualizada. Ya puedes iniciar sesión." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function changePasswordAction(input: { current: string; next: string }) {
  return run(async () => {
    const u = await getSessionUser();
    if (!u) throw new AppError("UNAUTHORIZED", "Sesión expirada.");
    const user = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    if (!(await bcrypt.compare(input.current, user.passwordHash))) throw invalid("La contraseña actual no es correcta.", { current: "Incorrecta." });
    const weak = validatePasswordStrength(input.next);
    if (weak) throw invalid(weak, { next: weak });
    await db.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(input.next) } });
    await db.session.deleteMany({ where: { userId: u.id, id: { not: u.sessionId } } });
    await audit({ orgId: u.orgId, actor: u, action: "auth.password_changed", entity: "user", entityId: u.id });
  }, "Contraseña actualizada. Cerramos tus otras sesiones.");
}

export async function revokeSessionAction(sessionId: string) {
  return run(async () => {
    const u = await getSessionUser();
    if (!u) throw new AppError("UNAUTHORIZED", "Sesión expirada.");
    await db.session.deleteMany({ where: { id: sessionId, userId: u.id } });
    await audit({ orgId: u.orgId, actor: u, action: "auth.session_revoked", entity: "session", entityId: sessionId });
  }, "Sesión cerrada.", ["/profile"]);
}

// ----------------------------------------------------------- Tickets
export async function suggestAction(text: string) {
  return run(async () => T.suggestForText(await getCtx(), text.slice(0, 2000)));
}

export async function createIncidentAction(input: unknown) {
  return run(async () => {
    const t = await T.createIncident(await getCtx("tickets:create"), input);
    return { id: t.id, number: t.number };
  }, "¡Listo! Recibimos tu reporte.");
}

export async function createRequestAction(input: unknown) {
  return run(async () => {
    const t = await T.createRequest(await getCtx("tickets:create"), input);
    return { id: t.id, number: t.number, approval: t.approvalStatus === "PENDING" };
  }, "¡Listo! Recibimos tu solicitud.");
}

export async function updateTicketAction(id: string, input: unknown) {
  return run(async () => { await T.updateTicket(await getCtx("tickets:work"), id, input); }, "Cambios guardados.", [`/tickets/${id}`]);
}

export async function escalateAction(id: string, reason: string) {
  return run(async () => { await T.escalateHierarchical(await getCtx("tickets:work"), id, reason); }, "Escalamiento enviado a líderes y gestores.", [`/tickets/${id}`]);
}

export async function commentAction(id: string, input: unknown) {
  return run(async () => { await T.addComment(await getCtx(), id, input); }, "Mensaje enviado.", [`/tickets/${id}`]);
}

export async function confirmResolutionAction(id: string, input: unknown) {
  return run(async () => { await T.confirmResolution(await getCtx(), id, input); }, "¡Gracias por tu respuesta!", [`/tickets/${id}`]);
}

export async function decideApprovalAction(approvalId: string, input: unknown) {
  return run(async () => { await T.decideApproval(await getCtx("approvals:decide"), approvalId, input); }, "Decisión registrada.", ["/approvals"]);
}

// ----------------------------------------------------------- Notificaciones
export async function markNotificationsReadAction(ids?: string[]) {
  return run(async () => {
    const u = await getSessionUser();
    if (!u) throw new AppError("UNAUTHORIZED", "Sesión expirada.");
    await db.notification.updateMany({ where: { userId: u.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
  });
}

// ----------------------------------------------------------- Administración
export async function saveUserAction(id: string | null, input: unknown) {
  return run(async () => { await A.saveUser(await getCtx("users:manage"), id, input); }, "Usuario guardado.", ["/admin/users"]);
}
export async function saveDepartmentAction(name: string) {
  return run(async () => { await A.saveDepartment(await getCtx("users:manage"), name); }, "Departamento creado.", ["/admin/users"]);
}
export async function saveTeamAction(id: string | null, input: unknown) {
  return run(async () => { await A.saveTeam(await getCtx("teams:manage"), id, input); }, "Equipo guardado.", ["/admin/teams"]);
}
export async function deleteTeamAction(id: string) {
  return run(async () => { await A.deleteTeam(await getCtx("teams:manage"), id); }, "Equipo eliminado.", ["/admin/teams"]);
}
export async function saveCategoryAction(id: string | null, input: unknown) {
  return run(async () => { await A.saveCategory(await getCtx("catalog:manage"), id, input); }, "Categoría guardada.", ["/admin/categories"]);
}
export async function deleteCategoryAction(id: string) {
  return run(async () => { await A.deleteCategory(await getCtx("catalog:manage"), id); }, "Categoría eliminada.", ["/admin/categories"]);
}
export async function saveServiceAction(id: string | null, input: unknown) {
  return run(async () => {
    const s = await A.saveService(await getCtx("catalog:manage"), id, input);
    return { id: s.id };
  }, "Servicio guardado.", ["/admin/catalog", "/catalog"]);
}
export async function savePolicyAction(id: string, input: unknown) {
  return run(async () => { await A.savePolicy(await getCtx("sla:manage"), id, input); }, "Política de SLA actualizada.", ["/admin/sla"]);
}
export async function saveCalendarAction(id: string | null, input: unknown) {
  return run(async () => { await A.saveCalendar(await getCtx("sla:manage"), id, input); }, "Calendario guardado.", ["/admin/sla"]);
}
export async function addHolidayAction(calendarId: string, input: unknown) {
  return run(async () => { await A.addHoliday(await getCtx("sla:manage"), calendarId, input); }, "Feriado agregado.", ["/admin/sla"]);
}
export async function removeHolidayAction(id: string) {
  return run(async () => { await A.removeHoliday(await getCtx("sla:manage"), id); }, "Feriado eliminado.", ["/admin/sla"]);
}
export async function saveArticleAction(id: string | null, input: unknown) {
  return run(async () => {
    const a = await A.saveArticle(await getCtx("kb:manage"), id, input);
    return { slug: a.slug };
  }, "Artículo guardado.", ["/help"]);
}
export async function deleteArticleAction(id: string) {
  return run(async () => { await A.deleteArticle(await getCtx("kb:manage"), id); }, "Artículo eliminado.", ["/help"]);
}
export async function rateArticleAction(id: string, helpful: boolean) {
  return run(async () => { await A.rateArticle(await getCtx(), id, helpful); }, "¡Gracias por tu opinión!");
}
export async function saveOrgSettingsAction(input: unknown) {
  return run(async () => { await A.saveOrgSettings(await getCtx("org:manage"), input); }, "Configuración guardada.", ["/admin/settings"]);
}

// ----------------------------------------------------------- Plataforma SaaS
export async function createOrganizationAction(input: unknown) {
  return run(async () => {
    const u = await getSessionUser();
    if (!u) throw new AppError("UNAUTHORIZED", "Sesión expirada.");
    await A.createOrganization(u, input);
  }, "Organización creada con su administrador, SLA base y mesa de ayuda.", ["/platform"]);
}
export async function setOrganizationActiveAction(id: string, active: boolean) {
  return run(async () => {
    const u = await getSessionUser();
    if (!u) throw new AppError("UNAUTHORIZED", "Sesión expirada.");
    await A.setOrganizationActive(u, id, active);
  }, active ? "Organización reactivada." : "Organización suspendida.", ["/platform"]);
}
