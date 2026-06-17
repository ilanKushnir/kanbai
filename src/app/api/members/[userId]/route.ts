import { handler, ok, HttpError } from "@/lib/api";
import { getCurrentContext, assertManager } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { updateMemberSchema } from "@/lib/validation";
import { db } from "@/lib/db";

async function loadMember(workspaceId: string, userId: string) {
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!member) throw new HttpError(404, "Member not found");
  return member;
}

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ userId: string }> }) => {
    const ctx = await getCurrentContext();
    assertManager(ctx);
    const { userId } = await params;
    const member = await loadMember(ctx.workspace.id, userId);
    if (member.role === "owner") throw new HttpError(403, "The workspace owner can't be changed.");

    const input = parse(updateMemberSchema, await readJson(req));

    if (input.role) {
      await db.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId: ctx.workspace.id, userId } },
        data: { role: input.role },
      });
    }

    if (input.boardAccess) {
      const boards = await db.board.findMany({ where: { workspaceId: ctx.workspace.id }, select: { id: true } });
      const valid = new Set(boards.map((b) => b.id));
      await db.boardAccess.deleteMany({ where: { userId, board: { workspaceId: ctx.workspace.id } } });
      for (const a of input.boardAccess) {
        if (!valid.has(a.boardId)) continue;
        await db.boardAccess.create({ data: { userId, boardId: a.boardId, level: a.level } });
      }
    }
    return ok({ ok: true });
  },
);

export const DELETE = handler(
  async (_req: Request, { params }: { params: Promise<{ userId: string }> }) => {
    const ctx = await getCurrentContext();
    assertManager(ctx);
    const { userId } = await params;
    const member = await loadMember(ctx.workspace.id, userId);
    if (member.role === "owner") throw new HttpError(403, "The workspace owner can't be removed.");
    if (userId === ctx.user.id) throw new HttpError(403, "You can't remove yourself.");

    await db.boardAccess.deleteMany({ where: { userId, board: { workspaceId: ctx.workspace.id } } });
    await db.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId: ctx.workspace.id, userId } },
    });
    return ok({ ok: true });
  },
);
