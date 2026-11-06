import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import { ProblemForm } from "./problem-form";

export const metadata: Metadata = { title: "Registrar problema" };

export default async function NewProblem({ searchParams }: { searchParams: Promise<{ from?: string; category?: string }> }) {
  const ctx = await requireCtx("problems:manage");
  const sp = await searchParams;
  const [categories, teams, staff, cis] = await Promise.all([
    db.category.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true, teamId: true }, orderBy: { name: "asc" } }),
    db.team.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { orgId: ctx.orgId, isActive: true, role: { in: ["AGENT", "SERVICE_MANAGER", "ORG_ADMIN"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.configItem.findMany({ where: { orgId: ctx.orgId, status: { not: "RETIRED" } }, select: { id: true, name: true, type: true }, orderBy: { name: "asc" } }),
  ]);
  const from = sp.from ? await db.ticket.findFirst({ where: { id: sp.from, orgId: ctx.orgId }, select: { id: true, number: true, title: true, description: true, categoryId: true, teamId: true, configItemId: true } }) : null;
  const categoryId = from?.categoryId ?? (categories.some((c) => c.id === sp.category) ? sp.category! : "");
  const recent = categoryId ? await db.ticket.findMany({ where: { orgId: ctx.orgId, type: "INCIDENT", categoryId, problemId: null, createdAt: { gt: new Date(Date.now() - 30 * 86400_000) } }, select: { id: true, number: true, title: true }, orderBy: { createdAt: "desc" }, take: 20 }) : [];
  return (
    <ProblemForm
      categories={categories} teams={teams} staff={staff} cis={cis} me={ctx.user.id}
      initial={{
        title: from ? from.title : "", description: from?.description ?? "", categoryId,
        teamId: from?.teamId ?? categories.find((c) => c.id === categoryId)?.teamId ?? "",
        ciIds: from?.configItemId ? [from.configItemId] : [],
        incidentIds: from ? [from.id] : [],
      }}
      candidates={[...(from ? [{ id: from.id, number: from.number, title: from.title }] : []), ...recent.filter((r) => r.id !== from?.id)]}
    />
  );
}
