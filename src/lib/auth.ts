import { cache } from "react";
import { db } from "./db";

/**
 * Auth-lite for the MVP: a single seeded workspace + owner.
 * The data model is multi-tenant (Workspace/WorkspaceMember) so real auth
 * (sessions, OAuth) can drop in without reshaping the schema.
 */
export const getCurrentContext = cache(async () => {
  let workspace = await db.workspace.findFirst({
    orderBy: { createdAt: "asc" },
    include: { members: { include: { user: true } } },
  });

  if (!workspace) {
    // First run safety net (seed normally handles this).
    const user = await db.user.upsert({
      where: { email: "you@kanbai.app" },
      update: {},
      create: { email: "you@kanbai.app", name: "You" },
    });
    const ws = await db.workspace.create({
      data: {
        name: "My Workspace",
        slug: "my-workspace",
        members: { create: { userId: user.id, role: "owner" } },
      },
      include: { members: { include: { user: true } } },
    });
    workspace = ws;
  }

  const owner = workspace.members[0]?.user;
  return { workspace, user: owner };
});

export async function getWorkspaceId() {
  const { workspace } = await getCurrentContext();
  return workspace.id;
}

export async function getCurrentUser() {
  const { user } = await getCurrentContext();
  return user;
}
