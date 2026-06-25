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
  pointerWithin,
  rectIntersection,
  closestCenter,
  getFirstCollision,
  type Announcements,
  type CollisionDetection,
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
import {
  Plus,
  Search,
  SlidersHorizontal,
  X,
  Check,
  MoreHorizontal,
  Flag,
  Tag,
  User,
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  CornerUpRight,
  Trash2,
} from "lucide-react";
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
type ColumnMeta = { id: string; name: string; isDone: boolean; wipLimit: number | null; subStates: string[] };
type SectionData = { key: string; sub: string | null; allIds: string[]; visibleIds: string[] };

/** Collapse a column's older cards behind a "show older" toggle past this count. */
const COLUMN_VISIBLE_LIMIT = 12;

// A "section" is a drop container: a plain column is one section (key = columnId);
// a column with sub-states is one section per sub-state (key = columnId\0subState).
// The NUL separator can't appear in a cuid columnId or a user-typed sub-state.
const SECTION_SEP = "\u0000";

function sectionKey(colId: string, sub: string | null): string {
  return sub == null ? colId : `${colId}${SECTION_SEP}${sub}`;
}
function parseSection(key: string): { colId: string; sub: string | null } {
  const i = key.indexOf(SECTION_SEP);
  return i === -1 ? { colId: key, sub: null } : { colId: key.slice(0, i), sub: key.slice(i + 1) };
}
function columnSectionKeys(col: { id: string; subStates: string[] }): string[] {
  return col.subStates.length ? col.subStates.map((s) => sectionKey(col.id, s)) : [col.id];
}
/** Flattened column order (sections concatenated in sub-state order) — matches the
 *  server's column-wide `position` numbering, so an index here is a valid position. */
function columnFlat(map: Record<string, string[]>, col: { id: string; subStates: string[] }): string[] {
  return columnSectionKeys(col).flatMap((k) => map[k] ?? []);
}
/** A ticket's effective sub-state: keep a valid choice, else the first (mirrors the server). */
function effectiveSub(subStates: string[], sub: string | null | undefined): string | null {
  if (!subStates.length) return null;
  return sub && subStates.includes(sub) ? sub : subStates[0];
}

type Filters = {
  q: string;
  priorities: Set<string>;
  labelIds: Set<string>;
  assignee: "any" | "me" | "agents" | "unassigned";
};

export function BoardView({
  board,
  agents: agentsProp,
  currentUser,
  initialTicketId,
  returnTo,
}: {
  board: BoardData;
  agents: AgentLite[];
  currentUser?: { id: string; name: string } | null;
  initialTicketId?: string;
  returnTo?: "notes";
}) {
  const router = useRouter();
  const { toast } = useToast();

  // Keep the assignable-agents list fresh: refetch on mount and when the tab
  // regains focus, so an agent added on the Agents page is immediately assignable.
  const [agents, setAgents] = React.useState<AgentLite[]>(agentsProp);
  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { agents: all } = await api<{
          agents: { id: string; name: string; color: string; kind: string; status: string }[];
        }>("/api/agents");
        if (!cancelled) {
          setAgents(
            all
              .filter((a) => a.status === "active")
              .map((a) => ({ id: a.id, name: a.name, color: a.color, kind: a.kind })),
          );
        }
      } catch {
        /* keep SSR list */
      }
    }
    load();
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
    };
  }, []);

  const [cols, setCols] = React.useState<ColumnMeta[]>(() =>
    board.columns.map((c) => ({ id: c.id, name: c.name, isDone: c.isDone, wipLimit: c.wipLimit, subStates: c.subStates ?? [] })),
  );
  const [ticketsById, setTicketsById] = React.useState<Record<string, SerializedTicket>>(() => {
    const m: Record<string, SerializedTicket> = {};
    board.columns.forEach((c) => c.tickets.forEach((t) => (m[t.id] = t)));
    return m;
  });
  // containers maps a section key → ordered ticket ids. Empty sections still get a
  // key so they register as drop targets and can receive cards.
  const [containers, setContainers] = React.useState<Record<string, string[]>>(() => {
    const m: Record<string, string[]> = {};
    board.columns.forEach((c) => {
      const subs = c.subStates ?? [];
      if (subs.length) {
        subs.forEach((s) => (m[sectionKey(c.id, s)] = []));
        c.tickets.forEach((t) => m[sectionKey(c.id, effectiveSub(subs, t.subState)!)].push(t.id));
      } else {
        m[c.id] = c.tickets.map((t) => t.id);
      }
    });
    return m;
  });
  const containersRef = React.useRef(containers);
  const setCont = (next: Record<string, string[]>) => {
    containersRef.current = next;
    setContainers(next);
  };

  const [activeId, setActiveId] = React.useState<string | null>(null);
  // Snapshot of containers at drag start, so a cancel (Escape) or a release onto
  // nothing reverts the optimistic cross-container moves made during onDragOver.
  const dragSnapshot = React.useRef<Record<string, string[]>>({});
  const [selectedId, setSelectedId] = React.useState<string | null>(initialTicketId ?? null);
  const [celebrateId, setCelebrateId] = React.useState<string | null>(null);
  const [focusedId, setFocusedId] = React.useState<string | null>(null);
  const liveRef = React.useRef<HTMLDivElement>(null);
  const gridRef = React.useRef<{ colId: string; ids: string[] }[]>([]);
  const focusedRef = React.useRef<string | null>(null);
  focusedRef.current = focusedId;

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

  // Pointer-first collision detection (the canonical dnd-kit multi-container
  // strategy). Whatever is under the cursor wins — so empty columns AND empty
  // sub-state bands are real drop targets — and within a filled container we fall
  // back to the closest card for smooth insertion.
  const collisionDetection = React.useCallback<CollisionDetection>((args) => {
    const pointer = pointerWithin(args);
    const intersections = pointer.length ? pointer : rectIntersection(args);
    let overId = getFirstCollision(intersections, "id");
    // Dead space (between columns, below the bands of a sub-stated column): fall
    // back to the nearest droppable so a release never silently lands on nothing.
    if (overId == null) overId = getFirstCollision(closestCenter(args), "id");
    if (overId != null) {
      const cont = containersRef.current;
      const key = String(overId);
      if (key in cont && cont[key].length > 0) {
        const closest = closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter(
            (c) => c.id !== overId && cont[key].includes(String(c.id)),
          ),
        });
        const inner = getFirstCollision(closest, "id");
        if (inner != null) overId = inner;
      }
      return [{ id: overId }];
    }
    return [];
  }, []);

  function keyOf(map: Record<string, string[]>, id: string): string | null {
    if (id in map) return id;
    return Object.keys(map).find((k) => map[k].includes(id)) ?? null;
  }

  function onDragStart(e: DragStartEvent) {
    dragSnapshot.current = containersRef.current;
    setActiveId(String(e.active.id));
  }

  function onDragCancel() {
    setActiveId(null);
    setCont(dragSnapshot.current);
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
    if (!over) {
      // Released onto nothing — undo the optimistic onDragOver reshuffle.
      setCont(dragSnapshot.current);
      return;
    }
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
    const { colId, sub } = parseSection(finalContainer);
    const col = cols.find((c) => c.id === colId);
    const position = col ? columnFlat(result, col).indexOf(activeId) : result[finalContainer].indexOf(activeId);

    // Drag moves are announced via DndContext's accessibility.announcements.
    if (col?.isDone) {
      setCelebrateId(activeId);
      setTimeout(() => setCelebrateId((id) => (id === activeId ? null : id)), 1100);
    }

    // The destination band already encodes the sub-state — no chooser needed.
    let subState: string | null | undefined;
    if (col?.subStates.length) {
      subState = sub && col.subStates.includes(sub) ? sub : col.subStates[0];
      if ((ticketsById[activeId]?.subState ?? null) !== subState)
        setTicketsById((m) => ({ ...m, [activeId]: { ...m[activeId], subState: subState! } }));
    } else if (ticketsById[activeId]?.subState) {
      subState = null; // moved to a column without sub-states → clear it
      setTicketsById((m) => ({ ...m, [activeId]: { ...m[activeId], subState: null } }));
    }

    void persistMove(activeId, colId, position, subState);
  }

  async function persistMove(ticketId: string, columnId: string, position: number, subState?: string | null) {
    try {
      const { ticket } = await api<{ ticket: SerializedTicket }>(`/api/tickets/${ticketId}/move`, {
        body: { columnId, position, ...(subState !== undefined ? { subState } : {}) },
      });
      setTicketsById((m) => ({ ...m, [ticketId]: ticket }));
    } catch {
      toast({ title: "Couldn't move card", variant: "error" });
      router.refresh();
    }
  }

  async function setColumnSubStates(columnId: string, subStates: string[]) {
    const col = cols.find((c) => c.id === columnId);
    // Re-key this column's sections, preserving each card's valid sub-state choice
    // and defaulting the rest to the first band.
    const prev = containersRef.current;
    const oldKeys = col ? columnSectionKeys(col) : [columnId];
    const ids = oldKeys.flatMap((k) => prev[k] ?? []);
    const next = { ...prev };
    oldKeys.forEach((k) => delete next[k]);
    if (subStates.length) {
      subStates.forEach((s) => (next[sectionKey(columnId, s)] = []));
      ids.forEach((id) => next[sectionKey(columnId, effectiveSub(subStates, ticketsById[id]?.subState)!)].push(id));
    } else {
      next[columnId] = ids;
    }
    setCont(next);
    setCols((cs) => cs.map((c) => (c.id === columnId ? { ...c, subStates } : c)));
    // Snap each card's own sub-state onto a valid value too, so the modal and the
    // "Move" menu don't show an orphaned/stale choice (the server does the same).
    setTicketsById((m) => {
      let changed = false;
      const mm = { ...m };
      ids.forEach((id) => {
        if (!mm[id]) return;
        const resolved = subStates.length ? effectiveSub(subStates, mm[id].subState) : null;
        if ((mm[id].subState ?? null) !== (resolved ?? null)) {
          mm[id] = { ...mm[id], subState: resolved };
          changed = true;
        }
      });
      return changed ? mm : m;
    });
    try {
      await api(`/api/columns/${columnId}`, { method: "PATCH", body: { subStates } });
    } catch {
      router.refresh();
    }
  }

  /** Move via the "Move to" menu (no drag): mirrors onDragEnd's optimistic update. */
  function moveTicketTo(ticketId: string, columnId: string, subState?: string) {
    const col = cols.find((c) => c.id === columnId);
    const targetSub = effectiveSub(col?.subStates ?? [], subState);
    const targetKey = sectionKey(columnId, targetSub);
    const prev = containersRef.current;
    const from = keyOf(prev, ticketId);
    const sameCol = from ? parseSection(from).colId === columnId : false;
    if (from !== targetKey) {
      const next = { ...prev };
      if (from) next[from] = next[from].filter((x) => x !== ticketId);
      next[targetKey] = [...(next[targetKey] ?? []), ticketId];
      setCont(next);
    }
    if ((ticketsById[ticketId]?.subState ?? null) !== targetSub) {
      setTicketsById((m) => ({ ...m, [ticketId]: { ...m[ticketId], subState: targetSub } }));
    }
    if (col?.isDone && !sameCol) {
      setCelebrateId(ticketId);
      setTimeout(() => setCelebrateId((id) => (id === ticketId ? null : id)), 1100);
    }
    if (liveRef.current)
      liveRef.current.textContent = `Moved ${ticketsById[ticketId]?.title ?? "card"} to ${col?.name ?? ""}${targetSub ? " · " + targetSub : ""}`;
    const flat = col ? columnFlat(containersRef.current, col) : containersRef.current[targetKey] ?? [];
    void persistMove(ticketId, columnId, flat.indexOf(ticketId), targetSub);
  }

  async function handleCreate(columnId: string, title: string) {
    try {
      const { ticket } = await api<{ ticket: SerializedTicket }>("/api/tickets", {
        body: { boardId: board.id, columnId, title },
      });
      const col = cols.find((c) => c.id === columnId);
      const sub = col?.subStates.length ? col.subStates[0] : null;
      const key = sectionKey(columnId, sub);
      setTicketsById((m) => ({ ...m, [ticket.id]: { ...ticket, subState: sub } }));
      setCont({ ...containersRef.current, [key]: [...(containersRef.current[key] ?? []), ticket.id] });
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

  async function toggleDone(columnId: string, isDone: boolean) {
    setCols((cs) => cs.map((c) => (c.id === columnId ? { ...c, isDone } : c)));
    try {
      await api(`/api/columns/${columnId}`, { method: "PATCH", body: { isDone } });
    } catch {
      router.refresh();
    }
  }

  async function addColumn(name: string) {
    try {
      const { column } = await api<{ column: ColumnMeta }>("/api/columns", {
        body: { boardId: board.id, name },
      });
      setCols((cs) => [...cs, column]);
      setCont({ ...containersRef.current, [column.id]: [] });
    } catch {
      toast({ title: "Couldn't add column", variant: "error" });
      router.refresh();
    }
  }

  async function moveColumn(columnId: string, dir: "left" | "right") {
    const idx = cols.findIndex((c) => c.id === columnId);
    const swap = dir === "left" ? idx - 1 : idx + 1;
    if (idx < 0 || swap < 0 || swap >= cols.length) return;
    const next = [...cols];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setCols(next);
    try {
      await api("/api/columns/reorder", { body: { boardId: board.id, orderedIds: next.map((c) => c.id) } });
    } catch {
      router.refresh();
    }
  }

  async function deleteColumn(columnId: string) {
    try {
      await api(`/api/columns/${columnId}`, { method: "DELETE" });
      setCols((cs) => cs.filter((c) => c.id !== columnId));
      const next = { ...containersRef.current };
      Object.keys(next).forEach((k) => {
        if (parseSection(k).colId === columnId) delete next[k];
      });
      setCont(next);
      toast({ title: "Column deleted", variant: "default" });
    } catch (e) {
      toast({ title: "Couldn't delete column", description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }

  function handleTicketUpdated(t: SerializedTicket) {
    setTicketsById((m) => ({ ...m, [t.id]: t }));
    const col = cols.find((c) => c.id === t.columnId);
    const targetKey = sectionKey(t.columnId, effectiveSub(col?.subStates ?? [], t.subState));
    const cur = keyOf(containersRef.current, t.id);
    if (cur !== targetKey) {
      const next = { ...containersRef.current };
      if (cur) next[cur] = next[cur].filter((id) => id !== t.id);
      next[targetKey] = [...(next[targetKey] ?? []), t.id];
      setCont(next);
    }
  }

  function handleTicketDeleted(id: string) {
    const cur = keyOf(containersRef.current, id);
    if (cur) setCont({ ...containersRef.current, [cur]: containersRef.current[cur].filter((x) => x !== id) });
    setSelectedId(null);
    toast({ title: "Ticket deleted", variant: "default" });
  }

  async function moveTicketToDone(ticketId: string): Promise<SerializedTicket> {
    const doneColumn = cols.find((c) => c.isDone);
    if (!doneColumn) throw new Error("No done column is configured for this board.");
    const sub = doneColumn.subStates.length ? doneColumn.subStates[0] : null;
    const targetKey = sectionKey(doneColumn.id, sub);
    const prev = containersRef.current;
    const from = keyOf(prev, ticketId);
    const sameCol = from ? parseSection(from).colId === doneColumn.id : false;
    const flat = columnFlat(prev, doneColumn);
    const position = sameCol ? Math.max(0, flat.indexOf(ticketId)) : flat.length;
    const { ticket } = await api<{ ticket: SerializedTicket }>(`/api/tickets/${ticketId}/move`, {
      body: { columnId: doneColumn.id, position, subState: sub },
    });

    setTicketsById((m) => ({ ...m, [ticketId]: ticket }));
    if (!sameCol) {
      const next = { ...containersRef.current };
      if (from) next[from] = next[from].filter((id) => id !== ticketId);
      next[targetKey] = [...(next[targetKey] ?? []), ticketId];
      setCont(next);
      setCelebrateId(ticketId);
      setTimeout(() => setCelebrateId((id) => (id === ticketId ? null : id)), 1100);
    }
    if (liveRef.current) liveRef.current.textContent = `Marked ${ticketsById[ticketId]?.title ?? "card"} done`;
    if (returnTo === "notes") {
      // Close the modal first so the moved card's success state can flash on the
      // board before navigating back to the Notes due section.
      setSelectedId(null);
      window.setTimeout(() => {
        router.push("/notes");
        router.refresh();
      }, 650);
    }
    return ticket;
  }

  // Keyboard navigation across cards (arrows move, Enter opens). Skips when
  // a modal/palette is open or the user is typing.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (selectedId) return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
      if (document.querySelector("[role=dialog], [role=menu]")) return;
      if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Enter"].includes(e.key)) return;
      const all = gridRef.current;
      if (!all.some((c) => c.ids.length)) return;
      e.preventDefault();
      const cur = focusedRef.current;
      let ci = all.findIndex((c) => c.ids.includes(cur ?? ""));
      if (ci < 0) {
        setFocusedId(all.find((c) => c.ids.length)!.ids[0]);
        return;
      }
      if (e.key === "Enter") {
        if (cur) setSelectedId(cur);
        return;
      }
      let ri = all[ci].ids.indexOf(cur!);
      if (e.key === "ArrowDown") ri = Math.min(ri + 1, all[ci].ids.length - 1);
      else if (e.key === "ArrowUp") ri = Math.max(ri - 1, 0);
      else {
        const dir = e.key === "ArrowRight" ? 1 : -1;
        let nc = ci + dir;
        while (nc >= 0 && nc < all.length && all[nc].ids.length === 0) nc += dir;
        if (nc >= 0 && nc < all.length) {
          ci = nc;
          ri = Math.min(ri, all[ci].ids.length - 1);
        }
      }
      setFocusedId(all[ci].ids[ri]);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedId]);

  React.useEffect(() => {
    if (focusedId)
      document.getElementById(`tk-${focusedId}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusedId]);

  const grid = cols.map((col) => {
    const sections: SectionData[] = columnSectionKeys(col).map((key, i) => {
      const ids = containers[key] ?? [];
      const visibleIds = activeFilterCount ? ids.filter((id) => ticketsById[id] && matches(ticketsById[id])) : ids;
      return { key, sub: col.subStates.length ? col.subStates[i] : null, allIds: ids, visibleIds };
    });
    return {
      col,
      sections,
      allIds: sections.flatMap((s) => s.allIds),
      visibleIds: sections.flatMap((s) => s.visibleIds),
    };
  });
  gridRef.current = grid.map((g) => ({ colId: g.col.id, ids: g.visibleIds }));

  const activeTicket = activeId ? ticketsById[activeId] : null;
  const selectedTicket = selectedId ? ticketsById[selectedId] : null;

  // Human-readable screen-reader announcements (the droppable ids embed a NUL
  // separator + sub-state, which would otherwise be read verbatim).
  const describeOver = (id: string) => {
    const { colId, sub } = parseSection(keyOf(containersRef.current, id) ?? id);
    const col = cols.find((c) => c.id === colId);
    return `${col?.name ?? "column"}${sub ? " · " + sub : ""}`;
  };
  const cardTitle = (id: string) => ticketsById[id]?.title ?? "card";
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${cardTitle(String(active.id))}.`,
    onDragOver: ({ active, over }) =>
      over ? `${cardTitle(String(active.id))} over ${describeOver(String(over.id))}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `Dropped ${cardTitle(String(active.id))} in ${describeOver(String(over.id))}.`
        : `Dropped ${cardTitle(String(active.id))}.`,
    onDragCancel: ({ active }) => `Cancelled moving ${cardTitle(String(active.id))}.`,
  };

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
        collisionDetection={collisionDetection}
        accessibility={{ announcements }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto overflow-y-hidden px-4 pb-4 md:px-6 lg:px-8">
          {grid.map(({ col, sections, allIds }, i) => (
            <Column
              key={col.id}
              col={col}
              index={i}
              total={cols.length}
              totalCount={allIds.length}
              sections={sections}
              ticketsById={ticketsById}
              celebrateId={celebrateId}
              focusedId={focusedId}
              dragging={activeId != null}
              allColumns={cols}
              onMoveTo={moveTicketTo}
              onCardClick={(id) => setSelectedId(id)}
              onCreate={(title) => handleCreate(col.id, title)}
              onRename={(name) => renameColumn(col.id, name)}
              onSetWip={(n) => setWip(col.id, n)}
              onToggleDone={(d) => toggleDone(col.id, d)}
              onSetSubStates={(s) => setColumnSubStates(col.id, s)}
              onMove={(dir) => moveColumn(col.id, dir)}
              onDelete={() => deleteColumn(col.id)}
            />
          ))}

          <AddColumn onCreate={addColumn} />
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
          onMoveToDone={() => moveTicketToDone(selectedTicket.id)}
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
          className="h-9 w-36 rounded-lg border border-border bg-surface pl-8 pr-3 text-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 sm:w-44 sm:focus:w-60"
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
  index,
  total,
  totalCount,
  sections,
  ticketsById,
  celebrateId,
  focusedId,
  dragging,
  allColumns,
  onMoveTo,
  onCardClick,
  onCreate,
  onRename,
  onSetWip,
  onToggleDone,
  onSetSubStates,
  onMove,
  onDelete,
}: {
  col: ColumnMeta;
  index: number;
  total: number;
  totalCount: number;
  sections: SectionData[];
  ticketsById: Record<string, SerializedTicket>;
  celebrateId: string | null;
  focusedId: string | null;
  dragging: boolean;
  allColumns: ColumnMeta[];
  onMoveTo: (ticketId: string, columnId: string, subState?: string) => void;
  onCardClick: (id: string) => void;
  onCreate: (title: string) => void;
  onRename: (name: string) => void;
  onSetWip: (n: number | null) => void;
  onToggleDone: (isDone: boolean) => void;
  onSetSubStates: (subStates: string[]) => void;
  onMove: (dir: "left" | "right") => void;
  onDelete: () => void;
}) {
  const dot = col.isDone ? tone("emerald").dot : tone("slate").dot;
  const overLimit = col.wipLimit != null && totalCount > col.wipLimit;
  const atLimit = col.wipLimit != null && totalCount === col.wipLimit;
  const [renaming, setRenaming] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(col.name);
  const subStated = col.subStates.length > 0;

  const sectionProps = (s: SectionData) => ({
    id: s.key,
    ids: s.visibleIds,
    allCount: s.allIds.length,
    dragging,
    ticketsById,
    celebrateId,
    focusedId,
    allColumns,
    onMoveTo,
    onCardClick,
  });

  return (
    <div className="group/col flex w-[19rem] min-h-0 shrink-0 flex-col">
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
              <div className="my-1 h-px bg-border" />
              <div className="px-2.5 pb-1 pt-1 text-[0.625rem] font-semibold uppercase tracking-wider text-fg-subtle">
                Sub-states
              </div>
              <div className="px-2 pb-1.5" onClick={(e) => e.stopPropagation()}>
                <SubStatesEditor value={col.subStates} onChange={onSetSubStates} />
              </div>
              <div className="my-1 h-px bg-border" />
              <MenuItem onClick={() => { close(); onToggleDone(!col.isDone); }}>
                <CircleCheck className={cn("h-4 w-4", col.isDone && "text-success")} />
                {col.isDone ? "Unmark done column" : "Mark as done column"}
              </MenuItem>
              <MenuItem
                onClick={() => index > 0 && (close(), onMove("left"))}
                className={index === 0 ? "pointer-events-none opacity-40" : ""}
              >
                <ArrowLeft className="h-4 w-4" /> Move left
              </MenuItem>
              <MenuItem
                onClick={() => index < total - 1 && (close(), onMove("right"))}
                className={index === total - 1 ? "pointer-events-none opacity-40" : ""}
              >
                <ArrowRight className="h-4 w-4" /> Move right
              </MenuItem>
              <div className="my-1 h-px bg-border" />
              <MenuItem className="text-danger hover:bg-danger-soft" onClick={() => { close(); onDelete(); }}>
                <Trash2 className="h-4 w-4" /> Delete column
              </MenuItem>
            </>
          )}
        </Menu>
      </div>

      {subStated ? (
        <div className={cn("flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-1", overLimit && "rounded-2xl p-0.5 ring-1 ring-danger/30")}>
          {sections.map((s) => (
            <Section key={s.key} {...sectionProps(s)} label={s.sub ?? undefined} count={s.allIds.length} />
          ))}
          {sections.reduce((n, s) => n + s.visibleIds.length, 0) === 0 && totalCount > 0 && (
            <p className="px-1 py-1.5 text-xs text-fg-subtle">No cards match the filter.</p>
          )}
          <AddCard onCreate={onCreate} />
        </div>
      ) : (
        <Section {...sectionProps(sections[0])} fill overLimit={overLimit} footer={<AddCard onCreate={onCreate} />} />
      )}
    </div>
  );
}

/** One drop container: a whole plain column (fill) or a single sub-state band. */
function Section({
  id,
  label,
  count,
  fill,
  dragging,
  overLimit,
  ids,
  allCount,
  ticketsById,
  celebrateId,
  focusedId,
  allColumns,
  onMoveTo,
  onCardClick,
  footer,
}: {
  id: string;
  label?: string;
  count?: number;
  fill?: boolean;
  dragging: boolean;
  overLimit?: boolean;
  ids: string[];
  allCount: number;
  ticketsById: Record<string, SerializedTicket>;
  celebrateId: string | null;
  focusedId: string | null;
  allColumns: ColumnMeta[];
  onMoveTo: (ticketId: string, columnId: string, subState?: string) => void;
  onCardClick: (id: string) => void;
  footer?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const [showAll, setShowAll] = React.useState(false);
  const shown = showAll ? ids : ids.slice(0, COLUMN_VISIBLE_LIMIT);
  const hidden = ids.length - shown.length;
  const empty = ids.length === 0;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col gap-2 rounded-2xl border transition-colors",
        fill
          ? "group/col min-h-0 flex-1 overflow-y-auto border-transparent bg-surface-2/50 p-2"
          : "border-border/50 bg-surface-2/40 p-2",
        isOver && "border-primary/50 bg-primary-soft/40 ring-1 ring-primary/30",
        fill && overLimit && "ring-1 ring-danger/30",
      )}
    >
      {label && (
        <div className="flex items-center gap-1.5 px-1 pt-0.5 text-[0.625rem] font-semibold uppercase tracking-wider text-fg-subtle">
          <span className="h-1 w-1 rounded-full bg-fg-subtle/60" />
          <span className="truncate">{label}</span>
          <span className="ml-auto tabular-nums">{count}</span>
        </div>
      )}

      <SortableContext items={shown} strategy={verticalListSortingStrategy}>
        {shown.map((tid) => {
          const t = ticketsById[tid];
          if (!t) return null;
          return (
            <SortableTicket
              key={tid}
              ticket={t}
              celebrate={celebrateId === tid}
              focused={focusedId === tid}
              allColumns={allColumns}
              onMoveTo={onMoveTo}
              onClick={() => onCardClick(tid)}
            />
          );
        })}
      </SortableContext>

      {hidden > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="rounded-lg px-2 py-1.5 text-left text-xs font-medium text-fg-muted hover:bg-surface-3 hover:text-fg cursor-pointer"
        >
          Show {hidden} older
        </button>
      )}
      {showAll && ids.length > COLUMN_VISIBLE_LIMIT && (
        <button
          onClick={() => setShowAll(false)}
          className="rounded-lg px-2 py-1.5 text-left text-xs font-medium text-fg-subtle hover:bg-surface-3 hover:text-fg cursor-pointer"
        >
          Show fewer
        </button>
      )}

      {/* Plain columns show their own filter-empty message; sub-stated columns show
          one column-level message instead of repeating it per band. */}
      {empty && allCount > 0 && fill && <p className="px-1 py-1.5 text-xs text-fg-subtle">No cards match the filter.</p>}
      {empty && allCount === 0 && (
        // A plain column's zone fills its height (so it stays a full-height drop
        // target, invisible at rest); a sub-state band shows a faint bounded slot
        // at rest so it's discoverable, and both light up during a drag.
        <div
          className={cn(
            "flex items-center justify-center rounded-xl border border-dashed text-[0.6875rem] font-medium transition-all",
            fill ? "min-h-[3rem] flex-1" : dragging ? "min-h-[2.5rem]" : "min-h-[1.5rem]",
            dragging
              ? "border-primary/40 bg-primary-soft/20 text-primary/70"
              : fill
                ? "border-transparent text-transparent"
                : "border-border/40 text-transparent",
          )}
        >
          {dragging ? "Drop here" : null}
        </div>
      )}

      {footer}
    </div>
  );
}

function SubStatesEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = React.useState("");
  function add() {
    const name = text.trim().slice(0, 24);
    if (!name) return;
    if (value.some((v) => v.toLowerCase() === name.toLowerCase())) {
      setText("");
      return;
    }
    if (value.length >= 8) return;
    onChange([...value, name]);
    setText("");
  }
  return (
    <div>
      {value.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {value.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs">
              {s}
              <button
                onClick={() => onChange(value.filter((x) => x !== s))}
                className="text-fg-subtle hover:text-danger cursor-pointer"
                aria-label={`Remove ${s}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={value.length ? "Add another…" : "e.g. In progress, Blocked"}
          maxLength={24}
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-xs outline-none focus:border-primary"
        />
        <button
          onClick={add}
          disabled={!text.trim() || value.length >= 8}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border hover:bg-surface-2 cursor-pointer disabled:opacity-40"
          aria-label="Add sub-state"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1 text-[0.625rem] text-fg-subtle">Each sub-state becomes its own drop zone in this column.</p>
    </div>
  );
}

function SortableTicket({
  ticket,
  celebrate,
  focused,
  allColumns,
  onMoveTo,
  onClick,
}: {
  ticket: SerializedTicket;
  celebrate: boolean;
  focused: boolean;
  allColumns: ColumnMeta[];
  onMoveTo: (ticketId: string, columnId: string, subState?: string) => void;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ticket.id });
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div
      ref={setNodeRef}
      id={`tk-${ticket.id}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className="group/card relative"
    >
      <TicketCard
        ticket={ticket}
        onClick={onClick}
        dragging={isDragging}
        className={focused ? "ring-2 ring-primary ring-offset-2 ring-offset-surface-2" : undefined}
      />
      {/* "Move to" — a no-drag way to change column/sub-state on touch devices,
          where drag-and-drop is fiddly. Phones/small screens only; hidden ≥ md. */}
      <div className="mt-1 flex items-center px-0.5 md:hidden">
        <Menu
          align="end"
          className="ml-auto"
          trigger={
            <button
              onPointerDown={stop}
              title="Move to…"
              aria-label="Move to another column"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-[0.6875rem] font-medium text-fg-muted hover:bg-surface-2 cursor-pointer"
            >
              <CornerUpRight className="h-3 w-3" /> Move
            </button>
          }
        >
          {(close) => <MoveMenu columns={allColumns} ticket={ticket} onMoveTo={onMoveTo} close={close} />}
        </Menu>
      </div>
      {celebrate && (
        <span className="pointer-events-none absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-success text-white shadow-md animate-check-pop">
          <Check className="h-3.5 w-3.5" />
        </span>
      )}
    </div>
  );
}

/** Flat "Move to" menu: every column, with each sub-state as a direct destination. */
function MoveMenu({
  columns,
  ticket,
  onMoveTo,
  close,
}: {
  columns: ColumnMeta[];
  ticket: SerializedTicket;
  onMoveTo: (ticketId: string, columnId: string, subState?: string) => void;
  close: () => void;
}) {
  return (
    <div className="max-h-[60vh] min-w-[12rem] overflow-y-auto py-1">
      <div className="px-2.5 pb-1 pt-0.5 text-[0.625rem] font-semibold uppercase tracking-wider text-fg-subtle">
        Move to
      </div>
      {columns.map((c) =>
        c.subStates.length === 0 ? (
          <MenuItem
            key={c.id}
            active={c.id === ticket.columnId}
            onClick={() => {
              onMoveTo(ticket.id, c.id);
              close();
            }}
          >
            {c.name}
          </MenuItem>
        ) : (
          <div key={c.id}>
            <div className="px-2.5 pb-0.5 pt-1.5 text-[0.625rem] font-semibold uppercase tracking-wider text-fg-subtle">
              {c.name}
            </div>
            {c.subStates.map((s) => (
              <MenuItem
                key={c.id + s}
                active={c.id === ticket.columnId && ticket.subState === s}
                onClick={() => {
                  onMoveTo(ticket.id, c.id, s);
                  close();
                }}
              >
                <span className="pl-1.5">{s}</span>
              </MenuItem>
            ))}
          </div>
        ),
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

function AddColumn({ onCreate }: { onCreate: (name: string) => void }) {
  const [adding, setAdding] = React.useState(false);
  const [value, setValue] = React.useState("");
  const ref = React.useRef<HTMLInputElement>(null);

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
        className="flex h-11 w-[15rem] shrink-0 items-center gap-1.5 rounded-2xl border border-dashed border-border px-3 text-sm text-fg-subtle transition-colors hover:border-border-strong hover:text-fg cursor-pointer"
      >
        <Plus className="h-4 w-4" /> Add column
      </button>
    );
  }

  return (
    <div className="w-[15rem] shrink-0">
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            setValue("");
            setAdding(false);
          }
        }}
        onBlur={submit}
        placeholder="Column name"
        className="w-full rounded-xl border border-primary bg-surface px-3 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/20"
      />
    </div>
  );
}
