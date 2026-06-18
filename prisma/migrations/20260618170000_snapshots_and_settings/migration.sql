-- AlterTable: User personal settings
ALTER TABLE "User" ADD COLUMN "settings" TEXT;

-- AlterTable: Workspace settings + snapshot session state
ALTER TABLE "Workspace" ADD COLUMN "defaultAgentId" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "snapshotLimit" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "Workspace" ADD COLUMN "agentSessionActive" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: Snapshot
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'auto',
    "reason" TEXT NOT NULL DEFAULT '',
    "agentId" TEXT,
    "agentName" TEXT,
    "payload" TEXT NOT NULL,
    "boardCount" INTEGER NOT NULL DEFAULT 0,
    "ticketCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Snapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Snapshot_workspaceId_createdAt_idx" ON "Snapshot"("workspaceId", "createdAt");
