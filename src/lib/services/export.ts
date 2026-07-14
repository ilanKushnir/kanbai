import { db } from "@/lib/db";
import { boardWhereForContext } from "@/lib/authz";
import { parseSubStates } from "@/lib/substates";
import { htmlToPlainText } from "@/lib/utils";
import type { Context } from "@/lib/auth";

/**
 * Backup & offline-checklist export.
 *
 * Two artifacts, one gathering pass:
 *  - Full JSON backup: every board/column/ticket/label + every note of the
 *    current user — for safekeeping while the server is down or migrating.
 *  - Offline checklist: a single self-contained HTML file listing every OPEN
 *    ticket and note. It runs entirely from the file (works over file:// with
 *    no server), persists checkbox state in localStorage, and can emit a small
 *    "progress file" that /api/import/progress applies once the app is back.
 */

type ExportTicket = {
  id: string;
  number: number | null;
  title: string;
  description: string;
  priority: string;
  subState: string | null;
  dueDate: string | null;
  done: boolean;
  labels: string[];
  createdAt: string;
};

type ExportColumn = {
  id: string;
  name: string;
  isDone: boolean;
  subStates: string[];
  tickets: ExportTicket[];
};

type ExportBoard = { id: string; name: string; slug: string; columns: ExportColumn[] };

type ExportNote = {
  id: string;
  body: string;
  scheduledDay: string | null;
  doneOn: string | null;
  priority: string;
  pinned: boolean;
  status: string;
  createdAt: string;
};

export type ExportData = {
  app: "kanbai";
  version: 1;
  exportedAt: string; // ISO timestamp
  workspace: string;
  user: string;
  boards: ExportBoard[];
  notes: ExportNote[];
};

export async function gatherExportData(ctx: Context): Promise<ExportData> {
  const boards = await db.board.findMany({
    where: { ...boardWhereForContext(ctx), archived: false },
    orderBy: { position: "asc" },
    include: {
      columns: { orderBy: { position: "asc" } },
      tickets: {
        where: { deletedAt: null },
        orderBy: { position: "asc" },
        include: { labels: { include: { label: true } } },
      },
    },
  });

  const notes = await db.note.findMany({
    where: { userId: ctx.user.id, deletedAt: null, status: { not: "archived" } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });

  return {
    app: "kanbai",
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace: ctx.workspace.name,
    user: ctx.user.name,
    boards: boards.map((b) => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      columns: b.columns.map((c) => ({
        id: c.id,
        name: c.name,
        isDone: c.isDone,
        subStates: parseSubStates(c.subStates),
        tickets: b.tickets
          .filter((t) => t.columnId === c.id)
          .map((t) => ({
            id: t.id,
            number: t.number,
            title: t.title,
            description: htmlToPlainText(t.description),
            priority: t.priority,
            subState: t.subState,
            dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
            done: c.isDone,
            labels: t.labels.map((l) => l.label.name),
            createdAt: t.createdAt.toISOString(),
          })),
      })),
    })),
    notes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      scheduledDay: n.scheduledDay,
      doneOn: n.doneOn,
      priority: n.priority,
      pinned: n.pinned,
      status: n.status,
      createdAt: n.createdAt.toISOString(),
    })),
  };
}

// ── Offline checklist HTML ──────────────────────────────────────────────────

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const PRIORITY_DOTS: Record<string, string> = {
  urgent: "#ef4444",
  high: "#f97316",
  medium: "#3b82f6",
  low: "#94a3b8",
};

function checklistItem(type: "ticket" | "note", id: string, html: string, meta?: string) {
  return `<li><label><input type="checkbox" data-t="${type}" data-id="${esc(id)}"><span class="box"></span><span class="txt" dir="auto">${html}${
    meta ? `<small>${meta}</small>` : ""
  }</span></label></li>`;
}

function ticketRow(t: ExportTicket): string {
  const dot = PRIORITY_DOTS[t.priority]
    ? `<i class="dot" style="background:${PRIORITY_DOTS[t.priority]}"></i>`
    : "";
  const bits = [
    t.number != null ? `#${t.number}` : "",
    t.subState ? esc(t.subState) : "",
    t.dueDate ? `due ${t.dueDate}` : "",
    ...t.labels.map(esc),
  ].filter(Boolean);
  return checklistItem("ticket", t.id, `${dot}${esc(t.title)}`, bits.join(" · "));
}

function noteRow(n: ExportNote): string {
  const dot = PRIORITY_DOTS[n.priority]
    ? `<i class="dot" style="background:${PRIORITY_DOTS[n.priority]}"></i>`
    : "";
  const body = n.body.length > 300 ? n.body.slice(0, 300) + "…" : n.body;
  return checklistItem("note", n.id, `${dot}${esc(body)}`, n.pinned ? "pinned" : undefined);
}

/** Group label for a note's scheduled day, relative to the export date. */
function noteGroup(day: string | null, today: string): string {
  if (!day) return "Unsorted";
  if (day < today) return "Overdue";
  if (day === today) return "Today";
  return day;
}

export function buildChecklistHtml(data: ExportData): string {
  const today = data.exportedAt.slice(0, 10);
  const exportId = data.exportedAt.replace(/\D/g, "").slice(0, 14); // yyyymmddhhmmss

  // Open tickets only, grouped board → column (done columns excluded entirely).
  const boardSections = data.boards
    .map((b) => {
      const cols = b.columns
        .filter((c) => !c.isDone)
        .map((c) => {
          if (!c.tickets.length) return "";
          // Within a sub-stated column, keep the band grouping visible.
          const bands = c.subStates.length
            ? c.subStates
                .map((s) => {
                  const items = c.tickets.filter(
                    (t) => (t.subState && c.subStates.includes(t.subState) ? t.subState : c.subStates[0]) === s,
                  );
                  return items.length
                    ? `<p class="band">${esc(s)}</p><ul>${items.map(ticketRow).join("")}</ul>`
                    : "";
                })
                .join("")
            : `<ul>${c.tickets.map(ticketRow).join("")}</ul>`;
          return `<div class="col"><h3>${esc(c.name)} <em>${c.tickets.length}</em></h3>${bands}</div>`;
        })
        .filter(Boolean)
        .join("");
      return cols ? `<section><h2>${esc(b.name)}</h2>${cols}</section>` : "";
    })
    .filter(Boolean)
    .join("");

  // Open notes grouped by schedule; Overdue → Today → future days → Unsorted.
  const openNotes = data.notes.filter((n) => !n.doneOn && n.status === "inbox");
  const groups = new Map<string, ExportNote[]>();
  for (const n of openNotes) {
    const g = noteGroup(n.scheduledDay, today);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(n);
  }
  const order = (g: string) =>
    g === "Overdue" ? "0" : g === "Today" ? "1" : g === "Unsorted" ? "9" : `2${g}`;
  const noteSections = [...groups.entries()]
    .sort((a, b) => order(a[0]).localeCompare(order(b[0])))
    .map(
      ([g, items]) =>
        `<div class="col"><h3>${esc(g)} <em>${items.length}</em></h3><ul>${items.map(noteRow).join("")}</ul></div>`,
    )
    .join("");

  const openTicketCount = data.boards.reduce(
    (n, b) => n + b.columns.filter((c) => !c.isDone).reduce((m, c) => m + c.tickets.length, 0),
    0,
  );
  const total = openTicketCount + openNotes.length;
  const niceDate = new Date(data.exportedAt).toDateString();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kanbai checklist · ${esc(today)}</title>
<style>
  :root{color-scheme:dark light}
  *{box-sizing:border-box;margin:0}
  body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0b0d12;color:#e6e8ee;padding:16px;max-width:760px;margin:0 auto}
  header{position:sticky;top:0;background:#0b0d12f2;backdrop-filter:blur(8px);padding:12px 0;border-bottom:1px solid #262a35;margin-bottom:16px;z-index:2}
  h1{font-size:18px;letter-spacing:-.01em}
  .sub{color:#8b91a0;font-size:12.5px;margin-top:2px}
  .bar{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
  button{font:600 13px/-apple-system inherit;padding:8px 14px;border-radius:10px;border:1px solid #363b49;background:#171a22;color:#e6e8ee;cursor:pointer}
  button.primary{background:#6366f1;border-color:#6366f1;color:#fff}
  button:active{transform:translateY(1px)}
  .hint{font-size:12px;color:#8b91a0;margin-top:8px}
  #done-count{color:#34d399;font-variant-numeric:tabular-nums}
  section{margin-bottom:22px}
  h2{font-size:15px;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #262a35;color:#c7cad3}
  .col{margin:10px 0}
  h3{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#8b91a0;margin-bottom:6px}
  h3 em{font-style:normal;opacity:.7}
  .band{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#6b7180;margin:8px 0 4px 4px}
  ul{list-style:none}
  li{margin:4px 0}
  label{display:flex;gap:10px;align-items:flex-start;background:#12151c;border:1px solid #20242e;border-radius:12px;padding:10px 12px;cursor:pointer;transition:opacity .15s,background .15s}
  label:hover{background:#161a23}
  input{position:absolute;opacity:0;pointer-events:none}
  .box{flex:none;width:20px;height:20px;border-radius:7px;border:1.5px solid #4a5063;margin-top:1px;display:grid;place-items:center;transition:all .15s}
  input:checked~.box{background:#10b981;border-color:#10b981}
  input:checked~.box::after{content:"";width:6px;height:10px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg) translate(-1px,-1px)}
  .txt{flex:1;min-width:0;overflow-wrap:break-word;white-space:pre-line}
  input:checked~.txt{opacity:.45;text-decoration:line-through}
  .txt small{display:block;white-space:normal;color:#8b91a0;font-size:11.5px;margin-top:2px;text-decoration:none}
  .dot{display:inline-block;width:8px;height:8px;border-radius:99px;margin-inline-end:7px;vertical-align:1px}
  footer{color:#6b7180;font-size:12px;text-align:center;padding:24px 0}
  @media (prefers-color-scheme: light){
    body{background:#f7f8fa;color:#1a1d26}
    header{background:#f7f8faf2;border-color:#e3e5ea}
    h2{color:#3d414d;border-color:#e3e5ea}
    label{background:#fff;border-color:#e3e5ea}
    label:hover{background:#f2f3f7}
    button{background:#fff;border-color:#d5d8e0;color:#1a1d26}
    button.primary{background:#6366f1;color:#fff}
  }
</style>
</head>
<body>
<header>
  <h1>Kanbai — offline checklist</h1>
  <div class="sub">${esc(data.workspace)} · exported ${esc(niceDate)} · <span id="done-count">0</span>/${total} done</div>
  <div class="bar">
    <button class="primary" id="dl">Download progress file</button>
    <button id="cp">Copy progress</button>
  </div>
  <p class="hint">Work through this list anywhere — no server needed. Ticks are saved in this browser automatically.
  When Kanbai is back up, download the progress file and import it in <b>Settings → Backup</b> to sync everything you finished.</p>
</header>
${boardSections}
${noteSections ? `<section><h2>Notes</h2>${noteSections}</section>` : ""}
<footer>Kanbai offline checklist · keep this file somewhere safe</footer>
<script>
(function(){
  var KEY = "kanbai-checklist-${exportId}";
  var state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) {}
  var boxes = Array.prototype.slice.call(document.querySelectorAll("input[data-id]"));
  var counter = document.getElementById("done-count");
  function localDay(){
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }
  function refresh(){
    var n = 0;
    boxes.forEach(function(b){ if (b.checked) n++; });
    counter.textContent = n;
  }
  boxes.forEach(function(b){
    var k = b.dataset.t + ":" + b.dataset.id;
    if (state[k] && state[k].done) b.checked = true;
    b.addEventListener("change", function(){
      if (b.checked) state[k] = { done: true, doneAt: localDay() };
      else delete state[k];
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
      refresh();
    });
  });
  refresh();
  function progressJson(){
    var items = [];
    boxes.forEach(function(b){
      if (!b.checked) return;
      var k = b.dataset.t + ":" + b.dataset.id;
      items.push({ type: b.dataset.t, id: b.dataset.id, done: true, doneAt: (state[k] && state[k].doneAt) || localDay() });
    });
    return JSON.stringify({ kanbai: "progress", version: 1, exportedAt: ${JSON.stringify(data.exportedAt)}, savedAt: new Date().toISOString(), items: items }, null, 2);
  }
  document.getElementById("dl").addEventListener("click", function(){
    var blob = new Blob([progressJson()], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "kanbai-progress-" + localDay() + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 5000);
  });
  document.getElementById("cp").addEventListener("click", function(){
    var txt = progressJson();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function(){ alert("Progress copied — paste it into Settings → Backup → Import."); });
    } else {
      prompt("Copy this JSON:", txt);
    }
  });
})();
</script>
</body>
</html>`;
}
