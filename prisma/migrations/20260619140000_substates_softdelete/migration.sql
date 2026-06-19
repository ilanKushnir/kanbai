-- Column sub-states (Jira-like) + soft-delete (recently deleted) for notes & tickets.
ALTER TABLE "Column" ADD COLUMN "subStates" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "subState" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "deletedAt" DATETIME;
ALTER TABLE "Note" ADD COLUMN "deletedAt" DATETIME;

CREATE INDEX "Ticket_deletedAt_idx" ON "Ticket"("deletedAt");
CREATE INDEX "Note_deletedAt_idx" ON "Note"("deletedAt");
