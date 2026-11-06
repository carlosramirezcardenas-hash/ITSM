import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireUser } from "@/server/auth";
import { ROLE_LABEL } from "@/lib/labels";
import { permissionsFor } from "@/lib/rbac";
import { Avatar, Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { timeAgo } from "@/lib/utils";
import { ChangePassword, RevokeSession } from "./profile-client";

export const metadata: Metadata = { title: "Mi perfil" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const u = await requireUser();
  const [user, sessions] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: u.id }, include: { department: true, manager: { select: { name: true } }, memberships: { include: { team: true } } } }),
    db.session.findMany({ where: { userId: u.id, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } }),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Mi perfil y seguridad" />
      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <Avatar name={user.name} size={56} />
        <div className="flex-1">
          <p className="text-lg font-semibold">{user.name}</p>
          <p className="text-sm text-muted">{user.email}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="primary">{ROLE_LABEL[user.role]}</Badge>
            {user.department && <Badge>{user.department.name}</Badge>}
            {user.memberships.map((m) => <Badge key={m.teamId}>{m.team.name}{m.isLead ? " · líder" : ""}</Badge>)}
          </div>
          {user.manager && <p className="mt-2 text-xs text-muted">Jefatura directa: {user.manager.name}</p>}
        </div>
      </Card>
      <Card>
        <CardHeader title="Cambiar contraseña" description="Al cambiarla, cerraremos tus otras sesiones abiertas." />
        <div className="p-5"><ChangePassword /></div>
      </Card>
      <Card>
        <CardHeader title="Sesiones activas" description="Cierra sesiones en equipos que no reconozcas." />
        <ul className="divide-y divide-border">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate">{s.userAgent ?? "Dispositivo desconocido"}</p>
                <p className="text-xs text-muted">IP {s.ip} · última actividad {timeAgo(s.lastSeenAt)}</p>
              </div>
              {s.id === u.sessionId ? <Badge tone="green">Esta sesión</Badge> : <RevokeSession id={s.id} />}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Mis permisos" description="Lo que tu rol te permite hacer en la plataforma." />
        <div className="flex flex-wrap gap-1.5 p-5">{permissionsFor(user.role).map((p) => <Badge key={p}>{p}</Badge>)}</div>
      </Card>
    </div>
  );
}
