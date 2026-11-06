import Link from "next/link";
import { buttonClass } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center p-6 text-center">
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">No encontramos esta página</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">Puede que el enlace esté mal escrito o que no tengas acceso a este contenido.</p>
      <Link href="/home" className={buttonClass("primary", "md", "mt-6")}>Volver al inicio</Link>
    </div>
  );
}
