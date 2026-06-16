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

export type NoteT = {
  id: string;
  body: string;
  status: string; // inbox | queued | sorted | archived
  pinned: boolean;
  sortContext: string | null;
  assignedAgent: AgentLite | null;
  attachments: AttachmentT[];
  ticket: { id: string; title: string; boardId: string } | null;
  queuedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
