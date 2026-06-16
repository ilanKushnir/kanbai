import { MessageSquare, CalendarClock, NotebookPen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { priorityMeta, dueMeta } from "@/lib/display";
import type { SerializedTicket } from "@/lib/serialize";
import { cn } from "@/lib/utils";

export function TicketCard({
  ticket,
  onClick,
  dragging,
  className,
}: {
  ticket: SerializedTicket;
  onClick?: () => void;
  dragging?: boolean;
  className?: string;
}) {
  const pr = priorityMeta(ticket.priority);
  const due = dueMeta(ticket.dueDate);
  const accent = ticket.priority === "urgent" || ticket.priority === "high";

  return (
    <div
      onClick={onClick}
      style={accent ? { borderLeftWidth: 3, borderLeftColor: pr.color } : undefined}
      className={cn(
        "group rounded-xl border border-border bg-surface p-3 shadow-card transition-all",
        "hover:border-border-strong hover:shadow-md hover:-translate-y-px active:translate-y-0 cursor-pointer",
        dragging && "opacity-40",
        className,
      )}
    >
      {ticket.labels.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {ticket.labels.map((l) => (
            <Badge key={l.id} tone={l.color} dot>
              {l.name}
            </Badge>
          ))}
        </div>
      )}

      <p className="text-sm font-medium leading-snug text-fg">{ticket.title}</p>

      {ticket.description && (
        <p className="mt-1 line-clamp-2 text-xs text-fg-muted leading-relaxed">
          {ticket.description}
        </p>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        {ticket.priority !== "none" && (
          <span className="inline-flex items-center gap-1 text-[0.6875rem] font-medium" style={{ color: pr.color }}>
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: pr.color }} />
            {pr.label}
          </span>
        )}

        {due && (
          <Badge tone={due.tone}>
            <CalendarClock className="h-3 w-3" />
            {due.label}
          </Badge>
        )}

        {ticket.sourceNoteId && (
          <span className="text-fg-subtle" title="Sorted from a note">
            <NotebookPen className="h-3.5 w-3.5" />
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {ticket.commentCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[0.6875rem] text-fg-subtle">
              <MessageSquare className="h-3.5 w-3.5" />
              {ticket.commentCount}
            </span>
          )}
          {ticket.assignee && (
            <Avatar
              name={ticket.assignee.name}
              color={ticket.assignee.type === "agent" ? ticket.assignee.color : undefined}
              isAgent={ticket.assignee.type === "agent"}
              size={22}
            />
          )}
        </div>
      </div>
    </div>
  );
}
