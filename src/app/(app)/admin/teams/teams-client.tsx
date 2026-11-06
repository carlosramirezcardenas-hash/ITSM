"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crown, Plus, Trash2 } from "lucide-react";
import { deleteTeamAction, saveTeamAction } from "@/app/actions";
import { Avatar, Badge, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useActionToast } from "@/components/toast";

type M = { userId: string; name: string; isLead: boolean };
type T = { id: string; name: string; description: string | null; autoAssign: boolean; open: number; categories: string[]; members: M[] };

export function TeamsClient({ teams, agents }: { teams: T[]; agents: { id: string; name: string }[] }) {
  const [editing, setEditing] = useState<T | "new" | null>(null);
  const [f, setF] = useState<{ name: string; description: string; autoAssign: boolean; members: M[] }>({ name: "", description: "", autoAssign: true, members: [] });
  const [add, setAdd] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();

  const open = (t: T | "new") => { setErrors({}); setEditing(t); setF(t === "new" ? { name: "", description: "", autoAssign: true, members: [] } : { name: t.name, description: t.description ?? "", autoAssign: t.autoAssign, members: t.members }); };
  const save = () => start(async () => {
    const r = toast(await saveTeamAction(editing === "new" ? null : (editing as T).id, { ...f, members: f.members.map((m) => ({ userId: m.userId, isLead: m.isLead })) }));
    if (r.ok) { setEditing(null); router.refresh(); } else setErrors(r.fields ?? {});
  });
  const remove = (t: T) => { if (confirm(`¿Eliminar el equipo «${t.name}»?`)) start(async () => { const r = toast(await deleteTeamAction(t.id)); if (r.ok) router.refresh(); }); };

  return (
    <>
      <div className="mb-4 flex justify-end"><Button onClick={() => open("new")}><Plus className="h-4 w-4" />Nuevo equipo</Button></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {teams.map((t) => (
          <Card key={t.id} className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-2">
              <div><p className="font-medium">{t.name}</p><p className="text-sm text-muted">{t.description}</p></div>
              <Badge tone={t.open ? "blue" : "slate"}>{t.open} abiertos</Badge>
            </div>
            <div className="mt-4 flex -space-x-2">{t.members.map((m) => <Avatar key={m.userId} name={m.name} size={28} className="ring-2 ring-card" />)}</div>
            <p className="mt-2 text-xs text-muted">{t.members.length} miembro(s) · líder: {t.members.filter((m) => m.isLead).map((m) => m.name).join(", ") || "—"}</p>
            {t.categories.length > 0 && <p className="mt-1 text-xs text-muted">Recibe: {t.categories.join(", ")}</p>}
            <p className="mt-1 text-xs text-muted">Asignación automática: {t.autoAssign ? "activada" : "desactivada"}</p>
            <div className="mt-4 flex gap-2 border-t border-border pt-3">
              <Button size="sm" variant="outline" onClick={() => open(t)}>Editar</Button>
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => remove(t)} disabled={pending}><Trash2 className="h-4 w-4" />Eliminar</Button>
            </div>
          </Card>
        ))}
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Nuevo equipo" : "Editar equipo"} size="lg"
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button><Button loading={pending} onClick={save}>Guardar</Button></>}>
        <div className="space-y-4">
          <Field label="Nombre" htmlFor="tn" required error={errors.name}><Input id="tn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Descripción" htmlFor="td"><Textarea id="td" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={f.autoAssign} onChange={(e) => setF({ ...f, autoAssign: e.target.checked })} />Asignar automáticamente al agente con menos carga</label>
          <div>
            <p className="mb-2 text-[13px] font-medium">Miembros</p>
            <ul className="space-y-1.5">
              {f.members.map((m) => (
                <li key={m.userId} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <Avatar name={m.name} size={22} /><span className="flex-1">{m.name}</span>
                  <button type="button" onClick={() => setF({ ...f, members: f.members.map((x) => x.userId === m.userId ? { ...x, isLead: !x.isLead } : x) })} className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${m.isLead ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" : "text-muted hover:bg-subtle"}`} aria-pressed={m.isLead}><Crown className="h-3 w-3" />Líder</button>
                  <button type="button" onClick={() => setF({ ...f, members: f.members.filter((x) => x.userId !== m.userId) })} className="text-muted hover:text-red-600" aria-label={`Quitar a ${m.name}`}><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <Select value={add} onChange={(e) => setAdd(e.target.value)} aria-label="Agregar miembro"><option value="">Agregar agente…</option>{agents.filter((a) => !f.members.some((m) => m.userId === a.id)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
              <Button variant="outline" disabled={!add} onClick={() => { const a = agents.find((x) => x.id === add)!; setF({ ...f, members: [...f.members, { userId: a.id, name: a.name, isLead: false }] }); setAdd(""); }}>Agregar</Button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
