"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Pencil, Play, Send, X } from "lucide-react";
import { decideChangeAction, submitChangeAction, transitionChangeAction } from "@/app/actions-itsm";
import { Button, Field, Select, Textarea, buttonClass } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useActionToast } from "@/components/toast";
import { OUTCOME_LABEL } from "@/lib/labels";

type M = null | "reject" | "complete" | "review" | "cancel";

export function ChangeActions({ id, status, canOperate, approvalId, canApprove }: { id: string; status: string; canOperate: boolean; approvalId: string | null; canApprove: boolean }) {
  const [modal, setModal] = useState<M>(null);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState("SUCCESSFUL");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  const go = (fn: () => Promise<any>) => start(async () => {
    setErrors({});
    const r = toast(await fn());
    if (r.ok) { setModal(null); setNote(""); router.refresh(); } else setErrors(r.fields ?? {});
  });
  const editable = ["DRAFT", "ASSESSMENT", "REJECTED"].includes(status);
  const cancellable = ["DRAFT", "ASSESSMENT", "PENDING_APPROVAL", "SCHEDULED"].includes(status);
  return (
    <div className="flex flex-wrap gap-2">
      {editable && <Link href={`/changes/${id}/edit`} className={buttonClass("outline", "sm")}><Pencil className="h-4 w-4" />Editar</Link>}
      {["DRAFT", "ASSESSMENT"].includes(status) && <Button size="sm" loading={pending} onClick={() => go(() => submitChangeAction(id))}><Send className="h-4 w-4" />Enviar a aprobación</Button>}
      {status === "PENDING_APPROVAL" && approvalId && <>
        <Button size="sm" variant="outline" onClick={() => setModal("reject")}><X className="h-4 w-4" />Rechazar</Button>
        <Button size="sm" loading={pending} onClick={() => go(() => decideChangeAction(id, { approve: true }))}><Check className="h-4 w-4" />Aprobar</Button>
      </>}
      {status === "SCHEDULED" && canOperate && <Button size="sm" loading={pending} onClick={() => go(() => transitionChangeAction(id, { to: "IN_PROGRESS" }))}><Play className="h-4 w-4" />Iniciar implementación</Button>}
      {status === "IN_PROGRESS" && canOperate && <Button size="sm" onClick={() => setModal("complete")}>Finalizar implementación</Button>}
      {status === "REVIEW" && (canApprove || canOperate) && <Button size="sm" onClick={() => setModal("review")}>Validar y cerrar</Button>}
      {cancellable && canOperate && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setModal("cancel")}>Cancelar cambio</Button>}

      <Modal open={modal === "reject"} onClose={() => setModal(null)} title="Rechazar cambio" footer={<><Button variant="ghost" onClick={() => setModal(null)}>Volver</Button><Button variant="danger" loading={pending} disabled={note.trim().length < 3} onClick={() => go(() => decideChangeAction(id, { approve: false, comment: note }))}>Rechazar</Button></>}>
        <Field label="Motivo (lo verá el solicitante)" htmlFor="rj" required error={errors.comment}><Textarea id="rj" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Modal>
      <Modal open={modal === "complete"} onClose={() => setModal(null)} title="Finalizar implementación" footer={<><Button variant="ghost" onClick={() => setModal(null)}>Volver</Button><Button loading={pending} onClick={() => go(() => transitionChangeAction(id, { to: "REVIEW", outcome, note: note || undefined }))}>Registrar resultado</Button></>}>
        <div className="space-y-4">
          <Field label="Resultado" htmlFor="oc"><Select id="oc" value={outcome} onChange={(e) => setOutcome(e.target.value)}>{Object.entries(OUTCOME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="¿Qué ocurrió?" htmlFor="on" required={outcome !== "SUCCESSFUL"} error={errors.note}><Textarea id="on" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={outcome === "ROLLED_BACK" ? "Ej: falló la migración de datos; se ejecutó el plan de reversa en 20 min." : ""} /></Field>
        </div>
      </Modal>
      <Modal open={modal === "review"} onClose={() => setModal(null)} title="Validación posterior a la implementación" description="Confirma que los servicios funcionan y registra lecciones aprendidas." footer={<><Button variant="ghost" onClick={() => setModal(null)}>Volver</Button><Button loading={pending} onClick={() => go(() => transitionChangeAction(id, { to: "CLOSED", note }))}>Cerrar cambio</Button></>}>
        <Field label="Resultado de la validación" htmlFor="rv" required error={errors.note}><Textarea id="rv" rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: Servicios verificados por usuarios clave; sin incidentes en 24 h." /></Field>
      </Modal>
      <Modal open={modal === "cancel"} onClose={() => setModal(null)} title="Cancelar cambio" footer={<><Button variant="ghost" onClick={() => setModal(null)}>Volver</Button><Button variant="danger" loading={pending} disabled={note.trim().length < 3} onClick={() => go(() => transitionChangeAction(id, { to: "CANCELLED", note }))}>Cancelar cambio</Button></>}>
        <Field label="Motivo" htmlFor="cn" required error={errors.note}><Textarea id="cn" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}
