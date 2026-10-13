-- Webhooks are gone: agents talk to Kanbai over the REST API only.
-- Drops the WebhookDelivery log and the Agent.webhook* columns. SQLite cannot
-- drop columns in place, so Agent is rebuilt (Prisma table-rebuild pattern):
-- every remaining column is copied across, keys/FKs/indexes recreated.
-- DropIndex
DROP INDEX "WebhookDelivery_agentId_createdAt_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "WebhookDelivery";
PRAGMA foreign_keys=on;

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
    "scopes" TEXT NOT NULL DEFAULT 'boards:read,boards:write,tickets:read,tickets:write,inbox:read,inbox:write,notes:read,notes:write',
    "lastSeenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Agent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Agent_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Agent" ("apiKeyHash", "apiKeyLast4", "apiKeyPrefix", "color", "createdAt", "id", "kind", "lastSeenAt", "name", "ownerUserId", "scopes", "status", "workspaceId") SELECT "apiKeyHash", "apiKeyLast4", "apiKeyPrefix", "color", "createdAt", "id", "kind", "lastSeenAt", "name", "ownerUserId", "scopes", "status", "workspaceId" FROM "Agent";
DROP TABLE "Agent";
ALTER TABLE "new_Agent" RENAME TO "Agent";
CREATE UNIQUE INDEX "Agent_apiKeyHash_key" ON "Agent"("apiKeyHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

