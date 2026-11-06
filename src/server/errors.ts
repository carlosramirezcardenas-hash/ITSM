export class AppError extends Error {
  constructor(public code: "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "RATE_LIMIT", message: string, public fields?: Record<string, string>) {
    super(message);
  }
  get status() {
    return { UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 422, CONFLICT: 409, RATE_LIMIT: 429 }[this.code];
  }
}

export const forbidden = (msg = "No tienes permiso para realizar esta acción.") => new AppError("FORBIDDEN", msg);
export const notFound = (msg = "No encontramos lo que buscas.") => new AppError("NOT_FOUND", msg);
export const invalid = (msg: string, fields?: Record<string, string>) => new AppError("VALIDATION", msg, fields);

export type ActionResult<T = unknown> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fields?: Record<string, string> };

import { ZodError } from "zod";

/** Convierte cualquier error en un resultado seguro para la UI (sin filtrar detalles internos). */
export function toActionError(e: unknown): { ok: false; error: string; fields?: Record<string, string> } {
  if (e instanceof AppError) return { ok: false, error: e.message, fields: e.fields };
  if (e instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of e.issues) fields[issue.path.join(".")] ??= issue.message;
    console.warn("[validation]", e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    return { ok: false, error: "Revisa los campos marcados.", fields };
  }
  if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
  console.error("[unexpected]", e);
  return { ok: false, error: "Ocurrió un error inesperado. Inténtalo nuevamente." };
}
