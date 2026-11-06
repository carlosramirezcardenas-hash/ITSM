/**
 * Cálculo de tiempo hábil para SLA (funciones puras, sin dependencias de BD).
 * Soporta calendarios laborales con zona horaria, días hábiles, horario y feriados.
 */
export type CalendarLike = {
  timezone: string;
  workDays: number[]; // 0=domingo
  startTime: string;  // "HH:MM"
  endTime: string;
  is24x7: boolean;
  holidays: string[]; // "YYYY-MM-DD"
};

const MIN = 60_000;
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

function parts(date: Date, tz: string) {
  const p: Record<string, number> = {};
  for (const x of fmt(tz).formatToParts(date)) if (x.type !== "literal") p[x.type] = Number(x.value);
  return { y: p.year!, m: p.month!, d: p.day!, h: p.hour!, mi: p.minute!, s: p.second! };
}

function offsetMs(date: Date, tz: string) {
  const p = parts(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convierte una hora local (y,m,d + minutos del día) en la zona tz a un instante UTC. */
export function zonedToUtc(y: number, m: number, d: number, minuteOfDay: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, 0, minuteOfDay);
  let off = offsetMs(new Date(guess), tz);
  let res = guess - off;
  const off2 = offsetMs(new Date(res), tz);
  if (off2 !== off) res = guess - off2;
  return new Date(res);
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const pad = (n: number) => String(n).padStart(2, "0");

/** Recorre las ventanas hábiles [inicio, fin) a partir de `from`. */
function* windows(from: Date, cal: CalendarLike) {
  const p0 = parts(from, cal.timezone);
  let y = p0.y, m = p0.m, d = p0.d;
  const startMin = toMin(cal.startTime);
  const endMin = toMin(cal.endTime);
  for (let i = 0; i < 730; i++) {
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    if (cal.workDays.includes(weekday) && !cal.holidays.includes(iso) && endMin > startMin) {
      yield [zonedToUtc(y, m, d, startMin, cal.timezone), zonedToUtc(y, m, d, endMin, cal.timezone)] as const;
    }
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    y = next.getUTCFullYear(); m = next.getUTCMonth() + 1; d = next.getUTCDate();
  }
}

export function addBusinessMinutes(start: Date, minutes: number, cal: CalendarLike | null): Date {
  if (!cal || cal.is24x7) return new Date(start.getTime() + minutes * MIN);
  let remaining = minutes;
  for (const [ws, we] of windows(start, cal)) {
    const from = Math.max(start.getTime(), ws.getTime());
    if (from >= we.getTime()) continue;
    const avail = (we.getTime() - from) / MIN;
    if (remaining <= avail) return new Date(from + remaining * MIN);
    remaining -= avail;
  }
  return new Date(start.getTime() + minutes * MIN); // calendario inválido: fallback
}

export function businessMinutesBetween(a: Date, b: Date, cal: CalendarLike | null): number {
  if (b <= a) return 0;
  if (!cal || cal.is24x7) return (b.getTime() - a.getTime()) / MIN;
  let total = 0;
  for (const [ws, we] of windows(a, cal)) {
    if (ws.getTime() >= b.getTime()) break;
    const s = Math.max(ws.getTime(), a.getTime());
    const e = Math.min(we.getTime(), b.getTime());
    if (e > s) total += (e - s) / MIN;
  }
  return total;
}

/** Estado visual de un SLA. */
export function slaState(dueAt: Date | null, doneAt: Date | null, breached: boolean, createdAt: Date, warnPercent = 75) {
  if (!dueAt) return { state: "none" as const, label: "Sin SLA" };
  if (doneAt) return doneAt <= dueAt && !breached ? { state: "met" as const, label: "Cumplido" } : { state: "breached" as const, label: "Incumplido" };
  const now = Date.now();
  if (breached || now > dueAt.getTime()) return { state: "breached" as const, label: "Vencido" };
  const total = dueAt.getTime() - createdAt.getTime();
  const used = now - createdAt.getTime();
  if (total > 0 && used / total >= warnPercent / 100) return { state: "warning" as const, label: "Por vencer" };
  return { state: "ok" as const, label: "En tiempo" };
}
