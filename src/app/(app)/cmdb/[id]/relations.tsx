"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { addRelationAction, removeRelationAction } from "@/app/actions-itsm";
import { Button, Select } from "@/components/ui";
import { useActionToast } from "@/components/toast";
import { CI_TYPE_LABEL, REL_LABEL } from "@/lib/labels";

export function AddRelation({ ciId, others }: { ciId: string; others: { id: string; name: string; type: string }[] }) {
  const [dir, setDir] = useState<"out" | "in">("out");
  const [type, setType] = useState("DEPENDS_ON");
  const [other, setOther] = useState("");
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  const add = () => start(async () => {
    const r = toast(await addRelationAction(dir === "out" ? { sourceId: ciId, targetId: other, type } : { sourceId: other, targetId: ciId, type }));
    if (r.ok) { setOther(""); router.refresh(); }
  });
  return (
    <div className="grid gap-2 sm:grid-cols-[150px_150px_1fr_auto]">
      <Select value={dir} onChange={(e) => setDir(e.target.value as "out")} aria-label="Dirección"><option value="out">Este elemento…</option><option value="in">Otro elemento…</option></Select>
      <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo de relación">{Object.entries(REL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
      <Select value={other} onChange={(e) => setOther(e.target.value)} aria-label="Elemento relacionado"><option value="">{dir === "out" ? "…elige el elemento" : "…que depende de este"}</option>{others.map((o) => <option key={o.id} value={o.id}>{o.name} · {CI_TYPE_LABEL[o.type]}</option>)}</Select>
      <Button variant="outline" disabled={!other || pending} onClick={add}><Plus className="h-4 w-4" />Agregar</Button>
    </div>
  );
}

export function RemoveRelation({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  return <button disabled={pending} onClick={() => start(async () => { const r = toast(await removeRelationAction(id)); if (r.ok) router.refresh(); })} className="text-muted hover:text-red-600" aria-label="Eliminar relación"><X className="h-4 w-4" /></button>;
}
