-- Completion timestamp: set when a ticket enters a done column, cleared when it
-- leaves. Done tickets show "Done <date>" instead of a stale overdue chip.
ALTER TABLE "Ticket" ADD COLUMN "completedAt" DATETIME;

-- Multi-assign (humans): all user assignees in display order. The legacy
-- assigneeType/assigneeUserId pair mirrors the first row (primary assignee).
CREATE TABLE "TicketAssignee" (
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("ticketId", "userId"),
    CONSTRAINT "TicketAssignee_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TicketAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TicketAssignee_userId_idx" ON "TicketAssignee"("userId");

-- Backfill: every existing single human assignee becomes the sole (primary) row.
INSERT INTO "TicketAssignee" ("ticketId", "userId", "position")
SELECT "id", "assigneeUserId", 0 FROM "Ticket"
WHERE "assigneeType" = 'user' AND "assigneeUserId" IS NOT NULL;
