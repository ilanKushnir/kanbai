import { TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MyDayCompletionPoint } from "@/lib/my-day";

/**
 * "Momentum" — the last two weeks of finished work as a stacked column chart
 * (tickets in iris, notes in aqua; series colors via --chart-* tokens that are
 * validated against both themes). Server-rendered: the hover/focus tooltip is
 * pure CSS, so the chart costs no client JS and renders identically on mobile,
 * where columns are comfortably tappable at 1/14th of the card width.
 */
export function MomentumChart({ series }: { series: MyDayCompletionPoint[] }) {
  const totals = series.map((p) => p.tickets + p.notes);
  const max = Math.max(1, ...totals);
  const windowTotal = totals.reduce((a, b) => a + b, 0);
  const todayIndex = series.length - 1;
  const bestIndex = totals.indexOf(Math.max(...totals));

  const dayLabel = (day: string, style: "narrow" | "long") =>
    new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
      ...(style === "narrow" ? { weekday: "narrow" as const } : { weekday: "short" as const, month: "short" as const, day: "numeric" as const }),
    });

  return (
    <section
      aria-label={`Momentum: ${windowTotal} items completed in the last ${series.length} days`}
      className="flex flex-col rounded-3xl border border-border bg-surface p-4 shadow-card md:p-5"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
          <TrendingUp className="h-3.5 w-3.5" />
          Momentum
        </h2>
        <span className="text-xs text-fg-subtle">last {series.length} days</span>
        <span className="ms-auto text-sm font-semibold">{windowTotal} done</span>
      </div>

      {/* Legend: two series, identity never by color alone (labels + tooltip). */}
      <div className="mt-1 flex items-center gap-3 text-[0.6875rem] text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: "var(--chart-ticket)" }} />
          Tickets
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: "var(--chart-note)" }} />
          Notes
        </span>
      </div>

      <div className="mt-3 flex h-24 items-end gap-1 border-b border-border md:h-28">
        {series.map((p, i) => {
          const total = p.tickets + p.notes;
          const isToday = i === todayIndex;
          const label = total === 1 ? "1 done" : `${total} done`;
          const detail =
            total === 0
              ? "Nothing completed"
              : [
                  p.tickets > 0 ? `${p.tickets} ${p.tickets === 1 ? "ticket" : "tickets"}` : null,
                  p.notes > 0 ? `${p.notes} ${p.notes === 1 ? "note" : "notes"}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
          return (
            <div
              key={p.day}
              tabIndex={0}
              aria-label={`${dayLabel(p.day, "long")}: ${total === 0 ? "nothing completed" : `${label} — ${detail}`}`}
              className="group relative flex h-full min-w-0 flex-1 flex-col justify-end outline-none"
            >
              {/* CSS tooltip — works for hover, keyboard focus, and mobile tap. */}
              <div
                aria-hidden
                className={cn(
                  "pointer-events-none absolute bottom-full z-10 mb-2 hidden whitespace-nowrap rounded-lg border border-border bg-surface px-2 py-1 text-[0.6875rem] shadow-md",
                  "group-hover:block group-focus-visible:block",
                  i < 3 ? "left-0" : i > series.length - 4 ? "right-0" : "left-1/2 -translate-x-1/2",
                )}
              >
                <span className="font-semibold">{dayLabel(p.day, "long")}</span>
                <span className="text-fg-muted"> · {total === 0 ? detail.toLowerCase() : `${label} — ${detail}`}</span>
              </div>

              {/* Selective direct label: today's column only. */}
              {isToday && total > 0 && (
                <span className="mb-0.5 self-center text-[0.625rem] font-semibold tabular-nums text-fg-muted">{total}</span>
              )}

              {total === 0 ? (
                // Empty-day stub: non-data ink, keeps the day's slot readable.
                <span className="mx-auto h-0.5 w-full max-w-5 rounded-full bg-surface-3" />
              ) : (
                <div className="mx-auto flex w-full max-w-5 flex-col justify-end" style={{ height: "100%" }}>
                  {p.notes > 0 && (
                    <span
                      className="w-full rounded-t-[4px]"
                      style={{ height: `${(p.notes / max) * 100}%`, background: "var(--chart-note)" }}
                    />
                  )}
                  {p.tickets > 0 && (
                    <span
                      className={cn("w-full", p.notes === 0 && "rounded-t-[4px]", p.notes > 0 && "mt-0.5")}
                      style={{ height: `${(p.tickets / max) * 100}%`, background: "var(--chart-ticket)" }}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Weekday letters; today reads as the anchor. */}
      <div aria-hidden className="mt-1 flex gap-1">
        {series.map((p, i) => (
          <span
            key={p.day}
            className={cn(
              "min-w-0 flex-1 text-center text-[0.5625rem] uppercase",
              i === todayIndex ? "font-bold text-primary" : "text-fg-subtle",
            )}
          >
            {dayLabel(p.day, "narrow")}
          </span>
        ))}
      </div>

      <p className="mt-2 text-xs text-fg-subtle">
        {windowTotal === 0
          ? "Finished tickets and notes land here — close something out today."
          : bestIndex === todayIndex
            ? "Today is your best day of the stretch."
            : `Best day: ${dayLabel(series[bestIndex].day, "long")} with ${totals[bestIndex]}.`}
      </p>

      {/* The same data as an accessible table. */}
      <table className="sr-only">
        <caption>Completed items per day, last {series.length} days</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Tickets</th>
            <th scope="col">Notes</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {series.map((p) => (
            <tr key={p.day}>
              <th scope="row">{p.day}</th>
              <td>{p.tickets}</td>
              <td>{p.notes}</td>
              <td>{p.tickets + p.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
