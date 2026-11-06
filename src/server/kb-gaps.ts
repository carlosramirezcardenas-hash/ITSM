import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { matchScore, tokens } from "@/lib/classify";
import { slugify } from "@/lib/utils";
import { type Ctx, assertCan } from "./auth";
import { audit } from "./audit";
import { notFound } from "./errors";
import { aiAvailable, callJson, clip } from "./ai";
import { throttle } from "./ai-features";

/**
 * «Lo que falta en el centro de ayuda»: agrupa en temas lo que la gente preguntó y no tuvo buena respuesta
 * (conversaciones del asistente sin guía/solución/servicio o con 👎) y los incidentes recientes que ninguna guía cubre.
 * Desde un tema se crea un BORRADOR de guía (con IA o con las soluciones reales); siempre lo revisa y publica una persona.
 */

const WINDOW_DAYS = 30;
const GENERIC = new Set("neces quier solic pedir ayuda favor tengo hola graci funci probl puedo algo cosa urgen sigue otra otro desde hasta cuand donde porqu mucho poco ahora todav bien malo hace tiene".split(" "));
const stem = (w: string) => w.slice(0, 5);
const stemsOf = (text: string) => new Set([...tokens(text)].map(stem).filter((s) => s.length >= 3 && !GENERIC.has(s)));

type Item = { kind: "assistant" | "ticket"; text: string; who: string; ticketId?: string; resolution?: string | null; categoryId?: string | null; stems: Set<string>; at: Date };

export type Gap = {
  key: string; label: string; count: number; people: number; examples: string[]; fromAssistant: number; fromTickets: number;
  resolutions: string[]; categoryId: string | null; topWords: string[];
  draft: { id: string; title: string } | null; // ya hay un borrador en revisión
  unfound: { id: string; title: string; slug: string } | null; // existe la guía pero no la encontraron
};

async function collect(orgId: string): Promise<Item[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000);
  const [inter, tickets, published] = await Promise.all([
    db.assistantInteraction.findMany({
      where: {
        orgId, createdAt: { gte: since }, intent: { not: "status" },
        OR: [{ feedback: -1 }, { outcome: "ticket" }, { AND: [{ articleIds: { isEmpty: true } }, { solutionIds: { isEmpty: true } }, { serviceId: null }] }],
      },
      select: { query: true, userId: true, ticketId: true, createdAt: true }, take: 2000, orderBy: { createdAt: "desc" },
    }),
    db.ticket.findMany({
      where: { orgId, type: "INCIDENT", createdAt: { gte: since }, linkedArticles: { none: {} } },
      select: { id: true, title: true, requesterId: true, resolution: true, categoryId: true, createdAt: true }, take: 2000, orderBy: { createdAt: "desc" },
    }),
    db.kbArticle.findMany({ where: { orgId, status: "PUBLISHED" }, select: { title: true, summary: true, tags: true } }),
  ]);
  const covered = (text: string) => published.some((a) => matchScore(text, `${a.title} ${a.summary} ${a.tags.join(" ")}`) >= 0.5);
  const fromChat = new Set(inter.map((i) => i.ticketId).filter(Boolean) as string[]);
  const items: Item[] = [];
  for (const i of inter) items.push({ kind: "assistant", text: i.query, who: i.userId, stems: stemsOf(i.query), at: i.createdAt });
  for (const t of tickets) {
    if (fromChat.has(t.id)) continue; // ya contado como conversación
    if (covered(t.title)) continue; // hay una guía que lo cubre (aunque no se haya vinculado)
    items.push({ kind: "ticket", text: t.title, who: t.requesterId, ticketId: t.id, resolution: t.resolution, categoryId: t.categoryId, stems: stemsOf(t.title), at: t.createdAt });
  }
  // Las conversaciones que terminaron en reporte aportan la solución del ticket resultante
  const chatTickets = await db.ticket.findMany({ where: { orgId, id: { in: [...fromChat] } }, select: { id: true, resolution: true, categoryId: true } });
  const byId = new Map(chatTickets.map((t) => [t.id, t]));
  for (const i of inter) {
    if (!i.ticketId) continue;
    const it = items.find((x) => x.kind === "assistant" && x.text === i.query && x.at === i.createdAt);
    const t = byId.get(i.ticketId);
    if (it && t) { it.resolution = t.resolution; it.categoryId = t.categoryId; it.ticketId = t.id; }
  }
  return items.filter((x) => x.stems.size > 0);
}

/** Agrupación simple por raíces compartidas (sin IA): un elemento se une al tema si comparte la mitad de sus raíces centrales. */
function cluster(items: Item[]) {
  type C = { members: Item[]; freq: Map<string, number> };
  const clusters: C[] = [];
  const core = (c: C) => {
    const min = Math.max(1, Math.ceil(c.members.length * 0.4));
    return [...c.freq].filter(([, n]) => n >= min).map(([s]) => s);
  };
  for (const it of items) {
    let best: { c: C; score: number } | null = null;
    for (const c of clusters) {
      const k = core(c);
      if (!k.length) continue;
      let inter = 0;
      for (const s of k) if (it.stems.has(s)) inter++;
      const score = inter / Math.min(k.length, it.stems.size);
      if (inter >= 1 && score >= 0.5 && (!best || score > best.score)) best = { c, score };
    }
    const c = best?.c ?? (clusters[clusters.push({ members: [], freq: new Map() }) - 1]!);
    c.members.push(it);
    for (const s of it.stems) c.freq.set(s, (c.freq.get(s) ?? 0) + 1);
  }
  return clusters.map((c) => ({ members: c.members, core: core(c).sort((a, b) => (c.freq.get(b)! - c.freq.get(a)!) || a.localeCompare(b)) }));
}

export async function knowledgeGaps(ctx: Ctx): Promise<Gap[]> {
  assertCan(ctx, "kb:manage");
  const [items, dismissed, articles] = await Promise.all([
    collect(ctx.orgId),
    db.kbGapDismissal.findMany({ where: { orgId: ctx.orgId }, select: { key: true } }),
    db.kbArticle.findMany({ where: { orgId: ctx.orgId }, select: { id: true, title: true, slug: true, summary: true, tags: true, status: true, updatedAt: true } }),
  ]);
  const hidden = new Set(dismissed.map((d) => d.key));
  const gaps: Gap[] = [];
  for (const c of cluster(items)) {
    const people = new Set(c.members.map((m) => m.who)).size;
    if (c.members.length < 2) continue; // un caso aislado no es un tema
    const key = c.core.slice(0, 3).sort().join("-");
    if (!key || hidden.has(key)) continue;
    // Etiqueta: el texto más corto que contiene más raíces centrales
    const label = [...c.members].sort((a, b) => {
      const ca = c.core.filter((s) => a.stems.has(s)).length, cb = c.core.filter((s) => b.stems.has(s)).length;
      return cb - ca || a.text.length - b.text.length;
    })[0]!.text;
    const words = new Map<string, number>();
    for (const m of c.members) for (const w of tokens(m.text)) if (c.core.includes(stem(w))) words.set(w, (words.get(w) ?? 0) + 1);
    const topWords = [...words].sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, 6);
    const cats = new Map<string, number>();
    for (const m of c.members) if (m.categoryId) cats.set(m.categoryId, (cats.get(m.categoryId) ?? 0) + 1);
    const match = (statuses: string[]) => articles.filter((a) => statuses.includes(a.status))
      .map((a) => ({ a, s: matchScore(c.core.join(" "), [...stemsOf(`${a.title} ${a.summary} ${a.tags.join(" ")}`)].join(" ")) }))
      .filter((x) => x.s >= 0.5).sort((x, y) => y.s - x.s)[0]?.a;
    const draft = match(["DRAFT"]);
    const pub = match(["PUBLISHED"]);
    const lastAsked = Math.max(...c.members.map((m) => m.at.getTime()));
    if (pub && pub.updatedAt.getTime() > lastAsked) continue; // se publicó/mejoró la guía después de la última consulta: resuelto
    gaps.push({
      key, label: clip(label, 140), count: c.members.length, people,
      examples: [...new Set(c.members.map((m) => clip(m.text, 140)))].slice(0, 5),
      fromAssistant: c.members.filter((m) => m.kind === "assistant").length,
      fromTickets: c.members.filter((m) => m.kind === "ticket").length,
      resolutions: [...new Set(c.members.map((m) => (m.resolution ?? "").trim()).filter((r) => r.length >= 15))].slice(0, 5),
      categoryId: [...cats].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      topWords,
      draft: draft ? { id: draft.id, title: draft.title } : null,
      unfound: pub ? { id: pub.id, title: pub.title, slug: pub.slug } : null,
    });
  }
  return gaps.sort((a, b) => b.people - a.people || b.count - a.count).slice(0, 30);
}

async function findGap(ctx: Ctx, key: string) {
  const g = (await knowledgeGaps(ctx)).find((x) => x.key === key);
  if (!g) throw notFound("Ese tema ya no está pendiente.");
  return g;
}

/** Crea un BORRADOR de guía para un tema. Con IA redacta a partir de las preguntas y soluciones reales; sin IA arma una plantilla con esas soluciones. */
export async function draftArticleForGap(ctx: Ctx, rawKey: unknown) {
  assertCan(ctx, "kb:manage");
  const key = z.string().min(1).max(200).parse(rawKey);
  const g = await findGap(ctx, key);
  if (g.draft) return { id: g.draft.id, ai: false };
  const categories = await db.category.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } });
  let title = g.label.replace(/[.¡!¿?]+$/g, "");
  let summary = `Qué hacer cuando: ${g.label.toLowerCase()}`.slice(0, 290);
  let steps = g.resolutions.length
    ? g.resolutions.flatMap((r) => r.split(/(?<=\.)\s+/)).map((x) => x.trim()).filter((x) => x.length > 8).slice(0, 8)
    : [];
  let tags = g.topWords;
  let categoryId = g.categoryId;
  let ai = false;

  if (await aiAvailable(ctx.orgId)) {
    try {
      throttle(ctx.user.id, 15);
      const r = await callJson<{ title: string; summary: string; steps: string[]; tags: string[]; category_id: string }>(ctx, "kb_draft", {
        task: `Redacta una guía de autoayuda para empleados (no técnicos) sobre este tema de la mesa de ayuda.
- title: cómo lo diría un empleado (máx. 90 caracteres). summary: una frase (máx. 200).
- steps: pasos concretos en orden, cada uno una frase simple. Usa SOLO lo que aparece en las soluciones aplicadas por el equipo;
  si no hay soluciones o no sirven para un empleado, deja steps vacío (el equipo lo completará). No inventes pasos.
  Si un paso solo lo puede hacer TI, el paso debe ser «Si no se soluciona, envía un reporte desde el asistente».
- tags: 3 a 8 palabras que usaría la gente para buscarlo (incluye las de las preguntas).
- category_id: id de la lista o "none".`,
        data: `Lo que preguntó la gente:\n${g.examples.map((e) => `- ${e}`).join("\n")}\n\nSoluciones aplicadas por el equipo:\n${g.resolutions.map((r) => `- ${clip(r, 600)}`).join("\n") || "(ninguna)"}\n\nCategorías:\n${categories.map((c) => `- ${c.id} | ${c.name}`).join("\n")}`,
        schema: {
          type: "object", additionalProperties: false, required: ["title", "summary", "steps", "tags", "category_id"],
          properties: { title: { type: "string" }, summary: { type: "string" }, steps: { type: "array", items: { type: "string" } }, tags: { type: "array", items: { type: "string" } }, category_id: { type: "string" } },
        },
        effort: "medium",
        maxTokens: 3000,
      });
      title = r.title.trim() || title;
      summary = r.summary.trim() || summary;
      steps = r.steps.map((s) => s.trim()).filter(Boolean).slice(0, 12);
      tags = [...new Set([...r.tags, ...g.topWords].map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
      if (categories.some((c) => c.id === r.category_id)) categoryId = r.category_id;
      ai = true;
    } catch (e) {
      console.error("[kb-gaps] borrador sin IA", e instanceof Error ? e.message : e);
    }
  }

  const body = [
    "Si te pasa algo como esto:",
    ...g.examples.slice(0, 4).map((e) => `- «${e}»`),
    "",
    "Qué hacer:",
    ...(steps.length ? steps.map((s, i) => `${i + 1}. ${s.replace(/^\d+[.)]\s*/, "")}`) : ["1. [Completar: pasos que usa el equipo de soporte]"]),
    `${(steps.length || 1) + 1}. Si no se soluciona, envía un reporte desde el asistente y el equipo te ayudará.`,
    "",
    `> Borrador ${ai ? "redactado por IA" : "armado automáticamente"} a partir de ${g.count} consultas y casos reales. Revísalo y borra esta nota antes de publicar.`,
  ].join("\n");

  let slug = slugify(title) || "guia";
  if (await db.kbArticle.findUnique({ where: { orgId_slug: { orgId: ctx.orgId, slug } } })) slug = `${slug}-${Date.now().toString(36)}`;
  const a = await db.kbArticle.create({
    data: {
      orgId: ctx.orgId, slug, title: title.slice(0, 140), summary: summary.slice(0, 300).padEnd(10, "."), body: body.slice(0, 20000),
      tags: tags.slice(0, 15), categoryId, status: "DRAFT", authorId: ctx.user.id,
    },
  });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "kb.draft_from_gap", entity: "article", entityId: a.id, meta: { key, ai, cases: g.count } });
  return { id: a.id, ai };
}

/** La guía existe pero la gente no la encontró: se le agregan las palabras que usaron. */
export async function addGapWordsToArticle(ctx: Ctx, rawKey: unknown, rawArticleId: unknown) {
  assertCan(ctx, "kb:manage");
  const key = z.string().min(1).max(200).parse(rawKey);
  const articleId = z.string().min(1).max(40).parse(rawArticleId);
  const g = await findGap(ctx, key);
  const a = await db.kbArticle.findFirst({ where: { id: articleId, orgId: ctx.orgId } });
  if (!a) throw notFound();
  const tags = [...new Set([...a.tags, ...g.topWords.map((w) => w.toLowerCase())])].slice(0, 15);
  await db.kbArticle.update({ where: { id: a.id }, data: { tags } });
  await db.kbGapDismissal.upsert({ where: { orgId_key: { orgId: ctx.orgId, key } }, create: { orgId: ctx.orgId, key, label: g.label, userId: ctx.user.id }, update: {} });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "kb.tags_from_gap", entity: "article", entityId: a.id, meta: { key, added: tags.filter((t) => !a.tags.includes(t)) } });
  return { added: tags.filter((t) => !a.tags.includes(t)) };
}

export async function dismissGap(ctx: Ctx, rawKey: unknown) {
  assertCan(ctx, "kb:manage");
  const key = z.string().min(1).max(200).parse(rawKey);
  const g = await findGap(ctx, key);
  await db.kbGapDismissal.upsert({ where: { orgId_key: { orgId: ctx.orgId, key } }, create: { orgId: ctx.orgId, key, label: g.label, userId: ctx.user.id }, update: {} });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "kb.gap_dismissed", entity: "gap", entityId: key, meta: { label: g.label } });
}
