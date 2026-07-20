/**
 * Pure helpers for the Boards page: section the visible boards for the viewer
 * and summarize per-board sharing for the indicator chips.
 *
 * Classification mirrors the access model exactly (boardWhereForContext /
 * board-members): there is no per-board owner — workspace owners/admins
 * ("managers") administer every board in the workspace, while plain members
 * only ever see boards someone shared with them via a BoardAccess grant. So
 * for a manager the whole list is "Workspace boards"; for a member it is
 * "Shared with you". The split is role-derived, never guessed from labels.
 */

export type BoardCardData = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  isPublic: boolean;
  ticketCount: number;
  doneCount: number;
  /** Members with an explicit BoardAccess grant, excluding the viewer. */
  sharedWith: { id: string; name: string; avatarUrl: string | null; avatarColor: string | null }[];
  /** The viewer's own explicit grant (always null for managers — theirs is implicit). */
  viewerLevel: "view" | "edit" | null;
};

export type BoardSectionKey = "pinned" | "workspace" | "shared";
export type BoardSection<B> = { key: BoardSectionKey; boards: B[] };

export const BOARD_SECTION_LABELS: Record<BoardSectionKey, string> = {
  pinned: "Pinned",
  workspace: "Workspace boards",
  shared: "Shared with you",
};

/**
 * Order the visible boards into sections: pinned first (in the given board
 * order), then the rest under a role-appropriate heading. Pin ids that don't
 * match a visible board (deleted, revoked, other workspace) are ignored. The
 * main section is omitted when every visible board is pinned.
 */
export function buildBoardSections<B extends { id: string }>(
  boards: B[],
  pinnedBoardIds: string[],
  isManager: boolean,
): BoardSection<B>[] {
  const pinnedSet = new Set(pinnedBoardIds);
  const pinned = boards.filter((b) => pinnedSet.has(b.id));
  const rest = boards.filter((b) => !pinnedSet.has(b.id));

  const sections: BoardSection<B>[] = [];
  if (pinned.length > 0) sections.push({ key: "pinned", boards: pinned });
  if (rest.length > 0 || pinned.length === 0) {
    sections.push({ key: isManager ? "workspace" : "shared", boards: rest });
  }
  return sections;
}

export type SharedSummary = {
  avatars: { id: string; name: string; avatarUrl: string | null; avatarColor: string | null }[];
  overflow: number;
  label: string;
};

/**
 * Face-pile summary for "who else has an explicit grant on this board"
 * (beyond the viewer). Returns null when nobody does — the public-link
 * state renders as its own badge and is not part of this summary.
 */
export function sharedSummary(
  board: Pick<BoardCardData, "sharedWith">,
  maxAvatars = 3,
): SharedSummary | null {
  if (board.sharedWith.length === 0) return null;

  const avatars = board.sharedWith.slice(0, maxAvatars);
  const overflow = board.sharedWith.length - avatars.length;
  const label =
    board.sharedWith.length === 1
      ? `Shared with ${board.sharedWith[0].name}`
      : `Shared with ${board.sharedWith.length} members`;
  return { avatars, overflow, label };
}
