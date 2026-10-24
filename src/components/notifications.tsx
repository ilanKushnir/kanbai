"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Menu } from "@/components/ui/menu";
import { api } from "@/lib/client-api";
import type { SerializedNotification } from "@/lib/services/notifications";
import { cn } from "@/lib/utils";

/** Fired by What's new when it closes, so the assigned pop-up waits its turn. */
export const WHATS_NEW_CLOSED = "kanbai:whats-new-closed";

/** How often an open, visible app looks for new assignments. */
const POLL_MS = 60_000;

type Ctx = {
  items: SerializedNotification[];
  unread: number;
  activeWorkspaceId: string;
  open: (n: SerializedNotification) => void;
  markAllRead: () => void;
};

const NotificationsContext = React.createContext<Ctx | null>(null);

function useNotifications() {
  const ctx = React.useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications outside NotificationsProvider");
  return ctx;
}

function markRead(ids?: string[]) {
  // keepalive: the write survives the navigation that usually follows.
  void fetch("/api/notifications/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ids ? { ids } : {}),
    keepalive: true,
  }).catch(() => {});
}

/**
 * "You were assigned": when someone else puts you on a ticket, the app tells
 * you the next time you open it — a pop-up for what's new since you last
 * looked, and a bell that keeps the recent ones. Refreshes whenever the app
 * comes back to the foreground, and every minute while it's on screen.
 */
export function NotificationsProvider({
  initial,
  activeWorkspaceId,
  holdForWhatsNew,
  children,
}: {
  initial: SerializedNotification[];
  activeWorkspaceId: string;
  /** What's new is about to show: hold the pop-up until it closes. */
  holdForWhatsNew: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [items, setItems] = React.useState(initial);
  const [held, setHeld] = React.useState(holdForWhatsNew);
  // Ids already put in front of the viewer this session — each pops up once.
  const shown = React.useRef(new Set<string>());
  const [popup, setPopup] = React.useState<SerializedNotification[]>([]);

  React.useEffect(() => {
    if (!held) return;
    const release = () => setHeld(false);
    window.addEventListener(WHATS_NEW_CLOSED, release);
    return () => window.removeEventListener(WHATS_NEW_CLOSED, release);
  }, [held]);

  // Anything unread that hasn't popped up yet joins the pop-up.
  React.useEffect(() => {
    if (held) return;
    const fresh = items.filter((n) => !n.read && !shown.current.has(n.id));
    if (!fresh.length) return;
    for (const n of fresh) shown.current.add(n.id);
    setPopup((p) => [...fresh, ...p.filter((x) => !fresh.some((f) => f.id === x.id))]);
  }, [items, held]);

  React.useEffect(() => {
    let last = Date.now();
    const refresh = async () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      last = Date.now();
      try {
        const { notifications } = await api<{ notifications: SerializedNotification[] }>("/api/notifications");
        setItems(notifications);
      } catch {
        // Offline or signed out: keep what we have.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last > 5_000) void refresh();
    };
    const timer = setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const setRead = React.useCallback((ids: string[] | null) => {
    setItems((list) => list.map((n) => (ids === null || ids.includes(n.id) ? { ...n, read: true } : n)));
  }, []);

  const open = React.useCallback(
    async (n: SerializedNotification) => {
      // Opening one entry from the pop-up counts as having seen the rest of it too.
      const ids = [...new Set([n.id, ...popup.map((p) => p.id)])];
      setRead(ids);
      setPopup([]);
      markRead(ids);
      const href = `/boards/${n.boardSlug}?ticket=${n.ticketId}`;
      if (n.workspaceId === activeWorkspaceId) {
        router.push(href);
        return;
      }
      // Someone else's workspace: switch first, then load it fresh.
      try {
        await api("/api/workspaces/switch", { body: { workspaceId: n.workspaceId } });
        window.location.assign(href);
      } catch {
        router.push("/boards");
      }
    },
    [activeWorkspaceId, router, setRead, popup],
  );

  const markAllRead = React.useCallback(() => {
    setRead(null);
    markRead();
  }, [setRead]);

  function dismissPopup() {
    const ids = popup.map((p) => p.id);
    setPopup([]);
    if (!ids.length) return;
    setRead(ids);
    markRead(ids);
  }

  const unread = items.filter((n) => !n.read).length;
  const value = React.useMemo(() => ({ items, unread, activeWorkspaceId, open, markAllRead }), [items, unread, activeWorkspaceId, open, markAllRead]);

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <AssignedPopup items={popup} activeWorkspaceId={activeWorkspaceId} onOpen={open} onClose={dismissPopup} />
    </NotificationsContext.Provider>
  );
}

function AssignedPopup({
  items,
  activeWorkspaceId,
  onOpen,
  onClose,
}: {
  items: SerializedNotification[];
  activeWorkspaceId: string;
  onOpen: (n: SerializedNotification) => void;
  onClose: () => void;
}) {
  // Keep the last list on screen while the modal animates out.
  const [last, setLast] = React.useState(items);
  if (items.length && items !== last) setLast(items);
  const list = items.length ? items : last;
  const people = [...new Set(list.map((n) => n.actorName))];
  const title = list.length === 1 ? "A new ticket for you" : `${list.length} new tickets for you`;
  const from = people.length === 1 ? `From ${people[0]}` : `From ${people.slice(0, -1).join(", ")} and ${people.at(-1)}`;

  return (
    <Modal open={items.length > 0} onClose={onClose} size="sm" title={<span className="font-display">{title}</span>} description={from}>
      <ul className="space-y-1.5">
        {list.map((n) => (
          <li key={n.id}>
            <NotificationRow n={n} elsewhere={n.workspaceId !== activeWorkspaceId} onOpen={onOpen} />
          </li>
        ))}
      </ul>
      <div className="sticky -bottom-5 -mx-5 -mb-5 mt-4 border-t border-border bg-surface px-5 pt-3 pb-5">
        <Button variant="primary" className="w-full" onClick={onClose}>
          Got it
        </Button>
      </div>
    </Modal>
  );
}

function NotificationRow({
  n,
  elsewhere,
  onOpen,
  compact = false,
}: {
  n: SerializedNotification;
  /** On a board in another workspace: name the workspace too. */
  elsewhere: boolean;
  onOpen: (n: SerializedNotification) => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(n)}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl text-left transition-colors cursor-pointer",
        compact ? "px-2.5 py-2 hover:bg-surface-2" : "bg-surface-2/60 px-3 py-2.5 hover:bg-surface-2",
      )}
    >
      <Avatar name={n.actorName} isAgent={n.actorType === "agent"} size={compact ? 24 : 28} className="mt-0.5 text-[0.625rem]" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-fg-muted">
          <span className="font-medium text-fg">{n.actorName}</span> assigned you · {ago(n.createdAt)}
        </span>
        <span className={cn("mt-0.5 block truncate text-sm", n.read ? "text-fg-muted" : "font-medium text-fg")} dir="auto">
          {n.ticketNumber != null && <span className="text-fg-subtle">#{n.ticketNumber} </span>}
          {n.ticketTitle}
        </span>
        <span className="mt-0.5 block truncate text-[0.6875rem] text-fg-subtle" dir="auto">
          {n.boardName}
          {elsewhere && ` · ${n.workspaceName}`}
        </span>
      </span>
      {!n.read && <span aria-label="New" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" />}
    </button>
  );
}

/** The bell: unread count on it, the recent entries behind it. */
export function NotificationBell({ className }: { className?: string }) {
  const { items, unread, activeWorkspaceId, open, markAllRead } = useNotifications();
  return (
    // "start" is the alignment the menu keeps inside the viewport: right of the
    // bell in the sidebar, pulled back on screen under the phone's top bar.
    <Menu
      className={className}
      contentClassName="w-[min(22rem,calc(100vw-1rem))] p-1.5"
      trigger={
        <button
          type="button"
          aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
          className="relative grid h-8 w-8 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg cursor-pointer"
        >
          <Bell className="h-4.5 w-4.5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[0.5625rem] font-semibold leading-4 text-accent-fg">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      }
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-subtle">Assigned to you</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg cursor-pointer"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-2.5 pb-3 pt-1 text-sm text-fg-subtle">When someone puts you on a ticket, it shows up here.</p>
          ) : (
            <ul className="max-h-[min(24rem,60vh)] overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <NotificationRow
                    n={n}
                    elsewhere={n.workspaceId !== activeWorkspaceId}
                    compact
                    onOpen={(x) => {
                      close();
                      open(x);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Menu>
  );
}

function ago(iso: string): string {
  const d = new Date(iso);
  if (Date.now() - d.getTime() < 60_000) return "just now";
  return formatDistanceToNowStrict(d, { addSuffix: true });
}
