import type { Metadata } from "next";
import { getContext } from "@/lib/auth";
import { listTrash, TRASH_DAYS } from "@/lib/services/trash";
import { TrashView } from "@/components/settings/trash-view";

export const metadata: Metadata = { title: "Recently deleted" };
export const dynamic = "force-dynamic";

export default async function TrashPage() {
  const ctx = await getContext();
  const { notes, tickets } = await listTrash(ctx);
  return <TrashView isManager={ctx.isManager} notes={notes} tickets={tickets} retentionDays={TRASH_DAYS} />;
}
