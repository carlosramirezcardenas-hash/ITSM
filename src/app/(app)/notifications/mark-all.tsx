"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { markNotificationsReadAction } from "@/app/actions";
import { Button } from "@/components/ui";

export function MarkAllRead() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return <Button variant="outline" loading={pending} onClick={() => start(async () => { await markNotificationsReadAction(); router.refresh(); })}><CheckCheck className="h-4 w-4" />Marcar todas como leídas</Button>;
}
