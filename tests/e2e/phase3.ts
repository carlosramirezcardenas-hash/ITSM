/**
 * Pruebas E2E Fase 3: IA (contra servidor simulado que valida cada petición), automatizaciones,
 * análisis predictivo, integraciones con webhooks firmados y claves de API.
 * Requiere: `npx tsx tests/mock-anthropic.ts` y el servidor iniciado con
 *   ANTHROPIC_API_KEY=sk-test ANTHROPIC_BASE_URL=http://localhost:4010 ALLOW_PRIVATE_WEBHOOKS=true
 */
import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MOCK = process.env.MOCK_URL ?? "http://localhost:4010";
const SHOTS = process.env.SHOTS_DIR;
let browser: Browser;
const results: { name: string; ok: boolean }[] = [];
const consoleErrors: string[] = [];

async function session(email: string) {
  const ctx = await browser.newContext({ baseURL: BASE, timezoneId: "America/Santiago", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("EventSource") && !m.text().includes("status of 404")) consoleErrors.push(`${email} ${page.url()}: ${m.text()}`); });
  page.on("pageerror", (e) => consoleErrors.push(`${email} ${page.url()}: ${e.message}`));
  await page.goto("/login");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill("Demo12345!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await page.waitForURL(/\/home/);
  return page;
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ✔ ${name}`); }
  catch (e) { results.push({ name, ok: false }); console.log(`  ✘ ${name}\n    ${(e as Error).message.split("\n").slice(0, 4).join("\n    ")}`); }
}
async function shot(page: Page, name: string) { if (SHOTS) { await page.waitForTimeout(600); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } }
const toast = (p: Page, text: string | RegExp) => p.getByRole("status").filter({ hasText: text }).first().waitFor({ timeout: 15000 });
const stats = async () => (await fetch(`${MOCK}/__stats`)).json() as Promise<{ messages: number; invalid: string[]; hooks: { headers: Record<string, string>; body: string }[] }>;
async function until<T>(fn: () => Promise<T | null | undefined | false>, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error("tiempo de espera agotado"); await new Promise((r) => setTimeout(r, 400)); }
}

async function main() {
  await fetch(`${MOCK}/__reset`, { method: "POST" });
  browser = await chromium.launch();
  let secret = "", rwKey = "", roKey = "", ticketUrl = "";

  console.log("Integraciones y claves de API");
  const adm = await session("admin@andes.demo");
  await step("Panel de integraciones muestra la IA activa", async () => {
    await adm.goto("/admin/integrations");
    await adm.getByText("Activo", { exact: true }).waitFor();
    await shot(adm, "p3-01-integraciones");
  });
  await step("Webhook: rechaza URL privada en producción y crea uno firmado", async () => {
    await adm.getByRole("button", { name: "Conectar" }).click();
    await adm.getByLabel("Tipo").selectOption("webhook");
    await adm.getByLabel("Nombre").fill("Monitoreo interno");
    await adm.getByLabel("URL del webhook").fill("http://10.0.0.5/hook");
    await adm.getByRole("button", { name: "Guardar" }).click();
    await toast(adm, /HTTPS|internas/);
    await adm.getByLabel("URL del webhook").fill(`${MOCK}/hook`);
    await adm.getByLabel("Ticket creado").check();
    await adm.getByRole("button", { name: "Guardar" }).click();
    await adm.getByText("Secreto de firma del webhook").waitFor();
    secret = (await adm.getByRole("dialog").locator("code").textContent())!.trim();
    assert.ok(secret.length > 20);
    await adm.getByRole("button", { name: "Listo" }).click();
    await adm.getByRole("button", { name: "Probar" }).first().click();
    await toast(adm, "Mensaje de prueba entregado.");
  });
  await step("Claves de API: lectura, escritura, alcance y revocación", async () => {
    for (const [name, scope] of [["Lectura BI", "read"], ["Integración monitoreo", "read_write"]] as const) {
      await adm.getByRole("button", { name: "Crear clave" }).click();
      await adm.getByLabel("Nombre").fill(name);
      await adm.getByLabel("Permisos").selectOption(scope);
      await adm.getByRole("dialog").getByRole("button", { name: "Crear" }).click();
      const k = (await adm.getByTestId("new-api-key").textContent())!.trim();
      if (scope === "read") roKey = k; else rwKey = k;
      await adm.getByRole("button", { name: "Listo" }).click();
    }
    const get = await fetch(`${BASE}/api/v1/tickets?status=open`, { headers: { authorization: `Bearer ${roKey}` } });
    assert.equal(get.status, 200);
    const list = await get.json();
    assert.ok(list.total > 0);
    const denied = await fetch(`${BASE}/api/v1/tickets`, { method: "POST", headers: { authorization: `Bearer ${roKey}`, "content-type": "application/json" }, body: JSON.stringify({ type: "INCIDENT", title: "Desde clave de lectura" }) });
    assert.equal(denied.status, 403);
    const created = await fetch(`${BASE}/api/v1/tickets`, { method: "POST", headers: { authorization: `Bearer ${rwKey}`, "content-type": "application/json" }, body: JSON.stringify({ type: "INCIDENT", title: "Alerta de monitoreo: disco lleno en SRV-FILE-01", description: "Uso de disco 97%", impact: "MEDIUM", urgency: "HIGH", channel: "api" }) });
    assert.equal(created.status, 201);
    const bad = await fetch(`${BASE}/api/v1/tickets`, { headers: { authorization: "Bearer itsm_clave_inventada_que_no_existe_123" } });
    assert.equal(bad.status, 401);
    // Las claves no sirven fuera de la API REST (no abren la interfaz)
    const ui = await fetch(`${BASE}/home`, { headers: { authorization: `Bearer ${rwKey}` }, redirect: "manual" });
    assert.equal(ui.status, 307);
  });

  console.log("Automatizaciones + IA en incidentes");
  const ana = await session("ana@andes.demo");
  await step("Autoayuda con IA en el portal", async () => {
    await ana.goto("/new/issue");
    await ana.getByLabel("¿Qué está pasando?").fill("La VPN me dice credenciales inválidas desde la casa");
    await ana.getByRole("button", { name: "Pedir ayuda a la IA" }).click();
    await ana.getByText("Respuesta generada por IA").waitFor();
    await shot(ana, "p3-02-autoayuda-ia");
  });
  await step("Automatización deriva el incidente de VPN a Infraestructura", async () => {
    await ana.getByRole("button", { name: "Enviar reporte" }).click();
    await ana.getByRole("link", { name: "Ver seguimiento" }).click();
    await ana.waitForURL(/\/tickets\//);
    ticketUrl = new URL(ana.url()).pathname;
    // La actividad de automatización solo la ve el equipo de soporte: se verifica en el paso siguiente
  });
  await step("Asistente conversacional con IA: responde y deja el reporte para confirmar", async () => {
    const before = (await stats()).messages;
    await ana.goto("/assistant");
    await ana.getByText("Con IA:").waitFor();
    await ana.getByLabel("Mensaje para el asistente").fill("El sistema de bodega no me deja ingresar");
    await ana.getByRole("button", { name: "Enviar mensaje" }).click();
    await ana.getByText("Respuesta simulada (reply).").waitFor({ timeout: 15000 });
    await ana.getByText("Respuestas generadas por IA").waitFor();
    assert.equal(await ana.getByLabel("Título del reporte").inputValue(), "Respuesta simulada (ticket_title).");
    assert.equal((await stats()).messages, before + 1);
    // Los id inventados por el modelo se descartan (no existe "id-de-prueba")
    assert.equal(await ana.getByRole("link", { name: "Solicitar", exact: true }).count(), 0);
    await shot(ana, "p3-02b-asistente-ia");
  });
  const cam = await session("camila@andes.demo");
  await step("Agente ve sugerencia de IA, resume y redacta respuesta", async () => {
    await cam.goto(ticketUrl);
    await cam.getByText(/aplicó la automatización «Derivar problemas de VPN/).waitFor();
    await until(async () => { await cam.reload(); return (await cam.getByText("Clasificación sugerida").count()) > 0; }, 20000);
    await cam.getByRole("button", { name: "Resumir con IA" }).click();
    await cam.getByText("Siguiente paso:").waitFor();
    await cam.getByRole("button", { name: "Sugerir respuesta" }).click();
    await cam.getByText("Borrador generado por IA").waitFor();
    assert.match(await cam.getByLabel("Mensaje").inputValue(), /Respuesta simulada/);
    await shot(cam, "p3-03-ticket-ia");
  });
  await step("Webhook firmado recibido para ticket creado", async () => {
    const s = await until(async () => { const x = await stats(); return x.hooks.some((h) => h.body.includes("ticket.created")) ? x : null; });
    const h = s.hooks.find((x) => x.body.includes("ticket.created"))!;
    const expected = "sha256=" + createHmac("sha256", secret).update(`${h.headers["x-itsm-timestamp"]}.${h.body}`).digest("hex");
    assert.equal(h.headers["x-itsm-signature"], expected, "firma HMAC válida");
  });

  console.log("Problemas, reportes y predicción");
  const mgr = await session("gestor@andes.demo");
  await step("IA sugiere causas raíz y se pueden usar", async () => {
    await mgr.goto("/problems?status=any&q=Lentitud");
    await mgr.getByRole("link", { name: /Lentitud recurrente/ }).click();
    await mgr.getByRole("button", { name: "Sugerir causas con IA" }).click();
    await mgr.getByText("Hipótesis de la IA").waitFor();
    await mgr.getByRole("button", { name: "Usar como causa raíz" }).first().click();
    assert.match(await mgr.getByLabel("Causa raíz").inputValue(), /Respuesta simulada/);
    await shot(mgr, "p3-04-rca-ia");
  });
  await step("Reportes: pronóstico, riesgo de SLA y tendencias con IA", async () => {
    await mgr.goto("/reports");
    await mgr.getByText("Pronóstico de tickets · próximos 7 días").waitFor();
    await mgr.getByText("Riesgo de incumplir el SLA").first().waitFor();
    await mgr.getByRole("button", { name: "Analizar" }).click();
    await mgr.getByText("Recomendaciones").waitFor();
    await mgr.getByText("Análisis predictivo").scrollIntoViewIfNeeded();
    await shot(mgr, "p3-05-prediccion");
  });
  await step("Inicio del agente muestra riesgo predictivo", async () => {
    await cam.goto("/home");
    await cam.getByText("Riesgo de incumplir el SLA").waitFor();
  });
  await step("Constructor de automatizaciones", async () => {
    await mgr.goto("/admin/automations");
    await mgr.getByText("Avisar a gestores ante incidentes críticos").waitFor();
    await mgr.getByRole("button", { name: "SLA vencido → escalar" }).click();
    await mgr.getByRole("button", { name: "Guardar regla" }).click();
    await toast(mgr, "Regla guardada.");
    await shot(mgr, "p3-06-automatizaciones");
  });

  console.log("Controles");
  await step("Todas las peticiones a la API de Claude cumplen el formato", async () => {
    const s = await stats();
    assert.ok(s.messages >= 6, `peticiones: ${s.messages}`);
    assert.deepEqual([...new Set(s.invalid)], []);
  });
  await step("Desactivar la IA oculta las funciones y la app sigue operando", async () => {
    await adm.goto("/admin/integrations");
    await adm.getByRole("button", { name: "Desactivar" }).click();
    await toast(adm, "Asistente de IA desactivado.");
    await cam.goto(ticketUrl);
    await cam.getByText("No está activo en esta organización").waitFor();
    assert.equal(await cam.getByRole("button", { name: "Sugerir respuesta" }).count(), 0);
    // El asistente del portal sigue funcionando en modo básico
    await ana.goto("/assistant");
    await ana.getByLabel("Mensaje para el asistente").fill("necesito un notebook nuevo");
    await ana.getByRole("button", { name: "Enviar mensaje" }).click();
    await ana.getByText("Para eso tenemos el servicio «Solicitar un notebook»").waitFor({ timeout: 15000 });
    await ana.getByText("Modo básico").waitFor();
    await adm.getByRole("button", { name: "Activar" }).click();
    await toast(adm, "Asistente de IA activado.");
  });
  await step("Usuario final no accede a administración de integraciones ni a la IA de agentes", async () => {
    await ana.goto("/admin/integrations");
    await ana.waitForURL(/denied=1/);
    await ana.goto(ticketUrl);
    assert.equal(await ana.getByText("Asistente de IA").count(), 0);
  });
  await step("Revocar clave corta el acceso", async () => {
    await adm.goto("/admin/integrations");
    const row = adm.locator("li", { hasText: "Lectura BI" }).first();
    await row.getByRole("button", { name: "Revocar" }).click();
    await toast(adm, "Clave revocada.");
    const r = await fetch(`${BASE}/api/v1/tickets`, { headers: { authorization: `Bearer ${roKey}` } });
    assert.equal(r.status, 401);
  });
  await step("Sin errores de JavaScript en consola", async () => { assert.equal(consoleErrors.length, 0, consoleErrors.slice(0, 5).join("\n")); });

  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} pruebas OK`);
  if (failed) process.exit(1);
}
main().catch(async (e) => { console.error(e); await browser?.close(); process.exit(1); });
