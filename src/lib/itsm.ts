/**
 * Lógica pura de Fase 2: evaluación de riesgo de cambios, análisis de impacto (CMDB),
 * conflictos de calendario y máquinas de estado. Sin dependencias de BD → probada con tests.
 */
export type Level = "LOW" | "MEDIUM" | "HIGH";

// ------------------------------------------------------------ Riesgo de cambios
export const RISK_QUESTIONS = [
  { key: "production", label: "¿Afecta sistemas en producción usados por clientes o toda la empresa?", weight: 3 },
  { key: "downtime", label: "¿Requiere interrumpir el servicio?", weight: 2 },
  { key: "untested", label: "¿Es la primera vez que se hace o no se probó en un ambiente de pruebas?", weight: 3 },
  { key: "noRollback", label: "¿Sería difícil o lento volver atrás si falla?", weight: 3 },
  { key: "vendor", label: "¿Depende de un proveedor externo para ejecutarse?", weight: 1 },
  { key: "businessHours", label: "¿Se ejecutará en horario laboral?", weight: 1 },
] as const;
export type RiskAnswers = Partial<Record<(typeof RISK_QUESTIONS)[number]["key"], boolean>>;

/** Puntaje 0-13 → riesgo. El impacto de la CMDB (servicios críticos afectados) puede elevarlo. */
export function assessRisk(answers: RiskAnswers, affectedCriticalServices = 0): { score: number; risk: Level } {
  let score = 0;
  for (const q of RISK_QUESTIONS) if (answers[q.key]) score += q.weight;
  score += Math.min(affectedCriticalServices, 2) * 2;
  const risk: Level = score >= 7 ? "HIGH" : score >= 3 ? "MEDIUM" : "LOW";
  return { score, risk };
}

export function impactFromServices(services: { criticality: Level }[]): Level {
  if (services.some((s) => s.criticality === "HIGH")) return "HIGH";
  if (services.length >= 2 || services.some((s) => s.criticality === "MEDIUM")) return "MEDIUM";
  return "LOW";
}

/** Niveles de aprobación requeridos según tipo y riesgo. */
export function approvalLevels(type: "STANDARD" | "NORMAL" | "EMERGENCY", risk: Level): number {
  if (type === "STANDARD") return 0;          // preaprobado
  if (type === "EMERGENCY") return 1;         // ECAB: un gestor
  return risk === "HIGH" ? 2 : 1;             // CAB, y dirección si el riesgo es alto
}

// ------------------------------------------------------------ CMDB: análisis de impacto
export type Edge = { sourceId: string; targetId: string };

/** Todo lo que depende (directa o transitivamente) de `rootId`: si rootId falla, esto se ve afectado. */
export function impactedBy(rootId: string, edges: Edge[]): { id: string; depth: number; via: string }[] {
  const dependents = new Map<string, string[]>();
  for (const e of edges) dependents.set(e.targetId, [...(dependents.get(e.targetId) ?? []), e.sourceId]);
  const out: { id: string; depth: number; via: string }[] = [];
  const seen = new Set([rootId]);
  let frontier = [{ id: rootId, depth: 0 }];
  while (frontier.length) {
    const next: typeof frontier = [];
    for (const f of frontier) for (const d of dependents.get(f.id) ?? []) {
      if (seen.has(d)) continue; // tolera ciclos
      seen.add(d);
      out.push({ id: d, depth: f.depth + 1, via: f.id });
      next.push({ id: d, depth: f.depth + 1 });
    }
    frontier = next;
  }
  return out;
}

/** De qué depende `rootId` (transitivamente). */
export function dependenciesOf(rootId: string, edges: Edge[]) {
  return impactedBy(rootId, edges.map((e) => ({ sourceId: e.targetId, targetId: e.sourceId })));
}

// ------------------------------------------------------------ Calendario de cambios
export type Window = { id: string; start: Date; end: Date; ciIds: string[] };

/** Cambios que se superponen en el tiempo Y comparten al menos un elemento de configuración. */
export function findConflicts(target: Window, others: Window[]) {
  return others.filter((o) =>
    o.id !== target.id &&
    o.start < target.end && target.start < o.end &&
    o.ciIds.some((c) => target.ciIds.includes(c)),
  );
}

// ------------------------------------------------------------ Máquinas de estado
export const PROBLEM_FLOW: Record<string, string[]> = {
  NEW: ["INVESTIGATING", "CLOSED"],
  INVESTIGATING: ["KNOWN_ERROR", "RESOLVED", "CLOSED"],
  KNOWN_ERROR: ["INVESTIGATING", "RESOLVED"],
  RESOLVED: ["CLOSED", "INVESTIGATING"],
  CLOSED: [],
};

export const CHANGE_FLOW: Record<string, string[]> = {
  DRAFT: ["ASSESSMENT", "CANCELLED"],
  ASSESSMENT: ["PENDING_APPROVAL", "SCHEDULED", "DRAFT", "CANCELLED"], // SCHEDULED solo para estándar
  PENDING_APPROVAL: ["SCHEDULED", "REJECTED", "CANCELLED"],             // decide el CAB
  SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["REVIEW"],
  REVIEW: ["CLOSED"],
  CLOSED: [],
  REJECTED: ["DRAFT"],
  CANCELLED: [],
};
