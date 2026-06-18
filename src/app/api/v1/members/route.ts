import { handler, ok, created } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { parse, readJson } from "@/lib/parse";
import { createMemberV1Schema } from "@/lib/validation";
import { hashPassword, randomToken } from "@/lib/password";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** List workspace members (so a migration can map assignees by email). */
export const GET = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  requireScope(agent, "members:read");
  const members = await db.workspaceMember.findMany({
    where: { workspaceId: agent.workspaceId },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  return ok({
    members: members.map((m) => ({ userId: m.user.id, email: m.user.email, name: m.user.name, role: m.role })),
  });
});

/** Create (or fetch) a user by email and add them to this workspace. */
export const POST = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  requireScope(agent, "members:write");
  const input = parse(createMemberV1Schema, await readJson(req));
  const email = input.email.toLowerCase();

  let user = await db.user.findUnique({ where: { email } });
  let tempPassword: string | undefined;
  let createdUser = false;
  if (!user) {
    tempPassword = randomToken().slice(0, 16);
    user = await db.user.create({
      data: {
        email,
        name: input.name ?? email.split("@")[0],
        passwordHash: hashPassword(tempPassword),
        systemRole: "user",
      },
    });
    createdUser = true;
  }

  await db.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: agent.workspaceId, userId: user.id } },
    update: { role: input.role ?? "member" },
    create: { workspaceId: agent.workspaceId, userId: user.id, role: input.role ?? "member" },
  });

  if (input.boardAccess?.length) {
    for (const a of input.boardAccess) {
      const board = await db.board.findUnique({ where: { id: a.boardId }, select: { workspaceId: true } });
      if (!board || board.workspaceId !== agent.workspaceId) continue;
      await db.boardAccess.upsert({
        where: { boardId_userId: { boardId: a.boardId, userId: user.id } },
        update: { level: a.level },
        create: { boardId: a.boardId, userId: user.id, level: a.level },
      });
    }
  }

  // tempPassword is returned ONCE for newly-created users so they can sign in.
  return created({ userId: user.id, email: user.email, created: createdUser, ...(tempPassword ? { tempPassword } : {}) });
});
