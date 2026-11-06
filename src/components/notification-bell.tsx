"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { markNotificationsReadAction } from "@/app/actions";
import { cn, timeAgo } from "@/lib/utils";
import { useToast } from "./toast";

type N = { id: string; title: string; body: string | null; link: string | null; kind: string; readAt: string | null; createdAt: string };
const DOT: Record<string, string> = { danger: "bg-red-500", warning: "bg-amber-500", success: "bg-emerald-500", info: "bg-primary" };

export function NotificationBell() {
  const [items, setItems] = useState<N[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const { push } = useToast();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const r = await fetch("/api/v1/notifications");
      if (r.ok) { const j = await r.json(); setItems(j.items); setUnread(j.unread); }
    } catch {}
  };

  useEffect(() => {
    load();
    // Tiempo real vía Server-Sent Events
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      es = new EventSource("/api/v1/notifications/stream");
      es.addEventListener("notification", (e) => {
        const n = JSON.parse((e as MessageEvent).data) as N;
        setItems((xs) => [n, ...xs.filter((x) => x.id !== n.id)].slice(0, 20));
        setUnread((u) => u + 1);
        push({ kind: n.kind === "danger" ? "error" : n.kind === "success" ? "success" : n.kind === "warning" ? "warning" : "info", title: n.title, body: n.body ?? undefined, link: n.link ?? undefined });
        router.refresh();
      });
      es.onerror = () => { es?.close(); retry = setTimeout(connect, 10000); };
    };
    connect();
    return () => { es?.close(); clearTimeout(retry); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const markAll = async () => {
    await markNotificationsReadAction();
    setItems((xs) => xs.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })));
    setUnread(0);
  };
  const openItem = async (n: N) => {
    setOpen(false);
    if (!n.readAt) { await markNotificationsReadAction([n.id]); setUnread((u) => Math.max(0, u - 1)); setItems((xs) => xs.map((x) => x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)); }
    if (n.link) router.push(n.link);
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-muted hover:bg-subtle hover:text-fg" aria-label={`Notificaciones${unread ? ` (${unread} sin leer)` : ""}`}>
        <Bell className="h-4 w-4" />
        {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="animate-in absolute right-0 z-50 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-sm font-semibold">Notificaciones</p>
            {unread > 0 && <button onClick={markAll} className="flex items-center gap-1 text-xs text-primary hover:underline"><CheckCheck className="h-3.5 w-3.5" />Marcar todas como leídas</button>}
          </div>
          <div className="scrollbar-thin max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? <p className="px-4 py-10 text-center text-sm text-muted">No tienes notificaciones</p> : items.map((n) => (
              <button key={n.id} onClick={() => openItem(n)} className={cn("flex w-full gap-3 border-b border-border px-4 py-3 text-left last:border-0 hover:bg-subtle", !n.readAt && "bg-primary-soft/40")}>
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : DOT[n.kind] ?? DOT.info)} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{n.title}</span>
                  {n.body && <span className="block truncate text-xs text-muted">{n.body}</span>}
                  <span className="mt-0.5 block text-[11px] text-muted">{timeAgo(n.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-border px-4 py-2 text-center text-xs text-primary hover:bg-subtle">Ver todas</Link>
        </div>
      )}
    </div>
  );
}
