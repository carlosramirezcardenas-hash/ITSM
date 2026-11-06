"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { saveDepartmentAction, saveUserAction } from "@/app/actions";
import { Avatar, Badge, Button, Card, Field, Input, Select } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useActionToast } from "@/components/toast";
import { ROLE_LABEL } from "@/lib/labels";
import { timeAgo } from "@/lib/utils";

type U = { id: string; name: string; email: string; role: string; title: string | null; departmentId: string | null; department: string | null; managerId: string | null; manager: string | null; isActive: boolean; lastLoginAt: string | null; teamIds: string[]; teams: string[] };
const ROLES = ["END_USER", "APPROVER", "AGENT", "SERVICE_MANAGER", "ORG_ADMIN"] as const;
const ROLE_HINT: Record<string, string> = {
  END_USER: "Pide ayuda y sigue sus solicitudes.",
  APPROVER: "Además aprueba solicitudes de su equipo.",
  AGENT: "Atiende tickets y escribe artículos.",
  SERVICE_MANAGER: "Gestiona equipos, catálogo, SLA y reportes.",
  ORG_ADMIN: "Control total de la organización.",
};

export function UsersClient({ users, departments, teams, people, q, me }: { users: U[]; departments: { id: string; name: string }[]; teams: { id: string; name: string }[]; people: { id: string; name: string }[]; q: string; me: string }) {
  const [editing, setEditing] = useState<U | "new" | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [newDept, setNewDept] = useState("");
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();

  const open = (u: U | "new") => {
    setErrors({});
    setEditing(u);
    setForm(u === "new" ? { name: "", email: "", role: "END_USER", title: "", departmentId: "", managerId: "", password: "", isActive: true, teamIds: [] }
      : { name: u.name, email: u.email, role: u.role, title: u.title ?? "", departmentId: u.departmentId ?? "", managerId: u.managerId ?? "", password: "", isActive: u.isActive, teamIds: u.teamIds });
  };
  const save = () => start(async () => {
    const r = toast(await saveUserAction(editing === "new" ? null : (editing as U).id, { ...form, password: form.password || null }));
    if (r.ok) { setEditing(null); router.refresh(); } else setErrors(r.fields ?? {});
  });
  const addDept = () => start(async () => { const r = toast(await saveDepartmentAction(newDept)); if (r.ok) { setNewDept(""); router.refresh(); } });

  return (
    <>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <form className="relative sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
          <input name="q" defaultValue={q} placeholder="Buscar por nombre o correo" className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-ring" />
        </form>
        <Button onClick={() => open("new")}><Plus className="h-4 w-4" />Nuevo usuario</Button>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-xs text-muted"><tr className="border-b border-border"><th className="px-5 py-2.5 text-left font-medium">Persona</th><th className="px-3 text-left font-medium">Rol</th><th className="px-3 text-left font-medium">Área · Equipos</th><th className="px-3 text-left font-medium">Último acceso</th><th className="px-5 text-right font-medium" /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0 hover:bg-subtle/60">
                <td className="px-5 py-3"><div className="flex items-center gap-3"><Avatar name={u.name} size={30} /><div><p className="font-medium">{u.name} {!u.isActive && <Badge tone="red">Inactivo</Badge>}</p><p className="text-xs text-muted">{u.email}</p></div></div></td>
                <td className="px-3"><Badge tone={u.role === "ORG_ADMIN" ? "violet" : u.role === "AGENT" || u.role === "SERVICE_MANAGER" ? "blue" : u.role === "APPROVER" ? "amber" : "slate"}>{ROLE_LABEL[u.role]}</Badge></td>
                <td className="px-3 text-xs text-muted">{u.department ?? "—"}{u.teams.length ? ` · ${u.teams.join(", ")}` : ""}</td>
                <td className="px-3 text-xs text-muted">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : "Nunca"}</td>
                <td className="px-5 text-right"><Button size="sm" variant="ghost" onClick={() => open(u)}>Editar</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="mt-6 p-5">
        <p className="text-sm font-medium">Departamentos</p>
        <div className="mt-3 flex flex-wrap gap-1.5">{departments.map((d) => <Badge key={d.id}>{d.name}</Badge>)}</div>
        <div className="mt-3 flex max-w-sm gap-2"><Input value={newDept} onChange={(e) => setNewDept(e.target.value)} placeholder="Nuevo departamento" aria-label="Nuevo departamento" /><Button variant="outline" onClick={addDept} disabled={newDept.trim().length < 2 || pending}>Agregar</Button></div>
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Nuevo usuario" : "Editar usuario"} size="lg"
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button><Button loading={pending} onClick={save}>Guardar</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" htmlFor="n" required error={errors.name}><Input id="n" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Correo" htmlFor="e" required error={errors.email}><Input id="e" type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Rol" htmlFor="r" hint={ROLE_HINT[form.role]}>
            <Select id="r" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} disabled={editing !== "new" && (editing as U)?.id === me}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>
          </Field>
          <Field label="Cargo" htmlFor="t"><Input id="t" value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Departamento" htmlFor="d"><Select id="d" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Jefatura directa" htmlFor="m" hint="Aprueba sus solicitudes cuando corresponda." error={errors.managerId}><Select id="m" value={form.managerId} onChange={(e) => setForm({ ...form, managerId: e.target.value })}><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label={editing === "new" ? "Contraseña inicial" : "Nueva contraseña (opcional)"} htmlFor="p" required={editing === "new"} error={errors.password} hint="Mín. 10 caracteres con letras y números.">
            <Input id="p" type="password" autoComplete="new-password" value={form.password ?? ""} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Field label="Estado" htmlFor="a">
            <Select id="a" value={form.isActive ? "1" : "0"} onChange={(e) => setForm({ ...form, isActive: e.target.value === "1" })} disabled={editing !== "new" && (editing as U)?.id === me}><option value="1">Activo</option><option value="0">Inactivo (sin acceso)</option></Select>
          </Field>
          {["AGENT", "SERVICE_MANAGER", "ORG_ADMIN"].includes(form.role) && (
            <div className="sm:col-span-2">
              <p className="mb-2 text-[13px] font-medium">Equipos de soporte</p>
              <div className="flex flex-wrap gap-2">
                {teams.map((t) => {
                  const on = (form.teamIds as string[]).includes(t.id);
                  return <button type="button" key={t.id} onClick={() => setForm({ ...form, teamIds: on ? form.teamIds.filter((x: string) => x !== t.id) : [...form.teamIds, t.id] })}
                    className={`rounded-full border px-3 py-1 text-sm ${on ? "border-primary bg-primary-soft text-primary" : "border-border text-muted"}`} aria-pressed={on}>{t.name}</button>;
                })}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
