/**
 * Pruebas E2E Fase 2: problemas, cambios (CAB multinivel), CMDB, aprobación multinivel de catálogo,
 * relación conocimiento↔tickets, reportes y aislamiento. Requiere servidor en marcha y `npm run db:seed`.
 */
import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR;
let browser: Browser;
const results: { name: string; ok: boolean }[] = [];
const consoleErrors: string[] = [];

async function session(email: string, opts: { dark?: boolean; mobile?: boolean } = {}) {
  const ctx = await browser.newContext({ baseURL: BASE, timezoneId: "America/Santiago", viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, colorScheme: opts.dark ? "dark" : "light" });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("EventSource") && !m.text().includes("status of 404")) consoleErrors.push(`${email} ${page.url()}: ${m.text()}`); });
  page.on("pageerror", (e) => consoleErrors.push(`${email} ${page.url()}: ${e.message}`));
  await page.goto("/login");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill("Demo12345!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await page.waitForURL(/\/(home|platform)/);
  return page;
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ✔ ${name}`); }
  catch (e) { results.push({ name, ok: false }); console.log(`  ✘ ${name}\n    ${(e as Error).message.split("\n").slice(0, 4).join("\n    ")}`); }
}
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
const toast = (p: Page, text: string | RegExp) => p.getByRole("status").filter({ hasText: text }).first().waitFor({ timeout: 10000 });
const localInput = (daysAhead: number, hour: number) => {
  const d = new Date(Date.now() + daysAhead * 86400_000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return `${parts}T${String(hour).padStart(2, "0")}:00`;
};

async function main() {
  browser = await chromium.launch();
  let incidentUrl = "", problemUrl = "", changeUrl = "", requestUrl = "";

  console.log("Conocimiento ↔ incidentes ↔ errores conocidos");
  const ana = await session("ana@andes.demo");
  await step("Ana reporta un problema de Outlook", async () => {
    await ana.goto("/new/issue");
    await ana.getByLabel("¿Qué está pasando?").fill("Outlook se queda cargando el perfil");
    await ana.getByRole("button", { name: "Enviar reporte" }).click();
    await ana.getByRole("link", { name: "Ver seguimiento" }).click();
    await ana.waitForURL(/\/tickets\//);
    incidentUrl = new URL(ana.url()).pathname;
  });
  const cam = await session("camila@andes.demo");
  await step("Agente ve el error conocido sugerido, vincula problema, CI y artículo", async () => {
    await cam.goto(incidentUrl);
    await cam.getByText("Errores conocidos relacionados").waitFor();
    await shot(cam, "p2-01-error-conocido-sugerido");
    await cam.getByRole("button", { name: "Vincular a este problema" }).click();
    await toast(cam, "Cambios guardados.");
    await cam.getByRole("link", { name: /PRB-101/ }).first().waitFor();
    await cam.getByLabel("Elemento afectado").selectOption({ label: "Microsoft 365 · Aplicación" });
    await toast(cam, "Cambios guardados.");
    await cam.getByLabel("Vincular artículo").selectOption({ label: "Configurar el correo corporativo en tu celular" });
    await toast(cam, "Artículo vinculado.");
    await cam.getByText(/vinculó el artículo/).waitFor();
  });
  await step("Usuario ve la solución temporal del error conocido en su ticket", async () => {
    await ana.goto(incidentUrl);
    await ana.getByText("Mientras lo solucionamos, puedes probar esto:").waitFor();
    await shot(ana, "p2-02-usuario-workaround");
  });

  console.log("Gestión de problemas");
  const mgr = await session("gestor@andes.demo");
  await step("Lista de problemas con candidatos detectados", async () => {
    await mgr.goto("/problems");
    await mgr.getByRole("heading", { name: "Gestión de problemas" }).waitFor();
    await mgr.getByText("Outlook se cuelga al abrir perfiles de correo grandes").waitFor();
    await shot(mgr, "p2-03-problemas");
  });
  await step("Publicar solución temporal en el centro de ayuda y resolver incidentes en bloque", async () => {
    await mgr.getByText("Outlook se cuelga al abrir perfiles de correo grandes").click();
    await mgr.waitForURL(/\/problems\//);
    await mgr.getByRole("button", { name: "Publicar solución temporal" }).click();
    await toast(mgr, /publicada en el centro de ayuda/);
    await mgr.getByRole("link", { name: /Solución temporal: Outlook/ }).waitFor();
    await mgr.getByRole("button", { name: /Resolver \d+ incidente/ }).click();
    await toast(mgr, /Incidentes resueltos/);
    await shot(mgr, "p2-04-detalle-problema");
    const r = await mgr.request.get("/api/v1/search?q=Soluci%C3%B3n%20temporal");
    assert.ok(JSON.stringify(await r.json()).includes("Outlook"));
  });
  await step("Crear problema desde incidente y recorrer su ciclo con validaciones", async () => {
    await mgr.goto("/queue?view=all&status=any&q=impresora");
    await mgr.getByRole("link", { name: /impresora/i }).first().click();
    await mgr.waitForURL(/\/tickets\//);
    await mgr.getByRole("link", { name: "+ Crear problema desde este incidente" }).click();
    await mgr.waitForURL(/\/problems\/new/);
    await mgr.getByLabel("Título").fill("Impresoras HP muestran atascos falsos");
    await mgr.getByRole("button", { name: "Registrar problema" }).click();
    await mgr.waitForURL(/\/problems\/c/);
    problemUrl = new URL(mgr.url()).pathname;
    await mgr.getByRole("button", { name: "Iniciar análisis" }).click();
    await toast(mgr, "Problema actualizado.");
    await mgr.getByRole("button", { name: "Registrar error conocido" }).click();
    await toast(mgr, /documenta la causa raíz/);
    await mgr.getByLabel("Causa raíz").fill("El sensor de papel del modelo M507 se descalibra con el firmware 2.1.");
    await mgr.getByLabel("Solución temporal (workaround)").fill("Apagar la impresora 30 segundos y retirar la bandeja 2.");
    await mgr.getByRole("button", { name: "Guardar análisis" }).click();
    await toast(mgr, "Problema actualizado.");
    await mgr.getByRole("button", { name: "Registrar error conocido" }).click();
    await mgr.getByText("Error conocido", { exact: true }).first().waitFor();
    await mgr.getByLabel("Nueva acción").fill("Actualizar firmware de impresoras M507");
    await mgr.getByRole("button", { name: "Agregar" }).first().click();
    await toast(mgr, "Acción agregada al plan.");
    await mgr.getByLabel("Solución definitiva").fill("Actualizar firmware a 2.3");
    await mgr.getByRole("button", { name: "Guardar análisis" }).click();
    await toast(mgr, "Problema actualizado.");
    await mgr.getByRole("button", { name: "Marcar resuelto" }).click();
    await toast(mgr, "Problema actualizado.");
    await mgr.getByRole("button", { name: "Cerrar problema" }).click();
    await toast(mgr, /acción\(es\) pendientes/);
    await mgr.getByLabel("Completar Actualizar firmware de impresoras M507").check();
    await mgr.waitForTimeout(800);
    await mgr.getByRole("button", { name: "Cerrar problema" }).click();
    await mgr.getByText("Cerrado", { exact: true }).first().waitFor();
  });

  console.log("Gestión de cambios");
  await step("Validación: no se envía sin plan de reversa", async () => {
    await cam.goto("/changes/new");
    await cam.getByLabel("Título").fill("Ampliar disco del servidor de archivos");
    await cam.getByLabel("Descripción").fill("Agregar 500 GB al volumen D de SRV-FILE-01.");
    await cam.getByRole("button", { name: /SRV-FILE-01/ }).click();
    await cam.getByRole("button", { name: "Guardar borrador" }).click();
    await cam.waitForURL(/\/changes\/c/);
    await cam.getByRole("button", { name: "Enviar a aprobación" }).click();
    await toast(cam, /Completa el plan/);
  });
  await step("Cambio normal de riesgo alto: evaluación en vivo y CAB de 2 niveles", async () => {
    await cam.getByRole("link", { name: "Editar" }).click();
    await cam.waitForURL(/\/edit/);
    for (const q of ["¿Afecta sistemas en producción usados por clientes o toda la empresa?", "¿Requiere interrumpir el servicio?", "¿Sería difícil o lento volver atrás si falla?"]) {
      await cam.getByRole("radiogroup", { name: q }).getByRole("radio", { name: "Sí" }).click();
    }
    await cam.getByLabel("Inicio de la ventana").fill(localInput(3, 21));
    await cam.getByLabel("Fin de la ventana").fill(localInput(3, 23));
    await cam.getByLabel("Plan de implementación").fill("1. Snapshot\n2. Ampliar disco\n3. Extender volumen");
    await cam.getByLabel("Plan de reversa (rollback)").fill("Restaurar snapshot.");
    await cam.getByText("Riesgo alto: requiere CAB y luego dirección (2 niveles).").waitFor();
    await shot(cam, "p2-05-formulario-cambio");
    await cam.getByRole("button", { name: "Guardar cambios" }).click();
    await cam.waitForURL(/\/changes\/c[^/]+$/);
    changeUrl = new URL(cam.url()).pathname;
    await cam.getByRole("button", { name: "Enviar a aprobación" }).click();
    await toast(cam, "Cambio enviado.");
    await cam.getByText("Esperando CAB").first().waitFor();
    assert.equal(await cam.getByRole("button", { name: "Aprobar" }).count(), 0, "el agente no puede aprobar");
  });
  await step("CAB (gestor) aprueba nivel 1 → pasa a dirección", async () => {
    await mgr.goto("/approvals");
    await mgr.getByText("Cambios esperando al CAB").waitFor();
    await mgr.goto(changeUrl);
    await mgr.getByRole("button", { name: "Aprobar" }).click();
    await toast(mgr, "Decisión registrada.");
    await mgr.getByText("Nivel 2 · Dirección").waitFor();
    await mgr.getByText("Esperando CAB").first().waitFor();
  });
  const adm = await session("admin@andes.demo");
  await step("Dirección aprueba nivel 2 → programado; implementación, resultado y revisión", async () => {
    await adm.goto(changeUrl);
    await adm.getByRole("button", { name: "Aprobar" }).click();
    await toast(adm, "Decisión registrada.");
    await adm.getByText("Programado").first().waitFor();
    await cam.goto(changeUrl);
    await cam.getByRole("button", { name: "Iniciar implementación" }).click();
    await cam.getByRole("button", { name: "Finalizar implementación" }).waitFor();
    await cam.getByRole("button", { name: "Finalizar implementación" }).click();
    await cam.getByRole("button", { name: "Registrar resultado" }).click();
    await cam.getByText("Revisión post-implementación").first().waitFor();
    await mgr.goto(changeUrl);
    await mgr.getByRole("button", { name: "Validar y cerrar" }).click();
    await mgr.getByRole("button", { name: "Cerrar cambio" }).click();
    await toast(mgr, /validación posterior/);
    await mgr.getByLabel("Resultado de la validación").fill("Espacio disponible verificado; sin incidentes.");
    await mgr.getByRole("button", { name: "Cerrar cambio" }).click();
    await toast(mgr, "Cambio actualizado.");
    await mgr.getByText("Exitoso").first().waitFor();
    await shot(mgr, "p2-06-detalle-cambio");
  });
  await step("Cambio estándar queda programado sin aprobación", async () => {
    await cam.goto("/changes/new");
    await cam.getByRole("radio", { name: /Estándar/ }).click();
    await cam.getByLabel("Título").fill("Rotación mensual de respaldos a cinta");
    await cam.getByLabel("Descripción").fill("Procedimiento estándar de rotación de cintas.");
    await cam.getByRole("button", { name: /SRV-FILE-01/ }).click();
    await cam.getByLabel("Inicio de la ventana").fill(localInput(4, 20));
    await cam.getByLabel("Fin de la ventana").fill(localInput(4, 21));
    await cam.getByLabel("Plan de implementación").fill("Rotar cintas según bitácora.");
    await cam.getByLabel("Plan de reversa (rollback)").fill("No aplica: sin cambios en sistemas.");
    await cam.getByRole("button", { name: "Guardar borrador" }).click();
    await cam.waitForURL(/\/changes\/c/);
    await cam.getByRole("button", { name: "Enviar a aprobación" }).click();
    await cam.getByText("Programado").first().waitFor();
  });
  await step("Calendario de cambios marca el conflicto de FW-CORE-01", async () => {
    await mgr.goto("/changes/calendar");
    await mgr.getByRole("heading", { name: "Calendario de cambios" }).waitFor();
    const conflict = await mgr.locator("a.ring-red-500").count();
    if (!conflict) { await mgr.getByRole("link", { name: "Mes siguiente" }).click(); }
    assert.ok((await mgr.locator("a.ring-red-500").count()) >= 2, "dos cambios en conflicto");
    await shot(mgr, "p2-07-calendario");
  });

  console.log("CMDB");
  await step("Análisis de impacto: si cae el enlace de Internet", async () => {
    await mgr.goto("/cmdb?q=Enlace%20Internet");
    await mgr.getByRole("link", { name: "Enlace Internet Santiago" }).click();
    await mgr.getByText("Análisis de impacto").waitFor();
    for (const s of ["Correo y colaboración", "Ventas y CRM", "Acceso remoto (VPN)", "FW-CORE-01"]) await mgr.getByRole("link", { name: s }).first().waitFor();
    await shot(mgr, "p2-08-cmdb-impacto");
  });
  await step("Crear elemento y relación; el agente solo puede consultar", async () => {
    await mgr.goto("/cmdb/new");
    await mgr.getByLabel("Nombre").fill("SRV-BI-01");
    await mgr.getByRole("button", { name: "Guardar" }).click();
    await mgr.waitForURL(/\/cmdb\/c/);
    await mgr.getByLabel("Elemento relacionado").selectOption({ label: "DB-SAP-PRD · Base de datos" });
    await mgr.getByRole("button", { name: "Agregar" }).click();
    await toast(mgr, "Relación agregada.");
    await mgr.getByRole("link", { name: "DB-SAP-PRD" }).first().waitFor();
    await cam.goto("/cmdb");
    assert.equal(await cam.getByRole("link", { name: "Nuevo elemento" }).count(), 0);
    await cam.goto("/cmdb/new");
    await cam.waitForURL(/denied=1/);
    await shot(mgr, "p2-09-cmdb-lista");
  });

  console.log("Aprobación multinivel del catálogo");
  const pat = await session("patricia@andes.demo");
  await step("Notebook: jefatura (nivel 1) → TI (nivel 2) → asignado", async () => {
    await ana.goto("/catalog");
    await ana.getByRole("link", { name: /Solicitar un notebook/ }).click();
    await ana.getByText(/Patricia Lagos y luego Valentina Rojas/).waitFor();
    await ana.getByLabel("¿Qué tipo de equipo necesitas?").selectOption("Estándar (oficina)");
    await ana.getByLabel("Motivo").selectOption("Equipo con falla");
    await ana.getByRole("button", { name: "Enviar solicitud" }).click();
    await ana.getByRole("link", { name: "Ver seguimiento" }).click();
    await ana.waitForURL(/\/tickets\//);
    requestUrl = new URL(ana.url()).pathname;
    await pat.goto("/approvals");
    await pat.locator("div.rounded-xl", { hasText: "Estándar (oficina)" }).filter({ hasText: "Ana Torres" }).first().getByRole("button", { name: "Aprobar" }).click();
    await toast(pat, "Decisión registrada.");
    await adm.goto("/approvals");
    const card = adm.locator("div.rounded-xl", { hasText: "Nivel 2" }).filter({ hasText: "Ana Torres" }).first();
    await card.waitFor();
    await shot(adm, "p2-10-aprobacion-nivel2");
    await card.getByRole("button", { name: "Aprobar" }).click();
    await toast(adm, "Decisión registrada.");
    const t = await (await ana.request.get(requestUrl.replace("/tickets/", "/api/v1/tickets/"))).json();
    assert.equal(t.approvalStatus, "APPROVED");
    assert.equal(t.approvals.length, 2);
  });

  console.log("Reportes, búsqueda y seguridad");
  await step("Reportes avanzados de cambios y problemas", async () => {
    await mgr.goto("/reports?from=2026-09-01");
    await mgr.getByText("Tasa de éxito").waitFor();
    await mgr.getByText("Activos con más incidentes").waitFor();
    await mgr.getByText("Resolución por prioridad").waitFor();
    await mgr.getByText("Problemas, cambios y CMDB").scrollIntoViewIfNeeded();
    await shot(mgr, "p2-11-reportes");
  });
  await step("Búsqueda global encuentra problemas, cambios y CMDB", async () => {
    const r = await (await mgr.request.get("/api/v1/search?q=FW-CORE")).json();
    const titles = r.results.map((x: { title: string }) => x.title).join("|");
    assert.match(titles, /FW-CORE-01/);
    const r2 = await (await mgr.request.get("/api/v1/search?q=PRB-101")).json();
    assert.ok(r2.results.some((x: { title: string }) => x.title.startsWith("PRB-101")));
  });
  await step("Usuario final no accede a problemas, cambios ni CMDB", async () => {
    for (const path of ["/problems", "/changes", "/cmdb"]) { await ana.goto(path); await ana.waitForURL(/denied=1/); }
  });
  const glx = await session("admin@globex.demo");
  await step("Aislamiento: Globex no ve problemas, cambios ni CMDB de Andes", async () => {
    for (const path of [problemUrl, changeUrl]) assert.equal((await glx.goto(path))?.status(), 404);
    const ci = await mgr.request.get("/api/v1/search?q=SRV-BI-01");
    const href = (await ci.json()).results.find((x: { href: string }) => x.href.startsWith("/cmdb/"))?.href;
    assert.ok(href);
    assert.equal((await glx.goto(href))?.status(), 404);
    await glx.goto("/cmdb");
    assert.equal(await glx.getByText("FW-CORE-01").count(), 0);
  });
  const dark = await session("gestor@andes.demo", { dark: true });
  await step("Modo oscuro y móvil en módulos nuevos", async () => {
    await dark.goto(changeUrl); await shot(dark, "p2-12-cambio-oscuro");
    const mob = await session("javiera@andes.demo", { mobile: true });
    await mob.goto("/changes");
    await shot(mob, "p2-13-movil-cambios");
    assert.equal(await mob.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "sin scroll horizontal");
    await mob.goto("/cmdb");
    await mob.getByText("FW-CORE-01").first().waitFor();
  });
  await step("Sin errores de JavaScript en consola", async () => { assert.equal(consoleErrors.length, 0, consoleErrors.slice(0, 5).join("\n")); });

  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} pruebas OK`);
  if (failed) process.exit(1);
}
main().catch(async (e) => { console.error(e); await browser?.close(); process.exit(1); });
