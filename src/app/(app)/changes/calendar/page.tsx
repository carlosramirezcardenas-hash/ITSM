import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import { changeCalendar } from "@/server/changes";
import { Card, PageHeader, buttonClass } from "@/components/ui";
import { CHANGE_STATUS_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Calendario de cambios" };
export const dynamic = "force-dynamic";

const DOW = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const TYPE_BG: Record<string, string> = {
  STANDARD: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  NORMAL: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  EMERGENCY: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const ctx = await requireCtx("changes:create");
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { timezone: true } });
  const tz = org.timezone;
  const { month, items } = await changeCalendar(ctx, (await searchParams).m ?? "");
  const [y, mo] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const shift = (d: number) => { const x = new Date(Date.UTC(y, mo - 1 + d, 1)); return x.toISOString().slice(0, 7); };
  const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz });
  const time = (d: Date) => d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const today = dayKey(new Date());
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const raw = first.toLocaleDateString("es", { month: "long", year: "numeric", timeZone: "UTC" });
  const title = raw.charAt(0).toUpperCase() + raw.slice(1);
  return (
    <div>
      <PageHeader title="Calendario de cambios" description="Ventanas planificadas. Los conflictos (mismos elementos a la misma hora) se marcan en rojo." action={<Link href="/changes/new" className={buttonClass()}>Nuevo cambio</Link>} />
      <div className="mb-4 flex items-center gap-2">
        <Link href={`/changes/calendar?m=${shift(-1)}`} className={buttonClass("outline", "icon")} aria-label="Mes anterior"><ChevronLeft className="h-4 w-4" /></Link>
        <p className="w-44 text-center font-medium">{title}</p>
        <Link href={`/changes/calendar?m=${shift(1)}`} className={buttonClass("outline", "icon")} aria-label="Mes siguiente"><ChevronRight className="h-4 w-4" /></Link>
        <Link href="/changes/calendar" className={buttonClass("ghost", "sm")}>Hoy</Link>
        <div className="ml-auto hidden gap-3 text-xs text-muted sm:flex">{Object.entries({ STANDARD: "Estándar", NORMAL: "Normal", EMERGENCY: "Emergencia" }).map(([k, v]) => <span key={k} className="flex items-center gap-1.5"><span className={cn("h-3 w-3 rounded", TYPE_BG[k])} />{v}</span>)}</div>
      </div>
      <Card className="overflow-x-auto">
        <div className="grid min-w-[760px] grid-cols-7">
          {DOW.map((d) => <div key={d} className="border-b border-border px-2 py-2 text-xs font-medium text-muted">{d}</div>)}
          {cells.map((d, i) => {
            const key = d ? `${month}-${String(d).padStart(2, "0")}` : "";
            const list = d ? items.filter((c) => dayKey(c.plannedStart!) <= key && dayKey(c.plannedEnd!) >= key) : [];
            return (
              <div key={i} className={cn("min-h-28 border-b border-r border-border p-1.5", !d && "bg-subtle/50", (i + 1) % 7 === 0 && "border-r-0")}>
                {d && <p className={cn("mb-1 text-xs", key === today ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary font-semibold text-primary-fg" : "text-muted")}>{d}</p>}
                <ul className="space-y-1">
                  {list.map((c) => (
                    <li key={c.id}>
                      <Link href={`/changes/${c.id}`} title={`${c.title} · ${CHANGE_STATUS_LABEL[c.status]}`}
                        className={cn("block truncate rounded px-1.5 py-0.5 text-[11px]", TYPE_BG[c.type], c.conflict && "ring-2 ring-red-500", ["CLOSED", "REJECTED"].includes(c.status) && "opacity-50")}>
                        {c.conflict && <AlertTriangle className="mr-0.5 inline h-3 w-3" />}{dayKey(c.plannedStart!) === key ? time(c.plannedStart!) : "…"} CHG-{c.number} {c.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
