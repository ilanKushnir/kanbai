import { PrismaClient } from "../src/generated/prisma";
import { generateApiKey, generateWebhookSecret } from "../src/lib/crypto";
import { hashPassword } from "../src/lib/password";
import { ALL_SCOPES } from "../src/lib/constants";

const db = new PrismaClient();
const DEMO_EMAIL = "you@kanbai.app";
const DEMO_PASSWORD = "kanbai1234";

async function main() {
  console.log("🌱 Seeding Kanbai…");
  const ticketCounters: Record<string, number> = {};

  // Clean slate (dev only)
  await db.webhookDelivery.deleteMany();
  await db.activityLog.deleteMany();
  await db.invite.deleteMany();
  await db.boardAccess.deleteMany();
  await db.session.deleteMany();
  await db.attachment.deleteMany();
  await db.comment.deleteMany();
  await db.ticketLabel.deleteMany();
  await db.ticket.deleteMany();
  await db.note.deleteMany();
  await db.label.deleteMany();
  await db.column.deleteMany();
  await db.board.deleteMany();
  await db.agent.deleteMany();
  await db.workspaceMember.deleteMany();
  await db.workspace.deleteMany();
  await db.user.deleteMany();

  const user = await db.user.create({
    data: {
      email: DEMO_EMAIL,
      name: "You",
      passwordHash: hashPassword(DEMO_PASSWORD),
      systemRole: "admin", // first user is the instance super-admin
    },
  });

  const ws = await db.workspace.create({
    data: {
      name: "My Workspace",
      slug: "my-workspace",
      ownerId: user.id,
      members: { create: { userId: user.id, role: "owner" } },
    },
  });

  // ── Agents ────────────────────────────────────────────────────────────────
  const hermesKey = generateApiKey();
  const hermes = await db.agent.create({
    data: {
      workspaceId: ws.id,
      name: "Hermes",
      kind: "hermes",
      color: "#6d5dfb",
      status: "active",
      apiKeyHash: hermesKey.hash,
      apiKeyPrefix: hermesKey.prefix,
      apiKeyLast4: hermesKey.last4,
      webhookUrl: "https://hermes.example.com/kanbai/webhook",
      webhookSecret: generateWebhookSecret(),
      scopes: ALL_SCOPES.join(","),
      lastSeenAt: new Date(),
    },
  });

  await db.agent.create({
    data: {
      workspaceId: ws.id,
      name: "Claude Code",
      kind: "claudecode",
      color: "#d97757",
      status: "active",
    },
  });

  // ── Board: Product ──────────────────────────────────────────────────────────
  const product = await db.board.create({
    data: {
      workspaceId: ws.id,
      name: "Product",
      slug: "product",
      description: "Roadmap, features, and bugs for the product.",
      color: "iris",
      position: 0,
    },
  });

  const pCols = await createColumns(product.id, [
    { name: "Backlog" },
    { name: "To Do" },
    { name: "In Progress" },
    { name: "Review" },
    { name: "Done", isDone: true },
  ]);

  const pLabels = await createLabels(product.id, [
    { name: "Feature", color: "iris" },
    { name: "Bug", color: "rose" },
    { name: "Design", color: "violet" },
    { name: "Infra", color: "amber" },
  ]);

  await createTicket(product.id, pCols["In Progress"], {
    title: "Webhook signature verification",
    description:
      "Sign outbound webhooks with HMAC-SHA256 and document the verification recipe for agents.",
    priority: "high",
    labels: [pLabels["Feature"], pLabels["Infra"]],
    assigneeAgentId: hermes.id,
    position: 0,
  });
  await createTicket(product.id, pCols["In Progress"], {
    title: "Drag-and-drop polish on the board",
    description: "Smooth reordering, drop placeholders, and keyboard a11y.",
    priority: "medium",
    labels: [pLabels["Design"]],
    position: 1,
  });
  await createTicket(product.id, pCols["To Do"], {
    title: "Voice-memo capture on mobile",
    description: "Record a memo alongside a note and attach it to the agent sort request.",
    priority: "high",
    labels: [pLabels["Feature"]],
    position: 0,
  });
  await createTicket(product.id, pCols["To Do"], {
    title: "Agent inbox triage endpoint",
    description: "`GET /api/v1/inbox` returns notes queued to the agent for sorting.",
    priority: "medium",
    labels: [pLabels["Feature"]],
    assigneeAgentId: hermes.id,
    position: 1,
  });
  await createTicket(product.id, pCols["Backlog"], {
    title: "Multi-workspace + real auth",
    description: "Sessions, OAuth, per-workspace membership and roles.",
    priority: "low",
    labels: [pLabels["Infra"]],
    position: 0,
  });
  await createTicket(product.id, pCols["Backlog"], {
    title: "Board templates",
    description: "Starter columns for common workflows (Kanban, sprint, content calendar).",
    priority: "low",
    position: 1,
  });
  await createTicket(product.id, pCols["Review"], {
    title: "Empty + loading states",
    description: "Make every surface feel intentional when there's no data yet.",
    priority: "medium",
    labels: [pLabels["Design"]],
    position: 0,
  });
  await createTicket(product.id, pCols["Done"], {
    title: "Design system + tokens",
    description: "Iris/Aqua palette, dark mode, typography, motion.",
    priority: "medium",
    labels: [pLabels["Design"]],
    position: 0,
  });
  await createTicket(product.id, pCols["Done"], {
    title: "Prisma schema + migrations",
    description: "Boards, tickets, notes, agents, webhooks, activity.",
    priority: "medium",
    labels: [pLabels["Infra"]],
    position: 1,
  });

  // ── Board: Personal ──────────────────────────────────────────────────────────
  const personal = await db.board.create({
    data: {
      workspaceId: ws.id,
      name: "Personal",
      slug: "personal",
      description: "Life admin and side quests.",
      color: "aqua",
      position: 1,
    },
  });
  const xCols = await createColumns(personal.id, [
    { name: "Inbox" },
    { name: "Doing" },
    { name: "Done", isDone: true },
  ]);
  await createTicket(personal.id, xCols["Inbox"], {
    title: "Renew passport",
    priority: "urgent",
    dueDate: daysFromNow(9),
    position: 0,
  });
  await createTicket(personal.id, xCols["Inbox"], {
    title: "Book dentist",
    priority: "medium",
    position: 1,
  });
  await createTicket(personal.id, xCols["Doing"], {
    title: "Plan weekend trip",
    description: "Compare two options, pick one by Friday.",
    priority: "low",
    position: 0,
  });

  // ── Notes (mobile fast-capture) ───────────────────────────────────────────────
  // One running note split into when-buckets; some lines marked for an agent.
  const noteData: {
    body: string;
    bucket?: string;
    priority?: string;
    status?: string;
    pinned?: boolean;
    agentId?: string;
    sortContext?: string;
  }[] = [
    { body: "Call the bank about the new card", bucket: "today", priority: "high" },
    { body: "Reply to Dana's thread about the launch checklist", bucket: "today", priority: "medium" },
    {
      body: "Follow up with the design contractor about the icon set",
      bucket: "today",
      priority: "medium",
      status: "queued",
      agentId: hermes.id,
      sortContext: "Put this on the Product board, it's a design task, medium priority.",
    },
    { body: "Bug — dragging a card to an empty column sometimes snaps back", bucket: "tomorrow", priority: "high" },
    { body: "Prep the standup notes", bucket: "tomorrow" },
    { body: "Blog post: how we sign webhooks so agents can trust Kanbai", bucket: "next_week", priority: "low" },
    { body: "Book the offsite venue", bucket: "next_month", priority: "medium" },
    { body: "Idea: let agents propose due dates based on the note text", bucket: "general", pinned: true },
    { body: "Grocery: oat milk, coffee, eggs", bucket: "general" },
  ];
  const posByBucket: Record<string, number> = {};
  for (const n of noteData) {
    const bucket = n.bucket ?? "today";
    const position = posByBucket[bucket] ?? 0;
    posByBucket[bucket] = position + 1;
    await db.note.create({
      data: {
        userId: user.id,
        body: n.body,
        bucket,
        position,
        priority: n.priority ?? "none",
        status: n.status ?? "inbox",
        pinned: n.pinned ?? false,
        assignedAgentId: n.agentId ?? null,
        sortContext: n.sortContext ?? null,
        queuedAt: n.status === "queued" ? new Date() : null,
      },
    });
  }

  console.log("\n✅ Seed complete.");
  console.log("\n────────────────────────────────────────────────────────");
  console.log("  Sign in (system admin):");
  console.log(`    email:    ${DEMO_EMAIL}`);
  console.log(`    password: ${DEMO_PASSWORD}`);
  console.log("────────────────────────────────────────────────────────");
  console.log("  Hermes API key (shown once — copy it now):\n");
  console.log("   " + hermesKey.key);
  console.log("\n  Use it as:  Authorization: Bearer " + hermesKey.key);
  console.log("────────────────────────────────────────────────────────\n");

  // helpers ───────────────────────────────────────────────────────────────────
  async function createColumns(boardId: string, cols: { name: string; isDone?: boolean }[]) {
    const map: Record<string, string> = {};
    for (let i = 0; i < cols.length; i++) {
      const c = await db.column.create({
        data: { boardId, name: cols[i].name, position: i, isDone: cols[i].isDone ?? false },
      });
      map[cols[i].name] = c.id;
    }
    return map;
  }

  async function createLabels(boardId: string, labels: { name: string; color: string }[]) {
    const map: Record<string, string> = {};
    for (const l of labels) {
      const created = await db.label.create({ data: { boardId, name: l.name, color: l.color } });
      map[l.name] = created.id;
    }
    return map;
  }

  async function createTicket(
    boardId: string,
    columnId: string,
    t: {
      title: string;
      description?: string;
      priority?: string;
      dueDate?: Date;
      labels?: string[];
      assigneeAgentId?: string;
      position: number;
    },
  ) {
    ticketCounters[boardId] = (ticketCounters[boardId] ?? 0) + 1;
    const ticket = await db.ticket.create({
      data: {
        boardId,
        columnId,
        number: ticketCounters[boardId],
        title: t.title,
        description: t.description ?? "",
        priority: t.priority ?? "medium",
        dueDate: t.dueDate ?? null,
        position: t.position,
        createdByType: "user",
        createdById: user.id,
        assigneeType: t.assigneeAgentId ? "agent" : null,
        assigneeAgentId: t.assigneeAgentId ?? null,
        labels: t.labels?.length
          ? { create: t.labels.map((labelId) => ({ labelId })) }
          : undefined,
      },
    });
    await db.activityLog.create({
      data: {
        boardId,
        ticketId: ticket.id,
        actorType: "user",
        actorId: user.id,
        actorName: "You",
        action: "ticket.created",
        meta: JSON.stringify({ title: t.title }),
      },
    });
    return ticket;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

function daysFromNow(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}
