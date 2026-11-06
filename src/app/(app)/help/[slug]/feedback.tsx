"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { rateArticleAction } from "@/app/actions";
import { Button, Card, buttonClass } from "@/components/ui";
import { useActionToast } from "@/components/toast";

export function ArticleFeedback({ articleId, initial }: { articleId: string; initial: boolean | null }) {
  const [value, setValue] = useState<boolean | null>(initial);
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const rate = (helpful: boolean) => start(async () => { const r = toast(await rateArticleAction(articleId, helpful)); if (r.ok) setValue(helpful); });
  return (
    <Card className="mt-8 flex flex-col items-center gap-3 p-5 text-center sm:flex-row sm:justify-between sm:text-left">
      <p className="text-sm font-medium">{value === null ? "¿Te sirvió este artículo?" : value ? "¡Qué bueno que te sirvió!" : "Gracias. ¿Quieres que te ayudemos directamente?"}</p>
      <div className="flex gap-2">
        {value === false ? <Link href="/new/issue" className={buttonClass("primary", "sm")}>Crear solicitud</Link> : null}
        <Button size="sm" variant={value === true ? "primary" : "outline"} disabled={pending} onClick={() => rate(true)} aria-pressed={value === true}><ThumbsUp className="h-4 w-4" />Sí</Button>
        <Button size="sm" variant={value === false ? "secondary" : "outline"} disabled={pending} onClick={() => rate(false)} aria-pressed={value === false}><ThumbsDown className="h-4 w-4" />No</Button>
      </div>
    </Card>
  );
}
