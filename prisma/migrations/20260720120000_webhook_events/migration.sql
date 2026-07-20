-- Per-agent webhook event subscriptions: "*" = all events, else a comma list.
ALTER TABLE "Agent" ADD COLUMN "webhookEvents" TEXT NOT NULL DEFAULT '*';
