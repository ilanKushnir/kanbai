import Link from "next/link";
import { Sparkles, User, Cog } from "lucide-react";
import type { ActivityItem } from "@/lib/services/activity-feed";
import { timeAgo, cn } from "@/lib/utils";

const VERBS: Record<string, string> = {
  "ticket.created": "added",
  "ticket.updated": "updated",
  "ticket.moved": "moved",
  "ticket.done": "completed",
  "ticket.reopened": "reopened",
  "ticket.transferred": "moved",
  "ticket.deleted": "deleted",
  "comment.created": "commented on",
  "subtask.created": "added a subtask to",
  "subtask.updated": "updated a subtask on",
  "subtask.deleted": "removed a subtask from",
  "note.created": "added",
  "note.updated": "edited",
  "note.done": "completed",
  "note.reopened": "reopened",
  "note.deleted": "deleted",
  "note.moved": "moved",
  "note.queued": "queued",
  "note.sorted": "filed",
  "note.promoted": "filed",
  "board.created": "created board",
  "board.updated": "updated board",
  "board.archived": "archived board",
  "board.unarchived": "restored board",
  "column.created": "added a column to",
  "column.updated": "changed a column on",
  "column.deleted": "removed a column from",
  "columns.reordered": "reordered columns on",
};

const FIELD_LABELS: Record<string, string> = {
  title: "title",
  description: "description",
  priority: "priority",
  dueDate: "due date",
  labelIds: "labels",
  labelNames: "labels",
  assigneeUserId: "assignee",
  assigneeUserIds: "assignee",
  assigneeType: "assignee",
  subState: "status",
  body: "text",
  scheduledDay: "day",
};

function fieldsExtra(meta: Record<string, unknown>): string | undefined {
  if (!Array.isArray(meta.fields)) return undefined;
  const names = [...new Set(meta.fields.map((f) => FIELD_LABELS[String(f)]).filter(Boolean))];
  return names.length ? `· ${names.join(", ")}` : undefined;
}

function dayExtra(day: unknown): string {
  if (typeof day !== "string") return "→ Inbox";
  const d = new Date(`${day}T12:00:00Z`);
  return `→ ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

function describe(a: ActivityItem, showBoard: boolean): { verb: string; target: string | null; href: string | null; extra?: string; ref?: string } {
  const verb = VERBS[a.action] ?? a.action.replace(/[._]/g, " ");
  if (a.ticket) {
    const extra =
      a.action === "ticket.transferred"
        ? `→ ${a.ticket.boardName}`
        : a.action === "ticket.moved" && typeof a.meta.toColumn === "string"
          ? `→ ${a.meta.toColumn}`
        : a.action === "ticket.updated"
          ? fieldsExtra(a.meta)
          : showBoard
            ? `· ${a.ticket.boardName}`
            : undefined;
    return { verb, ref: a.ticket.number != null ? `#${a.ticket.number}` : undefined, target: a.ticket.title, href: `/boards/${a.ticket.boardSlug}?ticket=${a.ticket.id}`, extra };
  }
  if (a.note) {
    const extra = a.action === "note.moved" ? dayExtra(a.meta.scheduledDay) : a.action === "note.updated" ? fieldsExtra(a.meta) : undefined;
    return { verb, target: a.note.body.split("\n")[0].slice(0, 80), href: `/today?focus=${a.note.id}`, extra };
  }
  if (a.board) return { verb: verb.replace(/ board$/, ""), target: a.board.name, href: `/boards/${a.board.slug}` };
  if (typeof a.meta.title === "string") return { verb, target: a.meta.title, href: null };
  return { verb, target: null, href: null };
}

/** A quiet, actor-led feed: "Hermes · completed #12 Fix backup · 2h ago". */
export function ActivityList({ items, compact = false, showBoard = false }: { items: ActivityItem[]; compact?: boolean; showBoard?: boolean }) {
  return (
    <ul className={cn("space-y-0.5", !compact && "divide-y divide-border")}>
      {items.map((a) => {
        const d = describe(a, showBoard);
        const Icon = a.actorType === "agent" ? Sparkles : a.actorType === "system" ? Cog : User;
        return (
          <li key={a.id} className={cn("flex items-start gap-2.5 rounded-lg px-2", compact ? "py-1.5" : "py-2.5")}>
            <span className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full", a.actorType === "agent" ? "bg-primary-soft text-primary-soft-fg" : "bg-surface-2 text-fg-subtle")}>
              <Icon className="h-3 w-3" />
            </span>
            <div className="min-w-0 flex-1 text-[0.8125rem] leading-5">
              <span className="font-medium text-fg">{a.actorName}</span>{" "}
              <span className="text-fg-muted">{d.verb}</span>{" "}
              {d.ref && <span className="text-fg-subtle">{d.ref} </span>}
              {d.target &&
                (d.href ? (
                  <Link href={d.href} className="text-fg hover:underline underline-offset-2" dir="auto">
                    {d.target}
                  </Link>
                ) : (
                  <span dir="auto">{d.target}</span>
                ))}
              {d.extra && <span className="text-fg-subtle"> {d.extra}</span>}
              <span className="ml-1.5 whitespace-nowrap text-[0.6875rem] text-fg-subtle" suppressHydrationWarning>{timeAgo(a.createdAt)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
