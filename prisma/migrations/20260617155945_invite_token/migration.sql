/*
  Warnings:

  - You are about to drop the column `tokenHash` on the `Invite` table. All the data in the column will be lost.
  - Added the required column `token` to the `Invite` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Invite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "email" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'workspace',
    "role" TEXT NOT NULL DEFAULT 'member',
    "workspaceId" TEXT,
    "boardAccess" TEXT,
    "invitedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "acceptedById" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invite_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Invite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Invite" ("acceptedById", "boardAccess", "createdAt", "email", "expiresAt", "id", "invitedById", "kind", "role", "status", "workspaceId") SELECT "acceptedById", "boardAccess", "createdAt", "email", "expiresAt", "id", "invitedById", "kind", "role", "status", "workspaceId" FROM "Invite";
DROP TABLE "Invite";
ALTER TABLE "new_Invite" RENAME TO "Invite";
CREATE UNIQUE INDEX "Invite_token_key" ON "Invite"("token");
CREATE INDEX "Invite_workspaceId_idx" ON "Invite"("workspaceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
