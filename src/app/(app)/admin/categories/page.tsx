import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import { PageHeader } from "@/components/ui";
import { CategoriesClient } from "./categories-client";

export const metadata: Metadata = { title: "Categorías" };
export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const ctx = await requireCtx("catalog:manage");
  const [cats, teams] = await Promise.all([
    db.category.findMany({ where: { orgId: ctx.orgId }, include: { team: true, _count: { select: { tickets: true } } }, orderBy: { name: "asc" } }),
    db.team.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div>
      <PageHeader title="Categorías y clasificación automática" description="Cada categoría define a qué equipo llega un reporte. Las palabras clave permiten clasificar automáticamente lo que escribe el usuario." />
      <CategoriesClient teams={teams} categories={cats.map((c) => ({ id: c.id, name: c.name, icon: c.icon, keywords: c.keywords.join(", "), teamId: c.teamId ?? "", team: c.team?.name ?? null, tickets: c._count.tickets }))} />
    </div>
  );
}
