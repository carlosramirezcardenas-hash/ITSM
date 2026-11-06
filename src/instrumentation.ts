/** Planificador interno: barrido de SLA cada minuto (servidor Node de larga duración). */
export async function register() {
  // En Vercel (serverless) no hay procesos de larga duración: se usa maybeRunSlaSweep() + cron diario.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL || process.env.DISABLE_SLA_SCHEDULER === "true") return;
  const g = globalThis as unknown as { __slaTimer?: NodeJS.Timeout };
  if (g.__slaTimer) return;
  const { runSlaSweep } = await import("./server/sla");
  const tick = async () => {
    try {
      const s = await runSlaSweep();
      if (s.warned + s.responseBreached + s.resolutionBreached + s.autoClosed > 0) console.info("[sla-sweep]", s);
    } catch (e) { console.error("[sla-sweep] error", e); }
  };
  g.__slaTimer = setInterval(tick, 60_000);
  setTimeout(tick, 5_000);
}
