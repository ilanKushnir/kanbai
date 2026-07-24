"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { TicketModal } from "@/components/board/ticket-modal";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import type { SerializedTicket } from "@/lib/serialize";

type ColumnMeta = { id: string; name: string; isDone: boolean; subStates: string[] };
type LabelLite = { id: string; name: string; color: string };
type AgentLite = { id: string; name: string; color: string; kind: string; ownerUserId: string | null; ownerName: string | null };
type MemberLite = { id: string; name: string; avatarUrl?: string | null; avatarColor?: string | null };

export function MyDayTicketModal({
  ticket,
  columns,
  labels,
  agents,
  members,
  currentUser,
}: {
  ticket: SerializedTicket;
  columns: ColumnMeta[];
  labels: LabelLite[];
  agents: AgentLite[];
  members: MemberLite[];
  currentUser: { id: string; name: string };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [current, setCurrent] = React.useState(ticket);

  function closeToMyDay() {
    router.replace("/my-day", { scroll: false });
    router.refresh();
  }

  async function undoDone(previous: { columnId: string; subState: string | null }) {
    try {
      await api(`/api/tickets/${current.id}/move`, {
        body: { columnId: previous.columnId, position: 0, subState: previous.subState },
      });
      toast({ title: "Restored to My Day", variant: "success" });
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't undo", description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }

  async function moveToDone() {
    const doneColumn = columns.find((c) => c.isDone);
    if (!doneColumn) throw new Error("No done column is configured for this board.");
    const subState = doneColumn.subStates[0] ?? null;
    const { ticket: next } = await api<{ ticket: SerializedTicket }>(`/api/tickets/${current.id}/move`, {
      body: { columnId: doneColumn.id, position: 0, subState },
    });
    return next;
  }

  return (
    <TicketModal
      ticket={current}
      columns={columns}
      labels={labels}
      agents={agents}
      members={members}
      currentUser={currentUser}
      onClose={closeToMyDay}
      onUpdated={setCurrent}
      onDeleted={closeToMyDay}
      onMoveToDone={moveToDone}
      onDoneComplete={({ previous }) => {
        toast({
          title: "Done",
          description: current.title,
          variant: "success",
          actionLabel: "Undo",
          duration: 7000,
          onAction: () => undoDone(previous),
        });
        router.refresh();
      }}
    />
  );
}
