import { test } from "node:test";
import assert from "node:assert/strict";
import { addBusinessMinutes, businessMinutesBetween, slaState, type CalendarLike } from "../src/lib/sla-calc";
import { classifyCategory, priorityMatrix, similarity, suggestLevels } from "../src/lib/classify";
import { can } from "../src/lib/rbac";
process.env.ENCRYPTION_KEY = "q0m2b9oWc6v5T1n0J3c7yQe8mX2kP4rS6tU8vW0xY2A=";
import { decrypt, encrypt, isEncrypted } from "../src/lib/crypto";

const office: CalendarLike = { timezone: "America/Santiago", workDays: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "18:00", is24x7: false, holidays: ["2026-12-25"] };
// Noviembre 2026: Chile en horario de verano (UTC-3)

test("SLA: dentro del mismo día hábil", () => {
  const start = new Date("2026-11-04T13:00:00Z"); // miércoles 10:00 local
  assert.equal(addBusinessMinutes(start, 120, office).toISOString(), "2026-11-04T15:00:00.000Z");
});

test("SLA: cruza el fin de la jornada al día siguiente", () => {
  const start = new Date("2026-11-04T20:00:00Z"); // miércoles 17:00 local, quedan 60 min
  assert.equal(addBusinessMinutes(start, 120, office).toISOString(), "2026-11-05T13:00:00.000Z"); // jueves 10:00
});

test("SLA: viernes en la tarde salta el fin de semana", () => {
  const start = new Date("2026-11-06T20:30:00Z"); // viernes 17:30 local
  assert.equal(addBusinessMinutes(start, 60, office).toISOString(), "2026-11-09T12:30:00.000Z"); // lunes 09:30
});

test("SLA: creado de noche comienza al inicio de la jornada", () => {
  const start = new Date("2026-11-05T02:00:00Z"); // miércoles 23:00 local
  assert.equal(addBusinessMinutes(start, 30, office).toISOString(), "2026-11-05T12:30:00.000Z");
});

test("SLA: respeta feriados", () => {
  const start = new Date("2026-12-24T20:00:00Z"); // jueves 24/12 17:00 local, 25/12 feriado
  assert.equal(addBusinessMinutes(start, 120, office).toISOString(), "2026-12-28T13:00:00.000Z"); // lunes 28, 10:00
});

test("SLA: 24x7 suma tiempo corrido", () => {
  const start = new Date("2026-11-07T03:00:00Z");
  assert.equal(addBusinessMinutes(start, 240, null).toISOString(), "2026-11-07T07:00:00.000Z");
});

test("SLA: minutos hábiles entre dos fechas (pausas)", () => {
  const a = new Date("2026-11-06T20:00:00Z"); // viernes 17:00
  const b = new Date("2026-11-09T13:00:00Z"); // lunes 10:00
  assert.equal(businessMinutesBetween(a, b, office), 120);
});

test("SLA: estados visuales", () => {
  const created = new Date(Date.now() - 80 * 60000);
  assert.equal(slaState(new Date(Date.now() + 20 * 60000), null, false, created).state, "warning");
  assert.equal(slaState(new Date(Date.now() - 1000), null, false, created).state, "breached");
  assert.equal(slaState(new Date(Date.now() + 1000), new Date(), false, created).state, "met");
});

test("Prioridad: matriz ITIL impacto × urgencia", () => {
  assert.equal(priorityMatrix("HIGH", "HIGH"), "P1");
  assert.equal(priorityMatrix("HIGH", "LOW"), "P3");
  assert.equal(priorityMatrix("MEDIUM", "HIGH"), "P2");
  assert.equal(priorityMatrix("LOW", "LOW"), "P4");
});

test("Clasificación automática por palabras clave (sin tildes)", () => {
  const cats = [
    { id: "net", name: "Red", keywords: ["vpn", "internet", "wifi"] },
    { id: "acc", name: "Accesos", keywords: ["contraseña", "bloqueado", "iniciar sesion"] },
  ];
  assert.equal(classifyCategory("No puedo INICIAR SESIÓN, dice usuario bloqueado", cats)?.category.id, "acc");
  assert.equal(classifyCategory("La VPN no conecta", cats)?.category.id, "net");
  assert.equal(classifyCategory("hola", cats), null);
});

test("Sugerencia de niveles por texto", () => {
  assert.deepEqual(suggestLevels("Urgente: toda la empresa sin correo"), { impact: "HIGH", urgency: "HIGH" });
  assert.deepEqual(suggestLevels("excel lento"), { impact: null, urgency: null });
});

test("Similitud de textos", () => {
  assert.ok(similarity("No funciona la VPN desde casa", "VPN no funciona en casa") > 0.4);
  assert.ok(similarity("impresora atascada", "outlook no abre") === 0);
});

test("RBAC: permisos por rol", () => {
  assert.ok(can("ORG_ADMIN", "users:manage"));
  assert.ok(!can("AGENT", "users:manage"));
  assert.ok(can("AGENT", "tickets:work"));
  assert.ok(!can("END_USER", "tickets:work"));
  assert.ok(can("APPROVER", "approvals:decide"));
  assert.ok(!can("SUPER_ADMIN", "tickets:viewAll"), "el superadmin SaaS no lee tickets de clientes");
});

test("Cifrado AES-256-GCM de campos sensibles", () => {
  const c = encrypt("17.654.321-K");
  assert.ok(isEncrypted(c));
  assert.notEqual(c, encrypt("17.654.321-K"), "IV aleatorio");
  assert.equal(decrypt(c), "17.654.321-K");
  const tampered = c.slice(0, -4) + (c.endsWith("A") ? "BBBB" : "AAAA");
  assert.throws(() => decrypt(tampered));
});

// ===================== Fase 2 =====================
import { approvalLevels, assessRisk, CHANGE_FLOW, dependenciesOf, findConflicts, impactedBy, impactFromServices } from "../src/lib/itsm";

test("Riesgo de cambio: cuestionario + servicios críticos", () => {
  assert.equal(assessRisk({}).risk, "LOW");
  assert.equal(assessRisk({ downtime: true, businessHours: true }).risk, "MEDIUM");
  assert.equal(assessRisk({ production: true, untested: true, noRollback: true }).risk, "HIGH");
  assert.equal(assessRisk({ downtime: true }, 1).risk, "MEDIUM");
  assert.equal(assessRisk({ downtime: true, vendor: true }, 2).risk, "HIGH");
});

test("Niveles de aprobación CAB", () => {
  assert.equal(approvalLevels("STANDARD", "HIGH"), 0);
  assert.equal(approvalLevels("EMERGENCY", "HIGH"), 1);
  assert.equal(approvalLevels("NORMAL", "MEDIUM"), 1);
  assert.equal(approvalLevels("NORMAL", "HIGH"), 2);
  assert.ok(!CHANGE_FLOW.DRAFT!.includes("IN_PROGRESS"), "no se implementa sin pasar por evaluación");
});

test("CMDB: impacto transitivo y tolerancia a ciclos", () => {
  // app RUNS_ON srv; servicio DEPENDS_ON app; srv DEPENDS_ON san; ciclo san→servicio
  const edges = [
    { sourceId: "app", targetId: "srv" },
    { sourceId: "svc", targetId: "app" },
    { sourceId: "srv", targetId: "san" },
    { sourceId: "san", targetId: "svc" },
  ];
  const hit = impactedBy("srv", edges);
  assert.deepEqual(hit.map((h) => h.id).sort(), ["app", "san", "svc"]);
  assert.equal(hit.find((h) => h.id === "svc")!.depth, 2);
  assert.deepEqual(dependenciesOf("app", edges).map((d) => d.id).sort(), ["san", "srv", "svc"]);
  assert.equal(impactFromServices([{ criticality: "LOW" }]), "LOW");
  assert.equal(impactFromServices([{ criticality: "HIGH" }]), "HIGH");
});

test("Calendario: conflicto solo si se superponen y comparten CI", () => {
  const d = (h: number) => new Date(Date.UTC(2026, 10, 10, h));
  const a = { id: "a", start: d(1), end: d(3), ciIds: ["db"] };
  assert.equal(findConflicts(a, [{ id: "b", start: d(2), end: d(4), ciIds: ["db", "x"] }]).length, 1);
  assert.equal(findConflicts(a, [{ id: "c", start: d(2), end: d(4), ciIds: ["x"] }]).length, 0);
  assert.equal(findConflicts(a, [{ id: "e", start: d(3), end: d(5), ciIds: ["db"] }]).length, 0, "ventanas contiguas no chocan");
});
