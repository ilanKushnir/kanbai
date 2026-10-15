-- One-time agent connect codes: the brief carries a short-lived code, the
-- agent redeems it for its API key over HTTPS (POST /api/v1/connect).
ALTER TABLE "Agent" ADD COLUMN "connectCodeHash" TEXT;
ALTER TABLE "Agent" ADD COLUMN "connectCodeExpiresAt" DATETIME;
ALTER TABLE "Agent" ADD COLUMN "connectRedeemedAt" DATETIME;
CREATE UNIQUE INDEX "Agent_connectCodeHash_key" ON "Agent"("connectCodeHash");
