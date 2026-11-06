import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requireCtx } from "@/server/auth";
import type { FormField } from "@/server/tickets";
import { RequestForm } from "./request-form";

export const metadata: Metadata = { title: "Solicitar servicio" };

export default async function ServicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx("tickets:create");
  const { id } = await params;
  const s = await db.serviceItem.findFirst({
    where: { id, orgId: ctx.orgId, isActive: true },
    include: { category: true, ownerTeam: true, owner: { select: { name: true } }, approver: { select: { name: true } }, secondApprover: { select: { name: true } } },
  });
  if (!s) notFound();
  const staff = can(ctx.user.role, "tickets:work");
  const me = await db.user.findUnique({ where: { id: ctx.user.id }, select: { manager: { select: { name: true } } } });
  const users = staff ? await db.user.findMany({ where: { orgId: ctx.orgId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  const approverName = !s.requiresApproval ? null : s.approvalMode === "USER" ? s.approver?.name ?? "Administración" : me?.manager?.name ?? "tu jefatura";
  const fullApprover = approverName && s.secondApprover ? `${approverName} y luego ${s.secondApprover.name}` : approverName;
  return (
    <RequestForm
      service={{ id: s.id, name: s.name, description: s.description, icon: s.icon, estimatedHours: s.estimatedHours, requirements: s.requirements, requiresApproval: s.requiresApproval, category: s.category?.name ?? null, team: s.ownerTeam?.name ?? null, owner: s.owner?.name ?? null, fields: s.formSchema as unknown as FormField[] }}
      approverName={fullApprover} staff={staff} users={users} me={ctx.user.id}
    />
  );
}
