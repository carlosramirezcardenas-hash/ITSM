import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import { PageHeader } from "@/components/ui";
import { TeamsClient } from "./teams-client";

export const metadata: Metadata = { title: "Equipos" };
export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const ctx = await requireCtx("teams:manage");
  const [teams, agents, openCounts] = await Promise.all([
    db.team.findMany({ where: { orgId: ctx.orgId }, include: { members: { include: { user: { select: { id: true, name: true } } } }, categories: { select: { name: true } } }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { orgId: ctx.orgId, isActive: true, role: { in: ["AGENT", "SERVICE_MANAGER", "ORG_ADMIN"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.ticket.groupBy({ by: ["teamId"], where: { orgId: ctx.orgId, status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING"] } }, _count: { _all: true } }),
  ]);
  const open = new Map(openCounts.map((o) => [o.teamId, o._count._all]));
  return (
    <div>
      <PageHeader title="Equipos de soporte" description="Los tickets se enrutan a un equipo según su categoría o servicio, y se asignan al agente con menos carga." />
      <TeamsClient agents={agents} teams={teams.map((t) => ({ id: t.id, name: t.name, description: t.description, autoAssign: t.autoAssign, open: open.get(t.id) ?? 0, categories: t.categories.map((c) => c.name), members: t.members.map((m) => ({ userId: m.user.id, name: m.user.name, isLead: m.isLead })) }))} />
    </div>
  );
}
