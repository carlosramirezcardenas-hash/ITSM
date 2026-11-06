/**
 * Pruebas funcionales de punta a punta (requiere el servidor en marcha y la BD con datos demo).
 *   npm run build && npm start   (en otra terminal)
 *   npm run test:e2e
 */
import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR;
let browser: Browser;
const results: { name: string; ok: boolean; error?: string }[] = [];
const consoleErrors: string[] = [];

async function session(email: string, opts: { dark?: boolean; mobile?: boolean } = {}) {
  const ctx = await browser.newContext({
    baseURL: BASE,
    viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    colorScheme: opts.dark ? "dark" : "light",
  });
  const page = await ctx.newPage();
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
  catch (e) { results.push({ name, ok: false, error: (e as Error).message.split("\n")[0] }); console.log(`  ✘ ${name}\n    ${(e as Error).message.split("\n").slice(0, 3).join("\n    ")}`); }
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function main() {
  browser = await chromium.launch();
  let incidentUrl = "";
  let requestRef = "";

  console.log("Usuario final (Ana)");
  const ana = await session("ana@andes.demo");
  await step("Portal muestra buscador central y botón Crear solicitud", async () => {
    await ana.getByRole("heading", { name: "¿En qué podemos ayudarte?" }).waitFor();
    await ana.getByRole("link", { name: /Crear solicitud/ }).first().waitFor();
    await shot(ana, "01-portal-usuario");
  });
  await step("Reportar un problema en < 30 s con sugerencias de artículos", async () => {
    const t0 = Date.now();
    await ana.goto("/new/issue");
    await ana.getByLabel("¿Qué está pasando?").fill("No puedo trabajar: la VPN no conecta desde mi casa");
    await ana.getByText("¿Esto te ayuda?").waitFor({ timeout: 5000 });
    await ana.getByText("Conectarse a la VPN desde casa").first().waitFor();
    await shot(ana, "02-reportar-problema");
    await ana.getByRole("button", { name: "Enviar reporte" }).click();
    await ana.getByRole("heading", { name: "¡Recibimos tu reporte!" }).waitFor();
    assert.ok(Date.now() - t0 < 30000);
    await ana.getByRole("link", { name: "Ver seguimiento" }).click();
    await ana.waitForURL(/\/tickets\//);
    incidentUrl = new URL(ana.url()).pathname;
    await ana.getByText("Red e Internet").first().waitFor(); // clasificado automáticamente
  });
  await step("Solicitud de catálogo con aprobación de jefatura", async () => {
    await ana.goto("/catalog");
    await ana.getByRole("link", { name: /Acceso a un sistema/ }).click();
    await ana.getByLabel("Sistema").selectOption("Salesforce");
    await ana.getByLabel("Tipo de acceso").selectOption("Solo lectura");
    await ana.getByLabel("¿Para qué lo necesitas?").fill("Revisar oportunidades de clientes de Finanzas");
    await shot(ana, "03-formulario-catalogo");
    await ana.getByRole("button", { name: "Enviar solicitud" }).click();
    await ana.getByText(/Primero debe aprobarla/).waitFor();
    requestRef = (await ana.locator("strong", { hasText: /^REQ-\d+$/ }).textContent())!;
    assert.match(requestRef, /REQ-\d+/);
  });
  await step("Validación: formulario no se envía con campos obligatorios vacíos", async () => {
    await ana.goto("/catalog");
    await ana.getByRole("link", { name: /Alta de nuevo colaborador/ }).click();
    await ana.getByRole("button", { name: "Enviar solicitud" }).click();
    assert.ok((await ana.getByText("Este campo es obligatorio.").count()) >= 3);
  });
  await step("RBAC: usuario final no accede a administración (UI y API)", async () => {
    await ana.goto("/admin/users");
    await ana.waitForURL(/\/home\?denied=1/);
    const r = await ana.request.get("/api/v1/metrics");
    assert.equal(r.status(), 403);
    const r2 = await ana.request.patch(incidentUrl.replace("/tickets/", "/api/v1/tickets/"), { data: { status: "CLOSED" } });
    assert.equal(r2.status(), 403);
  });
  await step("Mis solicitudes lista lo creado", async () => {
    await ana.goto("/my-requests");
    await ana.getByText("No puedo trabajar: la VPN no conecta desde mi casa").waitFor();
    await shot(ana, "04-mis-solicitudes");
  });

  console.log("Aprobadora (Patricia)");
  const pat = await session("patricia@andes.demo");
  await step("Aprobar la solicitud de Ana", async () => {
    await pat.goto("/approvals");
    const card = pat.locator("div.rounded-xl", { hasText: requestRef }).filter({ hasText: "Salesforce" }).first();
    await card.waitFor();
    await shot(pat, "05-aprobaciones");
    await card.getByRole("button", { name: "Aprobar" }).click();
    await pat.getByText("Decisión registrada.").waitFor();
  });
  await step("Rechazar exige motivo", async () => {
    await pat.goto("/approvals");
    const btn = pat.getByRole("button", { name: "Rechazar" }).first();
    await btn.click();
    const confirm = pat.getByRole("dialog").getByRole("button", { name: "Rechazar" });
    assert.ok(await confirm.isDisabled());
    await pat.keyboard.press("Escape");
  });

  console.log("Gestor de servicios (Martín)");
  const mgr = await session("gestor@andes.demo");
  await step("Panel ejecutivo con KPIs y gráficos", async () => {
    await mgr.getByRole("heading", { name: "Panel ejecutivo" }).waitFor();
    await mgr.getByText("Cumplimiento SLA").first().waitFor();
    await mgr.locator(".recharts-surface").first().waitFor();
    await shot(mgr, "06-panel-ejecutivo");
  });
  await step("Tomar, escalar y resolver el incidente de Ana", async () => {
    await mgr.goto(incidentUrl);
    await mgr.getByRole("button", { name: "Tomar ticket" }).click();
    await mgr.getByText("Cambios guardados.").waitFor();
    await mgr.getByRole("button", { name: "Escalar" }).click();
    await mgr.getByLabel("Motivo del escalamiento").fill("Afecta a varias personas en teletrabajo");
    await mgr.getByRole("button", { name: "Escalar a gestores" }).click();
    await mgr.getByText(/Escalamiento enviado/).waitFor();
    await mgr.getByPlaceholder(/Escribe una respuesta/).fill("Hola Ana, estamos revisando el concentrador VPN.");
    await mgr.getByRole("button", { name: "Enviar" }).click();
    await mgr.getByText("Mensaje enviado.").waitFor();
    await mgr.getByRole("button", { name: "Resolver" }).click();
    await mgr.getByLabel(/¿Qué se hizo/).fill("Se reinició el concentrador VPN y se renovó el certificado.");
    await mgr.getByRole("button", { name: "Marcar como resuelto" }).click();
    await mgr.getByText("Cambios guardados.").waitFor();
    await mgr.getByText("Resuelto").first().waitFor();
    await shot(mgr, "07-detalle-ticket-agente");
  });
  await step("Transición inválida rechazada por el backend", async () => {
    const r = await mgr.request.patch(incidentUrl.replace("/tickets/", "/api/v1/tickets/"), { data: { status: "PENDING", pendingReason: "x" } });
    assert.equal(r.status(), 422);
  });
  await step("Reportes con filtros y exportación CSV", async () => {
    await mgr.goto("/reports?type=INCIDENT");
    await mgr.getByRole("heading", { name: "Dashboard y reportes" }).waitFor();
    await shot(mgr, "08-reportes");
    const r = await mgr.request.get("/api/v1/reports/export");
    assert.equal(r.status(), 200);
    assert.match(await r.text(), /Número,Tipo,Título/);
  });

  console.log("Usuario final confirma y evalúa");
  await step("Ana confirma la solución y evalúa con 5 estrellas", async () => {
    await ana.goto(incidentUrl);
    await ana.getByRole("button", { name: "Sí, está solucionado" }).click();
    await ana.getByRole("radio", { name: "5 de 5" }).click();
    await ana.getByRole("button", { name: "Enviar evaluación" }).click();
    await ana.getByText("Cerrado").first().waitFor();
    await shot(ana, "09-ticket-cerrado-usuario");
  });
  await step("Ana no ve notas internas", async () => {
    const r = await ana.request.get(incidentUrl.replace("/tickets/", "/api/v1/tickets/"));
    const t = await r.json();
    assert.ok(t.comments.every((c: { isInternal: boolean }) => !c.isInternal));
  });

  console.log("Agente (Camila)");
  const cam = await session("camila@andes.demo");
  await step("Inicio del agente y bandeja de trabajo", async () => {
    await cam.getByRole("heading", { name: "Tu día de un vistazo" }).waitFor();
    await shot(cam, "10-inicio-agente");
    await cam.goto("/queue?view=all");
    await cam.getByRole("heading", { name: "Bandeja de trabajo" }).waitFor();
    await shot(cam, "11-bandeja");
  });
  await step("Búsqueda global (⌘K)", async () => {
    await cam.keyboard.press("Control+k");
    await cam.getByLabel("Buscar", { exact: true }).fill("vpn");
    await cam.getByText("Conectarse a la VPN desde casa").first().waitFor();
    await shot(cam, "12-busqueda-global");
    await cam.keyboard.press("Escape");
  });

  console.log("Aislamiento multi-tenant (Globex)");
  const glx = await session("admin@globex.demo");
  await step("Otra organización no puede ver el ticket de Andes (UI y API)", async () => {
    const resp = await glx.goto(incidentUrl);
    assert.equal(resp?.status(), 404);
    const r = await glx.request.get(incidentUrl.replace("/tickets/", "/api/v1/tickets/"));
    assert.equal(r.status(), 404);
    const s = await (await glx.request.get("/api/v1/search?q=vpn")).json();
    assert.equal(s.results.length, 0);
    const list = await (await glx.request.get("/api/v1/tickets?status=any")).json();
    assert.ok(list.items.every((t: { orgId: string }) => t.orgId === list.items[0].orgId));
    assert.ok(!JSON.stringify(list).includes("VPN"));
  });

  console.log("Administración");
  const adm = await session("admin@andes.demo");
  await step("Crear usuario, ver auditoría y SLA", async () => {
    await adm.goto("/admin/users");
    await adm.getByRole("button", { name: "Nuevo usuario" }).click();
    const email = `nuevo${Date.now()}@andes.demo`;
    await adm.getByLabel("Nombre").click();
    await adm.keyboard.type("Usuario de Prueba", { delay: 10 });
    await adm.getByLabel("Correo").click();
    await adm.keyboard.type(email, { delay: 10 });
    assert.equal(await adm.getByLabel("Nombre").inputValue(), "Usuario de Prueba");
    await adm.getByLabel("Contraseña inicial").fill("corta");
    await adm.getByRole("button", { name: "Guardar" }).click();
    await adm.getByText(/al menos 10 caracteres/).first().waitFor();
    await adm.getByLabel("Contraseña inicial").fill("Prueba12345");
    await adm.getByRole("button", { name: "Guardar" }).click();
    await adm.getByText("Usuario guardado.").waitFor();
    await adm.getByText(email).waitFor();
    await adm.goto("/admin/audit");
    await adm.getByText("user.created").first().waitFor();
    await adm.goto("/admin/sla");
    await adm.getByText("Feriados").first().waitFor();
    await shot(adm, "13-admin-sla");
    await adm.goto("/admin/catalog/new");
    await shot(adm, "14-editor-servicio");
  });

  console.log("Superadministrador SaaS");
  const root = await session("root@itsmeasy.app");
  await step("Plataforma lista organizaciones y no accede a tickets", async () => {
    await root.getByRole("heading", { name: "Organizaciones (tenants)" }).waitFor();
    await shot(root, "15-plataforma");
    const r = await root.request.get("/api/v1/tickets");
    assert.equal(r.status(), 403);
  });
  await step("Ventanas emergentes: se puede escribir tecla por tecla en todos los campos (crear organización)", async () => {
    const slug = `jp-${Date.now().toString(36)}`;
    await root.getByRole("button", { name: "Nueva organización" }).click();
    // Escritura real: click en cada campo y teclado (fill() no detecta robos de foco)
    const type = async (label: string, text: string) => { await root.getByLabel(label).click(); await root.keyboard.type(text, { delay: 15 }); };
    await type("Nombre de la empresa", "JP Inversiones");
    await root.getByLabel("Identificador").click();
    await root.keyboard.press("Control+A");
    await root.keyboard.type(slug, { delay: 15 });
    await type("Nombre del administrador", "Carlos Ramírez");
    await type("Correo del administrador", `admin@${slug}.demo`);
    await type("Contraseña inicial", "Inversiones2026");
    assert.equal(await root.getByLabel("Nombre de la empresa").inputValue(), "JP Inversiones");
    assert.equal(await root.getByLabel("Nombre del administrador").inputValue(), "Carlos Ramírez");
    assert.equal(await root.getByLabel("Correo del administrador").inputValue(), `admin@${slug}.demo`);
    await root.getByRole("button", { name: "Crear" }).click();
    await root.getByText("JP Inversiones").first().waitFor();
    // Escape sigue cerrando la ventana
    await root.getByRole("button", { name: "Nueva organización" }).click();
    await root.keyboard.press("Escape");
    assert.equal(await root.getByRole("dialog").count(), 0);
  });

  console.log("Responsive y modo oscuro");
  const dark = await session("ana@andes.demo", { dark: true });
  await step("Modo oscuro", async () => { await shot(dark, "16-portal-oscuro"); await dark.goto("/catalog"); await shot(dark, "17-catalogo-oscuro"); });
  const dmgr = await session("gestor@andes.demo", { dark: true });
  await step("Panel ejecutivo en oscuro", async () => { await dmgr.locator(".recharts-surface").first().waitFor(); await shot(dmgr, "18-panel-oscuro"); });
  const mob = await session("ana@andes.demo", { mobile: true });
  await step("Móvil: menú lateral como cajón", async () => {
    await shot(mob, "19-movil-portal");
    await mob.getByRole("button", { name: "Abrir menú" }).click();
    await mob.getByRole("link", { name: "Mis solicitudes" }).first().waitFor();
    await shot(mob, "20-movil-menu");
    await mob.goto(incidentUrl);
    await shot(mob, "21-movil-ticket");
    const overflow = await mob.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, "sin scroll horizontal");
  });

  await step("Sin errores de JavaScript en consola", async () => {
    assert.equal(consoleErrors.length, 0, consoleErrors.slice(0, 5).join("\n"));
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} pruebas OK`);
  if (failed.length) process.exit(1);
}

main().catch(async (e) => { console.error(e); await browser?.close(); process.exit(1); });
