import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { sha256, randomToken } from "./password";
import { HttpError } from "./api";
import { acceptPendingInvitesFor } from "./services/invites";
import type { User, Workspace } from "@/generated/prisma";

const SESSION_COOKIE = "kanbai_session";
const WS_COOKIE = "kanbai_ws";
const SESSION_DAYS = 30;

export type WorkspaceRole = "owner" | "admin" | "member";

export type Context = {
  user: User;
  workspace: Workspace;
  role: WorkspaceRole;
  isManager: boolean; // owner or admin of the active workspace
  isSystemAdmin: boolean;
  memberships: { workspace: Workspace; role: WorkspaceRole }[];
};

function cookieOpts(expires?: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(expires ? { expires } : { maxAge: 60 * 60 * 24 * 365 }),
  };
}

/** The signed-in user, or null. Cached per request. */
export const getSessionUser = cache(async (): Promise<User | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  if (session.user.status !== "active") return null;
  return session.user;
});

async function buildContext(user: User): Promise<Context> {
  // A workspace invite addressed to this account counts as accepted the
  // moment they're signed in — sharing shouldn't hinge on opening a link.
  await acceptPendingInvitesFor(user);

  const memberships = await db.workspaceMember.findMany({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { workspace: { createdAt: "asc" } },
  });
  if (memberships.length === 0) throw new HttpError(403, "You don't belong to any workspace.");

  const jar = await cookies();
  const wsId = jar.get(WS_COOKIE)?.value;
  const active = memberships.find((m) => m.workspaceId === wsId) ?? (await defaultMembership(user.id, memberships));

  const role = active.role as WorkspaceRole;
  return {
    user,
    workspace: active.workspace,
    role,
    isManager: role === "owner" || role === "admin",
    isSystemAdmin: user.systemRole === "admin",
    memberships: memberships.map((m) => ({ workspace: m.workspace, role: m.role as WorkspaceRole })),
  };
}

/**
 * Where to land without a remembered choice: the user's own workspace if it
 * has boards, else the first workspace that shows them a board (someone
 * shared one), else their own. Someone who only joined to see a shared board
 * shouldn't open the app into their own empty workspace.
 */
async function defaultMembership<M extends { workspaceId: string; role: string }>(userId: string, memberships: M[]): Promise<M> {
  const owned = memberships.find((m) => m.role === "owner");
  if (memberships.length === 1) return memberships[0];
  const visible = await db.board.findMany({
    where: {
      archived: false,
      OR: memberships.map((m) =>
        m.role === "member" ? { workspaceId: m.workspaceId, access: { some: { userId } } } : { workspaceId: m.workspaceId },
      ),
    },
    select: { workspaceId: true },
  });
  const withBoards = new Set(visible.map((b) => b.workspaceId));
  if (owned && withBoards.has(owned.workspaceId)) return owned;
  return memberships.find((m) => withBoards.has(m.workspaceId)) ?? owned ?? memberships[0];
}

/** For API routes — throws 401/403 (handled by handler()). */
export const getCurrentContext = cache(async (): Promise<Context> => {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, "Not authenticated", "unauthenticated");
  return buildContext(user);
});

/** For pages — redirects to /login if not signed in. */
export async function getContext(): Promise<Context> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return buildContext(user);
}

export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireSystemAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.systemRole !== "admin") redirect("/today");
  return user;
}

// ── Session lifecycle (call only from route handlers / server actions) ──
export async function createSession(userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.session.create({ data: { tokenHash: sha256(token), userId, expiresAt } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieOpts(expiresAt));
}

export async function destroyCurrentSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

/**
 * Revoke every session for a user except the one making the current request —
 * called after a password change so a stolen/older session can't outlive it.
 */
export async function revokeOtherSessions(userId: string) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const currentHash = token ? sha256(token) : "";
  await db.session.deleteMany({ where: { userId, tokenHash: { not: currentHash } } });
}

export async function setActiveWorkspace(workspaceId: string) {
  const jar = await cookies();
  jar.set(WS_COOKIE, workspaceId, cookieOpts());
}

export function assertManager(ctx: Context) {
  if (!ctx.isManager) throw new HttpError(403, "Only workspace owners/admins can do this.", "forbidden");
}

/** API guard: throws unless the caller is the instance system admin. */
export async function requireApiSystemAdmin(): Promise<User> {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, "Not authenticated", "unauthenticated");
  if (user.systemRole !== "admin") throw new HttpError(403, "System admin only.", "forbidden");
  return user;
}
