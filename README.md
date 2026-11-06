# ITSM Easy

**La gestión de servicios TI, simplificada.** Plataforma SaaS multi-empresa de ITSM basada en ITIL 4, con un portal
que cualquier empleado usa sin capacitación y herramientas operativas completas para el equipo de TI.

Diseño, modelo de datos, permisos, flujos, riesgos y roadmap: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Stack
Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL 16 · Prisma 6 · zod · Recharts.

## Puesta en marcha

Requisitos: Node 20+ y PostgreSQL 14+.

```bash
cp .env.example .env          # ajusta DATABASE_URL; genera ENCRYPTION_KEY con: openssl rand -base64 32
npm install
npx prisma migrate deploy     # crea las tablas
npm run db:seed               # organización demo con datos realistas
npm run build && npm start    # http://localhost:3000   (o: npm run dev)
```

## Cuentas de demostración
Contraseña para todas: `Demo12345!` (la pantalla de inicio de sesión tiene accesos con un clic en `DEMO_MODE`).

| Rol | Correo | Qué ver |
|---|---|---|
| Usuario final | `ana@andes.demo` | Portal, crear solicitud, seguimiento, confirmar y evaluar |
| Agente | `camila@andes.demo` | «Tu día», bandeja, SLA en riesgo, notas internas |
| Aprobadora | `patricia@andes.demo` | Aprobaciones pendientes |
| Gestor de servicios | `gestor@andes.demo` | Panel ejecutivo, reportes, catálogo, SLA |
| Administradora | `admin@andes.demo` | Usuarios, equipos, auditoría, organización |
| Superadmin SaaS | `root@itsmeasy.app` | Organizaciones (tenants) |
| Otra empresa | `admin@globex.demo` | Comprueba el aislamiento de datos |

La organización **Andes Logística** incluye 4 equipos de agentes, 8 servicios de catálogo (con aprobaciones y un campo
cifrado), 7 categorías con clasificación automática, SLA por prioridad con calendario laboral chileno y feriados 2026,
~116 tickets de 60 días con historial, comentarios, evaluaciones y 10 artículos de ayuda.

## Pruebas
```bash
npm test               # unitarias: motor SLA (zonas horarias, feriados, pausas), matriz de prioridad, clasificación, RBAC, cifrado
npm run test:e2e       # funcionales con Playwright contra el servidor en marcha (resiembra antes: npm run db:seed)
```
La suite E2E cubre de punta a punta: reporte de incidente con sugerencias, solicitud con aprobación, validaciones,
RBAC en UI y API, aprobación, tomar/escalar/resolver, transición inválida, reportes y CSV, confirmación con CSAT,
notas internas ocultas, búsqueda global, **aislamiento entre organizaciones**, administración, superadmin,
modo oscuro, móvil sin scroll horizontal y ausencia de errores JS.

## API REST (sesión por cookie)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/v1/tickets?view=&status=&type=&priority=&q=&page=` | Lista con visibilidad por rol |
| POST | `/api/v1/tickets` | `{type:"INCIDENT", title, description, impact, urgency}` o `{type:"REQUEST", serviceItemId, answers}` |
| GET / PATCH | `/api/v1/tickets/:id` | Detalle / actualizar estado, asignación, impacto, urgencia, categoría |
| POST | `/api/v1/tickets/:id/comments` | `{body, isInternal}` |
| GET | `/api/v1/catalog` | Servicios activos |
| GET | `/api/v1/metrics?from=&to=&teamId=&categoryId=&assigneeId=&type=` | Indicadores |
| GET | `/api/v1/reports/export` | CSV |
| GET | `/api/v1/search?q=` | Búsqueda global |
| GET | `/api/v1/notifications` · `/api/v1/notifications/stream` (SSE) | Notificaciones |
| POST | `/api/cron/sla` | Barrido de SLA (`Authorization: Bearer $CRON_SECRET`) |
| GET | `/api/health` | Salud |

Errores: `{ error, code, fields? }` con 401/403/404/422/429.

## Estructura
```
prisma/            schema, migraciones, seed
src/lib/           lógica pura y probada: sla-calc, classify, rbac, crypto, labels
src/server/        dominio: auth, tickets, sla, metrics, admin, notify, audit, api
src/app/(auth)/    login, recuperación de contraseña
src/app/(app)/     portal, tickets, bandeja, aprobaciones, catálogo, ayuda, reportes, admin, plataforma
src/app/api/       REST v1, SSE, cron
src/components/    sistema de diseño (ui, modal, toast, gráficos, búsqueda, notificaciones)
tests/             unitarias y E2E
```
