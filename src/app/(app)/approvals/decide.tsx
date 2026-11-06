"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { decideApprovalAction } from "@/app/actions";
import { Button, Field, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useActionToast } from "@/components/toast";

export function DecideButtons({ approvalId }: { approvalId: string }) {
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  const toast = useActionToast();
  const router = useRouter();
  const decide = (approve: boolean) => start(async () => {
    const r = toast(await decideApprovalAction(approvalId, { approve, comment: comment || undefined }));
    if (r.ok) { setRejecting(false); router.refresh(); }
  });
  return (
    <div className="flex shrink-0 gap-2">
      <Button variant="outline" size="sm" onClick={() => setRejecting(true)} disabled={pending}><X className="h-4 w-4" />Rechazar</Button>
      <Button size="sm" onClick={() => decide(true)} loading={pending && !rejecting}><Check className="h-4 w-4" />Aprobar</Button>
      <Modal open={rejecting} onClose={() => setRejecting(false)} title="Rechazar solicitud" description="Explica el motivo: el solicitante lo verá."
        footer={<><Button variant="ghost" onClick={() => setRejecting(false)}>Cancelar</Button><Button variant="danger" loading={pending} disabled={comment.trim().length < 3} onClick={() => decide(false)}>Rechazar</Button></>}>
        <Field label="Motivo" htmlFor="motivo" required><Textarea id="motivo" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} /></Field>
      </Modal>
    </div>
  );
}
