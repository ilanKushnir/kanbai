import { handler, created } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertAgentTicketAccess } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { createCommentSchema } from "@/lib/validation";
import { addComment } from "@/lib/services/tickets";

export const dynamic = "force-dynamic";

export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "comments:write");
    const { ticketId } = await params;
    await assertAgentTicketAccess(agent, ticketId);
    const { body } = parse(createCommentSchema, await readJson(req));
    const comment = await addComment(ticketId, body, { type: "agent", id: agent.id, name: agent.name });
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
