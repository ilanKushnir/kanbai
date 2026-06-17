import { handler, ok, HttpError } from "@/lib/api";
import { requireApiSystemAdmin } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { db } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  status: z.enum(["active", "disabled"]).optional(),
  systemRole: z.enum(["admin", "user"]).optional(),
});

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ userId: string }> }) => {
    const admin = await requireApiSystemAdmin();
    const { userId } = await params;
    const input = parse(schema, await readJson(req));

    if (userId === admin.id && (input.status === "disabled" || input.systemRole === "user")) {
      throw new HttpError(400, "You can't disable or demote your own admin account.");
    }
    const target = await db.user.findUnique({ where: { id: userId } });
    if (!target) throw new HttpError(404, "User not found");

    const data: Record<string, unknown> = {};
    if (input.status) data.status = input.status;
    if (input.systemRole) data.systemRole = input.systemRole;
    const user = await db.user.update({ where: { id: userId }, data });

    // Disabling a user kills their sessions.
    if (input.status === "disabled") await db.session.deleteMany({ where: { userId } });

    return ok({ user: { id: user.id, status: user.status, systemRole: user.systemRole } });
  },
);
