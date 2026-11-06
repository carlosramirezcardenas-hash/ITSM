// Lenguaje sencillo: el usuario final nunca ve jerga ITIL.
export const STATUS_LABEL: Record<string, string> = {
  NEW: "Nuevo",
  ASSIGNED: "Asignado",
  IN_PROGRESS: "En progreso",
  PENDING: "Pendiente",
  RESOLVED: "Resuelto",
  CLOSED: "Cerrado",
};

// Cómo lo ve el usuario final
export const STATUS_USER_LABEL: Record<string, string> = {
  NEW: "Recibido",
  ASSIGNED: "Alguien lo está revisando",
  IN_PROGRESS: "Trabajando en ello",
  PENDING: "Esperando información",
  RESOLVED: "Solucionado",
  CLOSED: "Cerrado",
};

export const STATUS_TONE: Record<string, string> = {
  NEW: "blue",
  ASSIGNED: "violet",
  IN_PROGRESS: "amber",
  PENDING: "orange",
  RESOLVED: "green",
  CLOSED: "slate",
};

export const PRIORITY_LABEL: Record<string, string> = {
  P1: "Crítica",
  P2: "Alta",
  P3: "Media",
  P4: "Baja",
};
export const PRIORITY_TONE: Record<string, string> = { P1: "red", P2: "orange", P3: "amber", P4: "slate" };

export const LEVEL_LABEL: Record<string, string> = { LOW: "Bajo", MEDIUM: "Medio", HIGH: "Alto" };

export const IMPACT_USER_LABEL: Record<string, string> = {
  LOW: "Solo a mí",
  MEDIUM: "A mi equipo o área",
  HIGH: "A toda la empresa o clientes",
};
export const URGENCY_USER_LABEL: Record<string, string> = {
  LOW: "Puedo seguir trabajando",
  MEDIUM: "Me dificulta trabajar",
  HIGH: "No puedo trabajar",
};

export const TYPE_LABEL: Record<string, string> = { INCIDENT: "Incidente", REQUEST: "Solicitud" };
export const TYPE_USER_LABEL: Record<string, string> = { INCIDENT: "Problema reportado", REQUEST: "Solicitud" };

export const APPROVAL_LABEL: Record<string, string> = {
  NOT_REQUIRED: "No requiere",
  PENDING: "Esperando aprobación",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
};

export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Superadministrador SaaS",
  ORG_ADMIN: "Administrador",
  SERVICE_MANAGER: "Gestor de servicios",
  AGENT: "Agente de soporte",
  APPROVER: "Aprobador",
  END_USER: "Usuario",
};

export const PENDING_REASONS = [
  "Esperando respuesta del usuario",
  "Esperando proveedor",
  "Esperando aprobación",
  "Esperando repuesto o equipo",
  "Programado para otra fecha",
];
