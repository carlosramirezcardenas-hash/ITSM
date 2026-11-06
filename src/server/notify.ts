import { db } from "@/lib/db";

export type NotifyInput = { title: string; body?: string; link?: string; kind?: "info" | "success" | "warning" | "danger"; email?: boolean };

/** Crea notificaciones in-app (el canal SSE las entrega en tiempo real). */
export async function notify(orgId: string, userIds: (string | null | undefined)[], n: NotifyInput, exceptUserId?: string) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x && x !== exceptUserId))];
  if (!ids.length) return;
  await db.notification.createMany({
    data: ids.map((userId) => ({ orgId, userId, title: n.title, body: n.body, link: n.link, kind: n.kind ?? "info" })),
  });
  // Correo para avisos que requieren acción (aprobaciones, incidentes críticos), si está configurado
  if (n.email) {
    const { emailConfigured, renderEmail, sendEmail } = await import("./email");
    if (emailConfigured()) {
      const users = await db.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { email: true } });
      const url = `${process.env.APP_URL ?? ""}${n.link ?? "/home"}`;
      await Promise.all(users.map((u) => sendEmail(u.email, n.title, renderEmail(n.title, n.body ?? "", { label: "Abrir en ITSM Easy", url }))));
    }
  }
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
