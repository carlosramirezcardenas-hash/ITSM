import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import type { FormField } from "@/server/tickets";
import { ServiceEditor } from "./editor";

export const metadata: Metadata = { title: "Editar servicio" };

export default async function EditService({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx("catalog:manage");
  const { id } = await params;
  const s = id === "new" ? null : await db.serviceItem.findFirst({ where: { id, orgId: ctx.orgId } });
  if (id !== "new" && !s) notFound();
  const [categories, teams, users] = await Promise.all([
    db.category.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.team.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { orgId: ctx.orgId, isActive: true }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
  ]);
  return <ServiceEditor categories={categories} teams={teams} users={users} service={s ? {
    id: s.id, name: s.name, description: s.description, icon: s.icon, categoryId: s.categoryId ?? "", estimatedHours: s.estimatedHours, requirements: s.requirements ?? "",
    formSchema: s.formSchema as unknown as FormField[], requiresApproval: s.requiresApproval, approvalMode: s.approvalMode as "MANAGER" | "USER", approverId: s.approverId ?? "",
    ownerTeamId: s.ownerTeamId ?? "", ownerId: s.ownerId ?? "", defaultPriority: s.defaultPriority, isActive: s.isActive,
  } : null} />;
}
