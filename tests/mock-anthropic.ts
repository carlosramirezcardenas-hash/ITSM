/**
 * Servidor simulado para pruebas E2E sin clave real:
 *  - POST /v1/messages: valida que la petición cumpla lo que exige la API actual y responde
 *    un JSON que satisface el esquema pedido (output_config.format).
 *  - POST /hook: recibe webhooks de integraciones.  GET /__stats: lo recibido.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const stats = { messages: 0, invalid: [] as string[], features: [] as string[], hooks: [] as { headers: Record<string, string>; body: string }[] };

function gen(schema: any, key = ""): unknown {
  if (schema.enum) return schema.enum.find((v: string) => v !== "none") ?? schema.enum[0];
  switch (schema.type) {
    case "object": return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, v]) => [k, gen(v, k)]));
    case "array": return [gen(schema.items, key), gen(schema.items, key)];
    case "number": return 0.9;
    case "integer": return 1;
    case "boolean": return true;
    default: return key.includes("id") ? "id-de-prueba" : `Respuesta simulada (${key || "texto"}).`;
  }
}

function validate(req: any, headers: Record<string, string | string[] | undefined>): string[] {
  const e: string[] = [];
  if (!headers["x-api-key"] && !headers["authorization"]) e.push("falta credencial (x-api-key o authorization)");
  if (req.model !== "claude-opus-5-5") e.push(`modelo inesperado ${req.model}`);
  if (!String(headers["anthropic-beta"] ?? "").includes("server-side-fallback-2026-07-01")) e.push("falta beta server-side-fallback-2026-07-01");
  if (req.fallbacks !== "default") e.push('fallbacks debe ser "default"');
  if (req.output_config?.format?.type !== "json_schema") e.push("falta output_config.format json_schema");
  if (!["low", "medium", "high"].includes(req.output_config?.effort)) e.push("effort inválido");
  for (const k of ["temperature", "top_p", "top_k", "budget_tokens"]) if (k in req) e.push(`parámetro no permitido: ${k}`);
  if (req.thinking && req.thinking.type !== "adaptive") e.push("thinking debe omitirse o ser adaptive");
  if (req.messages?.at(-1)?.role !== "user") e.push("el último mensaje debe ser del usuario (sin prefill)");
  const schema = req.output_config?.format?.schema;
  const check = (s: any, path: string) => {
    if (s?.type === "object") {
      if (s.additionalProperties !== false) e.push(`${path}: additionalProperties debe ser false`);
      for (const k of Object.keys(s.properties ?? {})) { if (!s.required?.includes(k)) e.push(`${path}.${k}: no está en required`); check(s.properties[k], `${path}.${k}`); }
    }
    if (s?.type === "array") check(s.items, `${path}[]`);
  };
  check(schema, "schema");
  return e;
}

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.method === "GET" && req.url === "/__stats") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(stats)); }
    if (req.method === "POST" && req.url === "/__reset") { stats.messages = 0; stats.invalid = []; stats.features = []; stats.hooks = []; res.writeHead(200); return res.end("ok"); }
    if (req.method === "POST" && req.url?.startsWith("/hook")) {
      stats.hooks.push({ headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])), body });
      res.writeHead(200); return res.end("ok");
    }
    if (req.method === "POST" && req.url?.startsWith("/v1/messages")) {
      stats.messages++;
      const r = JSON.parse(body);
      const errs = validate(r, req.headers);
      if (errs.length) stats.invalid.push(...errs);
      const task = String(r.messages?.[0]?.content ?? "");
      stats.features.push(task.slice(0, 40));
      const json = gen(r.output_config?.format?.schema ?? { type: "object", properties: {} });
      res.writeHead(200, { "content-type": "application/json", "request-id": "req_mock" });
      return res.end(JSON.stringify({ id: "msg_mock", type: "message", role: "assistant", model: r.model, content: [{ type: "text", text: JSON.stringify(json) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 300 } }));
    }
    res.writeHead(404); res.end();
  });
}).listen(PORT, () => console.log(`mock anthropic + hooks en :${PORT}`));
