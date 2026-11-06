"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, Info, TriangleAlert, XCircle, X } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type Toast = { id: number; kind: "success" | "error" | "info" | "warning"; title: string; body?: string; link?: string };
const Ctx = createContext<{ push: (t: Omit<Toast, "id">) => void }>({ push: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((xs) => [...xs.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), t.kind === "error" ? 7000 : 4500);
  }, []);
  const Icon = { success: CheckCircle2, error: XCircle, info: Info, warning: TriangleAlert };
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end" aria-live="polite">
        {toasts.map((t) => {
          const I = Icon[t.kind];
          return (
            <div key={t.id} className="animate-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-border bg-card p-3.5 shadow-lg" role="status">
              <I className={cn("mt-0.5 h-4 w-4 shrink-0",
                t.kind === "success" && "text-emerald-500", t.kind === "error" && "text-red-500", t.kind === "info" && "text-primary", t.kind === "warning" && "text-amber-500")} />
              <div className="min-w-0 flex-1 text-sm">
                {t.link ? <Link href={t.link} className="font-medium hover:underline">{t.title}</Link> : <p className="font-medium">{t.title}</p>}
                {t.body && <p className="mt-0.5 line-clamp-2 text-muted">{t.body}</p>}
              </div>
              <button onClick={() => setToasts((xs) => xs.filter((x) => x.id !== t.id))} className="text-muted hover:text-fg" aria-label="Cerrar">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

/** Ejecuta una server action y muestra el resultado como toast. */
export function useActionToast() {
  const { push } = useToast();
  return useCallback(
    <T,>(r: { ok: true; data?: T; message?: string } | { ok: false; error: string; fields?: Record<string, string> }) => {
      if (r.ok) { if (r.message) push({ kind: "success", title: r.message }); }
      else push({ kind: "error", title: r.error });
      return r;
    },
    [push],
  );
}
