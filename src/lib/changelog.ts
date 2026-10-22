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
    version: "0.22.0",
    date: "2026-10-23",
    items: [
      { emoji: "↕️", title: "Put your day in order", body: "Drag tasks in Today and Tomorrow into the order you'll do them — on a phone, hold a task for a moment, then drag. Your order is saved and syncs across your devices." },
      { emoji: "🌗", title: "Morning, afternoon, evening", body: "The sun-and-moon button on Today and Tomorrow splits the day into Morning, Afternoon and Evening. Drag a task under the part you'll do it in, or pick one from its ⋯ menu. Turn the split off and the order stays." },
    ],
  },
  {
    version: "0.21.2",
    date: "2026-10-22",
    items: [
      { emoji: "✨", title: "It's KanbAi now", body: "Kanban plus AI — the name is now spelled KanbAi, with the Ai picked out in the accent colour." },
    ],
  },
  {
    version: "0.21.1",
    date: "2026-10-22",
    items: [
      { emoji: "🗑️", title: "Delete tasks in Focus", body: "Your own tasks now have a ⋯ menu in Focus with Edit and Delete. Board tickets are deleted from inside the ticket, so their row menu no longer has Delete." },
    ],
  },
  {
    version: "0.21.0",
    date: "2026-10-19",
    items: [
      { emoji: "🎯", title: "Today is your list", body: "Today now shows only what's yours — tickets assigned to you and your own tasks — followed by unassigned tickets anyone can pick up. Tickets assigned to other people no longer appear on your day or count toward its total." },
      { emoji: "🙋", title: "Take it, or hand it off", body: "An unassigned ticket shows an Unassigned tag. Tap it to take the ticket yourself or give it to someone on that board. Every row's ⋯ menu has the same options, with Undo." },
      { emoji: "👥", title: "Assigned to others", body: "Work assigned to other people stays one tap away, under Assigned to others at the bottom of Today. It's grouped by person, with the soonest due first, and you can still take any of it." },
    ],
  },
  {
    version: "0.20.0",
    date: "2026-10-18",
    items: [
      { emoji: "🤝", title: "Sharing a board just works", body: "In a board's Members, type someone's KanbAi email and tap Share — they see the board right away, nothing to accept. Invites that were already sent apply the next time that person opens KanbAi." },
      { emoji: "🧭", title: "Shared boards are easy to find", body: "If you belong to more than one workspace, KanbAi opens in the one that has your boards, and the Boards page lists boards from your other workspaces — tap one to jump straight in." },
      { emoji: "🗄️", title: "Archive from the Boards page", body: "Each board card has a ⋯ menu with Pin and Archive. Archived boards wait under Archived at the bottom of the page, ready to restore." },
    ],
  },
  {
    version: "0.19.0",
    date: "2026-10-18",
    items: [
      { emoji: "⇅", title: "Sort on boards", body: "Columns now sort by due date — soonest at the top, and on the same day the higher priority first. Done columns show the latest finished first." },
      { emoji: "🎛️", title: "Per column, or the whole board", body: "Each column has its own ⇅ menu: due date, priority, newest, recently updated, recently completed, or Manual (your own drag order). The Sort button next to Filter sets every column at once." },
      { emoji: "🖐️", title: "Manual still there", body: "Drag a card into a sorted column and it takes its sorted place. To arrange cards by hand, switch that column to Manual." },
    ],
  },
  {
    version: "0.18.0",
    date: "2026-10-18",
    items: [
      { emoji: "☀️", title: "A daily brief from your agent", body: "Right after it connects, your agent offers a short morning brief — today's tasks, sorted, with a fitting emoji each, and your calendar if you want it — at the time you choose. Ask “brief me” any time for the same." },
      { emoji: "🗓️", title: "Your agent can read your calendar", body: "The calendars you linked under Settings → Calendars are now readable by your agent (read-only), so the brief can include today's meetings." },
      { emoji: "🧹", title: "Old “send to agent” is gone", body: "The old flow for queueing tasks to an agent to sort is removed. Just tell your agent what to do — or use “Move to board” on a task to turn it into a ticket." },
    ],
  },
  {
    version: "0.17.0",
    date: "2026-10-18",
    items: [
      { emoji: "☑️", title: "Subtasks, for every task", body: "Simple tasks and tickets can both be broken into steps. A small ring on the row shows how far along it is; tap it to open the list, tick steps, add or rename them. “Break into subtasks” is in the row's ⋯ menu." },
      { emoji: "🤔", title: "Done with all of it?", body: "Completing a task or a ticket with steps still open asks first: complete everything, or just the task. The same question comes up when a ticket is dragged into Done." },
      { emoji: "🤖", title: "Your agent breaks things down", body: "Your agent now adds real subtasks instead of writing “- [ ]” lists into the text, and lists written that way before were turned into subtasks." },
      { emoji: "◎", title: "Overdue in Focus", body: "Focus mode shows what's overdue in its own section above Today — closed until you open it." },
      { emoji: "🎨", title: "Calmer colours", body: "Today is set apart by depth instead of orange, focus rings are neutral, and the afternoon illustration keeps its kite in view." },
    ],
  },
  {
    version: "0.16.0",
    date: "2026-10-18",
    items: [
      { emoji: "◎", title: "Focus mode", body: "Flip the Focus switch at the top and everything else steps aside — no boards, no menus, no side panels. Just what's on today, anything carried over, and tomorrow." },
      { emoji: "🪜", title: "The rest, one step at a time", body: "The rest of the week is one tap away, and only then everything else (later and Inbox). Each time you open Focus, it starts small again." },
      { emoji: "➕", title: "Jot it down", body: "The + button in Focus adds a task straight to Inbox without asking for a day, so you can get it out of your head and keep going." },
    ],
  },
  {
    version: "0.15.0",
    date: "2026-10-17",
    items: [
      { emoji: "🎯", title: "Drag exactly where you mean", body: "Dragging on Plan was rebuilt: the card follows your finger or mouse, the day under it lights up, and a label shows where it will land. On a phone the card floats above your finger so you can see the day." },
      { emoji: "📌", title: "Calendar and tray side by side", body: "On phones the calendar stays pinned at the top while the “To plan” list scrolls under it, so every task is one drag away from its day. Tap a day to open it." },
      { emoji: "📅", title: "Pick a day, then confirm", body: "No drag needed: tap the calendar button on a task, tap a day, and confirm. You'll see what's already planned there before you say yes." },
      { emoji: "↩️", title: "Undo and redo", body: "Every move on the calendar can be undone or redone from the buttons above it (or ⌘Z / ⇧⌘Z). After an undo, the calendar shows you where the task went." },
      { emoji: "👉", title: "Swipe between months", body: "Swipe left or right on the calendar to glide to the next or previous month or week. On a trackpad, a sideways swipe works too. Hold a dragged task over an arrow to flip pages." },
      { emoji: "🖥️", title: "The chosen day, beside the calendar", body: "On wide screens, click any day to see all of it next to the calendar, above the tray. Days outside the month are now clearly set apart." },
    ],
  },
  {
    version: "0.14.0",
    date: "2026-10-17",
    items: [
      { emoji: "🗓️", title: "Plan — your tasks on a calendar", body: "A new section with a month and a week view of everything that has a day: simple tasks, tickets, and what you already finished." },
      { emoji: "🫳", title: "Drag a task onto a day", body: "The “To plan” tray holds every task without a day (and anything overdue). Drag it onto the calendar, or back to the tray to clear its date." },
      { emoji: "👆", title: "Tap to plan on your phone", body: "Tap the calendar button on a task, then tap a day. Long-press drags too." },
      { emoji: "🎫", title: "Tickets without a due date", body: "A second tab in the tray lists open tickets with no due date — in work first, then backlog — filterable by board." },
      { emoji: "📆", title: "Your Google Calendar, side by side", body: "Add your calendar's private iCal link in Settings → Calendars and your events show on Plan, read-only, recurring events included." },
    ],
  },
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
      { emoji: "📱", title: "Feels native on your phone", body: "Install KanbAi to your home screen for a full-screen app with instant tab switches." },
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
