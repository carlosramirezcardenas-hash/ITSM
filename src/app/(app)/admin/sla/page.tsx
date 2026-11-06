import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import { PageHeader } from "@/components/ui";
import { SlaClient } from "./sla-client";

export const metadata: Metadata = { title: "SLA y horarios" };
export const dynamic = "force-dynamic";

export default async function SlaPage() {
  const ctx = await requireCtx("sla:manage");
  const [policies, calendars] = await Promise.all([
    db.slaPolicy.findMany({ where: { orgId: ctx.orgId }, include: { calendar: { select: { name: true } } }, orderBy: { priority: "asc" } }),
    db.businessCalendar.findMany({ where: { orgId: ctx.orgId }, include: { holidays: { orderBy: { date: "asc" } } }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div>
      <PageHeader title="Acuerdos de nivel de servicio (SLA)" description="Tiempos de respuesta y resolución por prioridad. El reloj solo corre en horario hábil y se pausa cuando un ticket está en espera." />
      <SlaClient
        policies={policies.map((p) => ({ id: p.id, name: p.name, priority: p.priority, responseMinutes: p.responseMinutes, resolutionMinutes: p.resolutionMinutes, calendarId: p.calendarId ?? "", calendar: p.calendar?.name ?? "24x7 (sin calendario)", warnPercent: p.warnPercent, isActive: p.isActive }))}
        calendars={calendars.map((c) => ({ id: c.id, name: c.name, timezone: c.timezone, workDays: c.workDays, startTime: c.startTime, endTime: c.endTime, is24x7: c.is24x7, holidays: c.holidays.map((h) => ({ id: h.id, date: h.date, name: h.name })) }))}
      />
    </div>
  );
}
