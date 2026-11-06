"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createProblemAction } from "@/app/actions-itsm";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { useActionToast } from "@/components/toast";
import { LEVEL_LABEL, PRIORITY_LABEL, CI_TYPE_LABEL } from "@/lib/labels";
import { priorityMatrix } from "@/lib/classify";

type Opt = { id: string; name: string };
type Init = { title: string; description: string; categoryId: string; teamId: string; ciIds: string[]; incidentIds: string[] };

export function ProblemForm({ categories, teams, staff, cis, me, initial, candidates }: {
  categories: (Opt & { teamId: string | null })[]; teams: Opt[]; staff: Opt[]; cis: (Opt & { type: string })[]; me: string; initial: Init;
  candidates: { id: string; number: number; title: string }[];
}) {
  const [f, setF] = useState({ ...initial, impact: "MEDIUM" as "LOW" | "MEDIUM" | "HIGH", urgency: "MEDIUM" as "LOW" | "MEDIUM" | "HIGH", ownerId: me });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  const p = priorityMatrix(f.impact, f.urgency);
  const toggle = (k: "ciIds" | "incidentIds", id: string) => setF({ ...f, [k]: f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id] });
  const submit = () => start(async () => {
    const r = toast(await createProblemAction(f));
    if (r.ok && r.data) router.push(`/problems/${(r.data as { id: string }).id}`);
    else if (!r.ok) setErrors(r.fields ?? {});
  });
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/problems" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />Problemas</Link>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Registrar problema</h1>
      <p className="mb-6 text-sm text-muted">Un problema es la causa desconocida de uno o más incidentes. Registrarlo permite investigarla y evitar que se repita.</p>
      <Card className="space-y-5 p-5 sm:p-6">
        <Field label="Título" htmlFor="pt" required error={errors.title}><Input id="pt" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ej: Outlook se cuelga al abrir perfiles grandes" /></Field>
        <Field label="Descripción y síntomas" htmlFor="pd"><Textarea id="pd" rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoría" htmlFor="pc"><Select id="pc" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value, teamId: f.teamId || categories.find((c) => c.id === e.target.value)?.teamId || "" })}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Equipo" htmlFor="pteam"><Select id="pteam" value={f.teamId} onChange={(e) => setF({ ...f, teamId: e.target.value })}><option value="">—</option>{teams.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Responsable" htmlFor="po"><Select id="po" value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>{staff.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Impacto" htmlFor="pi"><Select id="pi" value={f.impact} onChange={(e) => setF({ ...f, impact: e.target.value as "LOW" })}>{["LOW", "MEDIUM", "HIGH"].map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}</Select></Field>
            <Field label="Urgencia" htmlFor="pu"><Select id="pu" value={f.urgency} onChange={(e) => setF({ ...f, urgency: e.target.value as "LOW" })}>{["LOW", "MEDIUM", "HIGH"].map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}</Select></Field>
          </div>
        </div>
        <p className="rounded-lg bg-subtle px-3 py-1.5 text-xs text-muted">Prioridad calculada: <strong>{p} · {PRIORITY_LABEL[p]}</strong></p>
        {candidates.length > 0 && (
          <div>
            <p className="mb-2 text-[13px] font-medium">Incidentes a vincular</p>
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {candidates.map((c) => (
                <li key={c.id}><label className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-subtle"><input type="checkbox" checked={f.incidentIds.includes(c.id)} onChange={() => toggle("incidentIds", c.id)} /><span className="font-mono text-xs text-muted">INC-{c.number}</span><span className="truncate">{c.title}</span></label></li>
              ))}
            </ul>
          </div>
        )}
        {cis.length > 0 && (
          <div>
            <p className="mb-2 text-[13px] font-medium">Elementos de configuración involucrados</p>
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {cis.map((c) => { const on = f.ciIds.includes(c.id); return <button type="button" key={c.id} aria-pressed={on} onClick={() => toggle("ciIds", c.id)} className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-primary bg-primary-soft text-primary" : "border-border text-muted"}`}>{c.name} <span className="opacity-60">· {CI_TYPE_LABEL[c.type]}</span></button>; })}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-border pt-4"><Link href="/problems" className={"inline-flex h-9 items-center px-4 text-sm text-muted"}>Cancelar</Link><Button onClick={submit} loading={pending}>Registrar problema</Button></div>
      </Card>
    </div>
  );
}
