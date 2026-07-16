import { db } from "@/lib/db";
import { boardWhereForContext } from "@/lib/authz";
import { parseSubStates } from "@/lib/substates";
import { htmlToPlainText } from "@/lib/utils";
import { textDirection } from "@/lib/text-direction";
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

function checklistItem(type: "ticket" | "note", id: string, text: string, html: string, meta?: string) {
  // Base direction is resolved server-side from the first strong character, so
  // a Hebrew/Arabic-first line reads right-to-left even inside the static file.
  return `<li dir="${textDirection(text)}"><label><input type="checkbox" data-t="${type}" data-id="${esc(id)}"><span class="box"></span><span class="txt">${html}${
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
  return checklistItem("ticket", t.id, t.title, `${dot}${esc(t.title)}`, bits.join(" · "));
}

function noteRow(n: ExportNote): string {
  const dot = PRIORITY_DOTS[n.priority]
    ? `<i class="dot" style="background:${PRIORITY_DOTS[n.priority]}"></i>`
    : "";
  const body = n.body.length > 300 ? n.body.slice(0, 300) + "…" : n.body;
  return checklistItem("note", n.id, body, `${dot}${esc(body)}`, n.pinned ? "pinned" : undefined);
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
  // Each board is a <details> so long exports fold down to a scannable list —
  // works with zero JS; the script only persists the open/closed choice.
  const boardSections = data.boards
    .map((b) => {
      const open = b.columns.filter((c) => !c.isDone).reduce((n, c) => n + c.tickets.length, 0);
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
      return cols
        ? `<details class="board" open data-board="${esc(b.id)}"><summary><span class="chev"></span><h2>${esc(b.name)}</h2><em>${open}</em></summary><div class="board-body">${cols}</div></details>`
        : "";
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
<meta name="theme-color" content="#0a0b10">
<title>Kanbai checklist · ${esc(today)}</title>
<style>
  :root{color-scheme:dark light;
    --bg:#0a0b10;--panel:#12151c;--panel-2:#171a22;--line:#20242e;--line-2:#2c3140;
    --fg:#e9ebf1;--muted:#8b91a0;--faint:#6b7180;
    --iris:#837ffb;--iris-deep:#6d5dfb;--green:#2fd896;--green-deep:#10b981}
  *{box-sizing:border-box;margin:0}
  html{-webkit-text-size-adjust:100%}
  body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg);padding:0 14px 24px;max-width:720px;margin:0 auto}
  header{position:sticky;top:0;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);padding:14px 0 10px;border-bottom:1px solid var(--line);margin-bottom:14px;z-index:2}
  h1{font-size:17px;letter-spacing:-.01em;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
  h1 .ws{color:var(--muted);font-weight:500;font-size:13px}
  .sub{color:var(--muted);font-size:12px;margin-top:2px}
  .meter{height:5px;border-radius:99px;background:var(--line);margin-top:10px;overflow:hidden}
  .meter i{display:block;height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,var(--iris-deep),var(--green));transition:width .25s ease}
  .bar{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center}
  button{font:600 13px/1 inherit;padding:9px 14px;border-radius:10px;border:1px solid var(--line-2);background:var(--panel-2);color:var(--fg);cursor:pointer;touch-action:manipulation}
  button.primary{background:var(--iris-deep);border-color:var(--iris-deep);color:#fff}
  button:active{transform:translateY(1px)}
  #done-count{color:var(--green);font-variant-numeric:tabular-nums;font-weight:600}
  details.help{margin-top:8px;font-size:12px;color:var(--muted)}
  details.help summary{cursor:pointer;list-style:none;color:var(--faint)}
  details.help summary::before{content:"ⓘ ";}
  details.help p{margin-top:6px;line-height:1.55}
  section{margin-bottom:20px}
  .sec-title{font-size:13px;font-weight:700;letter-spacing:.02em;color:#c7cad3;display:flex;align-items:center;gap:8px;padding-bottom:6px;border-bottom:1px solid var(--line);margin-bottom:8px}
  .sec-title em{font-style:normal;font-weight:600;color:var(--faint);font-size:12px}
  details.board{margin-bottom:14px;border:1px solid var(--line);border-radius:14px;background:color-mix(in srgb,var(--panel) 55%,transparent);overflow:hidden}
  details.board summary{display:flex;align-items:center;gap:9px;list-style:none;cursor:pointer;padding:11px 14px;user-select:none;-webkit-user-select:none}
  details.board summary::-webkit-details-marker{display:none}
  details.board h2{font-size:14.5px;letter-spacing:-.005em;display:inline}
  details.board summary em{font-style:normal;color:var(--faint);font-size:12px;margin-inline-start:auto;font-variant-numeric:tabular-nums}
  .chev{flex:none;width:8px;height:8px;border:solid var(--faint);border-width:0 1.5px 1.5px 0;transform:rotate(-45deg);transition:transform .15s;margin-top:-2px}
  details.board[open]>summary .chev{transform:rotate(45deg)}
  .board-body{padding:2px 12px 12px}
  .col{margin:10px 0 2px}
  h3{font-size:11.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:6px}
  h3 em{font-style:normal;opacity:.7}
  .band{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--faint);margin:8px 0 4px 4px}
  ul{list-style:none;padding:0}
  li{margin:5px 0}
  label{display:flex;gap:10px;align-items:flex-start;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:11px 12px;cursor:pointer;transition:opacity .15s,background .15s,border-color .15s}
  label:hover{background:var(--panel-2)}
  input[type=checkbox]{position:absolute;opacity:0;pointer-events:none}
  .box{flex:none;width:22px;height:22px;border-radius:8px;border:1.5px solid #4a5063;margin-top:0;display:grid;place-items:center;transition:all .15s}
  input:checked~.box{background:var(--green-deep);border-color:var(--green-deep)}
  input:checked~.box::after{content:"";width:6px;height:11px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg) translate(-1px,-1px)}
  .txt{flex:1;min-width:0;overflow-wrap:break-word;white-space:pre-line}
  input:checked~.txt{opacity:.45;text-decoration:line-through}
  .txt small{display:block;white-space:normal;color:var(--muted);font-size:11.5px;margin-top:2px;text-decoration:none}
  .dot{display:inline-block;width:8px;height:8px;border-radius:99px;margin-inline-end:7px;vertical-align:1px}
  /* Extras — local-only tasks added from this file, saved in this browser */
  #extras-empty{color:var(--faint);font-size:12.5px;padding:2px 2px 6px}
  .x-del{flex:none;align-self:center;border:0;background:none;color:var(--faint);font-size:16px;line-height:1;padding:4px 6px;border-radius:8px;cursor:pointer}
  .x-del:hover{color:#ff6b82;background:color-mix(in srgb,#ff6b82 12%,transparent)}
  .adder{display:flex;gap:8px;margin-top:8px}
  .adder input{flex:1;min-width:0;font:15px/1.4 inherit;padding:10px 12px;border-radius:12px;border:1px solid var(--line-2);background:var(--panel);color:var(--fg);outline:none}
  .adder input:focus{border-color:var(--iris)}
  footer{color:var(--faint);font-size:12px;text-align:center;padding:24px 0 8px}
  @media (prefers-color-scheme: light){
    :root{--bg:#f7f8fb;--panel:#fff;--panel-2:#f2f3f7;--line:#e5e7ef;--line-2:#d3d6e2;--fg:#171a22;--muted:#5c6173;--faint:#8b90a3;--iris:#6d5dfb;--green:#0ea96b}
    button.primary{color:#fff}
    .sec-title{color:#3d414d}
  }
</style>
</head>
<body>
<header>
  <h1>Kanbai checklist <span class="ws">${esc(data.workspace)}</span></h1>
  <div class="sub">exported ${esc(niceDate)} · <span id="done-count">0</span>/<span id="total-count">${total}</span> done</div>
  <div class="meter" role="progressbar" aria-label="Progress"><i id="meter-fill"></i></div>
  <div class="bar">
    <button class="primary" id="dl">Download progress file</button>
    <button id="cp">Copy progress</button>
  </div>
  <details class="help">
    <summary>How this works</summary>
    <p>Work through this list anywhere — no server needed. Ticks and any tasks you add under <b>My extra tasks</b>
    are saved in this browser automatically, for as long as you need. When Kanbai is back up, download the progress
    file (or copy it) and import it in <b>Settings → Backup</b>: finished tickets move to Done, finished notes get
    marked complete, and your extra tasks come in as fresh notes.</p>
  </details>
</header>
${noteSections ? `<section><div class="sec-title">Notes <em>${openNotes.length}</em></div>${noteSections}</section>` : ""}
<section>
  <div class="sec-title">My extra tasks <em id="x-count">0</em></div>
  <div id="extras-empty">Anything new that comes up while you're offline — add it here, it survives reopening this file and imports back into Kanbai as notes.</div>
  <ul id="extras"></ul>
  <div class="adder">
    <input id="x-input" dir="auto" type="text" maxlength="10000" placeholder="Add a task…" enterkeyhint="done" autocomplete="off">
    <button id="x-add" aria-label="Add task">Add</button>
  </div>
</section>
${boardSections}
<footer>Kanbai offline checklist · keep this file somewhere safe</footer>
<script>
(function(){
  var KEY = "kanbai-checklist-${exportId}";
  var state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) {}
  // Reserved keys (can't collide with "type:id" tick keys, which contain ":").
  state.$extras = Array.isArray(state.$extras) ? state.$extras : [];
  state.$open = state.$open && typeof state.$open === "object" ? state.$open : {};
  function save(){ try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function localDay(){
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }

  var boxes = Array.prototype.slice.call(document.querySelectorAll("input[data-id]"));
  var counter = document.getElementById("done-count");
  var totalEl = document.getElementById("total-count");
  var meter = document.getElementById("meter-fill");
  function refresh(){
    var done = 0;
    boxes.forEach(function(b){ if (b.checked) done++; });
    state.$extras.forEach(function(x){ if (x.done) done++; });
    var total = boxes.length + state.$extras.length;
    counter.textContent = done;
    totalEl.textContent = total;
    meter.style.width = (total ? Math.round(done / total * 100) : 0) + "%";
    document.getElementById("x-count").textContent = state.$extras.length;
    document.getElementById("extras-empty").style.display = state.$extras.length ? "none" : "";
  }

  boxes.forEach(function(b){
    var k = b.dataset.t + ":" + b.dataset.id;
    if (state[k] && state[k].done) b.checked = true;
    b.addEventListener("change", function(){
      if (b.checked) state[k] = { done: true, doneAt: localDay() };
      else delete state[k];
      save();
      refresh();
    });
  });

  // ── Extras: local-only tasks, rendered from state ──
  var list = document.getElementById("extras");
  function renderExtras(){
    list.textContent = "";
    state.$extras.forEach(function(x){
      var li = document.createElement("li");
      li.dir = "auto";
      var label = document.createElement("label");
      var input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!x.done;
      input.addEventListener("change", function(){
        x.done = input.checked;
        x.doneAt = input.checked ? localDay() : undefined;
        save(); refresh();
      });
      var box = document.createElement("span"); box.className = "box";
      var txt = document.createElement("span"); txt.className = "txt"; txt.textContent = x.text;
      label.appendChild(input); label.appendChild(box); label.appendChild(txt);
      var del = document.createElement("button");
      del.className = "x-del"; del.textContent = "✕"; del.setAttribute("aria-label", "Remove task");
      del.addEventListener("click", function(){
        state.$extras = state.$extras.filter(function(y){ return y !== x; });
        save(); renderExtras(); refresh();
      });
      label.appendChild(del);
      li.appendChild(label);
      list.appendChild(li);
    });
  }
  var xInput = document.getElementById("x-input");
  function addExtra(){
    var text = xInput.value.trim();
    if (!text) return;
    state.$extras.push({
      id: "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text: text,
      done: false,
      createdAt: localDay()
    });
    xInput.value = "";
    save(); renderExtras(); refresh();
    xInput.focus();
  }
  document.getElementById("x-add").addEventListener("click", addExtra);
  xInput.addEventListener("keydown", function(e){ if (e.key === "Enter") { e.preventDefault(); addExtra(); } });

  // ── Board fold state persists across reopens ──
  Array.prototype.forEach.call(document.querySelectorAll("details.board"), function(d){
    var id = d.dataset.board;
    if (state.$open[id] === false) d.open = false;
    d.addEventListener("toggle", function(){ state.$open[id] = d.open; save(); });
  });

  renderExtras();
  refresh();

  function progressJson(){
    var items = [];
    boxes.forEach(function(b){
      if (!b.checked) return;
      var k = b.dataset.t + ":" + b.dataset.id;
      items.push({ type: b.dataset.t, id: b.dataset.id, done: true, doneAt: (state[k] && state[k].doneAt) || localDay() });
    });
    var extras = state.$extras.map(function(x){
      return { id: x.id, text: x.text, done: !!x.done, doneAt: x.doneAt, createdAt: x.createdAt };
    });
    return JSON.stringify({ kanbai: "progress", version: 2, exportedAt: ${JSON.stringify(data.exportedAt)}, savedAt: new Date().toISOString(), items: items, extras: extras }, null, 2);
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
