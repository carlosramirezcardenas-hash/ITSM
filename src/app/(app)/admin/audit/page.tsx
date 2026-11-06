import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import { Badge, Card, PageHeader, buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Auditoría" };
export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string; action?: string }> }) {
  const ctx = await requireCtx("audit:view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = { orgId: ctx.orgId, ...(sp.action ? { action: { startsWith: sp.action } } : {}) };
  const [items, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50 }),
    db.auditLog.count({ where }),
  ]);
  const filters = [["", "Todo"], ["auth", "Accesos"], ["user", "Usuarios"], ["team", "Equipos"], ["service", "Catálogo"], ["sla", "SLA"], ["approval", "Aprobaciones"], ["kb", "Conocimiento"], ["report", "Reportes"]];
  return (
    <div>
      <PageHeader title="Registro de auditoría" description="Quién hizo qué y cuándo. Los registros no se pueden editar." />
      <div className="scrollbar-thin mb-4 flex gap-1.5 overflow-x-auto">{filters.map(([k, l]) => <Link key={k} href={`/admin/audit${k ? `?action=${k}` : ""}`} className={`whitespace-nowrap rounded-full border px-3 py-1 text-sm ${(sp.action ?? "") === k ? "border-primary bg-primary-soft text-primary" : "border-border text-muted"}`}>{l}</Link>)}</div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-xs text-muted"><tr className="border-b border-border"><th className="px-5 py-2.5 text-left font-medium">Fecha</th><th className="px-3 text-left font-medium">Persona</th><th className="px-3 text-left font-medium">Acción</th><th className="px-3 text-left font-medium">Detalle</th><th className="px-5 text-left font-medium">IP</th></tr></thead>
          <tbody>{items.map((a) => (
            <tr key={a.id} className="border-b border-border last:border-0">
              <td className="whitespace-nowrap px-5 py-2.5 text-muted">{formatDateTime(a.createdAt)}</td>
              <td className="px-3">{a.actorName ?? "Sistema"}</td>
              <td className="px-3"><Badge tone={a.action.includes("failed") ? "red" : a.action.startsWith("auth") ? "blue" : "slate"}>{a.action}</Badge></td>
              <td className="max-w-xs truncate px-3 font-mono text-xs text-muted">{a.entity}{a.meta ? ` ${JSON.stringify(a.meta)}` : ""}</td>
              <td className="px-5 font-mono text-xs text-muted">{a.ip ?? "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
      <div className="mt-4 flex items-center justify-between text-sm text-muted">
        <span>{total} registros</span>
        <div className="flex gap-2">
          {page > 1 && <Link className={buttonClass("outline", "sm")} href={`/admin/audit?page=${page - 1}${sp.action ? `&action=${sp.action}` : ""}`}>Anterior</Link>}
          {page * 50 < total && <Link className={buttonClass("outline", "sm")} href={`/admin/audit?page=${page + 1}${sp.action ? `&action=${sp.action}` : ""}`}>Siguiente</Link>}
        </div>
      </div>
    </div>
  );
}
