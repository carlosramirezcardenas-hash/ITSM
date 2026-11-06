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

// ---------------- Fase 2
export const PROBLEM_STATUS_LABEL: Record<string, string> = {
  NEW: "Nuevo", INVESTIGATING: "En análisis", KNOWN_ERROR: "Error conocido", RESOLVED: "Resuelto", CLOSED: "Cerrado",
};
export const PROBLEM_STATUS_TONE: Record<string, string> = { NEW: "blue", INVESTIGATING: "amber", KNOWN_ERROR: "orange", RESOLVED: "green", CLOSED: "slate" };
export const RCA_LABEL: Record<string, string> = { five_whys: "5 porqués", ishikawa: "Diagrama de Ishikawa", timeline: "Línea de tiempo", other: "Otro" };

export const CHANGE_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador", ASSESSMENT: "En evaluación", PENDING_APPROVAL: "Esperando CAB", SCHEDULED: "Programado",
  IN_PROGRESS: "En implementación", REVIEW: "Revisión post-implementación", CLOSED: "Cerrado", REJECTED: "Rechazado", CANCELLED: "Cancelado",
};
export const CHANGE_STATUS_TONE: Record<string, string> = {
  DRAFT: "slate", ASSESSMENT: "blue", PENDING_APPROVAL: "orange", SCHEDULED: "violet", IN_PROGRESS: "amber", REVIEW: "blue", CLOSED: "green", REJECTED: "red", CANCELLED: "slate",
};
export const CHANGE_TYPE_LABEL: Record<string, string> = { STANDARD: "Estándar", NORMAL: "Normal", EMERGENCY: "Emergencia" };
export const CHANGE_TYPE_HINT: Record<string, string> = {
  STANDARD: "Preaprobado, de bajo riesgo y repetible (p. ej. instalar parches mensuales).",
  NORMAL: "Requiere evaluación y aprobación del CAB.",
  EMERGENCY: "Para restaurar un servicio crítico: aprobación acelerada.",
};
export const CHANGE_TYPE_TONE: Record<string, string> = { STANDARD: "green", NORMAL: "blue", EMERGENCY: "red" };
export const OUTCOME_LABEL: Record<string, string> = { SUCCESSFUL: "Exitoso", PARTIAL: "Parcial", FAILED: "Fallido", ROLLED_BACK: "Revertido" };
export const OUTCOME_TONE: Record<string, string> = { SUCCESSFUL: "green", PARTIAL: "amber", FAILED: "red", ROLLED_BACK: "orange" };
export const RISK_TONE: Record<string, string> = { LOW: "green", MEDIUM: "amber", HIGH: "red" };

export const CI_TYPE_LABEL: Record<string, string> = {
  HARDWARE: "Equipo", SERVER: "Servidor", APPLICATION: "Aplicación", DATABASE: "Base de datos", NETWORK: "Red",
  LICENSE: "Licencia", SERVICE: "Servicio tecnológico", VENDOR: "Proveedor",
};
export const CI_TYPE_PLURAL: Record<string, string> = {
  HARDWARE: "Equipos", SERVER: "Servidores", APPLICATION: "Aplicaciones", DATABASE: "Bases de datos", NETWORK: "Red",
  LICENSE: "Licencias", SERVICE: "Servicios", VENDOR: "Proveedores",
};
export const CI_STATUS_LABEL: Record<string, string> = { ACTIVE: "Activo", MAINTENANCE: "En mantención", RETIRED: "Retirado" };
export const REL_LABEL: Record<string, string> = {
  DEPENDS_ON: "depende de", RUNS_ON: "se ejecuta en", USES: "usa", SUPPLIED_BY: "es provisto por", CONNECTS_TO: "se conecta a",
};
