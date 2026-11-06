"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, FileText, LayoutGrid, Search, Ticket, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Kbd } from "./ui";

type Result = { kind: "ticket" | "article" | "service" | "page"; title: string; subtitle?: string; href: string };
const ICONS = { ticket: Ticket, article: BookOpen, service: LayoutGrid, page: FileText };
const GROUP = { ticket: "Tickets", article: "Centro de ayuda", service: "Catálogo", page: "Ir a" };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-search", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("open-search", onOpen); };
  }, []);

  useEffect(() => { if (open) { setTimeout(() => inputRef.current?.focus(), 10); } else { setQ(""); setResults([]); } }, [open]);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/v1/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (r.ok) { setResults((await r.json()).results); setActive(0); }
      } catch {} finally { setLoading(false); }
    }, 150);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, open]);

  const go = (r: Result) => { setOpen(false); router.push(r.href); };

  if (!open) return null;
  let lastKind = "";
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
      <div className="animate-in relative w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" role="dialog" aria-label="Búsqueda global">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 text-muted" />
          <input
            ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === "Enter" && results[active]) go(results[active]);
            }}
            placeholder="Busca tickets, artículos, servicios… (ej: INC-1020, vpn, notebook)"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            aria-label="Buscar"
          />
          {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted border-r-transparent" />}
          <Kbd>Esc</Kbd>
        </div>
        <div className="scrollbar-thin max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && !loading && <p className="px-3 py-8 text-center text-sm text-muted">{q ? "Sin resultados. Prueba con otras palabras." : "Escribe para buscar"}</p>}
          {results.map((r, i) => {
            const I = ICONS[r.kind];
            const header = r.kind !== lastKind ? GROUP[r.kind] : null;
            lastKind = r.kind;
            return (
              <div key={`${r.kind}-${r.href}`}>
                {header && <p className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted">{header}</p>}
                <button onMouseEnter={() => setActive(i)} onClick={() => go(r)}
                  className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm", i === active && "bg-subtle")}>
                  <I className="h-4 w-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.title}</span>
                    {r.subtitle && <span className="block truncate text-xs text-muted">{r.subtitle}</span>}
                  </span>
                  {i === active && <CornerDownLeft className="h-3.5 w-3.5 text-muted" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function SearchButton({ className }: { className?: string }) {
  return (
    <button onClick={() => window.dispatchEvent(new Event("open-search"))}
      className={cn("flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-muted hover:border-border-strong", className)}>
      <Search className="h-4 w-4" />
      <span className="flex-1 text-left">Buscar…</span>
      <Kbd>⌘K</Kbd>
    </button>
  );
}
