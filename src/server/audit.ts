import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export async function audit(params: {
  orgId?: string | null;
  actor?: { id: string; name: string } | null;
  action: string;
  entity: string;
  entityId?: string | null;
  meta?: Prisma.InputJsonValue;
  ip?: string | null;
}) {
  try {
    await db.auditLog.create({
      data: {
        orgId: params.orgId ?? null,
        actorId: params.actor?.id ?? null,
        actorName: params.actor?.name ?? null,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId ?? null,
        meta: params.meta,
        ip: params.ip ?? null,
      },
    });
  } catch (e) {
    console.error("[audit] failed", e);
  }
}
