import "server-only";
import { cookies } from "next/headers";
import { can } from "@/lib/rbac";
import type { Role } from "@prisma/client";

/**
 * Dos experiencias sobre la misma plataforma:
 * - "employee": portal del empleado (catálogo visual, asistente, mis solicitudes). Sin jerga ITIL.
 * - "ops": Operaciones TI (bandeja, problemas, cambios, CMDB, SLA, reportes, administración).
 * Quien no trabaja tickets siempre ve el portal; el equipo de TI puede alternar (se recuerda en una cookie).
 */
export const EXPERIENCE_COOKIE = "itsm_exp";
export type Experience = "employee" | "ops";

export function canUseOps(role: Role) {
  return can(role, "tickets:work");
}

export async function getExperience(role: Role): Promise<Experience> {
  if (!canUseOps(role)) return "employee";
  const v = (await cookies()).get(EXPERIENCE_COOKIE)?.value;
  return v === "employee" ? "employee" : "ops";
}
