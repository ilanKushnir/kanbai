import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/auth";
import { listSnapshots } from "@/lib/snapshots";
import { SnapshotsView } from "@/components/settings/snapshots-view";

export const metadata: Metadata = { title: "Snapshots" };
export const dynamic = "force-dynamic";

export default async function SnapshotsPage() {
  const ctx = await getContext();
  if (!ctx.isManager) redirect("/settings");
  const snapshots = await listSnapshots(ctx.workspace.id);
  return <SnapshotsView snapshots={snapshots} />;
}
