import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type Client = Prisma.TransactionClient | typeof db;

/** Bitácora de problemas y cambios: actividad del sistema y notas de trabajo. */
export async function log(client: Client, orgId: string, entityType: "problem" | "change", entityId: string, actorId: string | null, action: string, note?: string | null) {
  await client.workLog.create({ data: { orgId, entityType, entityId, actorId, action, note: note ?? null } });
}

export async function getLogs(orgId: string, entityType: "problem" | "change", entityId: string) {
  return db.workLog.findMany({ where: { orgId, entityType, entityId }, include: { actor: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
}
