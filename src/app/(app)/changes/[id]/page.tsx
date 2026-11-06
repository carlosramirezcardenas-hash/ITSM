import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, ArrowLeft, Check, Clock, Network, ShieldCheck, ShieldX } from "lucide-react";
import { requireCtx } from "@/server/auth";
import { AppError } from "@/server/errors";
import { getChange } from "@/server/changes";
import { getLogs } from "@/server/worklog";
import { can } from "@/lib/rbac";
import { RISK_QUESTIONS } from "@/lib/itsm";
import { Badge, Card, CardHeader } from "@/components/ui";
import { WorkLog } from "@/components/worklog";
import { APPROVAL_LABEL, CHANGE_STATUS_LABEL, CHANGE_STATUS_TONE, CHANGE_TYPE_LABEL, CHANGE_TYPE_TONE, CI_TYPE_LABEL, LEVEL_LABEL, OUTCOME_LABEL, OUTCOME_TONE, RISK_TONE } from "@/lib/labels";
import { cn, formatDateTime } from "@/lib/utils";
import { ChangeActions } from "./change-actions";

export const metadata: Metadata = { title: "Cambio" };
export const dynamic = "force-dynamic";

const STEPS = ["DRAFT", "ASSESSMENT", "PENDING_APPROVAL", "SCHEDULED", "IN_PROGRESS", "REVIEW", "CLOSED"];
const STEP_LABEL = ["Borrador", "Evaluación", "Aprobación", "Programado", "Implementación", "Revisión", "Cerrado"];

export default async function ChangePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx("changes:create");
  const { id } = await params;
  let c;
  try { c = await getChange(ctx, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const logs = await getLogs(ctx.orgId, "change", id);
  const idx = STEPS.indexOf(c.status);
  const answers = (c.riskAnswers as Record<string, boolean>) ?? {};
  const myApproval = c.approvals.find((a) => a.approver.id === ctx.user.id && a.status === "PENDING");
  const levels = [...new Set(c.approvals.map((a) => a.level))];
  return (
    <div>
      <Link href="/changes" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />Cambios</Link>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm text-muted"><span className="font-mono">CHG-{c.number}</span> · solicitado por {c.requester.name}</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{c.title}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone={CHANGE_STATUS_TONE[c.status]} dot>{CHANGE_STATUS_LABEL[c.status]}</Badge>
            <Badge tone={CHANGE_TYPE_TONE[c.type]}>{CHANGE_TYPE_LABEL[c.type]}</Badge>
            <Badge tone={RISK_TONE[c.risk]}>Riesgo {LEVEL_LABEL[c.risk]} ({c.riskScore})</Badge>
            <Badge tone={RISK_TONE[c.impact]}>Impacto {LEVEL_LABEL[c.impact]}</Badge>
            {c.outcome && <Badge tone={OUTCOME_TONE[c.outcome]}>{OUTCOME_LABEL[c.outcome]}</Badge>}
          </div>
        </div>
        <ChangeActions id={c.id} status={c.status} canOperate={c.canOperate} approvalId={myApproval?.id ?? null} canApprove={can(ctx.user.role, "changes:approve")} />
      </div>

      {!["REJECTED", "CANCELLED"].includes(c.status) && (
        <Card className="mb-6 overflow-x-auto p-4">
          <ol className="flex min-w-[560px] items-center">
            {STEP_LABEL.map((l, i) => (
              <li key={l} className="flex flex-1 items-center last:flex-none">
                <span className="flex flex-col items-center gap-1">
                  <span className={cn("flex h-6 w-6 items-center justify-center rounded-full border-2 text-[11px] font-semibold", i < idx || c.status === "CLOSED" ? "border-primary bg-primary text-primary-fg" : i === idx ? "border-primary text-primary" : "border-border text-muted")}>{i < idx || c.status === "CLOSED" ? <Check className="h-3 w-3" /> : i + 1}</span>
                  <span className={cn("text-[11px]", i <= idx ? "font-medium" : "text-muted")}>{l}</span>
                </span>
                {i < STEP_LABEL.length - 1 && <span className={cn("mx-1 mb-4 h-0.5 flex-1", i < idx ? "bg-primary" : "bg-border")} />}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {c.conflicts.length > 0 && (
        <div className="mb-6 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div><p className="font-medium">Conflicto de calendario</p><p>Otros cambios usan los mismos elementos en esta ventana: {c.conflicts.map((x, i) => <span key={x.id}>{i ? ", " : ""}<Link href={`/changes/${x.id}`} className="underline">CHG-{x.number}</Link></span>)}.</p></div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          <Card className="space-y-4 p-5 text-sm">
            <p className="whitespace-pre-wrap leading-relaxed">{c.description}</p>
            {c.reason && <div><p className="text-xs font-medium text-muted">Justificación</p><p className="whitespace-pre-wrap">{c.reason}</p></div>}
          </Card>
          {[["Plan de implementación", c.implementationPlan], ["Plan de reversa", c.rollbackPlan], ["Plan de pruebas y validación", c.testPlan]].map(([t, v]) => (
            <Card key={t}><CardHeader title={t} /><p className={cn("whitespace-pre-wrap px-5 py-4 text-sm", !v && "text-muted")}>{v || "Sin definir"}</p></Card>
          ))}
          {(c.outcome || c.reviewNotes) && (
            <Card><CardHeader title="Resultado y revisión post-implementación" />
              <div className="space-y-2 px-5 py-4 text-sm">
                {c.outcome && <p>Resultado: <Badge tone={OUTCOME_TONE[c.outcome]}>{OUTCOME_LABEL[c.outcome]}</Badge> · {formatDateTime(c.actualStart)} → {formatDateTime(c.actualEnd)}</p>}
                {c.reviewNotes && <p className="whitespace-pre-wrap">{c.reviewNotes}</p>}
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="Evaluación de riesgo" description={`Puntaje ${c.riskScore} → riesgo ${LEVEL_LABEL[c.risk]!.toLowerCase()}`} />
            <ul className="divide-y divide-border">{RISK_QUESTIONS.map((q) => <li key={q.key} className="flex justify-between gap-3 px-5 py-2.5 text-sm"><span className="text-muted">{q.label}</span><span className={answers[q.key] ? "font-medium text-amber-600" : ""}>{answers[q.key] ? "Sí" : "No"}</span></li>)}</ul>
          </Card>
          <WorkLog logs={logs} entity="change" entityId={c.id} />
        </div>
        <aside className="space-y-4">
          <Card className="space-y-2.5 p-4 text-sm">
            <Row label="Ventana">{c.plannedStart ? <>{formatDateTime(c.plannedStart)}<br />→ {formatDateTime(c.plannedEnd)}</> : "—"}</Row>
            <Row label="Implementador">{c.owner?.name ?? "—"}</Row>
            <Row label="Equipo">{c.team?.name ?? "—"}</Row>
            {c.problem && <Row label="Problema"><Link href={`/problems/${c.problem.id}`} className="text-primary hover:underline">PRB-{c.problem.number}</Link></Row>}
          </Card>
          <Card>
            <CardHeader title="Aprobaciones" description={c.type === "STANDARD" ? "Cambio estándar: preaprobado" : undefined} />
            {c.approvals.length === 0 ? <p className="px-4 py-3 text-xs text-muted">{c.type === "STANDARD" ? "No requiere aprobación." : "Se solicitarán al enviar el cambio."}</p> : levels.map((lv) => (
              <div key={lv} className="border-b border-border last:border-0">
                <p className="px-4 pt-3 text-xs font-medium text-muted">Nivel {lv} · {lv === 1 ? (c.type === "EMERGENCY" ? "ECAB" : "CAB") : "Dirección"}</p>
                <ul className="pb-2">{c.approvals.filter((a) => a.level === lv).map((a) => (
                  <li key={a.id} className="flex items-start gap-2 px-4 py-1.5 text-sm">
                    {a.status === "APPROVED" ? <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-500" /> : a.status === "REJECTED" ? <ShieldX className="mt-0.5 h-4 w-4 text-red-500" /> : <Clock className="mt-0.5 h-4 w-4 text-muted" />}
                    <span className="flex-1">{a.approver.name}<span className="block text-xs text-muted">{a.status === "NOT_REQUIRED" ? a.comment ?? "No requerido" : APPROVAL_LABEL[a.status]}{a.status !== "NOT_REQUIRED" && a.comment ? ` — «${a.comment}»` : ""}</span></span>
                  </li>
                ))}</ul>
              </div>
            ))}
          </Card>
          <Card>
            <CardHeader title={`Elementos afectados (${c.configItems.length})`} />
            {c.configItems.length ? <ul className="divide-y divide-border">{c.configItems.map((ci) => <li key={ci.id}><Link href={`/cmdb/${ci.id}`} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-subtle"><Network className="h-4 w-4 text-muted" />{ci.name}<span className="ml-auto text-xs text-muted">{CI_TYPE_LABEL[ci.type]}</span></Link></li>)}</ul> : <p className="px-4 py-3 text-xs text-muted">Ninguno</p>}
          </Card>
          <Card>
            <CardHeader title="Servicios potencialmente afectados" description={`${c.affectedCount} elemento(s) dependientes`} />
            {c.services.length ? <ul className="divide-y divide-border">{c.services.map((s) => <li key={s.id} className="flex items-center justify-between px-4 py-2 text-sm">{s.name}<Badge tone={RISK_TONE[s.criticality]}>{LEVEL_LABEL[s.criticality]}</Badge></li>)}</ul> : <p className="px-4 py-3 text-xs text-muted">Ningún servicio depende de estos elementos.</p>}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex justify-between gap-3"><span className="text-muted">{label}</span><span className="text-right">{children}</span></div>;
}
