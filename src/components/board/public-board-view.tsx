"use client";

import * as React from "react";
import { Flag, CalendarClock } from "lucide-react";
import { TicketCard } from "@/components/board/ticket-card";
import { Modal } from "@/components/ui/modal";
import { RichText } from "@/components/ui/rich-text";
import { Badge, tone } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { priorityMeta, dueMeta } from "@/lib/display";
import type { PublicBoardData } from "@/lib/services/boards";
import type { SerializedPublicTicket } from "@/lib/serialize";

export function PublicBoardView({ board }: { board: PublicBoardData }) {
  const [selected, setSelected] = React.useState<SerializedPublicTicket | null>(null);

  return (
    <>
      <div className="flex h-full gap-4 overflow-x-auto px-4 pb-4 md:px-6">
        {board.columns.map((col) => (
          <div key={col.id} className="flex w-[19rem] shrink-0 flex-col">
            <div className="mb-2 flex items-center gap-2 px-1">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: col.isDone ? tone("emerald").dot : tone("slate").dot }}
              />
              <span className="text-sm font-semibold">{col.name}</span>
              <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[0.6875rem] font-medium text-fg-subtle">
                {col.tickets.length}
              </span>
            </div>
            <div className="flex min-h-24 flex-1 flex-col gap-2 rounded-2xl bg-surface-2/50 p-2">
              {col.tickets.map((t) => (
                <TicketCard key={t.id} ticket={t} onClick={() => setSelected(t)} />
              ))}
              {col.tickets.length === 0 && (
                <p className="px-1 py-2 text-xs text-fg-subtle">Nothing here.</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {selected && <ReadOnlyTicket ticket={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function ReadOnlyTicket({ ticket, onClose }: { ticket: SerializedPublicTicket; onClose: () => void }) {
  const pr = priorityMeta(ticket.priority);
  const due = dueMeta(ticket.dueDate);
  return (
    <Modal open onClose={onClose} size="lg">
      <div className="flex items-center gap-2 pb-2 text-xs text-fg-subtle">
        {ticket.number != null && <span className="font-medium">#{ticket.number}</span>}
        <span>·</span>
        <span>{ticket.column}</span>
      </div>
      <h2 className="text-xl font-semibold tracking-tight">{ticket.title}</h2>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {ticket.priority !== "none" && (
          <span className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium" style={{ color: pr.color }}>
            <Flag className="h-3.5 w-3.5" /> {pr.label}
          </span>
        )}
        {due && (
          <Badge tone={due.tone}>
            <CalendarClock className="h-3 w-3" /> {due.label}
          </Badge>
        )}
        {ticket.assignee && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs">
            <Avatar
              name={ticket.assignee.name}
              color={ticket.assignee.type === "agent" ? ticket.assignee.color : undefined}
              isAgent={ticket.assignee.type === "agent"}
              size={16}
            />
            {ticket.assignee.name}
          </span>
        )}
        {ticket.labels.map((l) => (
          <Badge key={l.id} tone={l.color} dot>
            {l.name}
          </Badge>
        ))}
      </div>

      {ticket.description && (
        <div className="mt-4 rounded-xl border border-border bg-surface-2/40 px-3 py-2.5 text-sm">
          <RichText html={ticket.description} />
        </div>
      )}
    </Modal>
  );
}
