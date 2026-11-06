"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Fila horizontal desplazable (estilo «streaming»), con flechas en escritorio y deslizamiento táctil en móvil. */
export function Carousel({ title, subtitle, seeAll, children }: { title: string; subtitle?: string; seeAll?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const update = () => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  };
  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scroll = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: "smooth" });

  return (
    <section aria-label={title} className="group/row">
      <div className="mb-3 flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        {seeAll && <Link href={seeAll} className="shrink-0 text-xs font-medium text-primary hover:underline">Ver todo</Link>}
        <div className="hidden gap-1 sm:flex">
          <button type="button" onClick={() => scroll(-1)} disabled={edges.start} aria-label={`Anteriores en ${title}`} className="rounded-full border border-border bg-card p-1.5 text-muted transition hover:text-fg disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => scroll(1)} disabled={edges.end} aria-label={`Siguientes en ${title}`} className="rounded-full border border-border bg-card p-1.5 text-muted transition hover:text-fg disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      <div ref={ref} onScroll={update}
        className={cn("scrollbar-none -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-3 pt-1 sm:-mx-1 sm:scroll-px-1 sm:px-1",
          "[&>*]:w-[72%] [&>*]:shrink-0 [&>*]:snap-start sm:[&>*]:w-[15.5rem]")}>
        {children}
      </div>
    </section>
  );
}
