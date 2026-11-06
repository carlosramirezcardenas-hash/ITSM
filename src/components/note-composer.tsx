"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { addNoteAction } from "@/app/actions-itsm";
import { Button, Card, Textarea } from "./ui";
import { useActionToast } from "./toast";

export function NoteComposer({ entity, id }: { entity: "problem" | "change"; id: string }) {
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  return (
    <Card className="p-3">
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="border-0 px-1 focus:ring-0" placeholder="Agrega una nota de trabajo…" aria-label="Nota de trabajo" />
      <div className="flex justify-end pt-2">
        <Button size="sm" loading={pending} disabled={!note.trim()} onClick={() => start(async () => { const r = toast(await addNoteAction(entity, id, note)); if (r.ok) { setNote(""); router.refresh(); } })}><Send className="h-3.5 w-3.5" />Agregar nota</Button>
      </div>
    </Card>
  );
}
