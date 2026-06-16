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
import { Plus, Search, SlidersHorizontal, X, Check, MoreHorizontal, Flag, Tag, User } from "lucide-react";
import { TicketCard } from "./ticket-card";
import { TicketModal } from "./ticket-modal";
import { Menu, MenuItem } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { tone } from "@/components/ui/badge";
import { PRIORITIES, PRIORITY_META } from "@/lib/constants";
import type { BoardData } from "@/lib/services/boards";
import type { SerializedTicket } from "@/lib/serialize";

type AgentLite = { id: string; name: string; color: string; kind: string };
type ColumnMeta = { id: string; name: string; isDone: boolean; wipLimit: number | null };

type Filters = {
  q: string;
  priorities: Set<string>;
  labelIds: Set<string>;
  assignee: "any" | "me" | "agents" | "unassigned";
};

export function BoardView({
  board,
  agents,
  currentUser,
  initialTicketId,
}: {
  board: BoardData;
  agents: AgentLite[];
  currentUser?: { id: string; name: string } | null;
  initialTicketId?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [cols, setCols] = React.useState<ColumnMeta[]>(() =>
    board.columns.map((c) => ({ id: c.id, name: c.name, isDone: c.isDone, wipLimit: c.wipLimit })),
  );
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
  const [selectedId, setSelectedId] = React.useState<string | null>(initialTicketId ?? null);
  const [celebrateId, setCelebrateId] = React.useState<string | null>(null);
  const liveRef = React.useRef<HTMLDivElement>(null);

  const [filters, setFilters] = React.useState<Filters>({
    q: "",
    priorities: new Set(),
    labelIds: new Set(),
    assignee: "any",
  });
  const activeFilterCount =
    (filters.q ? 1 : 0) + filters.priorities.size + filters.labelIds.size + (filters.assignee !== "any" ? 1 : 0);

  function matches(t: SerializedTicket): boolean {
    if (filters.q) {
      const q = filters.q.toLowerCase();
      if (!t.title.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false;
    }
    if (filters.priorities.size && !filters.priorities.has(t.priority)) return false;
    if (filters.labelIds.size && !t.labels.some((l) => filters.labelIds.has(l.id))) return false;
    if (filters.assignee === "agents" && t.assignee?.type !== "agent") return false;
    if (filters.assignee === "me" && !(t.assignee?.type === "user" && t.assignee.id === currentUser?.id)) return false;
    if (filters.assignee === "unassigned" && t.assignee) return false;
    return true;
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
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

    const col = cols.find((c) => c.id === finalContainer);
    if (liveRef.current) liveRef.current.textContent = `Moved ${ticketsById[activeId]?.title ?? "card"} to ${col?.name ?? ""}`;
    if (col?.isDone) {
      setCelebrateId(activeId);
      setTimeout(() => setCelebrateId((id) => (id === activeId ? null : id)), 1100);
    }
    void persistMove(activeId, finalContainer, finalIndex);
  }

  async function persistMove(ticketId: string, columnId: string, position: number) {
    try {
      const { ticket } = await api<{ ticket: SerializedTicket }>(`/api/tickets/${ticketId}/move`, {
        body: { columnId, position },
      });
      setTicketsById((m) => ({ ...m, [ticketId]: ticket }));
    } catch {
      toast({ title: "Couldn't move card", variant: "error" });
      router.refresh();
    }
  }

  async function handleCreate(columnId: string, title: string) {
    try {
      const { ticket } = await api<{ ticket: SerializedTicket }>("/api/tickets", {
        body: { boardId: board.id, columnId, title },
      });
      setTicketsById((m) => ({ ...m, [ticket.id]: ticket }));
      setCont({ ...containersRef.current, [columnId]: [...containersRef.current[columnId], ticket.id] });
    } catch {
      toast({ title: "Couldn't add card", variant: "error" });
      router.refresh();
    }
  }

  async function renameColumn(columnId: string, name: string) {
    setCols((cs) => cs.map((c) => (c.id === columnId ? { ...c, name } : c)));
    try {
      await api(`/api/columns/${columnId}`, { method: "PATCH", body: { name } });
    } catch {
      router.refresh();
    }
  }

  async function setWip(columnId: string, wipLimit: number | null) {
    setCols((cs) => cs.map((c) => (c.id === columnId ? { ...c, wipLimit } : c)));
    try {
      await api(`/api/columns/${columnId}`, { method: "PATCH", body: { wipLimit } });
    } catch {
      router.refresh();
    }
  }

  function handleTicketUpdated(t: SerializedTicket) {
    setTicketsById((m) => ({ ...m, [t.id]: t }));
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
    toast({ title: "Ticket deleted", variant: "default" });
  }

  const activeTicket = activeId ? ticketsById[activeId] : null;
  const selectedTicket = selectedId ? ticketsById[selectedId] : null;

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        filters={filters}
        setFilters={setFilters}
        activeFilterCount={activeFilterCount}
        labels={board.labels}
        agents={agents}
      />

      <DndContext
        id="kanbai-board"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto px-4 pb-4 md:px-6 lg:px-8">
          {cols.map((col) => {
            const ids = containers[col.id] ?? [];
            const visibleIds = activeFilterCount ? ids.filter((id) => ticketsById[id] && matches(ticketsById[id])) : ids;
            return (
              <Column
                key={col.id}
                col={col}
                totalCount={ids.length}
                visibleIds={visibleIds}
                allIds={ids}
                ticketsById={ticketsById}
                celebrateId={celebrateId}
                onCardClick={(id) => setSelectedId(id)}
                onCreate={(title) => handleCreate(col.id, title)}
                onRename={(name) => renameColumn(col.id, name)}
                onSetWip={(n) => setWip(col.id, n)}
              />
            );
          })}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeTicket ? (
            <div className="w-72 rotate-2">
              <TicketCard ticket={activeTicket} className="kb-dragging" />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <div ref={liveRef} aria-live="polite" className="sr-only" />

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
    </div>
  );
}

function Toolbar({
  filters,
  setFilters,
  activeFilterCount,
  labels,
  agents,
}: {
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  activeFilterCount: number;
  labels: { id: string; name: string; color: string }[];
  agents: AgentLite[];
}) {
  function toggleSet(key: "priorities" | "labelIds", value: string) {
    setFilters((f) => {
      const next = new Set(f[key]);
      next.has(value) ? next.delete(value) : next.add(value);
      return { ...f, [key]: next };
    });
  }

  return (
    <div className="flex items-center gap-2 px-4 pb-3 md:px-6 lg:px-8">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
        <input
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          placeholder="Filter cards…"
          className="h-9 w-44 rounded-lg border border-border bg-surface pl-8 pr-3 text-sm outline-none transition-all focus:w-60 focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <Menu
        trigger={
          <button
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors cursor-pointer",
              activeFilterCount ? "border-primary bg-primary-soft text-primary-soft-fg" : "border-border hover:bg-surface-2",
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filter
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[0.625rem] font-semibold text-primary-fg">
                {activeFilterCount}
              </span>
            )}
          </button>
        }
        contentClassName="w-60"
      >
        {() => (
          <div className="p-1">
            <div className="px-2 pb-1 pt-1.5 text-[0.625rem] font-semibold uppercase tracking-wider text-fg-subtle">
              <Flag className="mr-1 inline h-3 w-3" /> Priority
            </div>
            {PRIORITIES.filter((p) => p !== "none").map((p) => (
              <CheckRow key={p} on={filters.priorities.has(p)} onClick={() => toggleSet("priorities", p)}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PRIORITY_META[p].color }} />
                {PRIORITY_META[p].label}
              </CheckRow>
            ))}
            {labels.length > 0 && (
              <>
                <div className="px-2 pb-1 pt-2 text-[0.625rem] font-semibold uppercase tracking-wider text-fg-subtle">
                  <Tag className="mr-1 inline h-3 w-3" /> Labels
                </div>
                {labels.map((l) => (
                  <CheckRow key={l.id} on={filters.labelIds.has(l.id)} onClick={() => toggleSet("labelIds", l.id)}>
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tone(l.color).dot }} />
                    {l.name}
                  </CheckRow>
                ))}
              </>
            )}
            <div className="px-2 pb-1 pt-2 text-[0.625rem] font-semibold uppercase tracking-wider text-fg-subtle">
              <User className="mr-1 inline h-3 w-3" /> Assignee
            </div>
            {(["any", "me", "agents", "unassigned"] as const).map((a) => (
              <CheckRow key={a} on={filters.assignee === a} radio onClick={() => setFilters((f) => ({ ...f, assignee: a }))}>
                <span className="capitalize">{a === "any" ? "Anyone" : a}</span>
              </CheckRow>
            ))}
          </div>
        )}
      </Menu>

      {activeFilterCount > 0 && (
        <button
          onClick={() => setFilters({ q: "", priorities: new Set(), labelIds: new Set(), assignee: "any" })}
          className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg cursor-pointer"
        >
          <X className="h-3.5 w-3.5" /> Clear
        </button>
      )}
    </div>
  );
}

function CheckRow({
  children,
  on,
  onClick,
  radio,
}: {
  children: React.ReactNode;
  on: boolean;
  onClick: () => void;
  radio?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2 cursor-pointer"
    >
      <span
        className={cn(
          "grid h-4 w-4 shrink-0 place-items-center border",
          radio ? "rounded-full" : "rounded",
          on ? "border-primary bg-primary text-primary-fg" : "border-border-strong",
        )}
      >
        {on && <Check className="h-3 w-3" />}
      </span>
      {children}
    </button>
  );
}

function Column({
  col,
  totalCount,
  visibleIds,
  allIds,
  ticketsById,
  celebrateId,
  onCardClick,
  onCreate,
  onRename,
  onSetWip,
}: {
  col: ColumnMeta;
  totalCount: number;
  visibleIds: string[];
  allIds: string[];
  ticketsById: Record<string, SerializedTicket>;
  celebrateId: string | null;
  onCardClick: (id: string) => void;
  onCreate: (title: string) => void;
  onRename: (name: string) => void;
  onSetWip: (n: number | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  const dot = col.isDone ? tone("emerald").dot : tone("slate").dot;
  const overLimit = col.wipLimit != null && totalCount > col.wipLimit;
  const atLimit = col.wipLimit != null && totalCount === col.wipLimit;
  const [renaming, setRenaming] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(col.name);

  return (
    <div className="group/col flex w-[19rem] shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: dot }} />
        {renaming ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              setRenaming(false);
              if (nameDraft.trim() && nameDraft !== col.name) onRename(nameDraft.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setNameDraft(col.name);
                setRenaming(false);
              }
            }}
            className="w-32 rounded border border-primary bg-surface px-1.5 py-0.5 text-sm font-semibold outline-none"
          />
        ) : (
          <span className="text-sm font-semibold">{col.name}</span>
        )}
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[0.6875rem] font-medium",
            overLimit
              ? "bg-danger-soft text-danger"
              : atLimit
                ? "bg-warning-soft text-warning"
                : "bg-surface-2 text-fg-subtle",
          )}
          title={col.wipLimit ? `WIP limit ${col.wipLimit}` : undefined}
        >
          {totalCount}
          {col.wipLimit ? ` / ${col.wipLimit}` : ""}
        </span>

        <Menu
          align="end"
          className="ml-auto"
          trigger={
            <button
              className="grid h-6 w-6 place-items-center rounded-md text-fg-subtle opacity-100 transition-opacity hover:bg-surface-2 hover:text-fg md:opacity-0 md:group-hover/col:opacity-100 cursor-pointer"
              aria-label="Column options"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          }
        >
          {(close) => (
            <>
              <MenuItem
                onClick={() => {
                  close();
                  setNameDraft(col.name);
                  setRenaming(true);
                }}
              >
                Rename column
              </MenuItem>
              <div className="px-2.5 pb-1 pt-2 text-[0.625rem] font-semibold uppercase tracking-wider text-fg-subtle">
                WIP limit
              </div>
              <div className="flex flex-wrap gap-1 px-2 pb-1">
                {[0, 3, 5, 8].map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      close();
                      onSetWip(n === 0 ? null : n);
                    }}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs cursor-pointer",
                      (col.wipLimit ?? 0) === n ? "border-primary bg-primary-soft text-primary-soft-fg" : "border-border hover:bg-surface-2",
                    )}
                  >
                    {n === 0 ? "None" : n}
                  </button>
                ))}
              </div>
            </>
          )}
        </Menu>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "group/col flex min-h-24 flex-1 flex-col gap-2 rounded-2xl border p-2 transition-colors",
          "border-transparent bg-surface-2/50",
          isOver && "border-primary/40 bg-primary-soft/40",
          overLimit && "ring-1 ring-danger/30",
        )}
      >
        <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
          {visibleIds.map((id) => {
            const t = ticketsById[id];
            if (!t) return null;
            return (
              <SortableTicket
                key={id}
                ticket={t}
                celebrate={celebrateId === id}
                onClick={() => onCardClick(id)}
              />
            );
          })}
        </SortableContext>

        {visibleIds.length === 0 && allIds.length > 0 && (
          <p className="px-1 py-2 text-xs text-fg-subtle">No cards match the filter.</p>
        )}

        <AddCard onCreate={onCreate} />
      </div>
    </div>
  );
}

function SortableTicket({
  ticket,
  celebrate,
  onClick,
}: {
  ticket: SerializedTicket;
  celebrate: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ticket.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className="relative"
    >
      <TicketCard ticket={ticket} onClick={onClick} dragging={isDragging} />
      {celebrate && (
        <span className="pointer-events-none absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-success text-white shadow-md animate-check-pop">
          <Check className="h-3.5 w-3.5" />
        </span>
      )}
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

  function submit(keepOpen: boolean) {
    const v = value.trim();
    if (v) onCreate(v);
    setValue("");
    if (!keepOpen) setAdding(false);
    else ref.current?.focus();
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
            submit(true); // save and keep adding for rapid capture
          }
          if (e.key === "Escape") {
            setValue("");
            setAdding(false);
          }
        }}
        onBlur={() => submit(false)}
        rows={2}
        placeholder="What needs doing?  (Enter to add another)"
        className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-fg-subtle"
      />
    </div>
  );
}
