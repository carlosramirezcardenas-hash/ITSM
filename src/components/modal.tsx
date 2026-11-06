"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Modal({ open, onClose, title, description, children, size = "md", footer }: {
  open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode; size?: "sm" | "md" | "lg" | "xl"; footer?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // onClose suele ser una función nueva en cada render: se guarda en una ref para que el efecto
  // (foco inicial, Escape, bloqueo de scroll) se ejecute solo al abrir y no robe el foco al escribir.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>("input,textarea,select,button[data-autofocus]")?.focus(), 30);
    return () => { clearTimeout(t); document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title}
        className={cn("animate-in relative flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl",
          size === "sm" && "sm:max-w-md", size === "md" && "sm:max-w-lg", size === "lg" && "sm:max-w-2xl", size === "xl" && "sm:max-w-4xl")}>
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-subtle hover:text-fg" aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>
        <div className="scrollbar-thin overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
