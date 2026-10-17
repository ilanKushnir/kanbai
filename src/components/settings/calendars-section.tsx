"use client";

import * as React from "react";
import { CalendarDays, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tone } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";

export type PublicFeed = { id: string; name: string; color: string; host: string };

const COLORS = ["blue", "emerald", "amber", "rose", "violet", "aqua", "iris", "slate"] as const;

/**
 * External calendars shown read-only on Plan. A feed is added by its private
 * iCal link (Google: "Secret address in iCal format"); the link is checked
 * once and then only ever used by the server — this page only sees its host.
 */
export function CalendarsSection({ initial }: { initial: PublicFeed[] }) {
  const { toast } = useToast();
  const [feeds, setFeeds] = React.useState(initial);
  const [url, setUrl] = React.useState("");
  const [adding, setAdding] = React.useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setAdding(true);
    try {
      const res = await api<{ feed: PublicFeed; feeds: PublicFeed[] }>("/api/calendar/feeds", { body: { url } });
      setFeeds(res.feeds);
      setUrl("");
      toast({ title: `Added ${res.feed.name}`, description: "It now shows on Plan.", variant: "success" });
    } catch (err) {
      toast({ title: "Couldn't add that calendar", description: err instanceof Error ? err.message : undefined, variant: "error" });
    } finally {
      setAdding(false);
    }
  }

  async function update(id: string, body: { name?: string; color?: string }) {
    try {
      setFeeds((await api<{ feeds: PublicFeed[] }>("/api/calendar/feeds", { method: "PATCH", body: { id, ...body } })).feeds);
    } catch (err) {
      toast({ title: "Couldn't save", description: err instanceof Error ? err.message : undefined, variant: "error" });
    }
  }

  async function remove(id: string) {
    try {
      setFeeds((await api<{ feeds: PublicFeed[] }>(`/api/calendar/feeds?id=${encodeURIComponent(id)}`, { method: "DELETE" })).feeds);
    } catch (err) {
      toast({ title: "Couldn't remove", description: err instanceof Error ? err.message : undefined, variant: "error" });
    }
  }

  return (
    <section id="calendars" className="mb-6 scroll-mt-6">
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">Calendars</h2>
      <div className="space-y-4 rounded-xl border border-border bg-surface p-4 shadow-card">
        <div className="text-sm">
          <div className="font-medium">Show your calendar on Plan</div>
          <p className="mt-0.5 text-fg-muted">
            Your events appear next to your tasks, read-only. In Google Calendar open <b>Settings</b> → your calendar →{" "}
            <b>Integrate calendar</b>, copy the <b>Secret address in iCal format</b> and paste it here. Works with any iCal link (iCloud, Outlook…).
          </p>
        </div>

        {feeds.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {feeds.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <CalendarDays className="h-4 w-4 shrink-0" style={{ color: tone(f.color).dot }} />
                <input
                  defaultValue={f.name}
                  dir="auto"
                  aria-label="Calendar name"
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== f.name) update(f.id, { name });
                  }}
                  className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-sm font-medium outline-none focus:bg-surface-2"
                />
                <span className="hidden text-xs text-fg-subtle sm:inline">{f.host}</span>
                <div className="flex gap-1" role="radiogroup" aria-label="Color">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      role="radio"
                      aria-checked={f.color === c}
                      aria-label={c}
                      onClick={() => update(f.id, { color: c })}
                      className={cn("h-4 w-4 rounded-full ring-offset-2 ring-offset-surface cursor-pointer", f.color === c && "ring-2 ring-fg")}
                      style={{ backgroundColor: tone(c).dot }}
                    />
                  ))}
                </div>
                <button onClick={() => remove(f.id)} className="grid h-7 w-7 place-items-center rounded-md text-fg-subtle hover:bg-danger-soft hover:text-danger cursor-pointer" aria-label={`Remove ${f.name}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={add} className="flex gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics"
            aria-label="iCal link"
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant="primary" disabled={adding || !url.trim()}>
            {adding ? "Checking…" : "Add"}
          </Button>
        </form>
        <p className="text-xs text-fg-subtle">The link is a secret: Kanbai keeps it on the server and never shows it again.</p>
      </div>
    </section>
  );
}
