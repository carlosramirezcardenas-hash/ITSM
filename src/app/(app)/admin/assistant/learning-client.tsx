"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lightbulb, MessageCircleQuestion, Pencil, RefreshCw, Trash2, Type } from "lucide-react";
import { learningSyncAction, solutionEditAction, solutionStatusAction, termDeleteAction, termDisabledAction } from "@/app/actions-ai";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useActionToast } from "@/components/toast";
import { cn } from "@/lib/utils";

type Solution = { id: string; title: string; resolution: string; status: string; hiddenReason: string | null; manual: boolean; cases: number; shown: number; helpful: number; notHelpful: number; category: string | null; updated: string };
type Term = { id: string; term: string; targetType: string; targetName: string; positive: number; negative: number; disabled: boolean };
type Query = { id: string; query: string; feedback: number | null; when: string };

const TYPE_LABEL: Record<string, string> = { SERVICE: "Servicio", ARTICLE: "Guía", SOLUTION: "Solución" };

export function LearningClient({ solutions, terms, unanswered }: { solutions: Solution[]; terms: Term[]; unanswered: Query[] }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Solution | null>(null);
  const [filter, setFilter] = useState<"ACTIVE" | "HIDDEN">("ACTIVE");
  const toast = useActionToast();
  const router = useRouter();
  const act = (fn: () => Promise<Parameters<typeof toast>[0]>) => start(async () => { const r = toast(await fn()); if (r.ok) router.refresh(); });
  const list = solutions.filter((s) => s.status === filter);

  return (
    <>
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-1.5"><Lightbulb className="h-4 w-4 text-amber-500" />Soluciones que funcionaron</span>}
          description="Aprendidas de incidentes resueltos (solo el título y la solución; nunca quién lo pidió). Se ocultan solas si el caso se reabre o recibe mala evaluación."
          action={<Button size="sm" variant="outline" loading={pending} onClick={() => act(learningSyncAction)}><RefreshCw className="h-3.5 w-3.5" />Aprender del historial</Button>}
        />
        <div className="flex gap-1 border-b border-border px-5 py-2">
          {(["ACTIVE", "HIDDEN"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
              className={cn("rounded-md px-2.5 py-1 text-xs font-medium", filter === f ? "bg-subtle text-fg" : "text-muted hover:text-fg")}>
              {f === "ACTIVE" ? "En uso" : "Ocultas"} ({solutions.filter((s) => s.status === f).length})
            </button>
          ))}
        </div>
        {list.length === 0 ? (
          <EmptyState title={filter === "ACTIVE" ? "Aún no hay soluciones aprendidas" : "No hay soluciones ocultas"} description={filter === "ACTIVE" ? "Se agregan solas cuando el equipo resuelve incidentes. También puedes revisar el historial." : undefined} />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((s) => (
              <li key={s.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted">{s.resolution}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                    {s.category && <Badge>{s.category}</Badge>}
                    <span>{s.cases} caso{s.cases === 1 ? "" : "s"} resuelto{s.cases === 1 ? "" : "s"}</span>
                    <span>mostrada {s.shown} {s.shown === 1 ? "vez" : "veces"}</span>
                    <span>👍 {s.helpful} · 👎 {s.notHelpful}</span>
                    {s.manual && <span>revisada por administración</span>}
                    {s.hiddenReason && <span className="text-amber-600">{s.hiddenReason}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(s)} aria-label={`Editar ${s.title}`}><Pencil className="h-3.5 w-3.5" />Editar</Button>
                  {s.status === "ACTIVE"
                    ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => solutionStatusAction(s.id, "HIDDEN"))} aria-label={`Ocultar ${s.title}`}><EyeOff className="h-3.5 w-3.5" />Ocultar</Button>
                    : <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => solutionStatusAction(s.id, "ACTIVE"))} aria-label={`Mostrar ${s.title}`}><Eye className="h-3.5 w-3.5" />Mostrar</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={<span className="flex items-center gap-1.5"><Type className="h-4 w-4 text-primary" />Vocabulario aprendido</span>}
            description="Palabras que usan las personas y a qué las asocia el asistente. Se aprende cuando algo les sirvió (👍, «Me sirvió» o abrir el servicio sugerido)." />
          {terms.length === 0 ? <EmptyState title="Todavía no aprende palabras nuevas" description="Aparecerán cuando las personas usen el asistente y marquen lo que les sirvió." /> : (
            <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto">
              {terms.map((t) => (
                <li key={t.id} className={cn("flex items-center gap-3 px-5 py-2.5", t.disabled && "opacity-50")}>
                  <code className="rounded bg-subtle px-1.5 py-0.5 text-xs">{t.term}…</code>
                  <span className="text-xs text-muted">→</span>
                  <span className="min-w-0 flex-1 truncate text-sm"><span className="text-xs text-muted">{TYPE_LABEL[t.targetType]}:</span> {t.targetName}</span>
                  <span className="shrink-0 text-[11px] text-muted">+{t.positive}{t.negative ? ` −${t.negative}` : ""}</span>
                  <button type="button" disabled={pending} onClick={() => act(() => termDisabledAction(t.id, !t.disabled))} className="shrink-0 rounded p-1 text-muted hover:text-fg" aria-label={t.disabled ? `Activar ${t.term}` : `Desactivar ${t.term}`}>
                    {t.disabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                  <button type="button" disabled={pending} onClick={() => act(() => termDeleteAction(t.id))} className="shrink-0 rounded p-1 text-muted hover:text-red-600" aria-label={`Eliminar ${t.term}`}><Trash2 className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title={<span className="flex items-center gap-1.5"><MessageCircleQuestion className="h-4 w-4 text-rose-500" />Preguntas sin buena respuesta</span>}
            description="Lo que preguntaron y no tuvo guía, solución ni servicio, o recibió 👎."
            action={<a href="/help/gaps" className="whitespace-nowrap text-xs font-medium text-primary hover:underline">Ver temas y crear guías →</a>} />
          {unanswered.length === 0 ? <EmptyState title="Nada pendiente" description="El asistente encontró respuesta para todo en los últimos 30 días." /> : (
            <ul className="divide-y divide-border">
              {unanswered.map((q) => (
                <li key={q.id} className="flex items-start gap-3 px-5 py-2.5">
                  <span className="min-w-0 flex-1 text-sm">«{q.query}»</span>
                  {q.feedback === -1 && <Badge tone="red">👎</Badge>}
                  <span className="shrink-0 text-[11px] text-muted">{q.when}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {editing && <EditSolution s={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} />}
    </>
  );
}

function EditSolution({ s, onClose, onSaved }: { s: Solution; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(s.title);
  const [resolution, setResolution] = useState(s.resolution);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const toast = useActionToast();
  return (
    <Modal open onClose={onClose} title="Editar solución" description="Corrige o simplifica el texto que verán las personas. Queda marcada como revisada y no cambia sola."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={pending} onClick={() => start(async () => { setErrors({}); const r = toast(await solutionEditAction(s.id, { title, resolution })); if (r.ok) onSaved(); else setErrors(r.fields ?? {}); })}>Guardar</Button></>}>
      <div className="space-y-4">
        <Field label="Problema (para reconocer casos parecidos)" htmlFor="sol-title" error={errors.title}><Input id="sol-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></Field>
        <Field label="Qué hacer" htmlFor="sol-res" error={errors.resolution} hint="Pasos simples, sin datos de personas."><Textarea id="sol-res" rows={6} value={resolution} onChange={(e) => setResolution(e.target.value)} maxLength={2000} /></Field>
      </div>
    </Modal>
  );
}
