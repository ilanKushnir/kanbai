import { Suspense } from "react";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getCurrentContext } from "@/lib/auth";
import { listNotesForUser } from "@/lib/services/notes";
import { NotesView } from "@/components/notes/notes-view";

export const metadata: Metadata = { title: "Notes" };
export const dynamic = "force-dynamic";

export default async function NotesPage() {
  const { workspace, user } = await getCurrentContext();

  const [notes, agents] = await Promise.all([
    listNotesForUser(user!.id),
    db.agent.findMany({
      where: { workspaceId: workspace.id, status: "active" },
      select: { id: true, name: true, color: true, kind: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <Suspense fallback={null}>
      <NotesView notes={notes} agents={agents} />
    </Suspense>
  );
}
