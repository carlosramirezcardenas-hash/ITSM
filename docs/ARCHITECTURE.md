# ITSM Easy — Diseño del producto y arquitectura

> «ITSM potente por dentro, extraordinariamente sencillo por fuera.»

Este documento cubre los seis entregables previos al desarrollo: arquitectura, modelo de datos,
roles y permisos, experiencia de usuario, flujos principales y riesgos técnicos. Al final está el
estado real de cada fase.

---

## 1. Arquitectura

```
                    ┌──────────────────────────── Next.js 15 (App Router, Node) ─────────────────────────────┐
 Navegador          │                                                                                         │
 (React 19,  ──────►│  middleware.ts       Primer filtro: sin cookie de sesión → /login (401 en /api)         │
  Tailwind 4)       │        │                                                                                │
                    │        ▼                                                                                │
                    │  Server Components (páginas)   Server Actions (app/actions.ts)   REST /api/v1/*         │
                    │        │                              │                               │                 │
                    │        └──────────────┬───────────────┴───────────────────────────────┘                 │
                    │                       ▼                                                                 │
                    │  Capa de dominio  src/server/*   ← única puerta a los datos                             │
                    │   auth.ts (sesión, Ctx de tenant, RBAC)   tickets.ts (incidentes, solicitudes,          │
                    │   aprobaciones, estados)   sla.ts (cálculo + barrido)   metrics.ts   admin.ts           │
                    │   notify.ts   audit.ts                                                                  │
                    │                       │                                                                 │
                    │  Lógica pura src/lib/*: sla-calc (tiempo hábil), classify (matriz ITIL, reglas),        │
                    │  rbac, crypto (AES-256-GCM)  → probada con tests unitarios                              │
                    │                       │                                                                 │
                    │  instrumentation.ts: planificador de SLA cada 60 s (o POST /api/cron/sla)               │
                    └───────────────────────┼─────────────────────────────────────────────────────────────────┘
                                            ▼
                                 PostgreSQL 16  (Prisma 6)
```

**Decisiones clave**

| Decisión | Motivo |
|---|---|
| Monolito modular en Next.js (UI + API en un despliegue) | Un MVP comercial necesita velocidad de entrega. Los módulos (`server/tickets`, `server/sla`, …) tienen fronteras claras y pueden extraerse a servicios cuando la carga lo justifique. |
| Capa de dominio única (`src/server`) usada por Server Actions **y** por la API REST | Las reglas de negocio, validaciones (zod) y permisos viven en un solo lugar: la UI y las integraciones no pueden divergir. |
| Multi-tenant con **BD compartida + columna `orgId`** | Mejor costo/operación para cientos de clientes pequeños y medianos. Toda función de dominio recibe un `Ctx { user, orgId }` derivado de la sesión, nunca del cliente. |
| Sesiones propias en BD (en lugar de Auth.js) | Equivalente funcional a Auth.js con *database sessions*, pero con control directo de: revocación por dispositivo, cierre por inactividad, bloqueo por intentos, y vínculo usuario→tenant. Se puede añadir SSO (Entra ID / Google) en Fase 3 sobre la misma tabla `Session`. |
| Tiempo real con **SSE** | Más simple que WebSockets para notificaciones unidireccionales y funciona a través de proxies HTTP. MVP: sondeo liviano a BD cada 4 s por conexión; para escalar → `LISTEN/NOTIFY` de Postgres o Redis Pub/Sub. |
| Clasificación basada en reglas, no IA | Determinista, auditable y gratis. La IA (Fase 3) usará la misma interfaz `suggestForText()`, y solo **sugiere**: nunca ejecuta acciones críticas. |
| Componentes UI propios estilo shadcn/ui | El CLI de shadcn requiere red a su registro; se escribieron componentes equivalentes (Tailwind + tokens CSS) sin dependencias de Radix. |

**Escalabilidad prevista**: servidor sin estado (sesiones en BD) → réplicas horizontales detrás de un balanceador;
el planificador de SLA se mueve a un único *worker* o cron (`/api/cron/sla` protegido con `CRON_SECRET`);
el limitador de intentos pasa de memoria a Redis; métricas pesadas → vistas materializadas.

---

## 2. Modelo de datos

Esquema completo en [`prisma/schema.prisma`](../prisma/schema.prisma).

```
Organization 1─* User ─* Session / PasswordResetToken
     │            ├─ manager (User)        ← aprobaciones "jefatura directa"
     │            └─* TeamMember *─1 Team
     ├─* Department
     ├─* Category (keywords[] → clasificación, team → enrutamiento)
     ├─* ServiceItem (formSchema JSON, requiresApproval, approvalMode, ownerTeam, owner)
     ├─* BusinessCalendar ─* Holiday
     ├─* SlaPolicy (por prioridad: respuesta, resolución, calendario, % alerta)
     ├─* Ticket (type INCIDENT|REQUEST, number por org)
     │      ├─* TicketComment (isInternal)
     │      ├─* TicketActivity (historial inmutable)
     │      └─* Approval
     ├─* KbArticle ─* KbFeedback
     ├─* Notification
     └─* AuditLog
```

Decisiones:
- **Un solo `Ticket`** para incidentes y solicitudes (mismo ciclo de vida, SLA y bandeja). `type` distingue reglas.
  Problemas y cambios (Fase 2) serán entidades propias relacionadas con `Ticket`.
- **Numeración por organización** (`INC-1042`, `REQ-1043`) con contador transaccional en `Organization.ticketSeq`.
- **SLA materializado** en el ticket (`responseDueAt`, `resolutionDueAt`, `slaPausedMinutes`, banderas de
  incumplimiento) → las consultas de bandeja y reportes no recalculan calendarios.
- **Campos sensibles** de formularios (`sensitive: true`) se guardan cifrados con AES-256-GCM (`enc:v1:…`).
- Índices en `(orgId, status)`, `(orgId, assigneeId)`, `(orgId, requesterId)`, `(orgId, createdAt)`.

---

## 3. Roles y permisos (RBAC)

Definidos en [`src/lib/rbac.ts`](../src/lib/rbac.ts). La UI oculta lo que no corresponde, **pero cada acción se
valida en el backend** (`getCtx(perm)`, `assertCan`), y cada consulta filtra por `orgId`.

| Permiso | Superadmin SaaS | Admin org. | Gestor | Agente | Aprobador | Usuario |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Administrar organizaciones (tenants) | ✔ | | | | | |
| Configuración de la organización | | ✔ | | | | |
| Usuarios y departamentos | | ✔ | | | | |
| Equipos | | ✔ | ✔ | | | |
| Catálogo y categorías | | ✔ | ✔ | | | |
| SLA, calendarios y feriados | | ✔ | ✔ | | | |
| Base de conocimientos (editar) | | ✔ | ✔ | ✔ | | |
| Reportes y dashboard ejecutivo | | ✔ | ✔ | | | |
| Auditoría | ✔ (plataforma) | ✔ | | | | |
| Trabajar tickets / ver todos | | ✔ | ✔ | ✔ | | |
| Asignar a cualquier equipo/agente | | ✔ | ✔ | (solo sus equipos) | | |
| Aprobar solicitudes | | ✔ | ✔ | | ✔ | |
| Crear solicitudes | | ✔ | ✔ | ✔ | ✔ | ✔ |

Reglas adicionales de visibilidad: el usuario final solo ve sus tickets; el aprobador ve además los que debe aprobar;
las **notas internas** nunca llegan al usuario (filtradas en la consulta). El superadministrador SaaS **no** puede leer
tickets de clientes.

---

## 4. Experiencia de usuario

Principios aplicados (sección 8 del brief):

- **Lenguaje sin ITIL** para el usuario final: «Tengo un problema», «Necesito acceso», «Quiero solicitar algo».
  Estados traducidos: *Recibido → Alguien lo está revisando → Trabajando en ello → Solucionado*.
  Impacto/urgencia se preguntan como «¿A quién afecta?» y «¿Cuánto te afecta?».
- **Un solo campo obligatorio** para reportar un problema. Mientras escribe, se sugieren artículos que podrían
  resolverlo (deflexión) y se muestra a qué equipo se enviará.
- **Navegación por rol**: el menú lateral solo muestra lo que el rol puede usar; el inicio cambia por rol
  (portal / «tu día de un vistazo» / panel ejecutivo).
- **Valores por defecto inteligentes**: categoría y equipo automáticos, prioridad por matriz, asignación por carga,
  aprobador = jefatura directa, SLA calculado, cierre automático de resueltos.
- **Pocos clics**: «Tomar ticket», aprobar en un clic, confirmar solución + evaluación en el mismo ticket.
- **Transparencia**: barra de progreso, historial de actividad, notificaciones en tiempo real.
- Diseño inspirado en Linear/Stripe: tipografía Inter, tokens de color, modo claro/oscuro (respeta el sistema),
  responsive (menú en cajón en móvil), foco visible, `aria-*` en controles, enlace «Saltar al contenido»,
  `prefers-reduced-motion`.

---

## 5. Flujos principales

**Incidente** (`server/tickets.ts › createIncident`)
1. Usuario describe el problema → clasificación por palabras clave → categoría → equipo.
2. Prioridad = matriz(impacto, urgencia); las pistas del texto solo pueden subirla.
3. SLA calculado con el calendario de la política → asignación al agente con menos carga → notificaciones
   (P1 notifica también a gestores).
4. Estados: `Nuevo → Asignado → En progreso ⇄ Pendiente → Resuelto → Cerrado` (máquina de estados validada en backend).
   *Pendiente* pausa el SLA; al reanudar se desplaza el vencimiento por el tiempo hábil en pausa.
   Si se esperaba al usuario y éste responde, el ticket vuelve solo a *En progreso*.
5. Escalamiento **funcional** (derivar a otro equipo, reasignación automática) y **jerárquico** (manual o automático
   al vencer el SLA: líderes de equipo y gestores).
6. Resolver exige describir la solución → el usuario confirma (cierra + CSAT) o reabre. Sin respuesta en 3 días → cierre automático.
   Reapertura permitida hasta 14 días después del cierre.

**Solicitud de servicio** (`createRequest`)
1. Formulario configurable del catálogo, validado en backend (obligatorios, opciones, tipos); campos sensibles cifrados.
2. Si requiere aprobación: aprobador = jefatura directa o persona fija (con respaldos). El ticket queda *Pendiente:
   Esperando aprobación* con SLA en pausa.
3. Aprobado → enrutamiento y asignación automática; rechazado → cerrado con motivo obligatorio visible para el solicitante.

**SLA** (`server/sla.ts › runSlaSweep`, cada minuto): alerta al alcanzar el % configurado, marca incumplimientos de
respuesta/resolución, escala y cierra resueltos antiguos.

---

## 6. Riesgos técnicos y mitigaciones

| Riesgo | Mitigación actual | Próximo paso |
|---|---|---|
| Fuga de datos entre tenants | `orgId` del contexto de sesión en **todas** las consultas; tests E2E de aislamiento (UI, API, búsqueda) | Row-Level Security de PostgreSQL como segunda barrera |
| Escalamiento de privilegios | RBAC en backend para cada acción; transiciones de estado validadas; tests 403 | Tests de permisos por endpoint en CI |
| Fuerza bruta / robo de sesión | bcrypt (12), bloqueo tras 5 fallos, limitador por IP y por correo, cookies `httpOnly`+`SameSite`, tokens con hash SHA-256, expiración por inactividad, revocación por dispositivo | MFA y SSO; limitador en Redis |
| Datos sensibles | AES-256-GCM por campo, clave fuera del código (`ENCRYPTION_KEY`) | KMS y rotación de claves |
| Exactitud de SLA (zonas horarias, feriados, pausas) | Motor de tiempo hábil puro con tests (DST, feriados, fines de semana) | Calendario por equipo/servicio |
| Planificador en múltiples réplicas | Guardia por proceso; endpoint cron alternativo | *Worker* único o bloqueo distribuido (`pg_advisory_lock`) |
| Rendimiento de reportes | Agregación en memoria sobre columnas SLA materializadas | SQL agregado / vistas materializadas |
| SSE con muchas conexiones | Sondeo liviano | `LISTEN/NOTIFY` o Redis Pub/Sub |
| Inyección de fórmulas en CSV | Escape de `= + - @` en la exportación | — |

---

## 7. Estado por fase

### Fase 1 — MVP ✅ implementada y probada
Autenticación (login, cierre de sesión, recuperación y cambio de contraseña, sesiones revocables), multi-tenancy,
usuarios/roles/departamentos/equipos, portal de autoservicio, incidentes, solicitudes con aprobaciones, catálogo
configurable, SLA (políticas, calendarios, feriados, pausas, alertas, escalamientos), dashboards por rol, reportes con
filtros y CSV, búsqueda global, notificaciones en tiempo real, auditoría, plataforma SaaS (crear/suspender organizaciones).

Adelantado de Fase 2 porque el portal lo requiere: **base de conocimientos** (CRUD, categorías, etiquetas, FAQ, pasos,
valoración, sugerencias al reportar) y **flujos de aprobación** de catálogo.

### Aún NO implementado (sin botones ni pantallas falsas)
- **Fase 2**: gestión de problemas, gestión de cambios (por eso «cambios exitosos/fallidos» aparece como no disponible
  en reportes), CMDB, relación artículo↔ticket explícita, aprobaciones multinivel.
- **Fase 3**: asistente IA (resúmenes, respuestas sugeridas, causa raíz), automatizaciones configurables por el usuario,
  análisis predictivo, correo electrónico (los enlaces de recuperación se muestran en pantalla solo en `DEMO_MODE`),
  Microsoft Teams, SSO, API keys para integraciones, adjuntos de archivos.
