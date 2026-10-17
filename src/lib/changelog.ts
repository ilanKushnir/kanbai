// The user-facing release history behind the "What's new" dialog.
//
// - Newest release first. The dialog shows CHANGELOG[0]; older releases sit
//   behind "Older versions", one divider per release.
// - Add a block for every release with user-visible features. Patch releases
//   without a block never re-open the dialog (the seen marker is CHANGELOG[0]).

export type ChangelogItem = { emoji: string; title: string; body: string };
export type ChangelogRelease = { version: string; date: string; items: ChangelogItem[] };

export const CHANGELOG: ChangelogRelease[] = [
  {
    version: "0.13.0",
    date: "2026-10-17",
    items: [
      { emoji: "🤖", title: "Your agent files things where they belong", body: "“Add a task” becomes a simple to-do on Today. Only work on a specific project becomes a ticket, on that project's board." },
      { emoji: "🕘", title: "Recent changes on Today", body: "One small panel shows every task added, completed, moved or edited, by you or your agent, with a filter for each." },
      { emoji: "🔀", title: "Move tickets between boards", body: "A ticket can now move to another board in one step and keep its comments, subtasks and history." },
      { emoji: "📝", title: "Markdown descriptions", body: "Descriptions render formatted: headings, lists, checklists, links. Click to edit the Markdown; tick checkboxes right in the view." },
      { emoji: "🖱️", title: "Right-click a card", body: "Open it, mark it done or move it to another column from a menu. The done check now sits neatly inside the card." },
      { emoji: "↔️", title: "Hebrew and English, side by side", body: "Every task follows its own language direction, to-dos and tickets alike." },
      { emoji: "🧾", title: "Clear receipts from your agent", body: "After every change your agent replies with a short, emoji-led summary of exactly what it did." },
    ],
  },
  {
    version: "0.12.0",
    date: "2026-10-15",
    items: [
      { emoji: "📴", title: "Today works offline", body: "Open your list without a connection, add and complete tasks, and everything syncs when you're back. A small pill shows the sync state." },
      { emoji: "🌗", title: "A real light theme for the art", body: "Illustrations and covers now have proper light-mode versions." },
    ],
  },
  {
    version: "0.11.0",
    date: "2026-10-15",
    items: [
      { emoji: "🔗", title: "Connect an agent with one message", body: "Paste a single brief into your agent's chat. It connects itself with a one-time code, and no key is ever shown in chat." },
      { emoji: "📱", title: "Feels native on your phone", body: "Install Kanbai to your home screen for a full-screen app with instant tab switches." },
      { emoji: "✨", title: "Completing a task feels good", body: "The check draws itself, the title strikes through and the row folds away into Done." },
    ],
  },
  {
    version: "0.10.0",
    date: "2026-10-14",
    items: [
      { emoji: "⬛", title: "Monolith", body: "A new mark and a calm monochrome design with a single vermilion accent, plus paper-craft illustrations." },
    ],
  },
  {
    version: "0.9.0",
    date: "2026-10-13",
    items: [
      { emoji: "☀️", title: "Today, one place for your day", body: "Today replaces My Day and Notes: overdue, today, tomorrow, later and inbox in a single list, with natural-language quick add." },
      { emoji: "🤖", title: "Agents over a simple API", body: "Your AI agent reads the day and adds, moves and completes tasks over REST. Everything it does is logged and undoable." },
      { emoji: "🖼️", title: "Board covers", body: "Every board gets cover art." },
    ],
  },
];

/** The release the dialog announces; a user who has seen it isn't shown the dialog again. */
export const LATEST_RELEASE_VERSION = CHANGELOG[0].version;
