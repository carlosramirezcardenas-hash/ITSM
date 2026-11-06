"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, Plus, Trash2, Workflow, X } from "lucide-react";
import { deleteRuleAction, saveRuleAction, toggleRuleAction } from "@/app/actions-ai";
import { Badge, Button, Card, EmptyState, Field, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useActionToast } from "@/components/toast";
import { ACTIONS, CONDITION_FIELDS, OP_LABEL, TRIGGERS, type Action, type ActionType, type Condition, type ConditionField, type Op } from "@/lib/automation";
import { LEVEL_LABEL, PRIORITY_LABEL, ROLE_LABEL } from "@/lib/labels";

type Opt = { id: string; name: string };
type Options = { teams: Opt[]; categories: Opt[]; users: (Opt & { role: string })[]; departments: string[] };
type Rule = { id: string; name: string; description: string | null; trigger: string; conditions: Condition[]; actions: Action[]; isActive: boolean; runCount: number; lastRun: string | null };

const TEMPLATES: { name: string; rule: Omit<Rule, "id" | "runCount" | "lastRun" | "isActive"> }[] = [
  { name: "Críticos → gestores", rule: { name: "Avisar a gestores ante incidentes críticos", description: null, trigger: "ticket.created", conditions: [{ field: "priority", op: "eq", value: "P1" }], actions: [{ type: "notify_managers" }] } },
  { name: "VPN → Infraestructura", rule: { name: "Derivar problemas de VPN a Infraestructura", description: null, trigger: "ticket.created", conditions: [{ field: "text", op: "contains", value: "vpn" }], actions: [] } },
  { name: "SLA vencido → escalar", rule: { name: "Escalar cuando vence el SLA de un P2", description: null, trigger: "sla.breached", conditions: [{ field: "priority", op: "eq", value: "P2" }], actions: [{ type: "escalate" }, { type: "add_note", value: "Escalado automáticamente: SLA de resolución vencido." }] } },
];

function valueOptions(field: ConditionField, o: Options): { value: string; label: string }[] | null {
  switch (field) {
    case "type": return [{ value: "INCIDENT", label: "Incidente" }, { value: "REQUEST", label: "Solicitud" }];
    case "priority": return ["P1", "P2", "P3", "P4"].map((p) => ({ value: p, label: `${p} · ${PRIORITY_LABEL[p]}` }));
    case "impact": case "urgency": return ["LOW", "MEDIUM", "HIGH"].map((l) => ({ value: l, label: LEVEL_LABEL[l]! }));
    case "categoryId": return o.categories.map((c) => ({ value: c.id, label: c.name }));
    case "teamId": return o.teams.map((c) => ({ value: c.id, label: c.name }));
    case "channel": return ["portal", "phone", "email", "chat", "walk-in", "api"].map((c) => ({ value: c, label: c }));
    case "requesterDepartment": return o.departments.map((d) => ({ value: d, label: d }));
    default: return null;
  }
}

const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function describe(r: Rule, o: Options) {
  const label = (field: ConditionField, v: string) => valueOptions(field, o)?.find((x) => x.value === v)?.label ?? v;
  const conds = r.conditions.map((c) => `${lcFirst(CONDITION_FIELDS[c.field].label)} ${OP_LABEL[c.op]} ${(Array.isArray(c.value) ? c.value : [c.value]).map((v) => label(c.field, v)).join(", ")}`);
  const acts = r.actions.map((a) => {
    const v = Array.isArray(a.value) ? a.value : a.value ? [a.value] : [];
    const names = a.type === "assign_team" ? v.map((x) => o.teams.find((t) => t.id === x)?.name) : ["assign_user", "notify_users"].includes(a.type) ? v.map((x) => o.users.find((u) => u.id === x)?.name) : a.type === "add_note" ? [`«${v[0]?.slice(0, 40)}»`] : v;
    return `${lcFirst(ACTIONS[a.type])}${names.length ? ` ${names.filter(Boolean).join(", ")}` : ""}`;
  });
  return { conds, acts };
}

export function AutomationsClient({ rules, options }: { rules: Rule[]; options: Options }) {
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const [f, setF] = useState<Omit<Rule, "id" | "runCount" | "lastRun">>({ name: "", description: "", trigger: "ticket.created", conditions: [], actions: [], isActive: true });
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  const open = (r: Rule | "new", tpl?: Omit<Rule, "id" | "runCount" | "lastRun" | "isActive">) => {
    setEditing(r);
    const base = tpl ?? { name: "", description: "", trigger: "ticket.created", conditions: [], actions: [] };
    if (tpl && !tpl.actions.length) base.actions = [{ type: "assign_team", value: options.teams.find((t) => /infra/i.test(t.name))?.id ?? options.teams[0]?.id }];
    setF(r === "new" ? { ...base, isActive: true } : { name: r.name, description: r.description, trigger: r.trigger, conditions: r.conditions, actions: r.actions, isActive: r.isActive });
  };
  const go = (fn: () => Promise<any>, after?: () => void) => start(async () => { const r = toast(await fn()); if (r.ok) { after?.(); router.refresh(); } });
  const setCond = (i: number, c: Partial<Condition>) => setF({ ...f, conditions: f.conditions.map((x, j) => (j === i ? { ...x, ...c } : x)) });
  const setAct = (i: number, a: Partial<Action>) => setF({ ...f, actions: f.actions.map((x, j) => (j === i ? { ...x, ...a } : x)) });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button onClick={() => open("new")}><Plus className="h-4 w-4" />Nueva regla</Button>
        <span className="text-xs text-muted">o parte de una plantilla:</span>
        {TEMPLATES.map((t) => <Button key={t.name} size="sm" variant="outline" onClick={() => open("new", t.rule)}>{t.name}</Button>)}
      </div>
      {rules.length === 0 ? <Card><EmptyState icon={<Workflow className="h-5 w-5" />} title="Aún no hay automatizaciones" description="Crea una regla para derivar, priorizar o notificar automáticamente." /></Card> : (
        <div className="space-y-3">
          {rules.map((r) => {
            const d = describe(r, options);
            return (
              <Card key={r.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium">{r.name}{!r.isActive && <Badge>Pausada</Badge>}</p>
                    <p className="mt-1 text-sm text-muted"><strong className="font-medium text-fg">Cuando</strong> {lcFirst(TRIGGERS[r.trigger as keyof typeof TRIGGERS] ?? r.trigger)}{d.conds.length ? <>, <strong className="font-medium text-fg">si</strong> {d.conds.join(" y ")}</> : null}, <strong className="font-medium text-fg">entonces</strong> {d.acts.join("; ")}.</p>
                    <p className="mt-1 text-xs text-muted">Ejecutada {r.runCount} {r.runCount === 1 ? "vez" : "veces"}{r.lastRun ? ` · última ${r.lastRun}` : ""}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => go(() => toggleRuleAction(r.id, !r.isActive))} aria-label={r.isActive ? "Pausar" : "Activar"}>{r.isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button>
                    <Button size="sm" variant="ghost" onClick={() => open(r)}>Editar</Button>
                    <Button size="sm" variant="ghost" className="text-red-600" disabled={pending} onClick={() => { if (confirm(`¿Eliminar «${r.name}»?`)) go(() => deleteRuleAction(r.id)); }} aria-label="Eliminar"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Nueva automatización" : "Editar automatización"} size="xl"
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button><Button loading={pending} onClick={() => go(() => saveRuleAction(editing === "new" ? null : (editing as Rule).id, f), () => setEditing(null))}>Guardar regla</Button></>}>
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre" htmlFor="rn" required><Input id="rn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Cuando…" htmlFor="rt"><Select id="rt" value={f.trigger} onChange={(e) => setF({ ...f, trigger: e.target.value })}>{Object.entries(TRIGGERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between"><p className="text-[13px] font-medium">Si se cumple todo esto <span className="font-normal text-muted">(vacío = siempre)</span></p><Button size="sm" variant="outline" onClick={() => setF({ ...f, conditions: [...f.conditions, { field: "priority", op: "eq", value: "P1" }] })}><Plus className="h-3.5 w-3.5" />Condición</Button></div>
            <div className="space-y-2">
              {f.conditions.map((c, i) => {
                const opts = valueOptions(c.field, options);
                const val = Array.isArray(c.value) ? c.value[0] ?? "" : c.value;
                return (
                  <div key={i} className="grid gap-2 sm:grid-cols-[1fr_140px_1fr_auto]">
                    <Select value={c.field} aria-label="Campo" onChange={(e) => { const field = e.target.value as ConditionField; setCond(i, { field, op: CONDITION_FIELDS[field].ops[0] as Op, value: valueOptions(field, options)?.[0]?.value ?? "" }); }}>{Object.entries(CONDITION_FIELDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
                    <Select value={c.op} aria-label="Operador" onChange={(e) => setCond(i, { op: e.target.value as Op })}>{CONDITION_FIELDS[c.field].ops.map((o) => <option key={o} value={o}>{OP_LABEL[o as Op]}</option>)}</Select>
                    {opts && c.op !== "in" ? <Select value={val} aria-label="Valor" onChange={(e) => setCond(i, { value: e.target.value })}>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
                      : opts ? <Select multiple value={Array.isArray(c.value) ? c.value : [c.value]} aria-label="Valores" className="h-20" onChange={(e) => setCond(i, { value: [...e.target.selectedOptions].map((x) => x.value) })}>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
                      : <Input value={val} aria-label="Texto" placeholder="palabra o frase" onChange={(e) => setCond(i, { value: e.target.value })} />}
                    <Button size="icon" variant="ghost" onClick={() => setF({ ...f, conditions: f.conditions.filter((_, j) => j !== i) })} aria-label="Quitar condición"><X className="h-4 w-4" /></Button>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between"><p className="text-[13px] font-medium">Entonces</p><Button size="sm" variant="outline" onClick={() => setF({ ...f, actions: [...f.actions, { type: "notify_managers" }] })}><Plus className="h-3.5 w-3.5" />Acción</Button></div>
            <div className="space-y-2">
              {f.actions.map((a, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[220px_1fr_auto]">
                  <Select value={a.type} aria-label="Acción" onChange={(e) => { const type = e.target.value as ActionType; setAct(i, { type, value: type === "assign_team" ? options.teams[0]?.id : type === "set_priority" ? "P2" : type === "assign_user" ? options.users.find((u) => u.role !== "END_USER")?.id : type === "notify_users" ? [] : type === "add_note" ? "" : undefined }); }}>{Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                  {a.type === "assign_team" ? <Select value={String(a.value ?? "")} aria-label="Equipo" onChange={(e) => setAct(i, { value: e.target.value })}>{options.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
                    : a.type === "assign_user" ? <Select value={String(a.value ?? "")} aria-label="Agente" onChange={(e) => setAct(i, { value: e.target.value })}>{options.users.filter((u) => ["AGENT", "SERVICE_MANAGER", "ORG_ADMIN"].includes(u.role)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
                    : a.type === "set_priority" ? <Select value={String(a.value ?? "P2")} aria-label="Prioridad" onChange={(e) => setAct(i, { value: e.target.value })}>{["P1", "P2", "P3", "P4"].map((p) => <option key={p} value={p}>{p} · {PRIORITY_LABEL[p]}</option>)}</Select>
                    : a.type === "notify_users" ? <Select multiple value={Array.isArray(a.value) ? a.value : []} aria-label="Personas" className="h-20" onChange={(e) => setAct(i, { value: [...e.target.selectedOptions].map((x) => x.value) })}>{options.users.map((u) => <option key={u.id} value={u.id}>{u.name} · {ROLE_LABEL[u.role]}</option>)}</Select>
                    : a.type === "add_note" ? <Textarea rows={2} value={String(a.value ?? "")} aria-label="Nota" onChange={(e) => setAct(i, { value: e.target.value })} />
                    : <p className="self-center text-xs text-muted">{a.type === "escalate" ? "Sube el nivel de escalamiento y avisa a líderes y gestores." : "Avisa a gestores y líderes del equipo."}</p>}
                  <Button size="icon" variant="ghost" onClick={() => setF({ ...f, actions: f.actions.filter((_, j) => j !== i) })} aria-label="Quitar acción"><X className="h-4 w-4" /></Button>
                </div>
              ))}
              {!f.actions.length && <p className="text-xs text-muted">Agrega al menos una acción.</p>}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />Regla activa</label>
        </div>
      </Modal>
    </>
  );
}
