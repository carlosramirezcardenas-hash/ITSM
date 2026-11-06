import type { Role } from "@prisma/client";

/**
 * RBAC — catálogo de permisos. La UI usa estas mismas funciones para ocultar
 * lo que no corresponde, pero la validación real ocurre siempre en el backend
 * (src/server/*) antes de cada lectura o escritura.
 */
export const PERMISSIONS = [
  "platform:manage",      // administrar organizaciones (SaaS)
  "org:manage",           // configuración de la organización
  "users:manage",
  "teams:manage",
  "catalog:manage",
  "sla:manage",
  "kb:manage",
  "audit:view",
  "reports:view",
  "tickets:work",         // ver la cola y trabajar tickets
  "tickets:viewAll",      // ver todos los tickets de la organización
  "tickets:assignAny",    // asignar a cualquier agente/equipo
  "tickets:create",
  "approvals:decide",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ["platform:manage", "audit:view"],
  ORG_ADMIN: [
    "org:manage", "users:manage", "teams:manage", "catalog:manage", "sla:manage", "kb:manage",
    "audit:view", "reports:view", "tickets:work", "tickets:viewAll", "tickets:assignAny",
    "tickets:create", "approvals:decide",
  ],
  SERVICE_MANAGER: [
    "teams:manage", "catalog:manage", "sla:manage", "kb:manage", "reports:view",
    "tickets:work", "tickets:viewAll", "tickets:assignAny", "tickets:create", "approvals:decide",
  ],
  AGENT: ["tickets:work", "tickets:viewAll", "tickets:create", "kb:manage"],
  APPROVER: ["tickets:create", "approvals:decide"],
  END_USER: ["tickets:create"],
};

export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMS[role]?.includes(perm) ?? false;
}

export function permissionsFor(role: Role): Permission[] {
  return ROLE_PERMS[role] ?? [];
}

export function isStaff(role: Role) {
  return can(role, "tickets:work");
}
