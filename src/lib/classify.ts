/**
 * Clasificación automática basada en reglas (palabras clave por categoría) y
 * heurísticas de impacto/urgencia. NO es IA: es la base determinista del MVP;
 * la clasificación con IA llegará en la Fase 3 y usará esta misma interfaz.
 */
export type Level = "LOW" | "MEDIUM" | "HIGH";
export type Priority = "P1" | "P2" | "P3" | "P4";

export const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Matriz ITIL de prioridad = impacto × urgencia. */
export function priorityMatrix(impact: Level, urgency: Level): Priority {
  const m: Record<Level, Record<Level, Priority>> = {
    HIGH: { HIGH: "P1", MEDIUM: "P2", LOW: "P3" },
    MEDIUM: { HIGH: "P2", MEDIUM: "P3", LOW: "P4" },
    LOW: { HIGH: "P3", MEDIUM: "P4", LOW: "P4" },
  };
  return m[impact][urgency];
}

export function classifyCategory<T extends { id: string; name: string; keywords: string[] }>(text: string, categories: T[]) {
  const t = ` ${normalize(text)} `;
  let best: { category: T; score: number; matched: string[] } | null = null;
  for (const c of categories) {
    const matched: string[] = [];
    let score = 0;
    for (const kw of c.keywords) {
      const k = normalize(kw).trim();
      if (!k) continue;
      if (t.includes(k)) {
        matched.push(kw);
        score += k.includes(" ") ? 3 : 2; // frases pesan más
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { category: c, score, matched };
  }
  return best;
}

const URGENT = ["no puedo trabajar", "urgente", "bloquead", "caid", "no funciona nada", "detenid", "critico", "inmediat", "no responde", "perdida de datos"];
const BROAD = ["todos", "toda la empresa", "todo el equipo", "nadie puede", "toda la oficina", "clientes", "produccion", "todo el piso", "varios usuarios"];

export function suggestLevels(text: string): { impact: Level | null; urgency: Level | null } {
  const t = normalize(text);
  return {
    impact: BROAD.some((k) => t.includes(k)) ? "HIGH" : null,
    urgency: URGENT.some((k) => t.includes(k)) ? "HIGH" : null,
  };
}

/** Similitud simple (Jaccard sobre palabras significativas) para detectar duplicados / sugerir artículos. */
const STOP = new Set("el la los las de del y o a en un una para por con no mi me se que es al lo su sus como mas pero esta este esto hay muy ya tengo puedo".split(" "));
export function tokens(s: string) {
  return new Set(normalize(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));
}
export function similarity(a: string, b: string) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
