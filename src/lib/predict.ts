/**
 * Análisis predictivo (modelos simples, explicables y probados; no son IA generativa).
 */

/** Pronóstico diario con estacionalidad semanal y tendencia reciente. */
export function forecastDaily(history: { date: string; count: number }[], days = 7, today = new Date()) {
  // history: un registro por día (YYYY-MM-DD), idealmente ≥ 28 días
  const byDate = new Map(history.map((h) => [h.date, h.count]));
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const back = (n: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - n));
  const sum = (from: number, to: number) => { let s = 0; for (let i = from; i < to; i++) s += byDate.get(dayKey(back(i))) ?? 0; return s; };
  const recent = sum(1, 15), previous = sum(15, 29);
  const trend = previous > 0 ? Math.min(1.3, Math.max(0.7, recent / previous)) : 1;
  const out: { date: string; weekday: number; expected: number; low: number; high: number }[] = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + i));
    const samples: number[] = [];
    for (let w = 1; w <= 4; w++) {
      const past = new Date(d.getTime() - w * 7 * 86400_000);
      if (past < today) samples.push(byDate.get(dayKey(past)) ?? 0);
    }
    const mean = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
    const sd = samples.length > 1 ? Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (samples.length - 1)) : mean * 0.5;
    const expected = mean * trend;
    out.push({ date: dayKey(d), weekday: d.getUTCDay(), expected: Math.round(expected * 10) / 10, low: Math.max(0, Math.round((expected - sd) * 10) / 10), high: Math.round((expected + sd) * 10) / 10 });
  }
  return { trend, forecast: out };
}

export type RiskInput = {
  createdAt: Date; resolutionDueAt: Date | null; slaPausedAt: Date | null; status: string; priority: string;
  assigneeId: string | null; assigneeOpenLoad: number; reopenCount: number;
};

/** Riesgo (0-100) de que un ticket abierto incumpla su SLA de resolución. */
export function breachRisk(t: RiskInput, now = new Date()) {
  const reasons: string[] = [];
  if (!t.resolutionDueAt) return { score: 0, level: "none" as const, reasons };
  if (t.slaPausedAt) return { score: 0, level: "paused" as const, reasons: ["SLA en pausa"] };
  const total = t.resolutionDueAt.getTime() - t.createdAt.getTime();
  const used = now.getTime() - t.createdAt.getTime();
  if (now >= t.resolutionDueAt) return { score: 100, level: "breached" as const, reasons: ["SLA vencido"] };
  const frac = total > 0 ? Math.max(0, Math.min(1, used / total)) : 1;
  let score = frac * 65;
  if (frac > 0.5) reasons.push(`${Math.round(frac * 100)}% del tiempo consumido`);
  if (!t.assigneeId) { score += 15; reasons.push("sin responsable"); }
  if (t.status === "NEW") { score += 8; reasons.push("aún sin atender"); }
  if (t.assigneeOpenLoad >= 8) { score += 10; reasons.push(`responsable con ${t.assigneeOpenLoad} tickets abiertos`); }
  if (t.reopenCount > 0) { score += 5; reasons.push("reabierto antes"); }
  if (t.priority === "P1") score += 5;
  score = Math.round(Math.min(99, score));
  return { score, level: score >= 70 ? ("high" as const) : score >= 40 ? ("medium" as const) : ("low" as const), reasons };
}
