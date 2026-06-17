import { handler, ok, HttpError } from "@/lib/api";
import { getSessionUser, setActiveWorkspace } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { db } from "@/lib/db";
import { z } from "zod";

const schema = z.object({ workspaceId: z.string().min(1) });

export const POST = handler(async (req: Request) => {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, "Not authenticated");
  const { workspaceId } = parse(schema, await readJson(req));
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
  });
  if (!member) throw new HttpError(403, "You're not a member of that workspace.");
  await setActiveWorkspace(workspaceId);
  return ok({ ok: true });
});
