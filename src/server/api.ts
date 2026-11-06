import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./errors";
import { getSessionUser } from "./auth";

/** Envoltorio para route handlers REST: errores consistentes y sin filtrar detalles internos. */
export function api<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return async (...args: A) => {
    try {
      const req = args[0] instanceof Request ? args[0] : null;
      if (req && req.method !== "GET") {
        const u = await getSessionUser();
        if (u?.apiKeyScope === "read") throw new AppError("FORBIDDEN", "Esta clave de API es de solo lectura.");
      }
      const out = await fn(...args);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof AppError) return NextResponse.json({ error: e.message, code: e.code, fields: e.fields }, { status: e.status });
      if (e instanceof ZodError) return NextResponse.json({ error: "Datos inválidos", code: "VALIDATION", issues: e.issues }, { status: 422 });
      console.error("[api]", e);
      return NextResponse.json({ error: "Error interno", code: "INTERNAL" }, { status: 500 });
    }
  };
}
