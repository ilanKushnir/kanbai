import { handler, created } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertTicketAccess } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { createCommentSchema } from "@/lib/validation";
import { addComment } from "@/lib/services/tickets";

export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string }> }) => {
    const { workspace, user } = await getCurrentContext();
    const { ticketId } = await params;
    await assertTicketAccess(ticketId, workspace.id);
    const { body } = parse(createCommentSchema, await readJson(req));
    const comment = await addComment(ticketId, body, {
      type: "user",
      id: user?.id,
      name: user?.name ?? "You",
    });
    return created({
      comment: {
        id: comment.id,
        authorType: comment.authorType,
        authorName: comment.authorName,
        body: comment.body,
        createdAt: comment.createdAt.toISOString(),
      },
    });
  },
);
