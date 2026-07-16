-- Add semantic column stages introduced in v0.7.2.
-- Existing columns keep NULL and are derived from name/isDone in application code.
ALTER TABLE "Column" ADD COLUMN "stage" TEXT;
