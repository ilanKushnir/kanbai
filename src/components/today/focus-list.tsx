"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { SyncIndicator } from "@/components/sync-indicator";
import { FocusToggle } from "@/components/focus-mode";
import { cn } from "@/lib/utils";
import { addDays, parseYmd, ymd } from "@/lib/notes-schedule";
import { greetingFor, LOCALE, type SectionKey, type TaskItem, type TodayModel } from "@/lib/today-model";

/**
 * Today in focus: today and tomorrow, nothing else in sight. The rest of the
 * week opens on demand, and only then everything after it. A "+" jots a task
 * down without deciding anything — it waits in Inbox.
 */
export function FocusList({
  model,
  now,
  name,
  renderRow,
  composer,
}: {
  model: TodayModel;
  now: Date;
  name?: string | null;
  renderRow: (item: TaskItem, showDay: boolean) => React.ReactNode;
  /** The add box; `onAdded` reports each task it adds. */
  composer: (onAdded: (title: string, day: string | null) => void) => React.ReactNode;
}) {
  const [depth, setDepth] = React.useState<0 | 1 | 2>(0);
  const [showDone, setShowDone] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const mounted = React.useSyncExternalStore(noop, () => true, () => false);
  const [added, setAdded] = React.useState<{ title: string; day: string | null }[]>([]);

  const get = (k: SectionKey) => model.sections.find((s) => s.key === k)!;
  const overdue = get("overdue").items;
  const today = get("today").items;
  const tomorrow = get("tomorrow");
  const week = get("week");
  const later = get("later").items;
  const inbox = get("inbox").items;
  const done = get("done").items;

  const left = overdue.length + today.length;
  const doneCount = done.length;
  const total = left + doneCount;
  const { greeting } = greetingFor(now, name);
  const dateLabel = now.toLocaleDateString(LOCALE, { weekday: "long", month: "long", day: "numeric" });
  const tomorrowDate = addDays(parseYmd(model.todayYmd), 1);
  const restCount = later.length + inbox.length;

  return (
    <div className="kb-focus">
      <header className="sticky top-0 z-20 -mx-4 flex items-center gap-3 bg-bg/90 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3 backdrop-blur-md md:-mx-8 md:px-8">
        <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-fg-subtle">{dateLabel}</span>
        <div className="ml-auto flex items-center gap-2">
          <SyncIndicator />
          <FocusToggle showLabel />
        </div>
      </header>

      <div className="mx-auto w-full max-w-[38rem] pb-32">
        {/* The day in one line, and how far along it is. */}
        <div className="pt-6 pb-7 md:pt-12">
          <h1 className="font-display text-[2.1rem] font-medium leading-[1.05] tracking-tight md:text-[2.6rem]">{greeting}</h1>
          <p className="mt-2 text-[0.95rem] text-fg-muted">
            {left === 0 ? (doneCount ? `All clear — ${doneCount} done today.` : "Nothing left for today.") : `${left} to do today${doneCount ? ` · ${doneCount} done` : ""}`}
          </p>
          {total > 0 && (
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={doneCount} aria-label="Done today">
              <div className="h-full rounded-full bg-success transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ width: `${(doneCount / total) * 100}%` }} />
            </div>
          )}
        </div>

        {/* Today — the one card. Anything late leads it. */}
        <section className="kb-focus-today rounded-[1.5rem] border border-border bg-surface px-2 pt-3 pb-2">
          <BlockHead label="Today" count={left} />
          {left === 0 ? (
            <div className="flex items-center gap-3 px-3 pt-1 pb-4 text-sm text-fg-muted">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-success-soft text-success">
                <Check className="h-4 w-4" strokeWidth={2.5} />
              </span>
              {doneCount ? "That's everything for today." : "A free day. Tomorrow is below."}
            </div>
          ) : (
            <>
              {overdue.map((it) => (
                <React.Fragment key={it.id}>{renderRow(it, true)}</React.Fragment>
              ))}
              {today.map((it) => (
                <React.Fragment key={it.id}>{renderRow(it, false)}</React.Fragment>
              ))}
            </>
          )}
        </section>

        {/* Tomorrow — quieter, outside the card. */}
        <section className="mt-6 px-2">
          <BlockHead label="Tomorrow" sub={tomorrowDate.toLocaleDateString(LOCALE, { weekday: "long" })} count={tomorrow.items.length} />
          {tomorrow.items.length === 0 ? (
            <p className="px-3 pb-2 text-sm text-fg-subtle">Nothing yet.</p>
          ) : (
            tomorrow.items.map((it) => <React.Fragment key={it.id}>{renderRow(it, false)}</React.Fragment>)
          )}
        </section>

        {/* Further out: one step at a time. */}
        <div className="mt-6 space-y-2">
          {depth >= 1 ? (
            <section className="animate-fade-in px-2">
              <BlockHead label="This week" count={week.items.length} onCollapse={() => setDepth(0)} />
              {week.items.length === 0 && <p className="px-3 pb-2 text-sm text-fg-subtle">Nothing else this week.</p>}
              {week.groups?.map((g) => (
                <div key={g.day} className="mb-1">
                  <div className="flex items-baseline gap-2 px-3 pt-2 pb-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">{g.label}</span>
                    <span className="text-[0.6875rem] text-fg-subtle">{g.sublabel}</span>
                  </div>
                  {g.items.map((it) => (
                    <React.Fragment key={it.id}>{renderRow(it, false)}</React.Fragment>
                  ))}
                </div>
              ))}
            </section>
          ) : (
            <Reveal
              label="The rest of the week"
              hint={week.groups?.length ? week.groups.map((g) => parseYmd(g.day).toLocaleDateString(LOCALE, { weekday: "short" })).join(" · ") : "Nothing planned"}
              count={week.items.length}
              onClick={() => setDepth(1)}
            />
          )}

          {depth >= 1 &&
            (depth === 2 ? (
              <section className="animate-fade-in mt-4 px-2">
                <BlockHead label="Everything else" count={restCount} onCollapse={() => setDepth(1)} />
                {restCount === 0 && <p className="px-3 pb-2 text-sm text-fg-subtle">That&apos;s all there is.</p>}
                {later.length > 0 && <SubHead label="Later" />}
                {later.map((it) => (
                  <React.Fragment key={it.id}>{renderRow(it, true)}</React.Fragment>
                ))}
                {inbox.length > 0 && <SubHead label="Inbox" />}
                {inbox.map((it) => (
                  <React.Fragment key={it.id}>{renderRow(it, false)}</React.Fragment>
                ))}
              </section>
            ) : (
              <Reveal
                label="Everything else"
                hint={[later.length && `${later.length} later`, inbox.length && `${inbox.length} in Inbox`].filter(Boolean).join(" · ") || "Nothing more"}
                count={restCount}
                onClick={() => setDepth(2)}
              />
            ))}
        </div>

        {doneCount > 0 && (
          <section className="mt-8 px-2">
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              aria-expanded={showDone}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-fg-subtle transition-colors hover:text-fg cursor-pointer"
            >
              <Check className="h-4 w-4 text-success" />
              {doneCount} done today
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showDone && "rotate-180")} />
            </button>
            {showDone && (
              <div className="animate-fade-in">
                {done.map((it) => (
                  <React.Fragment key={it.id}>{renderRow(it, false)}</React.Fragment>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Portaled: the page wrapper's entrance animation would pin a fixed button to it. */}
      {mounted &&
        createPortal(
          <button
            type="button"
            onClick={() => setAdding(true)}
            aria-label="Add a task"
            className="kb-focus-fab fixed right-5 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-30 grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-fg transition-transform hover:scale-105 active:scale-95 cursor-pointer md:right-8 md:bottom-8"
          >
            <Plus className="h-6 w-6" strokeWidth={2.25} />
          </button>,
          document.body,
        )}

      <Modal
        open={adding}
        onClose={() => {
          setAdding(false);
          setAdded([]);
        }}
        title="Jot it down"
        description="It waits in Inbox until you give it a day."
        size="md"
      >
        <div className="px-5 pb-5">
          {composer((title, day) => setAdded((a) => [...a, { title, day }]))}
          {added.length > 0 && (
            <ul className="mt-3 space-y-1">
              {added.map((a, i) => (
                <li key={i} className="animate-row-in flex items-center gap-2 px-1 text-sm text-fg-muted">
                  <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                  <span className="truncate" dir="auto">{a.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-fg-subtle">{whereLabel(a.day, model.todayYmd)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </div>
  );
}

const noop = () => () => {};

function whereLabel(day: string | null, todayYmd: string) {
  if (!day) return "Inbox";
  if (day === todayYmd) return "Today";
  if (day === ymd(addDays(parseYmd(todayYmd), 1))) return "Tomorrow";
  return parseYmd(day).toLocaleDateString(LOCALE, { weekday: "short", month: "short", day: "numeric" });
}

function BlockHead({ label, sub, count, onCollapse }: { label: string; sub?: string; count: number; onCollapse?: () => void }) {
  return (
    <div className="flex items-baseline gap-2 px-3 pb-1.5">
      <h2 className="font-display text-[1.3rem] font-medium leading-none">{label}</h2>
      {sub && <span className="text-xs text-fg-subtle">{sub}</span>}
      <span className="ml-auto text-xs tabular-nums text-fg-subtle">{count || ""}</span>
      {onCollapse && (
        <button type="button" onClick={onCollapse} aria-label={`Hide ${label.toLowerCase()}`} className="grid h-6 w-6 place-items-center self-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg cursor-pointer">
          <ChevronDown className="h-4 w-4 rotate-180" />
        </button>
      )}
    </div>
  );
}

function SubHead({ label }: { label: string }) {
  return <div className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">{label}</div>;
}

/** A closed door: what's behind it, in one line. */
function Reveal({ label, hint, count, onClick }: { label: string; hint: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-3 text-left transition-colors hover:border-border-strong hover:bg-surface cursor-pointer"
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-fg-subtle transition-colors group-hover:text-fg">
        <ChevronDown className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg">{label}</span>
        <span className="block truncate text-xs text-fg-subtle">{hint}</span>
      </span>
      {count > 0 && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[0.6875rem] font-semibold tabular-nums text-fg-muted">{count}</span>}
    </button>
  );
}
