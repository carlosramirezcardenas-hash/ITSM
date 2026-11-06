import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import { CiForm } from "../ci-form";

export const metadata: Metadata = { title: "Nuevo elemento" };

export default async function NewCI({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const ctx = await requireCtx("cmdb:manage");
  const type = (await searchParams).type;
  const [staff, teams] = await Promise.all([
    db.user.findMany({ where: { orgId: ctx.orgId, isActive: true, role: { not: "END_USER" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.team.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return <CiForm initial={type ? { type } : {}} staff={staff} teams={teams} />;
}
