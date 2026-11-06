/**
 * Motor de automatizaciones (lógica pura, probada). Una regla: «cuando <disparador>, si <condiciones>, entonces <acciones>».
 * Todas las condiciones deben cumplirse (AND). Las acciones las ejecuta src/server/automation.ts.
 */
import { normalize } from "./classify";

export const TRIGGERS = {
  "ticket.created": "Se crea un ticket",
  "ticket.reopened": "Se reabre un ticket",
  "sla.warning": "Un SLA está por vencer",
  "sla.breached": "Se vence un SLA de resolución",
} as const;
export type Trigger = keyof typeof TRIGGERS;

export const CONDITION_FIELDS = {
  type: { label: "Tipo", ops: ["eq", "neq"] },
  priority: { label: "Prioridad", ops: ["eq", "neq", "in"] },
  impact: { label: "Impacto", ops: ["eq", "neq"] },
  urgency: { label: "Urgencia", ops: ["eq", "neq"] },
  categoryId: { label: "Categoría", ops: ["eq", "neq"] },
  teamId: { label: "Equipo", ops: ["eq", "neq"] },
  channel: { label: "Canal", ops: ["eq", "neq"] },
  text: { label: "Título o descripción", ops: ["contains", "not_contains"] },
  requesterDepartment: { label: "Área del solicitante", ops: ["eq", "neq"] },
} as const;
export type ConditionField = keyof typeof CONDITION_FIELDS;
export type Op = "eq" | "neq" | "in" | "contains" | "not_contains";
export const OP_LABEL: Record<Op, string> = { eq: "es", neq: "no es", in: "es alguno de", contains: "contiene", not_contains: "no contiene" };

export const ACTIONS = {
  assign_team: "Derivar al equipo",
  assign_user: "Asignar a",
  set_priority: "Cambiar prioridad a",
  notify_users: "Notificar a",
  notify_managers: "Notificar a los gestores",
  add_note: "Agregar nota interna",
  escalate: "Escalar (subir nivel)",
} as const;
export type ActionType = keyof typeof ACTIONS;

export type Condition = { field: ConditionField; op: Op; value: string | string[] };
export type Action = { type: ActionType; value?: string | string[] };

export type TicketFacts = {
  type: string; priority: string; impact: string; urgency: string; categoryId: string | null; teamId: string | null;
  channel: string; title: string; description: string; requesterDepartment: string | null;
};

function factValue(f: TicketFacts, field: ConditionField): string {
  if (field === "text") return `${f.title} ${f.description}`;
  return (f[field] ?? "") as string;
}

export function matches(c: Condition, facts: TicketFacts): boolean {
  const actual = factValue(facts, c.field);
  const values = Array.isArray(c.value) ? c.value : [c.value];
  switch (c.op) {
    case "eq": return actual === values[0];
    case "neq": return actual !== values[0];
    case "in": return values.includes(actual);
    case "contains": return values.some((v) => v && normalize(actual).includes(normalize(v)));
    case "not_contains": return !values.some((v) => v && normalize(actual).includes(normalize(v)));
    default: return false;
  }
}

export function ruleMatches(conditions: Condition[], facts: TicketFacts) {
  return conditions.every((c) => matches(c, facts));
}

/** Validación estructural de una regla (el servidor además valida referencias a la organización). */
export function validateRule(conditions: unknown, actions: unknown): string | null {
  if (!Array.isArray(conditions) || !Array.isArray(actions)) return "Formato inválido.";
  if (!actions.length) return "Agrega al menos una acción.";
  if (actions.length > 10 || conditions.length > 10) return "Máximo 10 condiciones y 10 acciones.";
  for (const c of conditions as Condition[]) {
    const def = CONDITION_FIELDS[c?.field as ConditionField];
    if (!def) return "Condición con campo desconocido.";
    if (!(def.ops as readonly string[]).includes(c.op)) return `Operador no válido para «${def.label}».`;
    const vals = Array.isArray(c.value) ? c.value : [c.value];
    if (!vals.length || vals.some((v) => typeof v !== "string" || !v.trim())) return `Completa el valor de «${def.label}».`;
  }
  for (const a of actions as Action[]) {
    if (!(a?.type in ACTIONS)) return "Acción desconocida.";
    const needsValue = !["notify_managers", "escalate"].includes(a.type);
    if (needsValue && (!a.value || (Array.isArray(a.value) && !a.value.length))) return `Completa el valor de «${ACTIONS[a.type]}».`;
    if (a.type === "set_priority" && !["P1", "P2", "P3", "P4"].includes(a.value as string)) return "Prioridad inválida.";
  }
  return null;
}
