"use client";
import { Button } from "@/components/ui";

export default function Error({ reset, error }: { reset: () => void; error: Error & { digest?: string } }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="text-xl font-semibold">Algo salió mal</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">Tuvimos un problema al cargar esta sección. Intenta nuevamente; si persiste, avísanos.{error.digest ? ` (Ref: ${error.digest})` : ""}</p>
      <Button className="mt-6" onClick={reset}>Reintentar</Button>
    </div>
  );
}
