-- The old "send a note to an agent to sort" flow is gone (agents now act on
-- direct requests through the REST API). Anything still queued goes back to
-- being a plain task, the inbox:* agent scopes are dropped, and the queue
-- columns and the workspace's "default agent for ingestion" are removed.
UPDATE "Note" SET "status" = 'inbox' WHERE "status" IN ('queued', 'sorting');
UPDATE "Agent" SET "scopes" = trim(replace(replace(replace(',' || "scopes" || ',', ',inbox:read,', ','), ',inbox:write,', ','), ',,', ','), ',');

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'custom',
    "color" TEXT NOT NULL DEFAULT 'iris',
    "status" TEXT NOT NULL DEFAULT 'active',
    "ownerUserId" TEXT,
    "apiKeyHash" TEXT,
    "apiKeyPrefix" TEXT,
    "apiKeyLast4" TEXT,
    "connectCodeHash" TEXT,
    "connectCodeExpiresAt" DATETIME,
    "connectRedeemedAt" DATETIME,
    "scopes" TEXT NOT NULL DEFAULT 'boards:read,boards:write,tickets:read,tickets:write,notes:read,notes:write',
    "lastSeenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Agent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Agent_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Agent" ("apiKeyHash", "apiKeyLast4", "apiKeyPrefix", "color", "connectCodeExpiresAt", "connectCodeHash", "connectRedeemedAt", "createdAt", "id", "kind", "lastSeenAt", "name", "ownerUserId", "scopes", "status", "workspaceId") SELECT "apiKeyHash", "apiKeyLast4", "apiKeyPrefix", "color", "connectCodeExpiresAt", "connectCodeHash", "connectRedeemedAt", "createdAt", "id", "kind", "lastSeenAt", "name", "ownerUserId", "scopes", "status", "workspaceId" FROM "Agent";
DROP TABLE "Agent";
ALTER TABLE "new_Agent" RENAME TO "Agent";
CREATE UNIQUE INDEX "Agent_apiKeyHash_key" ON "Agent"("apiKeyHash");
CREATE UNIQUE INDEX "Agent_connectCodeHash_key" ON "Agent"("connectCodeHash");
CREATE TABLE "new_Note" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'inbox',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "bucket" TEXT NOT NULL DEFAULT 'today',
    "scheduledDay" TEXT,
    "doneOn" TEXT,
    "deletedAt" DATETIME,
    "position" INTEGER NOT NULL DEFAULT 0,
    "priority" TEXT NOT NULL DEFAULT 'none',
    "subtasks" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Note" ("body", "bucket", "createdAt", "deletedAt", "doneOn", "id", "pinned", "position", "priority", "scheduledDay", "status", "subtasks", "updatedAt", "userId") SELECT "body", "bucket", "createdAt", "deletedAt", "doneOn", "id", "pinned", "position", "priority", "scheduledDay", "status", "subtasks", "updatedAt", "userId" FROM "Note";
DROP TABLE "Note";
ALTER TABLE "new_Note" RENAME TO "Note";
CREATE INDEX "Note_userId_status_idx" ON "Note"("userId", "status");
CREATE INDEX "Note_deletedAt_idx" ON "Note"("deletedAt");
CREATE TABLE "new_Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshotLimit" INTEGER NOT NULL DEFAULT 20,
    "agentSessionActive" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Workspace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Workspace" ("agentSessionActive", "createdAt", "id", "name", "ownerId", "slug", "snapshotLimit") SELECT "agentSessionActive", "createdAt", "id", "name", "ownerId", "slug", "snapshotLimit" FROM "Workspace";
DROP TABLE "Workspace";
ALTER TABLE "new_Workspace" RENAME TO "Workspace";
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

