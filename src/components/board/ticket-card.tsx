import { MessageSquare, CalendarClock, CircleCheck, NotebookPen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { priorityMeta, dueMeta, completionMeta, assigneeLabel } from "@/lib/display";
import { cn, htmlToPlainText } from "@/lib/utils";

type CardAssignee = { type: "user" | "agent"; name: string; color?: string; avatarUrl?: string | null; ownerName?: string | null };

/** The subset of ticket fields a card renders — satisfied by both the full and public serializers. */
export type TicketCardData = {
  number: number | null;
  title: string;
  description?: string;
  priority: string;
  dueDate: string | null;
  completedAt?: string | null;
  /** Sits in a done column — the due chip becomes a "Done" chip. */
  isDone?: boolean;
  labels: { id: string; name: string; color: string }[];
  commentCount: number;
  assignee: CardAssignee | null;
  /** All assignees (multi-assign); falls back to the single `assignee`. */
  assignees?: CardAssignee[];
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
  // Done tickets show when they were completed — never a stale "overdue".
  const done = Boolean(ticket.isDone);
  const due = done ? null : dueMeta(ticket.dueDate);
  const completed = done ? completionMeta(ticket.completedAt) : null;
  const assignees = ticket.assignees?.length ? ticket.assignees : ticket.assignee ? [ticket.assignee] : [];
  const excerpt = ticket.description ? htmlToPlainText(ticket.description) : "";

  return (
    <div
      onClick={onClick}
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

        {completed && (
          <Badge tone={completed.tone}>
            <CircleCheck className="h-3 w-3" />
            {completed.label}
          </Badge>
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
          {assignees.length > 0 && (
            <span className="flex items-center -space-x-1.5">
              {assignees.slice(0, 3).map((a, i) => (
                <span key={`${a.type}-${a.name}-${i}`} className="rounded-full ring-2 ring-surface">
                  <Avatar
                    name={a.name}
                    color={a.color}
                    src={a.type === "user" ? a.avatarUrl : undefined}
                    isAgent={a.type === "agent"}
                    size={22}
                    title={assigneeLabel(a)}
                  />
                </span>
              ))}
              {assignees.length > 3 && (
                <span
                  className="grid h-[22px] w-[22px] place-items-center rounded-full bg-surface-2 text-[0.625rem] font-semibold text-fg-muted ring-2 ring-surface"
                  title={assignees.slice(3).map((a) => a.name).join(", ")}
                >
                  +{assignees.length - 3}
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
