"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ShieldCheck } from "lucide-react";
import { createChangeAction, previewChangeAction, updateChangeAction } from "@/app/actions-itsm";
import { Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { useActionToast } from "@/components/toast";
import { RISK_QUESTIONS } from "@/lib/itsm";
import { CHANGE_TYPE_HINT, CHANGE_TYPE_LABEL, CI_TYPE_LABEL, LEVEL_LABEL, RISK_TONE } from "@/lib/labels";
import { cn } from "@/lib/utils";

type Opt = { id: string; name: string };
type Init = Partial<{
  title: string; description: string; reason: string; type: "STANDARD" | "NORMAL" | "EMERGENCY"; ciIds: string[]; riskAnswers: Record<string, boolean>;
  implementationPlan: string; rollbackPlan: string; testPlan: string; plannedStart: string; plannedEnd: string; ownerId: string; teamId: string; problemId: string;
}>;
type Preview = { risk: "LOW" | "MEDIUM" | "HIGH"; riskScore: number; impact: "LOW" | "MEDIUM" | "HIGH"; services: { id: string; name: string; criticality: string }[]; affected: number; levels: number; conflicts: { id: string; number: number; title: string }[] };

// <input type="datetime-local"> trabaja en hora local del navegador: convertimos a/desde ISO (UTC)
const toLocal = (iso?: string) => { if (!iso) return ""; const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

export function ChangeForm({ cis, staff, teams, problems, me, initial, changeId }: {
  cis: (Opt & { type: string; criticality: string })[]; staff: Opt[]; teams: Opt[]; problems: { id: string; number: number; title: string }[]; me: string; initial: Init; changeId?: string;
}) {
  const [f, setF] = useState({
    title: initial.title ?? "", description: initial.description ?? "", reason: initial.reason ?? "", type: initial.type ?? "NORMAL",
    ciIds: initial.ciIds ?? [], riskAnswers: initial.riskAnswers ?? {}, implementationPlan: initial.implementationPlan ?? "", rollbackPlan: initial.rollbackPlan ?? "",
    testPlan: initial.testPlan ?? "", plannedStart: toLocal(initial.plannedStart), plannedEnd: toLocal(initial.plannedEnd), ownerId: initial.ownerId || me, teamId: initial.teamId ?? "", problemId: initial.problemId ?? "",
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ciFilter, setCiFilter] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  const payload = useMemo(() => ({ ...f, plannedStart: toIso(f.plannedStart), plannedEnd: toIso(f.plannedEnd) }), [f]);

  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await previewChangeAction({ type: payload.type, ciIds: payload.ciIds, riskAnswers: payload.riskAnswers, plannedStart: payload.plannedStart, plannedEnd: payload.plannedEnd });
      if (r.ok && r.data) setPreview(r.data as Preview);
    }, 300);
    return () => clearTimeout(t);
  }, [payload.type, payload.ciIds, payload.riskAnswers, payload.plannedStart, payload.plannedEnd]);

  const submit = () => start(async () => {
    const r = toast<unknown>(changeId ? await updateChangeAction(changeId, payload) : await createChangeAction(payload));
    if (r.ok) router.push(`/changes/${changeId ?? (r.data as { id: string }).id}`); else setErrors(r.fields ?? {});
  });
  const shownCis = cis.filter((c) => !ciFilter || c.name.toLowerCase().includes(ciFilter.toLowerCase()) || f.ciIds.includes(c.id));

  return (
    <div className="mx-auto max-w-6xl">
      <Link href={changeId ? `/changes/${changeId}` : "/changes"} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />Volver</Link>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{changeId ? "Editar cambio" : "Nuevo cambio"}</h1>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="1. ¿Qué vas a cambiar?" />
            <div className="space-y-4 p-5">
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Tipo de cambio">
                {(["STANDARD", "NORMAL", "EMERGENCY"] as const).map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={f.type === t} onClick={() => setF({ ...f, type: t })}
                    className={cn("rounded-xl border p-3 text-left transition", f.type === t ? "border-primary bg-primary-soft ring-1 ring-primary" : "border-border hover:bg-subtle")}>
                    <p className="text-sm font-medium">{CHANGE_TYPE_LABEL[t]}</p><p className="mt-0.5 text-xs text-muted">{CHANGE_TYPE_HINT[t]}</p>
                  </button>
                ))}
              </div>
              <Field label="Título" htmlFor="ct" required error={errors.title}><Input id="ct" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ej: Actualizar SAP a la versión 2026.10" /></Field>
              <Field label="Descripción" htmlFor="cd" required error={errors.description}><Textarea id="cd" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
              <Field label="Justificación de negocio" htmlFor="cr"><Textarea id="cr" rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="¿Por qué es necesario? ¿Qué pasa si no se hace?" /></Field>
              {problems.length > 0 && <Field label="Problema que resuelve (opcional)" htmlFor="cp"><Select id="cp" value={f.problemId} onChange={(e) => setF({ ...f, problemId: e.target.value })}><option value="">—</option>{problems.map((p) => <option key={p.id} value={p.id}>PRB-{p.number} · {p.title}</option>)}</Select></Field>}
            </div>
          </Card>

          <Card>
            <CardHeader title="2. Elementos afectados" description="Selecciona los activos de la CMDB que se modifican. Calculamos qué servicios se pueden ver afectados." />
            <div className="p-5">
              <Input value={ciFilter} onChange={(e) => setCiFilter(e.target.value)} placeholder="Filtrar elementos…" className="mb-3 sm:w-72" aria-label="Filtrar elementos" />
              {errors.ciIds && <p className="mb-2 text-xs text-red-600">{errors.ciIds}</p>}
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {shownCis.map((c) => { const on = f.ciIds.includes(c.id); return (
                  <button key={c.id} type="button" aria-pressed={on} onClick={() => setF({ ...f, ciIds: on ? f.ciIds.filter((x) => x !== c.id) : [...f.ciIds, c.id] })}
                    className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-primary bg-primary-soft text-primary" : "border-border text-muted hover:text-fg")}>{c.name} <span className="opacity-60">· {CI_TYPE_LABEL[c.type]}</span></button>
                ); })}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="3. Evaluación de riesgo" description="Responde con honestidad: define cuántos niveles de aprobación necesita." />
            <ul className="divide-y divide-border">
              {RISK_QUESTIONS.map((q) => (
                <li key={q.key} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                  <span>{q.label}</span>
                  <span className="flex shrink-0 gap-1" role="radiogroup" aria-label={q.label}>
                    {[true, false].map((v) => (
                      <button key={String(v)} type="button" role="radio" aria-checked={!!f.riskAnswers[q.key] === v}
                        onClick={() => setF({ ...f, riskAnswers: { ...f.riskAnswers, [q.key]: v } })}
                        className={cn("w-12 rounded-md border py-1 text-xs", !!f.riskAnswers[q.key] === v ? "border-primary bg-primary-soft font-medium text-primary" : "border-border text-muted")}>{v ? "Sí" : "No"}</button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="4. Planificación" />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Inicio de la ventana" htmlFor="ps" error={errors.plannedStart}><Input id="ps" type="datetime-local" value={f.plannedStart} onChange={(e) => setF({ ...f, plannedStart: e.target.value })} /></Field>
              <Field label="Fin de la ventana" htmlFor="pe" error={errors.plannedEnd}><Input id="pe" type="datetime-local" value={f.plannedEnd} onChange={(e) => setF({ ...f, plannedEnd: e.target.value })} /></Field>
              <Field label="Implementador" htmlFor="co"><Select id="co" value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
              <Field label="Equipo" htmlFor="cteam"><Select id="cteam" value={f.teamId} onChange={(e) => setF({ ...f, teamId: e.target.value })}><option value="">—</option>{teams.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
              <Field label="Plan de implementación" htmlFor="ip" error={errors.implementationPlan} className="sm:col-span-2" hint="Pasos concretos, en orden, con responsables."><Textarea id="ip" rows={4} value={f.implementationPlan} onChange={(e) => setF({ ...f, implementationPlan: e.target.value })} /></Field>
              <Field label="Plan de reversa (rollback)" htmlFor="rp" error={errors.rollbackPlan} className="sm:col-span-2" hint="Cómo volver al estado anterior si algo falla, y en cuánto tiempo."><Textarea id="rp" rows={3} value={f.rollbackPlan} onChange={(e) => setF({ ...f, rollbackPlan: e.target.value })} /></Field>
              <Field label="Plan de pruebas y validación" htmlFor="tp" className="sm:col-span-2" hint="Cómo comprobarás que todo funciona después del cambio."><Textarea id="tp" rows={2} value={f.testPlan} onChange={(e) => setF({ ...f, testPlan: e.target.value })} /></Field>
            </div>
          </Card>
          <div className="flex justify-end gap-2"><Link href={changeId ? `/changes/${changeId}` : "/changes"} className="inline-flex h-9 items-center px-4 text-sm text-muted">Cancelar</Link><Button onClick={submit} loading={pending}>{changeId ? "Guardar cambios" : "Guardar borrador"}</Button></div>
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card className="space-y-4 p-5">
            <p className="text-sm font-semibold">Evaluación automática</p>
            {preview ? (
              <>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-subtle p-3"><p className="text-xs text-muted">Riesgo</p><Badge tone={RISK_TONE[preview.risk]} className="mt-1">{LEVEL_LABEL[preview.risk]} · {preview.riskScore} pts</Badge></div>
                  <div className="rounded-lg bg-subtle p-3"><p className="text-xs text-muted">Impacto</p><Badge tone={RISK_TONE[preview.impact]} className="mt-1">{LEVEL_LABEL[preview.impact]}</Badge></div>
                </div>
                <p className="flex items-start gap-2 text-sm"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  {preview.levels === 0 ? "Preaprobado: se programará al enviarlo." : preview.levels === 1 ? (f.type === "EMERGENCY" ? "Aprobación acelerada de un gestor (ECAB)." : "Requiere aprobación del CAB.") : "Riesgo alto: requiere CAB y luego dirección (2 niveles)."}
                </p>
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted">Servicios que pueden verse afectados ({preview.services.length})</p>
                  {preview.services.length ? <ul className="space-y-1">{preview.services.map((s) => <li key={s.id} className="flex items-center justify-between text-sm"><span>{s.name}</span><Badge tone={RISK_TONE[s.criticality]}>{LEVEL_LABEL[s.criticality]}</Badge></li>)}</ul> : <p className="text-xs text-muted">{f.ciIds.length ? "Ningún servicio depende de estos elementos." : "Selecciona elementos afectados."}</p>}
                  {preview.affected > 0 && <p className="mt-1 text-xs text-muted">{preview.affected} elemento(s) dependientes en total.</p>}
                </div>
                {preview.conflicts.length > 0 && (
                  <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
                    <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4" />Conflicto de calendario</p>
                    <ul className="mt-1 text-xs">{preview.conflicts.map((c) => <li key={c.id}>CHG-{c.number} · {c.title}</li>)}</ul>
                  </div>
                )}
              </>
            ) : <p className="text-sm text-muted">Calculando…</p>}
          </Card>
        </aside>
      </div>
    </div>
  );
}
