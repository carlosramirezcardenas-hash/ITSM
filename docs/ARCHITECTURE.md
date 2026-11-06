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

### Dos experiencias sobre la misma plataforma

| | **Portal del empleado** | **Operaciones TI** |
|---|---|---|
| Para | Usuarios finales y aprobadores (siempre); equipo de TI cuando lo elige | Agentes, gestores y administradores |
| Navegación | Barra superior: Inicio, Servicios, Mis solicitudes, Aprobaciones, Ayuda | Menú lateral: bandeja, problemas, cambios, CMDB, reportes, administración |
| Lenguaje | Sin ITIL: «algo no funciona», «quiero pedir algo», estados en palabras simples | Términos ITIL: incidente, SLA, prioridad, CAB, error conocido |
| Asistente | Botón flotante en todas las páginas + página `/assistant` | Ayudas de IA dentro del ticket (triage, resumen, respuesta) |

El equipo de TI alterna con el selector «Portal del empleado / Operaciones TI» (cookie `itsm_exp`, httpOnly).
La experiencia solo cambia la navegación y el inicio: **los permisos no cambian** (RBAC se valida siempre en el
servidor) y un usuario final no puede activar Operaciones aunque fuerce la cookie.

### Catálogo visual («tipo streaming»)
`/catalog` muestra un servicio destacado (el más pedido), filas desplazables «Pedir de nuevo» (lo que la persona ya
usó), «Popular en {empresa}» y una fila por categoría, con portada de color por categoría, tiempo estimado y si
requiere aprobación. La búsqueda y los filtros por categoría cambian a cuadrícula.

### Asistente conversacional (ITIL invisible)
La persona escribe con sus palabras; el asistente **propone** una de estas salidas: una guía del centro de ayuda,
el servicio del catálogo que corresponde, el estado de sus solicitudes o un reporte ya redactado (título, impacto y
urgencia deducidos). **Nunca crea nada por su cuenta**: el reporte se envía solo cuando la persona presiona
«Enviar reporte» (canal `chat`), con sus propios permisos.
- Con IA (`ANTHROPIC_API_KEY` y la IA activa en la organización): Claude con salida estructurada; los identificadores
  que devuelve se validan contra el catálogo, las guías y las solicitudes reales de la persona (lo inventado se descarta).
- Sin IA, o si la llamada falla: **modo básico** con reglas (raíces de palabras, palabras clave por categoría,
  catálogo y centro de ayuda). El chat indica en qué modo respondió.

### Aprendizaje del asistente (sin reentrenar modelos)
El asistente mejora con el uso de cada organización, de forma visible y reversible (Administración → Asistente y aprendizaje):

1. **Vocabulario aprendido** (`AssistantTerm`): cuando algo le sirve a una persona (👍, «Me sirvió» o abrir el servicio
   sugerido), las palabras nuevas de su consulta (raíces de 5 letras que no estaban en el destino y no son genéricas) se
   asocian a ese servicio, guía o solución. Un 👎 o «No me sirvió» resta. El impulso es (positivos − 2×negativos) × 0,5,
   acotado a [−0,6; 1]; las palabras que apuntan a 3 o más destinos se ignoran por genéricas.
   Ej.: si alguien pidió «compu» y eligió «Solicitar un notebook», la próxima persona que diga «compu» llega directo.
2. **Soluciones que funcionaron** (`LearnedSolution`): cada incidente resuelto con una solución de al menos 20
   caracteres se agrega como caso a la solución igual existente o crea una nueva. Se guarda solo el título y la solución,
   nunca quién lo pidió. Si el caso se reabre o recibe evaluación ≤ 2, deja de respaldarla; sin casos, se oculta sola.
   El asistente las ofrece como «Así se resolvió un caso parecido», con «Me sirvió / No me sirvió».
3. **Revisión humana**: el administrador ve métricas (resueltas sin ticket, derivadas al catálogo, 👍/👎), edita u oculta
   soluciones (queda «revisada» y no cambia sola), desactiva o borra palabras y ve las preguntas sin buena respuesta.
   Todo queda en auditoría.

4. **Lo que falta en el centro de ayuda** (`/help/gaps`, para quien gestiona guías): agrupa en temas, sin IA (raíces
   compartidas), lo que se preguntó al asistente sin buena respuesta (sin guía/solución/servicio, 👎 o terminó en
   reporte) y los incidentes de los últimos 30 días que ninguna guía publicada cubre. Ordena por personas afectadas.
   Por tema: «Redactar guía» (Claude, usando solo las soluciones reales; sin ellas deja los pasos por completar) o
   «Crear borrador» sin IA; siempre queda en **borrador** para que una persona lo revise y publique. Si ya existe una
   guía que la gente no encontró, «Agregar palabras a la guía» suma las palabras que usaron como etiquetas. Los temas
   se pueden descartar («No necesita guía») y desaparecen solos cuando se publica una guía que los cubre.

Las conversaciones se guardan recortadas (300 caracteres) y se borran a los 180 días. El aprendizaje corre al resolver
o reabrir cada ticket. Importar el historial anterior es una acción explícita del administrador («Aprender del historial»),
para revisar primero datos antiguos; el cron diario solo aplica la retención. Con IA, las soluciones aprendidas y el
ranking ajustado también se entregan a Claude, que solo puede citar ids existentes.

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
filtros y CSV, búsqueda global, notificaciones en tiempo real, auditoría, plataforma SaaS (crear/suspender organizaciones),
base de conocimientos.

### Fase 2 — ITSM avanzado ✅ implementada y probada
- **Gestión de problemas** (`/problems`): registro manual, desde un incidente o desde la detección automática de
  categorías con incidentes repetidos; vínculo con incidentes; análisis de causa raíz (5 porqués, Ishikawa, línea de
  tiempo); **errores conocidos** (exigen causa raíz y solución temporal); publicación de la solución temporal como
  artículo; plan de acción con responsables y fechas (no se cierra con acciones pendientes); resolución en bloque de los
  incidentes vinculados con aviso a cada usuario; cambios relacionados; bitácora.
  Estados: Nuevo → En análisis → Error conocido → Resuelto → Cerrado.
- **Gestión de cambios** (`/changes`): tipos estándar (preaprobado), normal (CAB) y emergencia (ECAB); evaluación de riesgo
  con cuestionario + servicios críticos afectados según la CMDB; impacto calculado; **aprobación multinivel**
  (CAB y, si el riesgo es alto, dirección); plan de implementación, de reversa y de pruebas (obligatorios para enviar);
  **calendario** mensual con **detección de conflictos** (misma ventana + mismo elemento); implementación con resultado
  (exitoso, parcial, fallido, revertido) y **revisión post-implementación** obligatoria. El plan queda congelado tras la aprobación.
  Estados: Borrador → Evaluación → Esperando CAB → Programado → En implementación → Revisión → Cerrado (o Rechazado/Cancelado).
- **CMDB simplificada** (`/cmdb`): equipos, servidores, aplicaciones, bases de datos, red, licencias (uso y vencimiento),
  servicios tecnológicos y proveedores; relaciones (depende de, se ejecuta en, usa, es provisto por, se conecta a);
  **análisis de impacto transitivo** («si esto falla, ¿qué servicios se afectan?», tolerante a ciclos); historial de
  tickets, problemas y cambios por elemento; alertas de vencimiento.
- **Integración con incidentes**: elemento afectado, problema vinculado, errores conocidos sugeridos al agente y
  solución temporal visible para el usuario; **relación conocimiento ↔ ticket** (artículos usados).
- **Aprobación multinivel en el catálogo**: segundo aprobador opcional por servicio (p. ej. jefatura → TI).
- **Reportes avanzados**: tasa de éxito de cambios, fallidos/revertidos, emergencias, cambios por tipo, problemas y
  errores conocidos, activos con más incidentes, MTTR y SLA por prioridad.

Permisos nuevos: `problems:manage` (agentes, gestores, admin), `changes:create` (ídem), `changes:approve` (CAB:
gestores y admin), `cmdb:view` (agentes) y `cmdb:manage` (gestores y admin). Lógica pura y probada en `src/lib/itsm.ts`.

### Fase 3 — Inteligencia y automatización ✅ implementada y probada
- **Asistente de IA (Claude, `claude-opus-5-5`)** — `src/server/ai.ts`, `src/server/ai-features.ts`:
  - *Clasificación y prioridad* de cada incidente nuevo (tras responder al usuario, con `after()`): sugiere categoría,
    impacto, urgencia y artículos con su justificación y confianza. Solo aplica sola la **categoría** (enrutamiento) si la
    regla de palabras clave no encontró ninguna y la confianza es ≥ 80 %; la prioridad siempre la confirma un agente
    («Aplicar sugerencia»).
  - *Resumen* de tickets largos, *respuesta sugerida* para el agente (borrador que se revisa antes de enviar, basado en
    la base de conocimientos y en la solución temporal del error conocido), *hipótesis de causa raíz* para problemas
    (usa incidentes, CMDB y cambios recientes), *análisis de tendencias* para gestores y *autoayuda* para usuarios en el
    portal (responde solo con lo que dicen los artículos).
  - Salidas estructuradas con esquema JSON, `effort` según la tarea (bajo para clasificar, alto para causa raíz),
    *fallback* del lado del servidor ante rechazos por política (`server-side-fallback-2026-07-01`, `fallbacks: "default"`),
    manejo de `refusal`/`max_tokens` y errores tipados del SDK, límite de uso por persona y registro de consumo
    (`AiUsage`) visible en Integraciones e IA. La organización puede desactivarla.
  - Privacidad: los campos sensibles (cifrados) nunca se envían; tendencias usa solo agregados; el texto de usuarios va
    delimitado como datos (mitiga *prompt injection*).
- **Automatizaciones** (`src/lib/automation.ts` + `src/server/automation.ts`): reglas «cuando… si… entonces…» con
  disparadores *ticket creado / reabierto / SLA por vencer / SLA vencido*, condiciones (tipo, prioridad, impacto, urgencia,
  categoría, equipo, canal, texto, área) y acciones (derivar a equipo con asignación por carga, asignar, cambiar prioridad
  recalculando el SLA, notificar, escalar, nota interna). Quedan registradas en la actividad del ticket; los cambios de
  una automatización no vuelven a disparar reglas.
- **Análisis predictivo** (`src/lib/predict.ts`, modelos explicables, no IA generativa): pronóstico de tickets a 7 días
  (estacionalidad semanal × tendencia de 14 días) comparado con la capacidad observada, y **riesgo de incumplir el SLA**
  (0-100) por ticket según tiempo consumido, responsable, carga y estado — en Reportes y en el inicio del agente.
- **Integraciones** (`src/server/integrations.ts`): Microsoft Teams (Adaptive Card), Slack y webhooks JSON firmados con
  HMAC-SHA256 (`x-itsm-signature`, `x-itsm-timestamp`) para eventos de tickets, SLA, cambios y errores conocidos; URLs
  cifradas en BD, protección SSRF (solo HTTPS a hosts públicos), botón de prueba e historial de entregas.
- **Claves de API** para la API REST: se guarda solo el hash, se muestran una vez, alcance *solo lectura* o *lectura y
  escritura*, vencimiento y revocación; actúan con los permisos de su creador y **solo** son válidas en `/api/v1`
  (el middleware marca esas rutas; no abren la interfaz ni las acciones del servidor).
- **Correo** (Resend, opcional): recuperación de contraseña y avisos que requieren acción (aprobaciones de solicitudes y
  cambios). Sin configurar, los avisos siguen llegando dentro de la app.

Pruebas: la IA se prueba de punta a punta contra `tests/mock-anthropic.ts`, que **valida cada petición** (modelo, beta
de fallback, salida estructurada estricta, sin parámetros retirados como `temperature` o `budget_tokens`, sin *prefill*)
y responde datos que cumplen el esquema. Las llamadas reales al modelo no se pudieron ejecutar en el entorno de
desarrollo (sin clave); se habilitan al definir `ANTHROPIC_API_KEY`.

### Experiencias diferenciadas ✅ implementadas y probadas
Portal del empleado vs. Operaciones TI, catálogo visual con filas por categoría y asistente conversacional con modo
básico sin IA, y aprendizaje del asistente (vocabulario, soluciones que funcionaron, revisión humana) (ver sección 4).
Pruebas: `npm run test:e2e:x` (21) y los pasos de asistente y borrador de guía con IA en `test:e2e:3`.

### Aún NO implementado
- Inicio de sesión único (SSO / Entra ID), creación de tickets desde correos entrantes, adjuntos de archivos,
  descubrimiento automático de la CMDB, aprobación de cambios desde Teams, congelamientos de cambios y CAB por mayoría.
