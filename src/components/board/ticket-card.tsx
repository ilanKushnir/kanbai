import { MessageSquare, CalendarClock, NotebookPen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { priorityMeta, dueMeta, assigneeLabel } from "@/lib/display";
import { cn, htmlToPlainText } from "@/lib/utils";

/** The subset of ticket fields a card renders — satisfied by both the full and public serializers. */
export type TicketCardData = {
  number: number | null;
  title: string;
  description?: string;
  priority: string;
  dueDate: string | null;
  labels: { id: string; name: string; color: string }[];
  commentCount: number;
  assignee: { type: "user" | "agent"; name: string; color?: string; avatarUrl?: string | null; ownerName?: string | null } | null;
  sourceNoteId?: string | null;
};

export function TicketCard({
  ticket,
  onClick,
  dragging,
  className,
}: {
  ticket: TicketCardData;
  onClick?: () => void;
  dragging?: boolean;
  className?: string;
}) {
  const pr = priorityMeta(ticket.priority);
  const due = dueMeta(ticket.dueDate);
  const accent = ticket.priority === "urgent" || ticket.priority === "high";
  const excerpt = ticket.description ? htmlToPlainText(ticket.description) : "";

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

      {/* dir="auto": first strong character sets base direction, so Hebrew/Arabic
          titles read right-to-left even when they mix in English words. */}
      <p dir="auto" className="text-sm font-medium leading-snug text-fg">{ticket.title}</p>

      {excerpt && (
        <p dir="auto" className="mt-1 line-clamp-2 text-xs text-fg-muted leading-relaxed">{excerpt}</p>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        {ticket.number != null && (
          <span className="text-[0.625rem] font-medium text-fg-subtle">#{ticket.number}</span>
        )}
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
              color={ticket.assignee.color}
              src={ticket.assignee.type === "user" ? ticket.assignee.avatarUrl : undefined}
              isAgent={ticket.assignee.type === "agent"}
              size={22}
              title={assigneeLabel(ticket.assignee)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
