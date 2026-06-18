import type { Metadata } from "next";
import { getContext } from "@/lib/auth";
import { parseUserSettings } from "@/lib/user-settings";
import { db } from "@/lib/db";
import { SettingsView } from "@/components/settings/settings-view";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await getContext();
  const settings = parseUserSettings(ctx.user.settings);

  const [agents, ws] = ctx.isManager
    ? await Promise.all([
        db.agent.findMany({
          where: { workspaceId: ctx.workspace.id, status: "active" },
          select: { id: true, name: true },
          orderBy: { createdAt: "asc" },
        }),
        db.workspace.findUnique({
          where: { id: ctx.workspace.id },
          select: { name: true, defaultAgentId: true, snapshotLimit: true },
        }),
      ])
    : [[], null];

  return (
    <SettingsView
      isManager={ctx.isManager}
      isOwner={ctx.role === "owner"}
      defaultLanding={settings.defaultLanding}
      workspaceId={ctx.workspace.id}
      workspace={ws ? { name: ws.name, defaultAgentId: ws.defaultAgentId, snapshotLimit: ws.snapshotLimit } : null}
      agents={agents}
    />
  );
}
