import { db } from "@/lib/db";
import { getSessionUser } from "@/server/auth";
import { api } from "@/server/api";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

export const GET = api(async () => {
  const u = await getSessionUser();
  if (!u) throw new AppError("UNAUTHORIZED", "No autenticado");
  const [items, unread] = await Promise.all([
    db.notification.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.notification.count({ where: { userId: u.id, readAt: null } }),
  ]);
  return { items, unread };
});
