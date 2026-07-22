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
  MeasuringStrategy,
  type Announcements,
  type CollisionDetection,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
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
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuItem } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { canAssignAgent } from "@/lib/display";
import { tone } from "@/components/ui/badge";
import { PRIORITIES, PRIORITY_META } from "@/lib/constants";
import { COLUMN_STAGES, STAGE_META, type ColumnStage } from "@/lib/column-stage";
import {
  insertInNewestFirstOrder,
  isDenseSection,
  moveInNewestFirstOrder,
  nextVisibleCount,
  visibleNewestFirstIds,
} from "@/lib/board-section-visibility";
import type { BoardData } from "@/lib/services/boards";
import type { SerializedTicket } from "@/lib/serialize";

type AgentLite = {
  id: string;
  name: string;
  color: string;
  kind: string;
  /** Owned agents are only assignable by their owner; null = workspace agent. */
  ownerUserId: string | null;
  ownerName: string | null;
};
type MemberLite = { id: string; name: string; avatarUrl?: string | null; avatarColor?: string | null };
/** Assignee chosen in the add-card composer, before the ticket exists. */
type NewAssignee = { type: "user" | "agent"; id: string; name: string; color?: string; kind?: string };
type ColumnMeta = {
  id: string;
  name: string;
  isDone: boolean;
  stage: ColumnStage;
  wipLimit: number | null;
  subStates: string[];
};

/** Stage color language — dots, tinted chips, and the column/band surfaces. */
const STAGE_DOT: Record<ColumnStage, string> = {
  intake: "var(--stage-intake)",
  backlog: "var(--stage-backlog)",
  active: "var(--stage-active)",
  done: "var(--stage-done)",
};
const STAGE_FILL: Record<ColumnStage, string> = {
  intake: "kb-col-intake",
  backlog: "kb-col-backlog",
  active: "kb-col-active",
  done: "kb-col-done",
};
const STAGE_BAND: Record<ColumnStage, string> = {
  intake: "kb-band-intake",
  backlog: "kb-band-backlog",
  active: "kb-band-active",
  done: "kb-band-done",
};
type SectionData = { key: string; sub: string | null; allIds: string[]; visibleIds: string[] };

/** Collapse a column's older cards behind a "show more" toggle past this count. */
const COLUMN_VISIBLE_LIMIT = 12;
/** Sub-state bands stack inside one column, so they collapse sooner. */
const SUBSTATE_VISIBLE_LIMIT = 6;
/** Don't bother collapsing for a trivial tail (a "Show 1 more" button is noise). */
const COLLAPSE_SLACK = 2;

function sectionVisibleLimit(subStated: boolean): number {
  return subStated ? SUBSTATE_VISIBLE_LIMIT : COLUMN_VISIBLE_LIMIT;
}
function visibleSectionIds(ids: string[], visibleCount: number): string[] {
  return visibleNewestFirstIds(ids, visibleCount);
}

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
// While a card is dragged over a sub-stated column, an overlay of equal-height
// drop zones (one per sub-state) covers the visible column, so the second band
// is reachable without scrolling past the first band's cards. Zones are extra
// droppables whose ids wrap the section key they stand in for.
const ZONE_PREFIX = `zone${SECTION_SEP}`;
function zoneId(sectionKey: string): string {
  return `${ZONE_PREFIX}${sectionKey}`;
}
/** The section key a zone id stands for, or null when the id isn't a zone. */
function zoneSection(id: string): string | null {
  return id.startsWith(ZONE_PREFIX) ? id.slice(ZONE_PREFIX.length) : null;
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

// Local board state is rebuilt from server props whenever they change (error
// recovery via router.refresh(), focus revalidation, agents filing tickets).
function buildCols(board: BoardData): ColumnMeta[] {
  return board.columns.map((c) => ({
    id: c.id,
    name: c.name,
    isDone: c.isDone,
    stage: c.stage,
    wipLimit: c.wipLimit,
    subStates: c.subStates ?? [],
  }));
}
function buildTicketsById(board: BoardData): Record<string, SerializedTicket> {
  const m: Record<string, SerializedTicket> = {};
  board.columns.forEach((c) => c.tickets.forEach((t) => (m[t.id] = t)));
  return m;
}
function buildContainers(board: BoardData): Record<string, string[]> {
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
}

export function BoardView({
  board,
  agents: agentsProp,
  members = [],
  currentUser,
  initialTicketId,
  returnTo,
  switcher,
}: {
  board: BoardData;
  agents: AgentLite[];
  members?: MemberLite[];
  currentUser?: { id: string; name: string } | null;
  initialTicketId?: string;
  returnTo?: "notes";
  /** The kanban ⇄ week view switch, rendered at the start of the toolbar row. */
  switcher?: React.ReactNode;
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
          agents: (AgentLite & { status: string })[];
        }>("/api/agents");
        if (!cancelled) {
          setAgents(
            all
              .filter((a) => a.status === "active")
              .map((a) => ({
                id: a.id,
                name: a.name,
                color: a.color,
                kind: a.kind,
                ownerUserId: a.ownerUserId,
                ownerName: a.ownerName,
              })),
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

  const [cols, setCols] = React.useState<ColumnMeta[]>(() => buildCols(board));
  const [ticketsById, setTicketsById] = React.useState<Record<string, SerializedTicket>>(() =>
    buildTicketsById(board),
  );
  // containers maps a section key → ordered ticket ids. Empty sections still get a
  // key so they register as drop targets and can receive cards.
  const [containers, setContainers] = React.useState<Record<string, string[]>>(() => buildContainers(board));
  const containersRef = React.useRef(containers);
  const setCont = (next: Record<string, string[]>) => {
    containersRef.current = next;
    setContainers(next);
  };

  // In-flight mutations; while > 0 we don't overwrite local state from props.
  const busyRef = React.useRef(0);
  async function tracked<T>(fn: () => Promise<T>): Promise<T> {
    busyRef.current++;
    try {
      return await fn();
    } finally {
      busyRef.current--;
    }
  }

  const [activeId, setActiveId] = React.useState<string | null>(null);
  // The column whose sub-state drop zones are showing (the column the drag is
  // currently over, when it has sub-states). Null outside a drag.
  const [zoneColId, setZoneColId] = React.useState<string | null>(null);
  // Snapshot of containers at drag start, so a cancel (Escape) or a release onto
  // nothing reverts the optimistic cross-container moves made during onDragOver.
  const dragSnapshot = React.useRef<Record<string, string[]>>({});
  const activeIdRef = React.useRef<string | null>(null);
  activeIdRef.current = activeId;

  // Server truth changed (router.refresh() after an error, focus revalidation,
  // an agent filing tickets) → rebuild local state. Skipped mid-drag/mid-save;
  // the next refresh reconciles then.
  React.useEffect(() => {
    if (activeIdRef.current || busyRef.current > 0) return;
    setCols(buildCols(board));
    setTicketsById(buildTicketsById(board));
    setCont(buildContainers(board));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  // Keep an open board fresh: revalidate when the tab regains focus.
  React.useEffect(() => {
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [router]);
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
    if (
      filters.assignee === "me" &&
      !(t.assignee?.type === "user" && (t.assignee.id === currentUser?.id || t.assignees?.some((a) => a.id === currentUser?.id)))
    )
      return false;
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
    // Sub-state zones overlay the hovered column's cards during a drag, so when
    // the pointer sits inside one, the zone IS the target — never the cards or
    // section droppables underneath it.
    const zone = pointer.find((c) => zoneSection(String(c.id)) != null);
    if (zone) return [{ id: zone.id }];
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
    const id = String(e.active.id);
    setActiveId(id);
    // Show the origin column's sub-state zones right away.
    const origin = keyOf(containersRef.current, id);
    setZoneColId(origin ? parseSection(origin).colId : null);
  }

  function onDragCancel() {
    setActiveId(null);
    setZoneColId(null);
    setCont(dragSnapshot.current);
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const prev = containersRef.current;
    const zoneKey = zoneSection(overId);
    const activeContainer = keyOf(prev, activeId);
    const overContainer = zoneKey ?? (overId in prev ? overId : keyOf(prev, overId));
    // Keep the hovered column's sub-state zones up while the drag is over it.
    if (overContainer) {
      const colId = parseSection(overContainer).colId;
      setZoneColId((cur) => (cur === colId ? cur : colId));
    }
    if (!activeContainer || !overContainer || activeContainer === overContainer) return;

    const activeItems = prev[activeContainer];
    const overItems = prev[overContainer] ?? [];
    const nextOverItems =
      zoneKey != null || overId in prev
        ? [...overItems.filter((id) => id !== activeId), activeId]
        : insertInNewestFirstOrder(overItems, activeId, overId);
    setCont({
      ...prev,
      [activeContainer]: activeItems.filter((id) => id !== activeId),
      [overContainer]: nextOverItems,
    });
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    setZoneColId(null);
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
    const zoneKey = zoneSection(overId);
    const overContainer = zoneKey ?? (overId in prev ? overId : keyOf(prev, overId));

    let result = prev;
    if (overContainer && activeContainer === overContainer && zoneKey == null) {
      const items = prev[activeContainer];
      const nextItems = overId in prev ? [...items.filter((id) => id !== activeId), activeId] : moveInNewestFirstOrder(items, activeId, overId);
      if (nextItems !== items) {
        result = { ...prev, [activeContainer]: nextItems };
        setCont(result);
      }
    }
    // A release on a zone lands in that band. onDragOver normally moved the card
    // there already; reconcile here in case the final over-change never fired.
    if (zoneKey != null && activeContainer !== zoneKey) {
      result = {
        ...result,
        [activeContainer]: result[activeContainer].filter((id) => id !== activeId),
        [zoneKey]: [...(result[zoneKey] ?? []).filter((id) => id !== activeId), activeId],
      };
      setCont(result);
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
    if (ticketId.startsWith("tmp-")) return; // optimistic card not saved yet — nothing to move
    await tracked(async () => {
      try {
        const { ticket } = await api<{ ticket: SerializedTicket }>(`/api/tickets/${ticketId}/move`, {
          body: { columnId, position, ...(subState !== undefined ? { subState } : {}) },
        });
        setTicketsById((m) => ({ ...m, [ticketId]: ticket }));
      } catch {
        toast({ title: "Couldn't move card", description: "Restoring the board.", variant: "error" });
        router.refresh();
      }
    });
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
    await patchColumn(columnId, { subStates }, "update sub-states");
  }

  /** Move via the "Move to" menu (no drag): mirrors onDragEnd's optimistic update. */
  function moveTicketTo(ticketId: string, columnId: string, subState?: string) {
    if (ticketId.startsWith("tmp-")) return; // optimistic card not saved yet
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

  async function handleCreate(columnId: string, title: string, assignee?: NewAssignee | null) {
    // Optimistic: show the card instantly (rapid Enter-to-add-another entry),
    // swap in the real ticket when the server answers.
    const col = cols.find((c) => c.id === columnId);
    const sub = col?.subStates.length ? col.subStates[0] : null;
    const key = sectionKey(columnId, sub);
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const temp: SerializedTicket = {
      id: tempId,
      number: null,
      boardId: board.id,
      columnId,
      column: col?.name ?? "",
      title,
      description: "",
      position: 0,
      priority: "none",
      subState: sub,
      dueDate: null,
      completedAt: null,
      isDone: col?.isDone ?? false,
      assignee: assignee ? { ...assignee, avatarUrl: null } : null as SerializedTicket["assignee"],
      assignees: assignee ? [{ ...assignee, avatarUrl: null }] : [],
      createdBy: { type: "user", id: currentUser?.id ?? null },
      labels: [],
      subtasks: [],
      commentCount: 0,
      comments: [],
      sourceNoteId: null,
      createdAt: now,
      updatedAt: now,
    };
    setTicketsById((m) => ({ ...m, [tempId]: temp }));
    setCont({ ...containersRef.current, [key]: [...(containersRef.current[key] ?? []), tempId] });

    await tracked(async () => {
      try {
        const { ticket } = await api<{ ticket: SerializedTicket }>("/api/tickets", {
          body: {
            boardId: board.id,
            columnId,
            title,
            ...(assignee
              ? {
                  assigneeType: assignee.type,
                  ...(assignee.type === "user" ? { assigneeUserId: assignee.id } : { assigneeAgentId: assignee.id }),
                }
              : // Explicit "Unassigned": say so, or the server defaults the
                // ticket onto the creator's plate.
                { assigneeType: null }),
          },
        });
        setTicketsById((m) => {
          const mm = { ...m, [ticket.id]: { ...ticket, subState: sub } };
          delete mm[tempId];
          return mm;
        });
        setCont({
          ...containersRef.current,
          [key]: (containersRef.current[key] ?? []).map((id) => (id === tempId ? ticket.id : id)),
        });
      } catch {
        // Roll the temp card back; keep the title in the toast so nothing typed is lost.
        setCont({
          ...containersRef.current,
          [key]: (containersRef.current[key] ?? []).filter((id) => id !== tempId),
        });
        setTicketsById((m) => {
          const mm = { ...m };
          delete mm[tempId];
          return mm;
        });
        toast({ title: "Couldn't add card", description: `“${title}” wasn't saved.`, variant: "error" });
      }
    });
  }

  /** PATCH a column optimistically; on failure toast + restore from the server. */
  async function patchColumn(columnId: string, body: Record<string, unknown>, what: string) {
    await tracked(async () => {
      try {
        await api(`/api/columns/${columnId}`, { method: "PATCH", body });
      } catch {
        toast({ title: `Couldn't ${what}`, description: "Restoring the board.", variant: "error" });
        router.refresh();
      }
    });
  }

  async function renameColumn(columnId: string, name: string) {
    setCols((cs) => cs.map((c) => (c.id === columnId ? { ...c, name } : c)));
    await patchColumn(columnId, { name }, "rename the column");
  }

  async function setWip(columnId: string, wipLimit: number | null) {
    setCols((cs) => cs.map((c) => (c.id === columnId ? { ...c, wipLimit } : c)));
    await patchColumn(columnId, { wipLimit }, "set the WIP limit");
  }

  async function setStage(columnId: string, stage: ColumnStage) {
    // The stage drives isDone server-side (done ⇔ isDone) — mirror that locally.
    setCols((cs) => cs.map((c) => (c.id === columnId ? { ...c, stage, isDone: stage === "done" } : c)));
    await patchColumn(columnId, { stage }, "change the column type");
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
    await tracked(async () => {
      try {
        await api("/api/columns/reorder", { body: { boardId: board.id, orderedIds: next.map((c) => c.id) } });
      } catch {
        toast({ title: "Couldn't move the column", description: "Restoring the board.", variant: "error" });
        router.refresh();
      }
    });
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
  // Keyboard-nav walks only cards that are actually rendered (each section
  // collapses its oldest cards past the visible limit).
  gridRef.current = grid.map((g) => ({
    colId: g.col.id,
    ids: g.sections.flatMap((s) => visibleSectionIds(s.visibleIds, sectionVisibleLimit(g.col.subStates.length > 0))),
  }));

  const activeTicket = activeId ? ticketsById[activeId] : null;
  const selectedTicket = selectedId ? ticketsById[selectedId] : null;

  // Pickers only offer agents the current user may assign (own + workspace
  // agents) — other users' agents stay visible on cards, just not assignable.
  // The server enforces the same rule.
  const assignableAgents = agents.filter((a) => canAssignAgent(a, currentUser?.id));

  // Human-readable screen-reader announcements (the droppable ids embed a NUL
  // separator + sub-state, which would otherwise be read verbatim).
  const describeOver = (id: string) => {
    const key = zoneSection(id) ?? keyOf(containersRef.current, id) ?? id;
    const { colId, sub } = parseSection(key);
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
        switcher={switcher}
      />

      <DndContext
        id="kanbai-board"
        sensors={sensors}
        collisionDetection={collisionDetection}
        // Sub-state zones mount mid-drag (when the drag first hovers a column),
        // so droppable rects must be re-measured continuously, not just at start.
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
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
              zonesActive={activeId != null && zoneColId === col.id}
              allColumns={cols}
              members={members}
              agents={assignableAgents}
              currentUser={currentUser}
              onMoveTo={moveTicketTo}
              onCardClick={(id) => !id.startsWith("tmp-") && setSelectedId(id)}
              onCreate={(title, assignee) => handleCreate(col.id, title, assignee)}
              onRename={(name) => renameColumn(col.id, name)}
              onSetWip={(n) => setWip(col.id, n)}
              onSetStage={(s) => setStage(col.id, s)}
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
          agents={assignableAgents}
          members={members}
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
  switcher,
}: {
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  activeFilterCount: number;
  labels: { id: string; name: string; color: string }[];
  agents: AgentLite[];
  switcher?: React.ReactNode;
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
      {switcher}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
        <input
          dir="auto"
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
  zonesActive,
  allColumns,
  members,
  agents,
  currentUser,
  onMoveTo,
  onCardClick,
  onCreate,
  onRename,
  onSetWip,
  onSetStage,
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
  /** A drag is over this column → overlay its sub-state drop zones. */
  zonesActive: boolean;
  allColumns: ColumnMeta[];
  members: MemberLite[];
  agents: AgentLite[];
  currentUser?: { id: string; name: string } | null;
  onMoveTo: (ticketId: string, columnId: string, subState?: string) => void;
  onCardClick: (id: string) => void;
  onCreate: (title: string, assignee?: NewAssignee | null) => void;
  onRename: (name: string) => void;
  onSetWip: (n: number | null) => void;
  onSetStage: (stage: ColumnStage) => void;
  onSetSubStates: (subStates: string[]) => void;
  onMove: (dir: "left" | "right") => void;
  onDelete: () => void;
}) {
  const dot = STAGE_DOT[col.stage];
  const overLimit = col.wipLimit != null && totalCount > col.wipLimit;
  const atLimit = col.wipLimit != null && totalCount === col.wipLimit;
  const [renaming, setRenaming] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(col.name);
  const subStated = col.subStates.length > 0;

  const sectionProps = (s: SectionData) => ({
    id: s.key,
    ids: s.visibleIds,
    allCount: s.allIds.length,
    stage: col.stage,
    dragging,
    visibleLimit: sectionVisibleLimit(subStated),
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
        {col.stage === "done" ? (
          <CircleCheck className="h-3.5 w-3.5 shrink-0" style={{ color: dot }} aria-hidden />
        ) : (
          <span
            className={cn("h-2 w-2 shrink-0 rounded-full", col.stage === "intake" && "opacity-70")}
            style={{ backgroundColor: dot, boxShadow: col.stage === "active" ? `0 0 8px ${"var(--stage-active)"}` : undefined }}
          />
        )}
        {renaming ? (
          <input
            autoFocus
            dir="auto"
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
          <span
            dir="auto"
            className={cn("truncate text-sm font-semibold", col.stage === "intake" && "text-fg-muted")}
            title={STAGE_META[col.stage].hint}
          >
            {col.name}
          </span>
        )}
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[0.6875rem] font-medium tabular-nums",
            overLimit
              ? "bg-danger-soft text-danger"
              : atLimit
                ? "bg-warning-soft text-warning"
                : col.stage === "done"
                  ? "bg-success-soft/80 text-success"
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
              <div className="px-2.5 pb-1 pt-1 text-[0.625rem] font-semibold uppercase tracking-wider text-fg-subtle">
                Column type
              </div>
              {COLUMN_STAGES.map((s) => (
                <MenuItem
                  key={s}
                  active={col.stage === s}
                  onClick={() => {
                    close();
                    if (s !== col.stage) onSetStage(s);
                  }}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STAGE_DOT[s] }} />
                  <span className="flex-1">{STAGE_META[s].label}</span>
                  <span className="max-w-[9.5rem] truncate text-[0.625rem] text-fg-subtle">{STAGE_META[s].hint}</span>
                </MenuItem>
              ))}
              <div className="my-1 h-px bg-border" />
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
        <div className={cn("relative flex min-h-0 flex-1 flex-col", overLimit && "rounded-2xl ring-1 ring-danger/30")}>
          <div data-col-scroll className={cn("flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-1", overLimit && "p-0.5")}>
            {sections.map((s) => (
              <Section key={s.key} {...sectionProps(s)} label={s.sub ?? undefined} count={s.allIds.length} />
            ))}
            {sections.reduce((n, s) => n + s.visibleIds.length, 0) === 0 && totalCount > 0 && (
              <p className="px-1 py-1.5 text-xs text-fg-subtle">No cards match the filter.</p>
            )}
            <AddCard onCreate={onCreate} members={members} agents={agents} currentUser={currentUser} />
          </div>
          {zonesActive && <SubStateZones colName={col.name} sections={sections} />}
        </div>
      ) : (
        <Section
          {...sectionProps(sections[0])}
          fill
          overLimit={overLimit}
          footer={<AddCard onCreate={onCreate} members={members} agents={agents} currentUser={currentUser} />}
        />
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
  stage,
  dragging,
  overLimit,
  ids,
  allCount,
  visibleLimit,
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
  stage: ColumnStage;
  dragging: boolean;
  overLimit?: boolean;
  ids: string[];
  allCount: number;
  visibleLimit: number;
  ticketsById: Record<string, SerializedTicket>;
  celebrateId: string | null;
  focusedId: string | null;
  allColumns: ColumnMeta[];
  onMoveTo: (ticketId: string, columnId: string, subState?: string) => void;
  onCardClick: (id: string) => void;
  footer?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const dense = isDenseSection(ids.length, visibleLimit, COLLAPSE_SLACK);
  const [visibleCount, setVisibleCount] = React.useState(visibleLimit);
  const clampedVisibleCount = Math.min(visibleCount, Math.max(ids.length, visibleLimit));
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);

  const loadMore = React.useCallback(
    () => setVisibleCount((count) => nextVisibleCount(count, ids.length, visibleLimit)),
    [ids.length, visibleLimit],
  );

  // Newer cards append at the end of the section; present them first. Dense
  // sections reveal older cards in batches per section/sub-state, not all at once.
  const shown = visibleSectionIds(ids, dense ? clampedVisibleCount : ids.length);
  const hidden = dense ? Math.max(0, ids.length - shown.length) : 0;
  const empty = ids.length === 0;

  // Stream older cards in as the bottom sentinel scrolls into view. The IO root
  // is the column's own scroll container so the pre-load margin applies where
  // the clipping actually happens; paused mid-drag to keep the list stable.
  React.useEffect(() => {
    const el = sentinelRef.current;
    if (hidden <= 0 || dragging || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { root: el.closest("[data-col-scroll]"), rootMargin: "0px 0px 160px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hidden, dragging, loadMore]);

  return (
    <div
      ref={setNodeRef}
      data-col-scroll={fill ? "" : undefined}
      className={cn(
        "flex flex-col gap-2 rounded-2xl border transition-colors",
        // The column's stage sets its surface: intake dashed & faded, backlog
        // quiet, active brand-lit, done softly purple-filled (see globals.css).
        fill ? "group/col min-h-0 flex-1 overflow-y-auto p-2" : "p-2",
        // Drop target highlight replaces the stage surface while hovered so the
        // primary tint always wins, whatever the stage's own colors are.
        isOver
          ? "border-primary/50 bg-primary-soft/40 ring-1 ring-primary/30"
          : fill
            ? STAGE_FILL[stage]
            : STAGE_BAND[stage],
        fill && overLimit && "ring-1 ring-danger/30",
      )}
    >
      {label && (
        <div className="flex items-center gap-1.5 px-1 pt-0.5 text-[0.625rem] font-semibold uppercase tracking-wider text-fg-subtle">
          <span className="h-1 w-1 rounded-full bg-fg-subtle/60" />
          <span dir="auto" className="truncate">{label}</span>
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

      {/* Older cards live below the fold: scrolling near the bottom streams the
          next batch in automatically (the sentinel), and the button stays as a
          manual/keyboard fallback. Paused during drags so the list under a held
          card never shifts. */}
      {hidden > 0 && (
        <>
          <div ref={sentinelRef} aria-hidden className="h-px shrink-0" />
          <button
            onClick={loadMore}
            className="rounded-lg px-2 py-1.5 text-start text-xs font-medium text-fg-muted hover:bg-surface-3 hover:text-fg cursor-pointer"
          >
            Show {Math.min(hidden, visibleLimit)} older
            {hidden > visibleLimit ? ` (${hidden} left)` : ""}
          </button>
        </>
      )}
      {dense && hidden === 0 && (
        <button
          onClick={() => setVisibleCount(visibleLimit)}
          className="rounded-lg px-2 py-1.5 text-start text-xs font-medium text-fg-subtle hover:bg-surface-3 hover:text-fg cursor-pointer"
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
                ? "border-border/40 text-fg-subtle/60"
                : "border-border/40 text-transparent",
          )}
        >
          {dragging ? "Drop here" : fill ? "No cards yet" : null}
        </div>
      )}

      {footer}
    </div>
  );
}

/**
 * The drag-time overlay for a sub-stated column: one equal-height drop zone per
 * sub-state, covering the column's visible viewport. Dropping anywhere in a zone
 * moves the card into that column + sub-state — no scrolling past a long first
 * band to reach the second.
 */
function SubStateZones({ colName, sections }: { colName: string; sections: SectionData[] }) {
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col gap-1.5 rounded-2xl bg-surface/55 p-1 backdrop-blur-[2px] animate-scale-in"
      role="group"
      aria-label={`Drop zones for ${colName}`}
    >
      {sections.map((s) => (
        <ZoneTarget key={s.key} id={zoneId(s.key)} label={s.sub ?? colName} count={s.allIds.length} />
      ))}
    </div>
  );
}

function ZoneTarget({ id, label, count }: { id: string; label: string; count: number }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      aria-label={`Drop to move to ${label}`}
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-dashed px-2 transition-colors",
        isOver
          ? "border-primary bg-primary-soft/80 text-primary"
          : "border-border-strong/50 bg-surface/80 text-fg-muted",
      )}
    >
      <span dir="auto" className="max-w-full truncate text-sm font-semibold">
        {label}
      </span>
      <span className={cn("text-[0.6875rem] tabular-nums", isOver ? "text-primary/80" : "text-fg-subtle")}>
        {isOver ? "Release to drop here" : `${count} ${count === 1 ? "card" : "cards"}`}
      </span>
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
      className={cn("group/card relative", ticket.id.startsWith("tmp-") && "animate-scale-in opacity-70")}
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
        <span className="pointer-events-none absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-success text-success-fg shadow-md animate-check-pop">
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
            <span dir="auto">{c.name}</span>
          </MenuItem>
        ) : (
          <div key={c.id}>
            <div dir="auto" className="px-2.5 pb-0.5 pt-1.5 text-[0.625rem] font-semibold uppercase tracking-wider text-fg-subtle">
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
                <span dir="auto" className="pl-1.5">{s}</span>
              </MenuItem>
            ))}
          </div>
        ),
      )}
    </div>
  );
}

function AddCard({
  onCreate,
  members,
  agents,
  currentUser,
}: {
  onCreate: (title: string, assignee?: NewAssignee | null) => void;
  members: MemberLite[];
  agents: AgentLite[];
  currentUser?: { id: string; name: string } | null;
}) {
  const [adding, setAdding] = React.useState(false);
  const [value, setValue] = React.useState("");
  // New cards land on the creator's own plate unless they pick someone else
  // (or explicitly "Unassigned"). Chosen assignee sticks across rapid
  // Enter-to-add-another entries.
  const selfAssignee: NewAssignee | null = currentUser
    ? { type: "user", id: currentUser.id, name: currentUser.name }
    : null;
  const [assignee, setAssignee] = React.useState<NewAssignee | null>(selfAssignee);
  const ref = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (adding) ref.current?.focus();
  }, [adding]);

  // Same rule as the ticket modal: board members are assignable, and the
  // current user always appears (solo workspaces pass no members list).
  const assignableUsers: MemberLite[] = React.useMemo(() => {
    const list = [...members];
    if (currentUser && !list.some((m) => m.id === currentUser.id)) list.unshift(currentUser);
    return list;
  }, [members, currentUser]);

  function submit(keepOpen: boolean) {
    const v = value.trim();
    if (v) onCreate(v, assignee);
    setValue("");
    if (!keepOpen) {
      setAdding(false);
      setAssignee(selfAssignee);
    } else ref.current?.focus();
  }

  function close() {
    setValue("");
    setAssignee(selfAssignee);
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
    <div
      className="rounded-xl border border-border bg-surface p-2 shadow-card"
      // Save/close only when focus leaves the whole composer, so opening the
      // assignee picker (rendered inside this container) doesn't submit.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) submit(false);
      }}
    >
      <textarea
        ref={ref}
        dir="auto"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit(true); // save and keep adding for rapid capture
          }
          if (e.key === "Escape") close();
        }}
        rows={2}
        placeholder="What needs doing?  (Enter to add another)"
        className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-fg-subtle"
      />
      {/* preventDefault on mousedown keeps the textarea focused while picking. */}
      <div className="mt-1 flex items-center" onMouseDown={(e) => e.preventDefault()}>
        <Menu
          trigger={
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs font-medium text-fg-muted hover:bg-surface-2 cursor-pointer"
              aria-label="Assign the new card"
            >
              {assignee ? (
                <>
                  <Avatar
                    name={assignee.name}
                    color={assignee.type === "agent" ? assignee.color : undefined}
                    isAgent={assignee.type === "agent"}
                    size={14}
                  />
                  <span className="max-w-[8rem] truncate">{assignee.name}</span>
                </>
              ) : (
                <>
                  <User className="h-3.5 w-3.5" />
                  Assign
                </>
              )}
            </button>
          }
          contentClassName="max-h-64 overflow-y-auto"
        >
          {(closeMenu) => (
            <>
              <MenuItem
                active={!assignee}
                onClick={() => {
                  closeMenu();
                  setAssignee(null);
                }}
              >
                Unassigned
              </MenuItem>
              {assignableUsers.map((m) => (
                <MenuItem
                  key={m.id}
                  active={assignee?.type === "user" && assignee.id === m.id}
                  onClick={() => {
                    closeMenu();
                    setAssignee({ type: "user", id: m.id, name: m.name });
                  }}
                >
                  <Avatar name={m.name} src={m.avatarUrl} color={m.avatarColor ?? undefined} size={16} />
                  {m.name}
                  {m.id === currentUser?.id && <span className="text-[0.625rem] text-fg-subtle">you</span>}
                </MenuItem>
              ))}
              {agents.map((a) => (
                <MenuItem
                  key={a.id}
                  active={assignee?.type === "agent" && assignee.id === a.id}
                  onClick={() => {
                    closeMenu();
                    setAssignee({ type: "agent", id: a.id, name: a.name, color: a.color, kind: a.kind });
                  }}
                >
                  <Avatar name={a.name} color={a.color} isAgent size={16} />
                  {a.name}
                </MenuItem>
              ))}
            </>
          )}
        </Menu>
      </div>
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
        dir="auto"
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
