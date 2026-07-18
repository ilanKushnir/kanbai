// Client-safe shared types (no server imports).

export type AttachmentT = {
  id: string;
  kind: string;
  mimeType: string;
  filename: string | null;
  dataUrl: string;
  durationMs: number | null;
};

export type AgentLite = { id: string; name: string; color: string; kind: string };

export type BoardLite = {
  id: string;
  name: string;
  slug: string;
  color: string;
  columns: { id: string; name: string; isDone: boolean }[];
  labels: { id: string; name: string; color: string }[];
};

export type DeliveryT = {
  id: string;
  event: string;
  status: string; // pending | success | failed
  statusCode: number | null;
  signature: string;
  error: string | null;
  attempts: number;
  createdAt: string;
};

export type AgentFull = {
  id: string;
  name: string;
  kind: string;
  color: string;
  status: string; // active | disabled
  /** Owning user — caps the agent's board access to that user's boards. Null = workspace-wide. */
  ownerUserId: string | null;
  apiKeyPrefix: string | null;
  apiKeyLast4: string | null;
  hasKey: boolean;
  webhookUrl: string | null;
  webhookSecret: string | null;
  webhookActive: boolean;
  scopes: string[];
  lastSeenAt: string | null;
  createdAt: string;
  deliveries: DeliveryT[];
};

/**
 * A read-through reflection of a real board ticket that carries a due date.
 * Surfaced inside the Notes time-sections (Today / This week / …) so a due ticket
 * shows up next to the notes for that day. It is NOT a note — it never converts
 * into one; the board ticket stays the source of truth.
 */
export type TicketReflectionT = {
  id: string;
  boardId: string;
  boardName: string;
  boardColor: string;
  boardSlug: string;
  number: number | null;
  title: string;
  priority: string;
  dueDate: string; // ISO instant
  done: boolean; // ticket sits in an "is done" column
};

export type RecentActionT = {
  id: string;
  actorName: string;
  actorType: string;
  action: string;
  noteBody: string;
  resourceHref: string | null;
  resourceLabel: string | null;
  createdAt: string;
};

export type NoteT = {
  id: string;
  body: string;
  status: string; // inbox | queued | sorted | archived
  pinned: boolean;
  bucket: string; // coarse, derived: today | tomorrow | next_week | next_month | general
  scheduledDay: string | null; // local "YYYY-MM-DD"; null = General
  doneOn: string | null; // local "YYYY-MM-DD" completed; null = not done
  position: number;
  priority: string; // none | low | medium | high | urgent
  suggestedDueDate: string | null;
  sortContext: string | null;
  assignedAgent: AgentLite | null;
  attachments: AttachmentT[];
  ticket: { id: string; title: string; boardId: string } | null;
  queuedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Client-only: note captured offline, awaiting sync. */
  pending?: boolean;
};
