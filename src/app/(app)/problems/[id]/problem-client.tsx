"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, CheckCircle2, Link2, Plus, Trash2, X } from "lucide-react";
import { addTaskAction, deleteTaskAction, linkIncidentsAction, publishWorkaroundAction, resolveLinkedIncidentsAction, toggleTaskAction, unlinkIncidentAction, updateProblemAction } from "@/app/actions-itsm";
import { Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useActionToast } from "@/components/toast";
import { PROBLEM_STATUS_LABEL, RCA_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

const ACTION_LABEL: Record<string, string> = {
  INVESTIGATING: "Iniciar análisis", KNOWN_ERROR: "Registrar error conocido", RESOLVED: "Marcar resuelto", CLOSED: "Cerrar problema",
};

export function ProblemActions({ id, status, next, hasWorkaround, hasFix, openIncidents, hasArticle }: { id: string; status: string; next: string[]; hasWorkaround: boolean; hasFix: boolean; openIncidents: number; hasArticle: boolean }) {
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  const go = (fn: () => Promise<any>) => start(async () => { const r = toast(await fn()); if (r.ok) router.refresh(); });
  return (
    <div className="flex flex-wrap gap-2">
      {hasWorkaround && <Button variant="outline" size="sm" disabled={pending} onClick={() => go(() => publishWorkaroundAction(id))}><BookOpen className="h-4 w-4" />{hasArticle ? "Actualizar artículo" : "Publicar solución temporal"}</Button>}
      {(hasWorkaround || hasFix) && openIncidents > 0 && <Button variant="outline" size="sm" disabled={pending} onClick={() => { if (confirm(`¿Resolver los ${openIncidents} incidentes abiertos vinculados y notificar a los usuarios?`)) go(() => resolveLinkedIncidentsAction(id)); }}><CheckCircle2 className="h-4 w-4" />Resolver {openIncidents} incidente(s)</Button>}
      {next.map((n) => (
        <Button key={n} size="sm" variant={n === "CLOSED" || (n === "INVESTIGATING" && status !== "NEW") ? "outline" : "primary"} disabled={pending}
          onClick={() => go(() => updateProblemAction(id, { status: n }))}>
          {n === "INVESTIGATING" && status !== "NEW" ? "Volver a análisis" : ACTION_LABEL[n] ?? PROBLEM_STATUS_LABEL[n]}
        </Button>
      ))}
    </div>
  );
}

export function RcaEditor({ id, initial, disabled }: { id: string; initial: { rcaMethod: string; rootCause: string; workaround: string; permanentFix: string }; disabled: boolean }) {
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const save = () => start(async () => { const r = toast(await updateProblemAction(id, f)); if (r.ok) router.refresh(); else setErrors(r.fields ?? {}); });
  const hint: Record<string, string> = {
    five_whys: "Pregunta «¿por qué?» hasta llegar al origen. Ej: 1) Outlook se cuelga → 2) el perfil supera 50 GB → 3) no hay política de archivado…",
    ishikawa: "Analiza causas por categoría: personas, procesos, tecnología, proveedores, entorno.",
    timeline: "Reconstruye la secuencia de eventos con hora: qué cambió justo antes del primer incidente.",
    other: "Describe el método usado y sus conclusiones.",
  };
  return (
    <Card>
      <CardHeader title="Análisis de causa raíz" description="Documenta la investigación, la solución temporal y la definitiva." action={dirty && !disabled ? <Button size="sm" loading={pending} onClick={save}>Guardar</Button> : undefined} />
      <div className="space-y-4 p-5">
        <Field label="Método" htmlFor="rca"><Select id="rca" value={f.rcaMethod} disabled={disabled} onChange={(e) => setF({ ...f, rcaMethod: e.target.value })} className="sm:w-64">{Object.entries(RCA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Causa raíz" htmlFor="rc" error={errors.rootCause} hint={hint[f.rcaMethod]}><Textarea id="rc" rows={5} value={f.rootCause} disabled={disabled} onChange={(e) => setF({ ...f, rootCause: e.target.value })} /></Field>
        <Field label="Solución temporal (workaround)" htmlFor="wa" error={errors.workaround} hint="Lo que soporte puede aplicar mientras tanto. Se puede publicar en el centro de ayuda."><Textarea id="wa" rows={3} value={f.workaround} disabled={disabled} onChange={(e) => setF({ ...f, workaround: e.target.value })} /></Field>
        <Field label="Solución definitiva" htmlFor="pf" error={errors.permanentFix}><Textarea id="pf" rows={3} value={f.permanentFix} disabled={disabled} onChange={(e) => setF({ ...f, permanentFix: e.target.value })} /></Field>
        {dirty && !disabled && <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setF(initial)}>Descartar</Button><Button size="sm" loading={pending} onClick={save}>Guardar análisis</Button></div>}
      </div>
    </Card>
  );
}

type Task = { id: string; title: string; owner: string | null; dueDate: string | null; done: boolean };
export function Tasks({ problemId, tasks, staff, disabled }: { problemId: string; tasks: Task[]; staff: { id: string; name: string }[]; disabled: boolean }) {
  const [f, setF] = useState({ title: "", ownerId: "", dueDate: "" });
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({}); // respuesta inmediata al marcar
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const go = (fn: () => Promise<any>, after?: () => void) => start(async () => { const r = toast(await fn()); if (r.ok) { after?.(); router.refresh(); } });
  const isDone = (t: Task) => optimistic[t.id] ?? t.done;
  const done = tasks.filter(isDone).length;
  const toggle = (t: Task) => {
    setOptimistic((o) => ({ ...o, [t.id]: !isDone(t) }));
    start(async () => {
      const r = toast(await toggleTaskAction(t.id));
      if (!r.ok) setOptimistic((o) => { const { [t.id]: _, ...rest } = o; return rest; });
      router.refresh();
    });
  };
  return (
    <Card>
      <CardHeader title="Plan de acción" description={tasks.length ? `${done} de ${tasks.length} completadas` : "Define las acciones para eliminar la causa raíz."} />
      {tasks.length > 0 && (
        <ul className="divide-y divide-border">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <input type="checkbox" checked={isDone(t)} disabled={disabled} onChange={() => toggle(t)} aria-label={`Completar ${t.title}`} className="h-4 w-4" />
              <span className={cn("flex-1", isDone(t) && "text-muted line-through")}>{t.title}</span>
              <span className={cn("text-xs", !isDone(t) && t.dueDate && t.dueDate < today ? "font-medium text-red-600" : "text-muted")}>{[t.owner, t.dueDate].filter(Boolean).join(" · ")}</span>
              {!disabled && <button onClick={() => go(() => deleteTaskAction(t.id))} className="text-muted hover:text-red-600" aria-label={`Eliminar ${t.title}`}><Trash2 className="h-3.5 w-3.5" /></button>}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="grid gap-2 border-t border-border p-4 sm:grid-cols-[1fr_160px_140px_auto]">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Nueva acción, ej: Aplicar política de archivado" aria-label="Nueva acción" />
          <Select value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })} aria-label="Responsable"><option value="">Responsable…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} aria-label="Fecha límite" />
          <Button variant="outline" disabled={f.title.trim().length < 3 || pending} onClick={() => go(() => addTaskAction(problemId, f), () => setF({ title: "", ownerId: "", dueDate: "" }))}><Plus className="h-4 w-4" />Agregar</Button>
        </div>
      )}
    </Card>
  );
}

export function IncidentLinker({ problemId }: { problemId: string }) {
  const [open, setOpen] = useState(false);
  const [refs, setRefs] = useState("");
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Link2 className="h-4 w-4" />Vincular incidentes</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Vincular incidentes" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button loading={pending} disabled={!refs.trim()} onClick={() => start(async () => { const r = toast(await linkIncidentsAction(problemId, refs.split(/[\s,;]+/).filter(Boolean))); if (r.ok) { setOpen(false); setRefs(""); router.refresh(); } })}>Vincular</Button></>}>
        <Field label="Números de incidente" htmlFor="refs" hint="Separados por coma o espacio. Ej: INC-1042, 1043"><Input id="refs" value={refs} onChange={(e) => setRefs(e.target.value)} /></Field>
      </Modal>
    </>
  );
}

export function UnlinkButton({ problemId, ticketId }: { problemId: string; ticketId: string }) {
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  return <button disabled={pending} onClick={() => start(async () => { const r = toast(await unlinkIncidentAction(problemId, ticketId)); if (r.ok) router.refresh(); })} className="text-muted hover:text-red-600" aria-label="Desvincular"><X className="h-4 w-4" /></button>;
}
