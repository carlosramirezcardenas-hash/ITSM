import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import { ChangeForm } from "../../change-form";
import { changeOptions } from "../../change-options";

export const metadata: Metadata = { title: "Editar cambio" };

const iso = (d: Date | null) => d?.toISOString() ?? "";

export default async function EditChange({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx("changes:create");
  const { id } = await params;
  const c = await db.change.findFirst({ where: { id, orgId: ctx.orgId }, include: { configItems: { select: { id: true } } } });
  if (!c) notFound();
  if (!["DRAFT", "ASSESSMENT", "REJECTED"].includes(c.status)) redirect(`/changes/${id}`);
  const opts = await changeOptions(ctx.orgId);
  return <ChangeForm {...opts} me={ctx.user.id} changeId={c.id} initial={{
    title: c.title, description: c.description, reason: c.reason ?? "", type: c.type, ciIds: c.configItems.map((x) => x.id),
    riskAnswers: (c.riskAnswers as Record<string, boolean>) ?? {}, implementationPlan: c.implementationPlan ?? "", rollbackPlan: c.rollbackPlan ?? "", testPlan: c.testPlan ?? "",
    plannedStart: iso(c.plannedStart), plannedEnd: iso(c.plannedEnd), ownerId: c.ownerId ?? "", teamId: c.teamId ?? "", problemId: c.problemId ?? "",
  }} />;
}
