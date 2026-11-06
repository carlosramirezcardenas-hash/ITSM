import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/server/auth";
import { Badge, Card, PageHeader, Stat } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { OrgActions, NewOrg } from "./platform-client";

export const metadata: Metadata = { title: "Plataforma" };
export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  const u = await requireUser();
  if (u.role !== "SUPER_ADMIN") redirect("/home");
  const orgs = await db.organization.findMany({ include: { _count: { select: { users: true, tickets: true } } }, orderBy: { createdAt: "asc" } });
  const logs = await db.auditLog.findMany({ where: { action: { startsWith: "platform" } }, orderBy: { createdAt: "desc" }, take: 10 });
  return (
    <div className="space-y-6">
      <PageHeader title="Organizaciones (tenants)" description="Cada organización tiene datos completamente aislados. Desde aquí no se accede a sus tickets." action={<NewOrg />} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Organizaciones" value={orgs.length} />
        <Stat label="Activas" value={orgs.filter((o) => o.isActive).length} />
        <Stat label="Usuarios totales" value={orgs.reduce((a, o) => a + o._count.users, 0)} />
        <Stat label="Tickets totales" value={orgs.reduce((a, o) => a + o._count.tickets, 0)} />
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-xs text-muted"><tr className="border-b border-border"><th className="px-5 py-2.5 text-left font-medium">Organización</th><th className="px-3 text-left font-medium">Plan</th><th className="px-3 text-right font-medium">Usuarios</th><th className="px-3 text-right font-medium">Tickets</th><th className="px-3 text-left font-medium">Creada</th><th className="px-5" /></tr></thead>
          <tbody>{orgs.map((o) => (
            <tr key={o.id} className="border-b border-border last:border-0">
              <td className="px-5 py-3"><p className="font-medium">{o.name} {!o.isActive && <Badge tone="red">Suspendida</Badge>}</p><p className="text-xs text-muted">{o.slug}</p></td>
              <td className="px-3"><Badge tone="primary">{o.plan}</Badge></td>
              <td className="px-3 text-right tabular-nums">{o._count.users}</td>
              <td className="px-3 text-right tabular-nums">{o._count.tickets}</td>
              <td className="px-3 text-muted">{formatDateTime(o.createdAt)}</td>
              <td className="px-5 text-right"><OrgActions id={o.id} active={o.isActive} name={o.name} /></td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
      {logs.length > 0 && <Card className="p-5"><p className="mb-2 text-sm font-medium">Actividad de plataforma</p><ul className="space-y-1 text-sm text-muted">{logs.map((l) => <li key={l.id}>{formatDateTime(l.createdAt)} · {l.actorName} · {l.action}</li>)}</ul></Card>}
    </div>
  );
}
