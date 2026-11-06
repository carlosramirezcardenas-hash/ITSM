import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import { CiForm } from "../../ci-form";

export const metadata: Metadata = { title: "Editar elemento" };

export default async function EditCI({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx("cmdb:manage");
  const { id } = await params;
  const c = await db.configItem.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!c) notFound();
  const [staff, teams] = await Promise.all([
    db.user.findMany({ where: { orgId: ctx.orgId, isActive: true, role: { not: "END_USER" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.team.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const s = (v: string | number | null) => (v == null ? "" : String(v));
  return <CiForm id={c.id} staff={staff} teams={teams} initial={{ name: c.name, type: c.type, status: c.status, criticality: c.criticality, description: s(c.description), ownerId: s(c.ownerId), teamId: s(c.teamId), serial: s(c.serial), location: s(c.location), ipAddress: s(c.ipAddress), version: s(c.version), seats: s(c.seats), seatsUsed: s(c.seatsUsed), expiresAt: s(c.expiresAt), contact: s(c.contact) }} />;
}
