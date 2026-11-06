"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, CheckCircle2, Hand, Lock, PauseCircle, Play, RotateCcw, Send, Sparkles, Star, XCircle } from "lucide-react";
import { aiSuggestReplyAction } from "@/app/actions-ai";
import { commentAction, confirmResolutionAction, escalateAction, updateTicketAction } from "@/app/actions";
import { Button, Card, Field, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useActionToast } from "@/components/toast";
import { LEVEL_LABEL, PENDING_REASONS, PRIORITY_LABEL } from "@/lib/labels";
import { priorityMatrix, type Level } from "@/lib/classify";
import { cn } from "@/lib/utils";

type StaffTicket = {
  id: string; status: string; assigneeId: string | null; teamId: string | null; impact: Level; urgency: Level; priority: string;
  categoryId: string | null; approvalPending: boolean; resolution: string | null;
};

export function StaffPanel({ ticket: t, next, teams, agents, categories, me }: {
  ticket: StaffTicket; next: string[]; teams: { id: string; name: string }[]; agents: { id: string; name: string; teamIds: string[] }[];
  categories: { id: string; name: string }[]; me: string;
}) {
  const router = useRouter();
  const toast = useActionToast();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ assigneeId: t.assigneeId ?? "", teamId: t.teamId ?? "", impact: t.impact, urgency: t.urgency, categoryId: t.categoryId ?? "" });
  const [modal, setModal] = useState<null | "resolve" | "pending" | "escalate">(null);
  const [resolution, setResolution] = useState(t.resolution ?? "");
  const [reason, setReason] = useState(PENDING_REASONS[0]!);
  const [escTeam, setEscTeam] = useState("");
  const [escReason, setEscReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const dirty = form.assigneeId !== (t.assigneeId ?? "") || form.teamId !== (t.teamId ?? "") || form.impact !== t.impact || form.urgency !== t.urgency || form.categoryId !== (t.categoryId ?? "");
  const newPriority = priorityMatrix(form.impact, form.urgency);
  const teamAgents = useMemo(() => {
    const inTeam = agents.filter((a) => form.teamId && a.teamIds.includes(form.teamId));
    const rest = agents.filter((a) => !inTeam.includes(a));
    return { inTeam, rest };
  }, [agents, form.teamId]);
  const closed = t.status === "CLOSED";

  const update = (patch: Record<string, unknown>, after?: () => void) => start(async () => {
    setErrors({});
    const r = toast(await updateTicketAction(t.id, patch));
    if (r.ok) { after?.(); router.refresh(); } else setErrors(r.fields ?? {});
  });

  const saveFields = () => update({
    assigneeId: form.assigneeId || null, teamId: form.teamId || null, impact: form.impact, urgency: form.urgency, categoryId: form.categoryId || null,
  });

  return (
    <Card>
      <div className="space-y-2 border-b border-border p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Acciones</p>
        {t.approvalPending ? <p className="rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-800 dark:bg-orange-950 dark:text-orange-200">Esperando aprobación: no puede avanzar hasta que se apruebe.</p> : closed ? <p className="text-sm text-muted">Ticket cerrado.</p> : (
          <div className="grid grid-cols-2 gap-2">
            {t.assigneeId !== me && ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING"].includes(t.status) && (
              <Button variant="primary" size="sm" loading={pending} onClick={() => update(t.status === "PENDING" ? { assigneeId: me } : { assigneeId: me, status: "IN_PROGRESS" })} className="col-span-2"><Hand className="h-4 w-4" />Tomar ticket</Button>
            )}
            {next.includes("IN_PROGRESS") && t.status !== "RESOLVED" && t.assigneeId === me && t.status !== "IN_PROGRESS" && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => update({ status: "IN_PROGRESS" })}><Play className="h-4 w-4" />{t.status === "PENDING" ? "Reanudar" : "Iniciar"}</Button>
            )}
            {next.includes("PENDING") && <Button size="sm" variant="outline" disabled={pending} onClick={() => setModal("pending")}><PauseCircle className="h-4 w-4" />En espera</Button>}
            {next.includes("RESOLVED") && <Button size="sm" variant="outline" disabled={pending} onClick={() => setModal("resolve")} className="text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" />Resolver</Button>}
            {t.status === "RESOLVED" && <Button size="sm" variant="outline" disabled={pending} onClick={() => update({ status: "CLOSED" })}><XCircle className="h-4 w-4" />Cerrar</Button>}
            {t.status === "RESOLVED" && <Button size="sm" variant="outline" disabled={pending} onClick={() => update({ status: "IN_PROGRESS" })}><RotateCcw className="h-4 w-4" />Reabrir</Button>}
            {!["RESOLVED", "CLOSED"].includes(t.status) && <Button size="sm" variant="outline" disabled={pending} onClick={() => setModal("escalate")}><ArrowUpRight className="h-4 w-4" />Escalar</Button>}
          </div>
        )}
      </div>

      <div className="space-y-3 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Clasificación y asignación</p>
        <Field label="Equipo" htmlFor="team">
          <Select id="team" value={form.teamId} disabled={closed} onChange={(e) => setForm({ ...form, teamId: e.target.value })}>
            <option value="">Sin equipo</option>{teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </Field>
        <Field label="Responsable" htmlFor="assignee">
          <Select id="assignee" value={form.assigneeId} disabled={closed} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
            <option value="">Sin asignar</option>
            {teamAgents.inTeam.length > 0 && <optgroup label="Del equipo">{teamAgents.inTeam.map((a) => <option key={a.id} value={a.id}>{a.name}{a.id === me ? " (yo)" : ""}</option>)}</optgroup>}
            <optgroup label={teamAgents.inTeam.length ? "Otros" : "Agentes"}>{teamAgents.rest.map((a) => <option key={a.id} value={a.id}>{a.name}{a.id === me ? " (yo)" : ""}</option>)}</optgroup>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Impacto" htmlFor="impact">
            <Select id="impact" value={form.impact} disabled={closed} onChange={(e) => setForm({ ...form, impact: e.target.value as Level })}>
              {(["LOW", "MEDIUM", "HIGH"] as const).map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
            </Select>
          </Field>
          <Field label="Urgencia" htmlFor="urgency">
            <Select id="urgency" value={form.urgency} disabled={closed} onChange={(e) => setForm({ ...form, urgency: e.target.value as Level })}>
              {(["LOW", "MEDIUM", "HIGH"] as const).map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
            </Select>
          </Field>
        </div>
        <p className={cn("rounded-lg px-3 py-1.5 text-xs", newPriority !== t.priority ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200" : "bg-subtle text-muted")}>
          Prioridad calculada: <strong>{newPriority} · {PRIORITY_LABEL[newPriority]}</strong>{newPriority !== t.priority && " (se recalculará el SLA)"}
        </p>
        <Field label="Categoría" htmlFor="category">
          <Select id="category" value={form.categoryId} disabled={closed} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">Sin categoría</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        {dirty && !closed && (
          <div className="flex gap-2 pt-1">
            <Button size="sm" className="flex-1" loading={pending} onClick={saveFields}>Guardar cambios</Button>
            <Button size="sm" variant="ghost" onClick={() => setForm({ assigneeId: t.assigneeId ?? "", teamId: t.teamId ?? "", impact: t.impact, urgency: t.urgency, categoryId: t.categoryId ?? "" })}>Descartar</Button>
          </div>
        )}
      </div>

      <Modal open={modal === "resolve"} onClose={() => setModal(null)} title="Resolver ticket" description="El usuario recibirá la solución y podrá confirmarla y evaluar la atención."
        footer={<><Button variant="ghost" onClick={() => setModal(null)}>Cancelar</Button><Button loading={pending} onClick={() => update({ status: "RESOLVED", resolution }, () => setModal(null))}>Marcar como resuelto</Button></>}>
        <Field label="¿Qué se hizo para solucionarlo?" htmlFor="res" required error={errors.resolution}>
          <Textarea id="res" value={resolution} onChange={(e) => setResolution(e.target.value)} rows={4} placeholder="Ej: Se reinició el perfil de Outlook y se validó con el usuario." />
        </Field>
      </Modal>

      <Modal open={modal === "pending"} onClose={() => setModal(null)} title="Poner en espera" description="El reloj del SLA se pausa mientras el ticket está en espera."
        footer={<><Button variant="ghost" onClick={() => setModal(null)}>Cancelar</Button><Button loading={pending} onClick={() => update({ status: "PENDING", pendingReason: reason }, () => setModal(null))}>Poner en espera</Button></>}>
        <Field label="¿Qué estás esperando?" htmlFor="reason">
          <Select id="reason" value={reason} onChange={(e) => setReason(e.target.value)}>{PENDING_REASONS.map((r) => <option key={r}>{r}</option>)}</Select>
        </Field>
        {reason.includes("usuario") && <p className="mt-3 text-xs text-muted">Avisaremos al usuario. Cuando responda, el ticket volverá automáticamente a «En progreso».</p>}
      </Modal>

      <Modal open={modal === "escalate"} onClose={() => setModal(null)} title="Escalar ticket">
        <div className="space-y-5">
          <div className="space-y-3 rounded-xl border border-border p-4">
            <p className="text-sm font-medium">Escalamiento funcional</p>
            <p className="text-xs text-muted">Deriva el ticket a otro equipo con más especialización.</p>
            <div className="flex gap-2">
              <Select value={escTeam} onChange={(e) => setEscTeam(e.target.value)} aria-label="Equipo destino">
                <option value="">Elige un equipo…</option>{teams.filter((x) => x.id !== t.teamId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
              <Button disabled={!escTeam} loading={pending} onClick={() => update({ teamId: escTeam }, () => setModal(null))}>Derivar</Button>
            </div>
          </div>
          <div className="space-y-3 rounded-xl border border-border p-4">
            <p className="text-sm font-medium">Escalamiento jerárquico</p>
            <p className="text-xs text-muted">Notifica a los líderes del equipo y gestores de servicio.</p>
            <Textarea value={escReason} onChange={(e) => setEscReason(e.target.value)} rows={2} placeholder="¿Por qué necesitas apoyo?" aria-label="Motivo del escalamiento" />
            <Button variant="outline" disabled={escReason.trim().length < 5} loading={pending} onClick={() => start(async () => {
              const r = toast(await escalateAction(t.id, escReason));
              if (r.ok) { setModal(null); setEscReason(""); router.refresh(); }
            })}>Escalar a gestores</Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

export function Composer({ ticketId, staff, aiOn = false }: { ticketId: string; staff: boolean; aiOn?: boolean }) {
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [drafted, setDrafted] = useState(false);
  const [drafting, startDraft] = useTransition();
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  const send = () => start(async () => {
    const r = toast(await commentAction(ticketId, { body, isInternal: internal }));
    if (r.ok) { setBody(""); setDrafted(false); router.refresh(); }
  });
  const draft = () => startDraft(async () => {
    const r = toast(await aiSuggestReplyAction(ticketId));
    if (r.ok && r.data) { setInternal(false); setBody((r.data as { reply: string }).reply); setDrafted(true); }
  });
  return (
    <Card className={cn("p-3", internal && "border-amber-300 dark:border-amber-800")}>
      {staff && (
        <div className="mb-2 flex gap-1 text-xs">
          <button type="button" onClick={() => setInternal(false)} className={cn("rounded-md px-2.5 py-1", !internal ? "bg-subtle font-medium" : "text-muted")}>Responder al usuario</button>
          <button type="button" onClick={() => setInternal(true)} className={cn("flex items-center gap-1 rounded-md px-2.5 py-1", internal ? "bg-amber-100 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "text-muted")}><Lock className="h-3 w-3" />Nota interna</button>
          {aiOn && <button type="button" onClick={draft} disabled={drafting} className="ml-auto flex items-center gap-1 rounded-md px-2.5 py-1 text-violet-600 hover:bg-violet-50 disabled:opacity-50 dark:text-violet-400 dark:hover:bg-violet-950"><Sparkles className="h-3 w-3" />{drafting ? "Redactando…" : "Sugerir respuesta"}</button>}
        </div>
      )}
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className="border-0 px-1 focus:ring-0" aria-label="Mensaje"
        placeholder={internal ? "Solo visible para el equipo de soporte…" : staff ? "Escribe una respuesta para el usuario…" : "Escribe un mensaje al equipo de soporte…"}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && body.trim()) send(); }} />
      {drafted && <p className="px-1 text-[11px] text-violet-600 dark:text-violet-400">Borrador generado por IA: revísalo y edítalo antes de enviar.</p>}
      <div className="flex items-center justify-between pt-2">
        <span className="hidden text-[11px] text-muted sm:block">Ctrl/⌘ + Enter para enviar</span>
        <Button size="sm" onClick={send} loading={pending} disabled={!body.trim()} className="ml-auto"><Send className="h-3.5 w-3.5" />Enviar</Button>
      </div>
    </Card>
  );
}

export function ConfirmResolution({ ticketId, resolution, status }: { ticketId: string; resolution: string | null; status: string }) {
  const [step, setStep] = useState<"ask" | "rate" | "reopen">(status === "CLOSED" ? "rate" : "ask");
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  const submit = (solved: boolean) => start(async () => {
    const r = toast(await confirmResolutionAction(ticketId, { solved, score: solved && score ? score : undefined, comment: comment || undefined }));
    if (r.ok) router.refresh();
  });
  return (
    <Card className="border-emerald-200 p-5 dark:border-emerald-900">
      {step === "ask" && (
        <>
          <p className="font-medium">{status === "CLOSED" ? "¿Cómo te atendimos?" : "¿Quedó solucionado?"}</p>
          {resolution && <p className="mt-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"><strong>Solución:</strong> {resolution}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => setStep("rate")}><CheckCircle2 className="h-4 w-4" />Sí, está solucionado</Button>
            <Button variant="outline" onClick={() => setStep("reopen")}>No, sigue el problema</Button>
          </div>
        </>
      )}
      {step === "rate" && (
        <>
          <p className="font-medium">¿Cómo evaluarías la atención?</p>
          <div className="mt-3 flex gap-1" role="radiogroup" aria-label="Calificación">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={score === n} aria-label={`${n} de 5`} onClick={() => setScore(n)} className="rounded p-1 hover:bg-subtle">
                <Star className={cn("h-7 w-7 transition", n <= score ? "fill-amber-400 text-amber-400" : "text-border-strong")} />
              </button>
            ))}
          </div>
          <Textarea className="mt-3" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="¿Algo que quieras contarnos? (opcional)" aria-label="Comentario" />
          <div className="mt-3 flex gap-2">
            <Button loading={pending} disabled={!score} onClick={() => submit(true)}>Enviar evaluación</Button>
            {status !== "CLOSED" && <Button variant="ghost" onClick={() => submit(true)} disabled={pending}>Cerrar sin evaluar</Button>}
          </div>
        </>
      )}
      {step === "reopen" && (
        <>
          <p className="font-medium">Lamentamos que siga ocurriendo</p>
          <p className="mt-1 text-sm text-muted">Cuéntanos qué pasa y lo retomaremos de inmediato.</p>
          <Textarea className="mt-3" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="¿Qué sigue fallando?" aria-label="Detalle" />
          <div className="mt-3 flex gap-2">
            <Button loading={pending} disabled={comment.trim().length < 3} onClick={() => submit(false)}>Reabrir solicitud</Button>
            <Button variant="ghost" onClick={() => setStep("ask")}>Volver</Button>
          </div>
        </>
      )}
    </Card>
  );
}
