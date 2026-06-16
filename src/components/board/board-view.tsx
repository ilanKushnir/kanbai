"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import { TicketCard } from "./ticket-card";
import { TicketModal } from "./ticket-modal";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { tone } from "@/components/ui/badge";
import type { BoardData } from "@/lib/services/boards";
import type { SerializedTicket } from "@/lib/serialize";

type AgentLite = { id: string; name: string; color: string; kind: string };
type ColumnMeta = { id: string; name: string; isDone: boolean; wipLimit: number | null };

export function BoardView({
  board,
  agents,
  currentUser,
}: {
  board: BoardData;
  agents: AgentLite[];
  currentUser?: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const cols: ColumnMeta[] = board.columns.map((c) => ({
    id: c.id,
    name: c.name,
    isDone: c.isDone,
    wipLimit: c.wipLimit,
  }));

  const [ticketsById, setTicketsById] = React.useState<Record<string, SerializedTicket>>(() => {
    const m: Record<string, SerializedTicket> = {};
    board.columns.forEach((c) => c.tickets.forEach((t) => (m[t.id] = t)));
    return m;
  });
  const [containers, setContainers] = React.useState<Record<string, string[]>>(() => {
    const m: Record<string, string[]> = {};
    board.columns.forEach((c) => (m[c.id] = c.tickets.map((t) => t.id)));
    return m;
  });
  const containersRef = React.useRef(containers);
  const setCont = (next: Record<string, string[]>) => {
    containersRef.current = next;
    setContainers(next);
  };

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function keyOf(map: Record<string, string[]>, id: string): string | null {
    if (id in map) return id;
    return Object.keys(map).find((k) => map[k].includes(id)) ?? null;
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const prev = containersRef.current;
    const activeContainer = keyOf(prev, activeId);
    const overContainer = overId in prev ? overId : keyOf(prev, overId);
    if (!activeContainer || !overContainer || activeContainer === overContainer) return;

    const activeItems = prev[activeContainer];
    const overItems = prev[overContainer];
    const overIndex = overId in prev ? overItems.length : Math.max(0, overItems.indexOf(overId));
    setCont({
      ...prev,
      [activeContainer]: activeItems.filter((id) => id !== activeId),
      [overContainer]: [...overItems.slice(0, overIndex), activeId, ...overItems.slice(overIndex)],
    });
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const prev = containersRef.current;
    const activeContainer = keyOf(prev, activeId);
    if (!activeContainer) return;
    const overContainer = overId in prev ? overId : keyOf(prev, overId);

    let result = prev;
    if (overContainer && activeContainer === overContainer) {
      const items = prev[activeContainer];
      const oldIndex = items.indexOf(activeId);
      const newIndex = overId in prev ? items.length - 1 : items.indexOf(overId);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        result = { ...prev, [activeContainer]: arrayMove(items, oldIndex, newIndex) };
        setCont(result);
      }
    }

    const finalContainer = keyOf(result, activeId);
    if (!finalContainer) return;
    const finalIndex = result[finalContainer].indexOf(activeId);
    void persistMove(activeId, finalContainer, finalIndex);
  }

  async function persistMove(ticketId: string, columnId: string, position: number) {
    try {
      const { ticket } = await api<{ ticket: SerializedTicket }>(
        `/api/tickets/${ticketId}/move`,
        { body: { columnId, position } },
      );
      setTicketsById((m) => ({ ...m, [ticketId]: ticket }));
    } catch {
      router.refresh(); // resync on failure
    }
  }

  async function handleCreate(columnId: string, title: string) {
    const optimisticId = `tmp-${Math.random().toString(36).slice(2)}`;
    try {
      const { ticket } = await api<{ ticket: SerializedTicket }>("/api/tickets", {
        body: { boardId: board.id, columnId, title },
      });
      setTicketsById((m) => ({ ...m, [ticket.id]: ticket }));
      setCont({ ...containersRef.current, [columnId]: [...containersRef.current[columnId], ticket.id] });
    } catch {
      router.refresh();
    }
    void optimisticId;
  }

  function handleTicketUpdated(t: SerializedTicket) {
    setTicketsById((m) => ({ ...m, [t.id]: t }));
    // If the column changed via the modal, move it in containers.
    const cur = keyOf(containersRef.current, t.id);
    if (cur && cur !== t.columnId) {
      const next = { ...containersRef.current };
      next[cur] = next[cur].filter((id) => id !== t.id);
      next[t.columnId] = [...(next[t.columnId] ?? []), t.id];
      setCont(next);
    }
  }

  function handleTicketDeleted(id: string) {
    const cur = keyOf(containersRef.current, id);
    if (cur) setCont({ ...containersRef.current, [cur]: containersRef.current[cur].filter((x) => x !== id) });
    setSelectedId(null);
  }

  const activeTicket = activeId ? ticketsById[activeId] : null;
  const selectedTicket = selectedId ? ticketsById[selectedId] : null;

  return (
    <>
      <DndContext
        id="kanbai-board"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className="flex h-full gap-4 overflow-x-auto px-4 pb-4 md:px-6 lg:px-8">
          {cols.map((col) => (
            <Column
              key={col.id}
              col={col}
              ticketIds={containers[col.id] ?? []}
              ticketsById={ticketsById}
              onCardClick={(id) => setSelectedId(id)}
              onCreate={(title) => handleCreate(col.id, title)}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeTicket ? (
            <div className="w-72 rotate-2">
              <TicketCard ticket={activeTicket} className="kb-dragging" />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {selectedTicket && (
        <TicketModal
          ticket={selectedTicket}
          columns={cols}
          labels={board.labels}
          agents={agents}
          currentUser={currentUser}
          onClose={() => setSelectedId(null)}
          onUpdated={handleTicketUpdated}
          onDeleted={handleTicketDeleted}
        />
      )}
    </>
  );
}

function Column({
  col,
  ticketIds,
  ticketsById,
  onCardClick,
  onCreate,
}: {
  col: ColumnMeta;
  ticketIds: string[];
  ticketsById: Record<string, SerializedTicket>;
  onCardClick: (id: string) => void;
  onCreate: (title: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  const dot = col.isDone ? tone("emerald").dot : tone("slate").dot;

  return (
    <div className="flex w-[19rem] shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: dot }} />
        <span className="text-sm font-semibold">{col.name}</span>
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[0.6875rem] font-medium text-fg-subtle">
          {ticketIds.length}
          {col.wipLimit ? ` / ${col.wipLimit}` : ""}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-2 rounded-2xl border border-transparent p-2 transition-colors",
          "bg-surface-2/50",
          isOver && "border-primary/40 bg-primary-soft/40",
        )}
      >
        <SortableContext items={ticketIds} strategy={verticalListSortingStrategy}>
          {ticketIds.map((id) => {
            const t = ticketsById[id];
            if (!t) return null;
            return <SortableTicket key={id} ticket={t} onClick={() => onCardClick(id)} />;
          })}
        </SortableContext>

        <AddCard onCreate={onCreate} />
      </div>
    </div>
  );
}

function SortableTicket({ ticket, onClick }: { ticket: SerializedTicket; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ticket.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <TicketCard ticket={ticket} onClick={onClick} dragging={isDragging} />
    </div>
  );
}

function AddCard({ onCreate }: { onCreate: (title: string) => void }) {
  const [adding, setAdding] = React.useState(false);
  const [value, setValue] = React.useState("");
  const ref = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (adding) ref.current?.focus();
  }, [adding]);

  function submit() {
    const v = value.trim();
    if (v) onCreate(v);
    setValue("");
    setAdding(false);
  }

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-fg-subtle hover:bg-surface-3 hover:text-fg transition-colors cursor-pointer"
      >
        <Plus className="h-4 w-4" />
        Add card
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-2 shadow-card">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            setValue("");
            setAdding(false);
          }
        }}
        onBlur={submit}
        rows={2}
        placeholder="What needs doing?"
        className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-fg-subtle"
      />
    </div>
  );
}
