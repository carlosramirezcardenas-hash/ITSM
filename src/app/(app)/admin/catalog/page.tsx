import Link from "next/link";
import type { Metadata } from "next";
import { Plus, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import { Badge, Card, PageHeader, buttonClass } from "@/components/ui";
import { DynIcon } from "@/components/icon";

export const metadata: Metadata = { title: "Administrar catálogo" };
export const dynamic = "force-dynamic";

export default async function AdminCatalog() {
  const ctx = await requireCtx("catalog:manage");
  const services = await db.serviceItem.findMany({ where: { orgId: ctx.orgId }, include: { category: true, ownerTeam: true, _count: { select: { tickets: true } } }, orderBy: [{ isActive: "desc" }, { name: "asc" }] });
  return (
    <div>
      <PageHeader title="Catálogo de servicios" description="Define qué pueden pedir las personas, con qué formulario y quién lo aprueba." action={<Link href="/admin/catalog/new" className={buttonClass()}><Plus className="h-4 w-4" />Nuevo servicio</Link>} />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-xs text-muted"><tr className="border-b border-border"><th className="px-5 py-2.5 text-left font-medium">Servicio</th><th className="px-3 text-left font-medium">Categoría</th><th className="px-3 text-left font-medium">Equipo</th><th className="px-3 text-left font-medium">Tiempo</th><th className="px-3 text-left font-medium">Aprobación</th><th className="px-3 text-right font-medium">Solicitudes</th><th className="px-5" /></tr></thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0 hover:bg-subtle/60">
                <td className="px-5 py-3"><div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary"><DynIcon name={s.icon} className="h-4 w-4" /></span><span className="font-medium">{s.name}</span>{!s.isActive && <Badge tone="red">Inactivo</Badge>}</div></td>
                <td className="px-3 text-muted">{s.category?.name ?? "—"}</td>
                <td className="px-3 text-muted">{s.ownerTeam?.name ?? "—"}</td>
                <td className="px-3 text-muted">{s.estimatedHours} h</td>
                <td className="px-3">{s.requiresApproval ? <Badge tone="amber"><ShieldCheck className="h-3 w-3" />{s.approvalMode === "MANAGER" ? "Jefatura" : "Aprobador fijo"}{s.secondApproverId ? " + 2.º nivel" : ""}</Badge> : <span className="text-muted">No</span>}</td>
                <td className="px-3 text-right tabular-nums">{s._count.tickets}</td>
                <td className="px-5 text-right"><Link href={`/admin/catalog/${s.id}`} className={buttonClass("ghost", "sm")}>Editar</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
