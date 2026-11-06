/** Planificador interno (solo runtime Node, servidor de larga duración): barrido de SLA cada minuto. */
const g = globalThis as unknown as { __slaTimer?: NodeJS.Timeout };

// En Vercel (serverless) no hay procesos de larga duración: se usa maybeRunSlaSweep() + cron diario.
if (!process.env.VERCEL && process.env.DISABLE_SLA_SCHEDULER !== "true" && !g.__slaTimer) {
  const tick = async () => {
    try {
      const { runSlaSweep } = await import("./server/sla");
      const s = await runSlaSweep();
      if (s.warned + s.responseBreached + s.resolutionBreached + s.autoClosed > 0) console.info("[sla-sweep]", s);
    } catch (e) { console.error("[sla-sweep] error", e); }
  };
  g.__slaTimer = setInterval(tick, 60_000);
  setTimeout(tick, 5_000);
}
export {};
