/** Deep-link to a ticket inside its owning board, opening the ticket modal.
 *
 * The board page reads `?ticket=<id>` and pre-selects that ticket (see
 * `boards/[slug]/page.tsx` → `initialTicketId`). When the owning board isn't in
 * the caller's scope (e.g. access was revoked), fall back to the boards index. */
export function ticketHref(
  ticket: { id: string; boardId: string },
  boards: { id: string; slug: string }[],
): string {
  const slug = boards.find((b) => b.id === ticket.boardId)?.slug;
  return slug ? `/boards/${slug}?ticket=${ticket.id}` : "/boards";
}
