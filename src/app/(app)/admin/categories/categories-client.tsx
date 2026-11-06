"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { deleteCategoryAction, saveCategoryAction } from "@/app/actions";
import { Badge, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { DynIcon, ICON_NAMES } from "@/components/icon";
import { useActionToast } from "@/components/toast";
import { cn } from "@/lib/utils";

type C = { id: string; name: string; icon: string; keywords: string; teamId: string; team: string | null; tickets: number };

export function CategoriesClient({ categories, teams }: { categories: C[]; teams: { id: string; name: string }[] }) {
  const [editing, setEditing] = useState<C | "new" | null>(null);
  const [f, setF] = useState({ name: "", icon: "folder", keywords: "", teamId: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  const open = (c: C | "new") => { setErrors({}); setEditing(c); setF(c === "new" ? { name: "", icon: "folder", keywords: "", teamId: "" } : { name: c.name, icon: c.icon, keywords: c.keywords, teamId: c.teamId }); };
  const save = () => start(async () => { const r = toast(await saveCategoryAction(editing === "new" ? null : (editing as C).id, f)); if (r.ok) { setEditing(null); router.refresh(); } else setErrors(r.fields ?? {}); });
  const remove = (c: C) => { if (confirm(`¿Eliminar «${c.name}»? Los tickets existentes quedarán sin categoría.`)) start(async () => { const r = toast(await deleteCategoryAction(c.id)); if (r.ok) router.refresh(); }); };
  return (
    <>
      <div className="mb-4 flex justify-end"><Button onClick={() => open("new")}><Plus className="h-4 w-4" />Nueva categoría</Button></div>
      <Card className="divide-y divide-border">
        {categories.map((c) => (
          <div key={c.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"><DynIcon name={c.icon} className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{c.name} <span className="text-xs font-normal text-muted">→ {c.team ?? "sin equipo"} · {c.tickets} tickets</span></p>
              <div className="mt-1 flex flex-wrap gap-1">{c.keywords.split(",").filter(Boolean).slice(0, 10).map((k) => <Badge key={k}>{k.trim()}</Badge>)}</div>
            </div>
            <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => open(c)}>Editar</Button><Button size="sm" variant="ghost" className="text-red-600" onClick={() => remove(c)} aria-label={`Eliminar ${c.name}`}><Trash2 className="h-4 w-4" /></Button></div>
          </div>
        ))}
      </Card>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Nueva categoría" : "Editar categoría"}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button><Button loading={pending} onClick={save}>Guardar</Button></>}>
        <div className="space-y-4">
          <Field label="Nombre" htmlFor="cn" required error={errors.name}><Input id="cn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Equipo que la atiende" htmlFor="ct"><Select id="ct" value={f.teamId} onChange={(e) => setF({ ...f, teamId: e.target.value })}><option value="">—</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          <Field label="Palabras clave" htmlFor="ck" hint="Separadas por coma. Si el usuario las escribe, el ticket se clasifica aquí automáticamente."><Textarea id="ck" rows={3} value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} /></Field>
          <Field label="Ícono"><div className="flex flex-wrap gap-1.5">{ICON_NAMES.map((n) => <button key={n} type="button" onClick={() => setF({ ...f, icon: n })} className={cn("rounded-lg border p-2", f.icon === n ? "border-primary bg-primary-soft text-primary" : "border-border text-muted")} aria-label={n} aria-pressed={f.icon === n}><DynIcon name={n} className="h-4 w-4" /></button>)}</div></Field>
        </div>
      </Modal>
    </>
  );
}
