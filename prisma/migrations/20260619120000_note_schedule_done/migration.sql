-- Notes gain a scheduled calendar day + a "done on" day (both local "YYYY-MM-DD").
ALTER TABLE "Note" ADD COLUMN "scheduledDay" TEXT;
ALTER TABLE "Note" ADD COLUMN "doneOn" TEXT;

-- Best-effort backfill of scheduledDay from the legacy coarse bucket, relative to
-- the migration date. "general" stays NULL (unscheduled/someday).
UPDATE "Note" SET "scheduledDay" = date('now','localtime')                              WHERE "bucket" = 'today';
UPDATE "Note" SET "scheduledDay" = date('now','localtime','+1 day')                     WHERE "bucket" = 'tomorrow';
UPDATE "Note" SET "scheduledDay" = date('now','localtime','+7 day')                     WHERE "bucket" = 'next_week';
UPDATE "Note" SET "scheduledDay" = date('now','localtime','start of month','+1 month')  WHERE "bucket" = 'next_month';
