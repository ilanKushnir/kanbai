-- Simple tasks (notes) get a checklist of subtasks, stored inline as JSON
-- [{ id, title, completed }] so it syncs offline with the task itself.
ALTER TABLE "Note" ADD COLUMN "subtasks" TEXT NOT NULL DEFAULT '[]';
