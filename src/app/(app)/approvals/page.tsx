import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, ShieldCheck, ShieldX } from "lucide-react";
import { requireCtx } from "@/server/auth";
import { listMyApprovals, type FormField } from "@/server/tickets";
import { decrypt, isEncrypted } from "@/lib/crypto";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { DynIcon } from "@/components/icon";
import { cn, ticketRef, timeAgo } from "@/lib/utils";
import { DecideButtons } from "./decide";
import { pendingChangeApprovals } from "@/server/changes";
import { can } from "@/lib/rbac";
import { Badge } from "@/components/ui";
import { AlertTriangle, GitPullRequestArrow } from "lucide-react";
import { CHANGE_TYPE_LABEL, CHANGE_TYPE_TONE, LEVEL_LABEL, RISK_TONE } from "@/lib/labels";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Aprobaciones" };
export const dynamic = "force-dynamic";

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireCtx("approvals:decide");
  const tab = (await searchParams).tab === "done" ? "DONE" : "PENDING";
  const items = await listMyApprovals(ctx, tab);
  const changes = tab === "PENDING" && can(ctx.user.role, "changes:approve") ? await pendingChangeApprovals(ctx) : [];
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Aprobaciones" description="Revisa y decide en un clic. El solicitante recibe tu respuesta al instante." />
      <div className="mb-4 flex gap-1 border-b border-border">
        <Link href="/approvals" className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === "PENDING" ? "border-primary font-medium" : "border-transparent text-muted")}>Pendientes</Link>
        <Link href="/approvals?tab=done" className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === "DONE" ? "border-primary font-medium" : "border-transparent text-muted")}>Historial</Link>
      </div>
      {changes.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold">Cambios esperando al CAB</h2>
          <Card className="divide-y divide-border">
            {changes.map((a) => (
              <Link key={a.id} href={`/changes/${a.change.id}`} className="flex flex-col gap-2 px-5 py-3.5 hover:bg-subtle sm:flex-row sm:items-center">
                <GitPullRequestArrow className="hidden h-4 w-4 text-muted sm:block" />
                <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5 text-sm font-medium">{a.change.type === "EMERGENCY" && <AlertTriangle className="h-3.5 w-3.5 text-red-500" />}CHG-{a.change.number} · {a.change.title}</span>
                  <span className="text-xs text-muted">{a.change.requester.name} · {a.change.plannedStart ? formatDateTime(a.change.plannedStart) : "sin ventana"} · nivel {a.level}</span></span>
                <span className="flex gap-1.5"><Badge tone={CHANGE_TYPE_TONE[a.change.type]}>{CHANGE_TYPE_LABEL[a.change.type]}</Badge><Badge tone={RISK_TONE[a.change.risk]}>Riesgo {LEVEL_LABEL[a.change.risk]}</Badge></span>
              </Link>
            ))}
          </Card>
          <h2 className="mb-2 mt-6 text-sm font-semibold">Solicitudes de servicio</h2>
        </section>
      )}
      {items.length === 0 ? <Card><EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title={tab === "PENDING" ? "¡Estás al día!" : "Sin historial"} description={tab === "PENDING" ? "No tienes solicitudes esperando tu aprobación." : undefined} /></Card> : (
        <div className="space-y-3">
          {items.map((a) => {
            const t = a.ticket;
            const schema = (t.serviceItem?.formSchema as unknown as FormField[]) ?? [];
            const answers = Object.entries((t.formData as Record<string, string>) ?? {}).map(([k, v]) => ({ label: schema.find((f) => f.key === k)?.label ?? k, value: isEncrypted(v) ? decrypt(v) : v }));
            return (
              <Card key={a.id} className="p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><DynIcon name={t.serviceItem?.icon ?? "package"} className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{t.title} {a.level > 1 && <Badge tone="violet">Nivel {a.level}</Badge>}</p>
                    <p className="text-sm text-muted"><strong className="font-medium text-fg">{t.requester.name}</strong>{t.requester.department ? ` · ${t.requester.department.name}` : ""} · <Link href={`/tickets/${t.id}`} className="hover:underline">{ticketRef(t.type, t.number)}</Link> · {timeAgo(a.createdAt)}</p>
                    {answers.length > 0 && (
                      <dl className="mt-3 grid gap-x-6 gap-y-2 rounded-lg bg-subtle p-3 text-sm sm:grid-cols-2">
                        {answers.map((x) => <div key={x.label}><dt className="text-xs text-muted">{x.label}</dt><dd>{x.value}</dd></div>)}
                      </dl>
                    )}
                    {t.description && t.description !== t.title && <p className="mt-2 text-sm text-muted">«{t.description}»</p>}
                    {a.status !== "PENDING" && (
                      <p className="mt-3 flex items-center gap-1.5 text-sm">
                        {a.status === "APPROVED" ? <ShieldCheck className="h-4 w-4 text-emerald-500" /> : <ShieldX className="h-4 w-4 text-red-500" />}
                        {a.status === "APPROVED" ? "Aprobaste" : "Rechazaste"} {a.decidedAt && timeAgo(a.decidedAt)}{a.comment ? ` — «${a.comment}»` : ""}
                      </p>
                    )}
                  </div>
                  {a.status === "PENDING" && <DecideButtons approvalId={a.id} />}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
