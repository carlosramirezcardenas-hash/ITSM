"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, Mail, Plug, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { createApiKeyAction, deleteIntegrationAction, revokeApiKeyAction, saveIntegrationAction, setAiEnabledAction, testIntegrationAction } from "@/app/actions-ai";
import { Badge, Button, Card, CardHeader, Field, Input, Select } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useActionToast } from "@/components/toast";

const EVENTS: Record<string, string> = {
  "ticket.created": "Ticket creado", "ticket.critical": "Incidente crítico (P1)", "ticket.resolved": "Ticket resuelto", "sla.breached": "SLA vencido",
  "change.pending_approval": "Cambio esperando al CAB", "change.closed": "Cambio cerrado", "problem.known_error": "Nuevo error conocido",
};
const TYPES: Record<string, string> = { teams: "Microsoft Teams", slack: "Slack", webhook: "Webhook (JSON firmado)" };
const FEATURE: Record<string, string> = { triage: "Clasificación", summary: "Resúmenes", reply: "Respuestas sugeridas", rca: "Causa raíz", trends: "Tendencias", selfhelp: "Autoayuda" };

type Integration = { id: string; type: string; name: string; events: string[]; isActive: boolean; url: string; lastDelivery: string | null; lastStatus: string | null; deliveries: { id: string; event: string; ok: boolean; status: number | null; error: string | null; at: string }[] };
type Key = { id: string; name: string; prefix: string; scope: string; createdBy: string; lastUsed: string | null; revoked: boolean; expires: string | null; created: string };

export function IntegrationsClient({ ai, email, integrations, keys }: {
  ai: { configured: boolean; enabled: boolean; model: string; failures: number; usage: { feature: string; calls: number; input: number; output: number }[] };
  email: { configured: boolean; from: string | null };
  integrations: Integration[]; keys: Key[];
}) {
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  const [edit, setEdit] = useState<Integration | "new" | null>(null);
  const [f, setF] = useState({ type: "teams", name: "", url: "", events: ["ticket.critical", "sla.breached"] as string[], isActive: true });
  const [secret, setSecret] = useState<string | null>(null);
  const [keyModal, setKeyModal] = useState(false);
  const [kf, setKf] = useState({ name: "", scope: "read", expiresInDays: 365 });
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const go = (fn: () => Promise<any>, after?: (d: any) => void) => start(async () => { const r = toast(await fn()); if (r.ok) { after?.(r.data); router.refresh(); } });
  const openEdit = (i: Integration | "new") => { setEdit(i); setF(i === "new" ? { type: "teams", name: "", url: "", events: ["ticket.critical", "sla.breached"], isActive: true } : { type: i.type, name: i.name, url: "", events: i.events, isActive: i.isActive }); };
  const totalCalls = ai.usage.reduce((a, u) => a + u.calls, 0);
  const tokens = ai.usage.reduce((a, u) => a + u.input + u.output, 0);

  return (
    <div className="space-y-6">
      {/* IA */}
      <Card>
        <CardHeader title={<span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-violet-500" />Asistente de IA (Claude)</span>}
          description="Clasifica, resume, sugiere respuestas y causas raíz. Siempre como sugerencia: nada crítico se aplica sin confirmación."
          action={ai.configured ? <Button size="sm" variant={ai.enabled ? "outline" : "primary"} loading={pending} onClick={() => go(() => setAiEnabledAction(!ai.enabled))}>{ai.enabled ? "Desactivar" : "Activar"}</Button> : undefined} />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <div><p className="text-xs text-muted">Estado</p><p className="mt-1">{!ai.configured ? <Badge tone="amber">Falta la clave ANTHROPIC_API_KEY</Badge> : ai.enabled ? <Badge tone="green" dot>Activo</Badge> : <Badge>Desactivado</Badge>}</p><p className="mt-1 text-xs text-muted">Modelo {ai.model}</p></div>
          <div><p className="text-xs text-muted">Uso últimos 30 días</p><p className="mt-1 text-lg font-semibold tabular-nums">{totalCalls} <span className="text-sm font-normal text-muted">consultas</span></p><p className="text-xs text-muted">{tokens.toLocaleString("es")} tokens · {ai.failures} con error</p></div>
          <div className="text-xs text-muted">{ai.usage.length ? ai.usage.map((u) => <p key={u.feature}>{FEATURE[u.feature] ?? u.feature}: {u.calls}</p>) : "Sin uso todavía."}</div>
        </div>
        <p className="border-t border-border px-5 py-3 text-xs text-muted">Privacidad: los campos marcados como sensibles (cifrados) nunca se envían a la IA; el análisis de tendencias usa solo datos agregados.{!ai.configured && " Para activarla, agrega la variable ANTHROPIC_API_KEY en el proyecto de Vercel y vuelve a desplegar."}</p>
      </Card>

      {/* Integraciones */}
      <Card>
        <CardHeader title={<span className="flex items-center gap-1.5"><Plug className="h-4 w-4" />Notificaciones a otras herramientas</span>} description="Envía eventos a canales de Microsoft Teams o Slack, o a tu propio sistema (webhook firmado con HMAC-SHA256)." action={<Button size="sm" onClick={() => openEdit("new")}><Plus className="h-4 w-4" />Conectar</Button>} />
        {integrations.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Sin integraciones. Conecta un canal de Teams para avisar al equipo de incidentes críticos y SLA vencidos.</p> : (
          <ul className="divide-y divide-border">
            {integrations.map((i) => (
              <li key={i.id} className="px-5 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">{i.name}<Badge>{TYPES[i.type]}</Badge>{!i.isActive && <Badge tone="amber">Pausada</Badge>}</p>
                    <p className="mt-0.5 text-xs text-muted">{i.url} · {i.events.map((e) => EVENTS[e]).join(", ")}</p>
                    <p className="mt-0.5 text-xs text-muted">{i.lastDelivery ? <>Último envío {i.lastDelivery}: {i.lastStatus === "ok" ? <span className="text-emerald-600">entregado</span> : <span className="text-red-600">{i.lastStatus}</span>}</> : "Sin envíos todavía"}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => go(() => testIntegrationAction(i.id))}><Send className="h-3.5 w-3.5" />Probar</Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(i)}>Editar</Button>
                    <Button size="sm" variant="ghost" className="text-red-600" disabled={pending} onClick={() => { if (confirm(`¿Eliminar «${i.name}»?`)) go(() => deleteIntegrationAction(i.id)); }} aria-label="Eliminar"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Claves de API */}
      <Card>
        <CardHeader title={<span className="flex items-center gap-1.5"><KeyRound className="h-4 w-4" />Claves de API</span>} description="Para integrar otros sistemas con la API REST (/api/v1). Actúan con los permisos de quien las crea." action={<Button size="sm" onClick={() => { setKf({ name: "", scope: "read", expiresInDays: 365 }); setNewKey(null); setKeyModal(true); }}><Plus className="h-4 w-4" />Crear clave</Button>} />
        {keys.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Sin claves.</p> : (
          <ul className="divide-y divide-border">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-col gap-2 px-5 py-3 text-sm sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{k.name} <Badge tone={k.scope === "read_write" ? "amber" : "slate"}>{k.scope === "read_write" ? "Lectura y escritura" : "Solo lectura"}</Badge> {k.revoked && <Badge tone="red">Revocada</Badge>}</p>
                  <p className="text-xs text-muted"><code>{k.prefix}…</code> · creada por {k.createdBy} {k.created} · {k.lastUsed ? `usada ${k.lastUsed}` : "sin uso"}{k.expires ? ` · vence ${k.expires}` : ""}</p>
                </div>
                {!k.revoked && <Button size="sm" variant="ghost" className="text-red-600" disabled={pending} onClick={() => { if (confirm(`¿Revocar «${k.name}»? Los sistemas que la usan dejarán de tener acceso.`)) go(() => revokeApiKeyAction(k.id)); }}>Revocar</Button>}
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-border px-5 py-3 text-xs text-muted">Uso: <code>Authorization: Bearer itsm_…</code> · Ejemplo: <code>GET /api/v1/tickets?status=open</code></p>
      </Card>

      {/* Correo */}
      <Card>
        <CardHeader title={<span className="flex items-center gap-1.5"><Mail className="h-4 w-4" />Correo electrónico</span>} description="Recuperación de contraseña y avisos que requieren acción (aprobaciones)." />
        <div className="px-5 py-4 text-sm">{email.configured ? <p><Badge tone="green" dot>Configurado</Badge> <span className="ml-2 text-muted">Remitente: {email.from}</span></p> : <p className="text-muted"><Badge tone="amber">No configurado</Badge><span className="ml-2">Agrega RESEND_API_KEY y EMAIL_FROM en Vercel. Mientras tanto, los avisos llegan solo dentro de la aplicación.</span></p>}</div>
        <p className="border-t border-border px-5 py-3 text-xs text-muted">No implementado aún: creación de tickets desde correos entrantes e inicio de sesión único (SSO).</p>
      </Card>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? "Conectar herramienta" : "Editar integración"} size="lg"
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button><Button loading={pending} onClick={() => go(() => saveIntegrationAction(edit === "new" ? null : (edit as Integration).id, { ...f, url: f.url || undefined }), (d) => { setEdit(null); if (d?.secret) setSecret(d.secret); })}>Guardar</Button></>}>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tipo" htmlFor="it"><Select id="it" value={f.type} disabled={edit !== "new"} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Nombre" htmlFor="iname" required><Input id="iname" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej: Canal #mesa-de-ayuda" /></Field>
          </div>
          <Field label={edit === "new" ? "URL del webhook" : "Nueva URL (vacío = mantener la actual)"} htmlFor="iurl" required={edit === "new"}
            hint={f.type === "teams" ? "En Teams: canal → Flujos de trabajo → «Publicar en un canal cuando se reciba una solicitud de webhook»." : f.type === "slack" ? "En Slack: Apps → Incoming Webhooks → Add to Slack." : "Tu endpoint HTTPS. Firmamos cada envío con HMAC-SHA256 (cabeceras x-itsm-signature y x-itsm-timestamp)."}>
            <Input id="iurl" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" />
          </Field>
          <div>
            <p className="mb-2 text-[13px] font-medium">Eventos</p>
            <div className="grid gap-1.5 sm:grid-cols-2">{Object.entries(EVENTS).map(([k, v]) => (
              <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.events.includes(k)} onChange={(e) => setF({ ...f, events: e.target.checked ? [...f.events, k] : f.events.filter((x) => x !== k) })} />{v}</label>
            ))}</div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />Activa</label>
        </div>
      </Modal>

      <Modal open={!!secret} onClose={() => setSecret(null)} title="Secreto de firma del webhook" description="Guárdalo en tu sistema para verificar los envíos. No se volverá a mostrar." footer={<Button onClick={() => setSecret(null)}>Listo</Button>}>
        <code className="block break-all rounded-lg bg-subtle p-3 text-sm">{secret}</code>
      </Modal>

      <Modal open={keyModal} onClose={() => setKeyModal(false)} title={newKey ? "Tu nueva clave" : "Crear clave de API"}
        footer={newKey ? <Button onClick={() => setKeyModal(false)}>Listo</Button> : <><Button variant="ghost" onClick={() => setKeyModal(false)}>Cancelar</Button><Button loading={pending} onClick={() => go(() => createApiKeyAction(kf), (d) => setNewKey(d.key))}>Crear</Button></>}>
        {newKey ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">Cópiala ahora y guárdala en un lugar seguro: no se volverá a mostrar.</p>
            <div className="flex gap-2"><code className="flex-1 break-all rounded-lg bg-subtle p-3 text-sm" data-testid="new-api-key">{newKey}</code>
              <Button variant="outline" onClick={() => { navigator.clipboard?.writeText(newKey).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }} aria-label="Copiar">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button></div>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="Nombre" htmlFor="kname" required hint="Para identificar qué sistema la usa."><Input id="kname" value={kf.name} onChange={(e) => setKf({ ...kf, name: e.target.value })} placeholder="Ej: Monitoreo Zabbix" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Permisos" htmlFor="kscope"><Select id="kscope" value={kf.scope} onChange={(e) => setKf({ ...kf, scope: e.target.value })}><option value="read">Solo lectura</option><option value="read_write">Lectura y escritura</option></Select></Field>
              <Field label="Vence en (días)" htmlFor="kexp" hint="0 = sin vencimiento"><Input id="kexp" type="number" min={0} max={730} value={kf.expiresInDays} onChange={(e) => setKf({ ...kf, expiresInDays: Number(e.target.value) })} /></Field>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
