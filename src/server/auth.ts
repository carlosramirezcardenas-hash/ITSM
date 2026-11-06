import "server-only";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";
import { can, type Permission } from "@/lib/rbac";
import { AppError, forbidden } from "./errors";
import { audit } from "./audit";

export const SESSION_COOKIE = "itsm_session";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000; // duración máxima
const IDLE_TIMEOUT_MS = 12 * 3600 * 1000;    // cierre por inactividad
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  orgId: string | null;
  orgName: string | null;
  sessionId: string;
};

/** Contexto de tenant: toda operación de negocio recibe esto y filtra por orgId. */
export type Ctx = { user: SessionUser; orgId: string };

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}

export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 10) return "La contraseña debe tener al menos 10 caracteres.";
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return "Usa letras y números en tu contraseña.";
  return null;
}

async function clientInfo() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "local",
    userAgent: h.get("user-agent")?.slice(0, 250) ?? null,
  };
}

// Limitador simple en memoria por IP (en producción: Redis).
const attempts = new Map<string, { count: number; reset: number }>();
/** Falla si la clave ya superó el máximo, sin sumar un intento. */
function checkLimit(key: string, max: number) {
  const e = attempts.get(key);
  if (e && e.reset > Date.now() && e.count >= max) throw new AppError("RATE_LIMIT", "Demasiados intentos. Espera unos minutos.");
}
function rateLimit(key: string, max = 20, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.reset < now) {
    attempts.set(key, { count: 1, reset: now + windowMs });
    return;
  }
  entry.count++;
  if (entry.count > max) throw new AppError("RATE_LIMIT", "Demasiados intentos. Espera unos minutos.");
}

let dummyHash: string | undefined;

export async function login(email: string, password: string) {
  const { ip, userAgent } = await clientInfo();
  const ipKey = `login-fail-ip:${ip}`;
  checkLimit(ipKey, 50); // oficinas detrás de una misma IP: solo cuentan los fallidos
  const failKey = `login-fail:${ip}:${email.toLowerCase().trim()}`;
  checkLimit(failKey, 10); // solo cuentan los intentos fallidos
  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() }, include: { org: true } });
  const generic = new AppError("UNAUTHORIZED", "Correo o contraseña incorrectos.");
  if (!user) {
    rateLimit(failKey, 1000);
    rateLimit(ipKey, 1000);
    dummyHash ??= await bcrypt.hash("dummy-password", 12);
    await bcrypt.compare(password, dummyHash); // tiempo constante: no revela si el correo existe
    throw generic;
  }
  if (!user.isActive || (user.org && !user.org.isActive)) throw new AppError("UNAUTHORIZED", "Tu cuenta está desactivada. Contacta a tu administrador.");
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError("UNAUTHORIZED", "Cuenta bloqueada temporalmente por intentos fallidos. Intenta en 15 minutos.");
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLogins + 1;
    await db.user.update({
      where: { id: user.id },
      data: { failedLogins: failed >= MAX_FAILED ? 0 : failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MS) : null },
    });
    await audit({ orgId: user.orgId, actor: user, action: "auth.login_failed", entity: "user", entityId: user.id, ip });
    rateLimit(failKey, 1000);
    rateLimit(ipKey, 1000);
    throw generic;
  }
  attempts.delete(failKey);
  const token = randomToken();
  const session = await db.session.create({
    data: { tokenHash: sha256(token), userId: user.id, ip, userAgent, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await audit({ orgId: user.orgId, actor: user, action: "auth.login", entity: "session", entityId: session.id, ip });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: session.expiresAt,
  });
  return user;
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const s = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (s) {
      await db.session.delete({ where: { id: s.id } }).catch(() => {});
      await audit({ orgId: s.user.orgId, actor: s.user, action: "auth.logout", entity: "session", entityId: s.id });
    }
  }
  jar.delete(SESSION_COOKIE);
}

/** Usuario de la sesión actual (memoizado por request). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { org: { select: { name: true, isActive: true } } } } },
  });
  if (!s) return null;
  const now = Date.now();
  if (s.expiresAt.getTime() < now || now - s.lastSeenAt.getTime() > IDLE_TIMEOUT_MS || !s.user.isActive || (s.user.org && !s.user.org.isActive)) {
    await db.session.delete({ where: { id: s.id } }).catch(() => {});
    return null;
  }
  if (now - s.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await db.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  const u = s.user;
  return { id: u.id, name: u.name, email: u.email, role: u.role, orgId: u.orgId, orgName: u.org?.name ?? null, sessionId: s.id };
});

/** Para páginas: redirige a /login si no hay sesión. */
export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  return u;
}

/** Para páginas de una organización: devuelve el contexto de tenant. */
export async function requireCtx(perm?: Permission): Promise<Ctx> {
  const user = await requireUser();
  if (!user.orgId) redirect("/platform");
  if (perm && !can(user.role, perm)) redirect("/home?denied=1");
  return { user, orgId: user.orgId };
}

/** Para acciones/API: lanza error en vez de redirigir. */
export async function getCtx(perm?: Permission): Promise<Ctx> {
  const user = await getSessionUser();
  if (!user) throw new AppError("UNAUTHORIZED", "Tu sesión expiró. Vuelve a iniciar sesión.");
  if (!user.orgId) throw forbidden("Esta acción requiere pertenecer a una organización.");
  if (perm && !can(user.role, perm)) throw forbidden();
  return { user, orgId: user.orgId };
}

export function assertCan(ctx: Ctx, perm: Permission) {
  if (!can(ctx.user.role, perm)) throw forbidden();
}

// ---- Recuperación de contraseña ----
export async function createPasswordReset(email: string): Promise<string | null> {
  const { ip } = await clientInfo();
  rateLimit(`reset:${ip}`, 10);
  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || !user.isActive) return null; // no revelar si existe
  const token = randomToken();
  await db.passwordResetToken.create({
    data: { tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 30 * 60 * 1000) },
  });
  await audit({ orgId: user.orgId, actor: user, action: "auth.reset_requested", entity: "user", entityId: user.id, ip });
  return token;
}

export async function resetPassword(token: string, newPassword: string) {
  const weak = validatePasswordStrength(newPassword);
  if (weak) throw new AppError("VALIDATION", weak, { password: weak });
  const rec = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!rec || rec.usedAt || rec.expiresAt < new Date()) throw new AppError("VALIDATION", "El enlace expiró o ya fue utilizado. Solicita uno nuevo.");
  await db.$transaction([
    db.user.update({ where: { id: rec.userId }, data: { passwordHash: await hashPassword(newPassword), failedLogins: 0, lockedUntil: null } }),
    db.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
    db.session.deleteMany({ where: { userId: rec.userId } }), // cierra todas las sesiones
  ]);
  await audit({ orgId: rec.user.orgId, actor: rec.user, action: "auth.password_reset", entity: "user", entityId: rec.userId });
}
