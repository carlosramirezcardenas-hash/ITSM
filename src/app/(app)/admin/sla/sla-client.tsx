"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Plus, Trash2 } from "lucide-react";
import { addHolidayAction, removeHolidayAction, saveCalendarAction, savePolicyAction } from "@/app/actions";
import { Badge, Button, Card, CardHeader, Field, Input, Select } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useActionToast } from "@/components/toast";
import { PRIORITY_LABEL, PRIORITY_TONE } from "@/lib/labels";
import { formatMinutes, cn } from "@/lib/utils";

type P = { id: string; name: string; priority: string; responseMinutes: number; resolutionMinutes: number; calendarId: string; calendar: string; warnPercent: number; isActive: boolean };
type Cal = { id: string; name: string; timezone: string; workDays: number[]; startTime: string; endTime: string; is24x7: boolean; holidays: { id: string; date: string; name: string }[] };
const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function SlaClient({ policies, calendars }: { policies: P[]; calendars: Cal[] }) {
  const [policy, setPolicy] = useState<P | null>(null);
  const [cal, setCal] = useState<Cal | "new" | null>(null);
  const [pf, setPf] = useState({ name: "", responseMinutes: 60, resolutionMinutes: 480, calendarId: "", warnPercent: 75, isActive: true });
  const [cf, setCf] = useState({ name: "", timezone: "America/Santiago", workDays: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "18:00", is24x7: false });
  const [hol, setHol] = useState<Record<string, { date: string; name: string }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();

  const run = (fn: () => Promise<any>, after?: () => void) => start(async () => { const r = toast(await fn()); if (r.ok) { after?.(); router.refresh(); } else setErrors(r.fields ?? {}); });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Políticas por prioridad" description="Prioridad = impacto × urgencia (matriz ITIL). Se recalcula si cambian." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-xs text-muted"><tr className="border-b border-border"><th className="px-5 py-2.5 text-left font-medium">Prioridad</th><th className="px-3 text-left font-medium">Primera respuesta</th><th className="px-3 text-left font-medium">Resolución</th><th className="px-3 text-left font-medium">Horario</th><th className="px-3 text-left font-medium">Alerta</th><th className="px-5" /></tr></thead>
            <tbody>{policies.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0">
                <td className="px-5 py-3"><Badge tone={PRIORITY_TONE[p.priority]}>{p.priority} · {PRIORITY_LABEL[p.priority]}</Badge> <span className="ml-1 text-muted">{p.name}</span>{!p.isActive && <Badge tone="red">Inactiva</Badge>}</td>
                <td className="px-3 font-medium tabular-nums">{formatMinutes(p.responseMinutes)}</td>
                <td className="px-3 font-medium tabular-nums">{formatMinutes(p.resolutionMinutes)}</td>
                <td className="px-3 text-muted">{p.calendar}</td>
                <td className="px-3 text-muted">al {p.warnPercent}%</td>
                <td className="px-5 text-right"><Button size="sm" variant="ghost" onClick={() => { setErrors({}); setPolicy(p); setPf({ name: p.name, responseMinutes: p.responseMinutes, resolutionMinutes: p.resolutionMinutes, calendarId: p.calendarId, warnPercent: p.warnPercent, isActive: p.isActive }); }}>Editar</Button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="border-t border-border px-5 py-3 text-xs text-muted">Al vencer, el sistema notifica al responsable; al incumplirse, escala automáticamente a líderes de equipo y gestores. Los resueltos se cierran solos tras 3 días sin respuesta.</p>
      </Card>

      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Calendarios laborales y feriados</h2><Button size="sm" variant="outline" onClick={() => { setErrors({}); setCal("new"); setCf({ name: "", timezone: "America/Santiago", workDays: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "18:00", is24x7: false }); }}><Plus className="h-4 w-4" />Calendario</Button></div>
      <div className="grid gap-4 lg:grid-cols-2">
        {calendars.map((c) => (
          <Card key={c.id}>
            <CardHeader title={<span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-muted" />{c.name}</span>}
              description={c.is24x7 ? "Todos los días, las 24 horas" : `${c.workDays.map((d) => DAYS[d]).join(", ")} · ${c.startTime}–${c.endTime} · ${c.timezone}`}
              action={<Button size="sm" variant="ghost" onClick={() => { setErrors({}); setCal(c); setCf({ name: c.name, timezone: c.timezone, workDays: c.workDays, startTime: c.startTime, endTime: c.endTime, is24x7: c.is24x7 }); }}>Editar</Button>} />
            {!c.is24x7 && (
              <div className="p-5">
                <p className="mb-2 text-xs font-medium text-muted">Feriados ({c.holidays.length})</p>
                <ul className="scrollbar-thin max-h-48 space-y-1 overflow-y-auto">
                  {c.holidays.map((h) => (
                    <li key={h.id} className="flex items-center gap-2 text-sm"><span className="w-24 font-mono text-xs text-muted">{h.date}</span><span className="flex-1">{h.name}</span>
                      <button onClick={() => run(() => removeHolidayAction(h.id))} className="text-muted hover:text-red-600" aria-label={`Eliminar ${h.name}`} disabled={pending}><Trash2 className="h-3.5 w-3.5" /></button></li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Input type="date" value={hol[c.id]?.date ?? ""} onChange={(e) => setHol({ ...hol, [c.id]: { name: hol[c.id]?.name ?? "", date: e.target.value } })} className="sm:w-40" aria-label="Fecha del feriado" />
                  <Input value={hol[c.id]?.name ?? ""} onChange={(e) => setHol({ ...hol, [c.id]: { date: hol[c.id]?.date ?? "", name: e.target.value } })} placeholder="Nombre del feriado" aria-label="Nombre del feriado" />
                  <Button variant="outline" disabled={!hol[c.id]?.date || !hol[c.id]?.name || pending} onClick={() => run(() => addHolidayAction(c.id, hol[c.id]), () => setHol({ ...hol, [c.id]: { date: "", name: "" } }))}>Agregar</Button>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>

      <Modal open={!!policy} onClose={() => setPolicy(null)} title={`Política ${policy?.priority ?? ""}`}
        footer={<><Button variant="ghost" onClick={() => setPolicy(null)}>Cancelar</Button><Button loading={pending} onClick={() => run(() => savePolicyAction(policy!.id, pf), () => setPolicy(null))}>Guardar</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" htmlFor="pn" className="sm:col-span-2"><Input id="pn" value={pf.name} onChange={(e) => setPf({ ...pf, name: e.target.value })} /></Field>
          <Field label="Primera respuesta (minutos)" htmlFor="pr" error={errors.responseMinutes} hint={formatMinutes(pf.responseMinutes)}><Input id="pr" type="number" min={1} value={pf.responseMinutes} onChange={(e) => setPf({ ...pf, responseMinutes: Number(e.target.value) })} /></Field>
          <Field label="Resolución (minutos)" htmlFor="ps" error={errors.resolutionMinutes} hint={formatMinutes(pf.resolutionMinutes)}><Input id="ps" type="number" min={1} value={pf.resolutionMinutes} onChange={(e) => setPf({ ...pf, resolutionMinutes: Number(e.target.value) })} /></Field>
          <Field label="Calendario" htmlFor="pc"><Select id="pc" value={pf.calendarId} onChange={(e) => setPf({ ...pf, calendarId: e.target.value })}><option value="">24x7 (sin calendario)</option>{calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Alertar al consumir (%)" htmlFor="pw"><Input id="pw" type="number" min={10} max={95} value={pf.warnPercent} onChange={(e) => setPf({ ...pf, warnPercent: Number(e.target.value) })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pf.isActive} onChange={(e) => setPf({ ...pf, isActive: e.target.checked })} />Política activa</label>
        </div>
      </Modal>

      <Modal open={!!cal} onClose={() => setCal(null)} title={cal === "new" ? "Nuevo calendario" : "Editar calendario"}
        footer={<><Button variant="ghost" onClick={() => setCal(null)}>Cancelar</Button><Button loading={pending} onClick={() => run(() => saveCalendarAction(cal === "new" ? null : (cal as Cal).id, cf), () => setCal(null))}>Guardar</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" htmlFor="cn" required error={errors.name} className="sm:col-span-2"><Input id="cn" value={cf.name} onChange={(e) => setCf({ ...cf, name: e.target.value })} /></Field>
          <Field label="Zona horaria" htmlFor="tz" error={errors.timezone} className="sm:col-span-2"><Input id="tz" value={cf.timezone} onChange={(e) => setCf({ ...cf, timezone: e.target.value })} placeholder="America/Santiago" /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={cf.is24x7} onChange={(e) => setCf({ ...cf, is24x7: e.target.checked })} />Atención 24x7</label>
          {!cf.is24x7 && (
            <>
              <div className="sm:col-span-2">
                <p className="mb-2 text-[13px] font-medium">Días hábiles</p>
                <div className="flex flex-wrap gap-1.5">{DAYS.map((d, i) => { const on = cf.workDays.includes(i); return <button key={d} type="button" aria-pressed={on} onClick={() => setCf({ ...cf, workDays: on ? cf.workDays.filter((x) => x !== i) : [...cf.workDays, i].sort() })} className={cn("w-12 rounded-lg border py-1.5 text-sm", on ? "border-primary bg-primary-soft text-primary" : "border-border text-muted")}>{d}</button>; })}</div>
                {errors.workDays && <p className="mt-1 text-xs text-red-600">{errors.workDays}</p>}
              </div>
              <Field label="Desde" htmlFor="cs" error={errors.startTime}><Input id="cs" type="time" value={cf.startTime} onChange={(e) => setCf({ ...cf, startTime: e.target.value })} /></Field>
              <Field label="Hasta" htmlFor="ce" error={errors.endTime}><Input id="ce" type="time" value={cf.endTime} onChange={(e) => setCf({ ...cf, endTime: e.target.value })} /></Field>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
