import { db } from "@/lib/db";

export type NotifyInput = { title: string; body?: string; link?: string; kind?: "info" | "success" | "warning" | "danger" };

/** Crea notificaciones in-app (el canal SSE las entrega en tiempo real). */
export async function notify(orgId: string, userIds: (string | null | undefined)[], n: NotifyInput, exceptUserId?: string) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x && x !== exceptUserId))];
  if (!ids.length) return;
  await db.notification.createMany({
    data: ids.map((userId) => ({ orgId, userId, title: n.title, body: n.body, link: n.link, kind: n.kind ?? "info" })),
  });
  // Punto de extensión (Fase 3): correo electrónico y Microsoft Teams.
}

export async function teamMemberIds(teamId: string | null | undefined, leadsOnly = false) {
  if (!teamId) return [];
  const m = await db.teamMember.findMany({ where: { teamId, ...(leadsOnly ? { isLead: true } : {}) }, select: { userId: true } });
  return m.map((x) => x.userId);
}

export async function managerIds(orgId: string) {
  const u = await db.user.findMany({ where: { orgId, isActive: true, role: { in: ["SERVICE_MANAGER"] } }, select: { id: true } });
  return u.map((x) => x.id);
}
