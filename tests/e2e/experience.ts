/**
 * Pruebas de las dos experiencias (Portal del empleado / Operaciones TI), el catálogo visual y el asistente en modo básico.
 * Requiere el servidor en marcha SIN ANTHROPIC_API_KEY (el modo con IA se prueba en phase3.ts contra el simulador).
 *   npm run build && npm start   (en otra terminal)
 *   npm run test:e2e:x
 */
import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let browser: Browser;
const results: { name: string; ok: boolean }[] = [];
const consoleErrors: string[] = [];

async function session(email: string, opts: { mobile?: boolean } = {}) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
  const page = await ctx.newPage();
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
  catch (e) { results.push({ name, ok: false }); console.log(`  ✘ ${name}\n    ${(e as Error).message.split("\n").slice(0, 3).join("\n    ")}`); }
}

async function main() {
  browser = await chromium.launch();
  const stamp = Date.now().toString(36);

  console.log("Portal del empleado (Ana)");
  const ana = await session("ana@andes.demo");
  const send = async (text: string) => {
    const before = await ana.locator("p.bg-subtle").count();
    await ana.getByLabel("Mensaje para el asistente").fill(text);
    await ana.getByRole("button", { name: "Enviar mensaje" }).click();
    await ana.waitForFunction((n) => document.querySelectorAll("p.bg-subtle").length > n, before, { timeout: 15000 });
  };

  await step("Usuario final ve el portal: navegación simple, sin módulos de TI ni selector", async () => {
    const nav = ana.getByRole("navigation", { name: "Principal" });
    for (const l of ["Inicio", "Servicios", "Mis solicitudes", "Ayuda"]) await nav.getByRole("link", { name: l }).waitFor();
    for (const l of ["Bandeja de trabajo", "Problemas", "Cambios", "CMDB"]) assert.equal(await ana.getByRole("link", { name: l, exact: true }).count(), 0, `no debe ver ${l}`);
    assert.equal(await ana.getByRole("radiogroup", { name: "Experiencia" }).count(), 0);
    // Sin jerga ITIL en el inicio del empleado
    const text = await ana.locator("main").innerText();
    for (const w of ["SLA", "ITIL", "CMDB", "Incidente"]) assert.ok(!text.includes(w), `no debe decir ${w}`);
  });
  await step("Forzar la cookie de Operaciones no da acceso a un usuario final", async () => {
    await ana.context().addCookies([{ name: "itsm_exp", value: "ops", url: BASE }]);
    await ana.goto("/home");
    await ana.getByRole("heading", { name: "¿En qué podemos ayudarte?" }).waitFor();
    assert.equal(await ana.getByRole("link", { name: "Bandeja de trabajo" }).count(), 0);
  });
  await step("Catálogo visual: destacado, filas por categoría y búsqueda", async () => {
    await ana.goto("/catalog");
    await ana.getByText("Lo más pedido").first().waitFor();
    await ana.getByRole("link", { name: "Solicitar ahora" }).waitFor();
    await ana.getByRole("region", { name: /Popular en Andes Logística/ }).waitFor();
    await ana.getByRole("region", { name: "Accesos y contraseñas" }).waitFor();
    await ana.getByRole("region", { name: "Pedir de nuevo" }).waitFor(); // Ana ya pidió servicios en los datos demo
    // flecha de la fila desplaza el carrusel
    const row = ana.getByRole("region", { name: /Popular en Andes Logística/ });
    const scroller = row.locator("div.overflow-x-auto");
    await row.getByRole("button", { name: /Siguientes/ }).click();
    await ana.waitForFunction((el) => (el as HTMLElement).scrollLeft > 0, await scroller.elementHandle(), { timeout: 5000 });
    // búsqueda → cuadrícula filtrada
    await ana.getByLabel("Buscar en el catálogo").fill("notebook");
    await ana.keyboard.press("Enter");
    await ana.getByRole("heading", { name: "Resultados para «notebook»" }).waitFor();
    assert.equal(await ana.locator("main a[href^='/catalog/c']").count(), 1);
    // el servicio destacado lleva a su formulario
    await ana.goto("/catalog");
    await ana.getByRole("link", { name: "Solicitar ahora" }).click();
    await ana.waitForURL(/\/catalog\/c/);
    await ana.getByRole("button", { name: "Enviar solicitud" }).waitFor();
  });
  await step("Asistente: entiende un pedido y lleva al servicio del catálogo", async () => {
    await ana.goto("/assistant");
    await send("necesito un notebook nuevo para un colaborador");
    await ana.getByText("Para eso tenemos el servicio «Solicitar un notebook»").waitFor();
    await ana.getByText("Modo básico").waitFor();
    await ana.getByRole("link", { name: "Solicitar", exact: true }).last().click();
    await ana.waitForURL(/\/catalog\/c/);
    await ana.getByRole("heading", { name: "Solicitar un notebook" }).waitFor();
  });
  await step("Asistente: sugiere la guía y, si no resulta, deja el reporte listo (sin enviarlo solo)", async () => {
    await ana.goto("/assistant");
    await send("no puedo conectarme a la VPN desde mi casa");
    await ana.getByRole("link", { name: /Conectarse a la VPN desde casa/ }).waitFor();
    const total = async () => ((await (await ana.request.get("/api/v1/tickets")).json()) as { total: number }).total;
    const before = await total();
    await send("ya probé la guía y sigue sin funcionar");
    const draft = ana.getByLabel("Título del reporte").last();
    await draft.waitFor();
    // Nada se creó todavía: la persona debe confirmar
    assert.equal(await total(), before, "el asistente no crea nada sin confirmación");
    await draft.fill(`VPN no conecta desde casa ${stamp}`);
    await ana.getByRole("button", { name: "Enviar reporte" }).last().click();
    await ana.getByText(/Tu número de seguimiento es/).waitFor();
    await ana.getByRole("link", { name: "Ver seguimiento" }).click();
    await ana.waitForURL(/\/tickets\//);
    await ana.getByRole("heading", { name: `VPN no conecta desde casa ${stamp}` }).waitFor();
  });
  await step("Asistente: responde el estado de mis solicitudes", async () => {
    await ana.goto("/assistant");
    await send("¿cómo van mis solicitudes?");
    await ana.getByText(/solicitud(es)? en curso/).waitFor();
    await ana.getByRole("link", { name: new RegExp(`VPN no conecta desde casa ${stamp}`) }).waitFor();
  });
  await step("Pregunta desde el inicio abre el asistente con el mensaje", async () => {
    await ana.goto("/home");
    await ana.getByLabel("Pregúntale al asistente").fill("olvidé mi contraseña");
    await ana.getByRole("button", { name: "Preguntar" }).click();
    await ana.waitForURL(/\/assistant\?q=/);
    await ana.locator("p.bg-subtle").first().waitFor({ timeout: 15000 });
    assert.equal(await ana.getByText("olvidé mi contraseña", { exact: true }).count(), 1, "se envía una sola vez");
  });
  await step("Asistente flotante: abre, conserva la conversación y cierra con Escape", async () => {
    await ana.goto("/catalog");
    await ana.getByRole("button", { name: /Pregúntale al asistente/ }).click();
    const dlg = ana.getByRole("dialog", { name: "Asistente" });
    await dlg.waitFor();
    await dlg.getByLabel("Mensaje para el asistente").fill("necesito acceso a una carpeta compartida");
    await dlg.getByRole("button", { name: "Enviar mensaje" }).click();
    await dlg.getByText(/Permiso a carpeta compartida/).first().waitFor({ timeout: 15000 });
    await ana.keyboard.press("Escape");
    await dlg.waitFor({ state: "hidden" });
    await ana.getByRole("button", { name: /Pregúntale al asistente/ }).click();
    await dlg.getByText("necesito acceso a una carpeta compartida").waitFor();
  });

  console.log("Equipo de TI (Camila, agente)");
  const cam = await session("camila@andes.demo");
  await step("El agente entra a Operaciones TI y puede cambiar al portal y volver", async () => {
    await cam.getByRole("heading", { name: "Tu día de un vistazo" }).waitFor();
    await cam.getByRole("link", { name: /Bandeja de trabajo/ }).waitFor();
    await cam.getByRole("radio", { name: /Portal del empleado/ }).click();
    await cam.getByRole("heading", { name: "¿En qué podemos ayudarte?" }).waitFor();
    assert.equal(await cam.getByRole("link", { name: /Bandeja de trabajo/ }).count(), 0);
    // la preferencia se recuerda
    await cam.goto("/catalog");
    await cam.getByRole("navigation", { name: "Principal" }).waitFor();
    await cam.getByRole("radio", { name: /Operaciones TI/ }).click();
    await cam.getByRole("heading", { name: "Tu día de un vistazo" }).waitFor();
    // en modo portal sigue pudiendo abrir sus herramientas por URL (permisos intactos)
    await cam.goto("/queue");
    await cam.getByRole("heading", { name: "Bandeja de trabajo" }).waitFor();
  });

  console.log("Móvil");
  const mob = await session("ana@andes.demo", { mobile: true });
  await step("Móvil: catálogo sin scroll horizontal y menú con asistente", async () => {
    await mob.goto("/catalog");
    await mob.getByRole("link", { name: "Solicitar ahora" }).waitFor();
    assert.equal(await mob.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
    await mob.getByRole("button", { name: "Abrir menú" }).click();
    await mob.getByRole("link", { name: "Asistente", exact: true }).click();
    await mob.waitForURL(/\/assistant/);
  });

  const camMob = await session("camila@andes.demo", { mobile: true });
  await step("Móvil (agente): Operaciones TI sin scroll horizontal y selector en el menú", async () => {
    assert.equal(await camMob.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
    await camMob.getByRole("button", { name: "Abrir menú" }).click();
    await camMob.getByRole("radio", { name: /Portal/ }).last().click();
    await camMob.getByRole("heading", { name: "¿En qué podemos ayudarte?" }).waitFor();
    assert.equal(await camMob.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
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
