import { handler, ok, HttpError } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { parse, readJson } from "@/lib/parse";
import { updateMemberV1Schema } from "@/lib/validation";
import { logActivity } from "@/lib/activity";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ userId: string }> };

async function loadMember(workspaceId: string, userId: string) {
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!member) throw new HttpError(404, "Member not found");
  return member;
}

/** Update a member's workspace role and/or per-board access grants. */
export const PATCH = handler(async (req: Request, { params }: Ctx) => {
  const agent = await requireAgent(req);
  requireScope(agent, "members:write");
  const { userId } = await params;
  const member = await loadMember(agent.workspaceId, userId);
  if (member.role === "owner") throw new HttpError(403, "The workspace owner can't be changed.");

  const input = parse(updateMemberV1Schema, await readJson(req));

  if (input.role) {
    await db.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: agent.workspaceId, userId } },
      data: { role: input.role },
    });
  }

  if (input.boardAccess) {
    const boards = await db.board.findMany({ where: { workspaceId: agent.workspaceId }, select: { id: true } });
    const valid = new Set(boards.map((b) => b.id));
    const grants = input.boardAccess.filter((a) => valid.has(a.boardId));
    // Reset atomically so a mid-way failure can't strip the member's access.
    await db.$transaction([
      db.boardAccess.deleteMany({ where: { userId, board: { workspaceId: agent.workspaceId } } }),
      ...grants.map((a) => db.boardAccess.create({ data: { userId, boardId: a.boardId, level: a.level } })),
    ]);
  }
  await logActivity({
    actor: { type: "agent", id: agent.id, name: agent.name },
    action: "member.updated",
    meta: { userId, fields: Object.keys(input) },
  });
  return ok({ ok: true });
});

/**
 * Remove a member from THIS workspace. This is a membership change, not a
 * deletion: the user account, their notes, and every ticket survive intact,
 * and re-adding them (POST /members) restores access. The workspace owner can
 * never be removed.
 */
export const DELETE = handler(async (req: Request, { params }: Ctx) => {
  const agent = await requireAgent(req);
  requireScope(agent, "members:write");
  const { userId } = await params;
  const member = await loadMember(agent.workspaceId, userId);
  if (member.role === "owner") throw new HttpError(403, "The workspace owner can't be removed.");

  await db.boardAccess.deleteMany({ where: { userId, board: { workspaceId: agent.workspaceId } } });
  await db.workspaceMember.delete({
    where: { workspaceId_userId: { workspaceId: agent.workspaceId, userId } },
  });
  await logActivity({
    actor: { type: "agent", id: agent.id, name: agent.name },
    action: "member.removed",
    meta: { userId },
  });
  return ok({ ok: true, removed: { userId }, note: "Membership only — the account and its data are untouched." });
});
