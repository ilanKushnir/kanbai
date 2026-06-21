"use client";

import * as React from "react";
import Link from "next/link";
import { Search, Loader2, NotebookPen, Columns3, Ticket, Hash, ArrowUpRight } from "lucide-react";
import { tone } from "@/components/ui/badge";
import { priorityMeta } from "@/lib/display";

type SearchResults = {
  boards: { id: string; name: string; slug: string; color: string }[];
  tickets: { id: string; title: string; priority: string; boardSlug: string; boardName: string; column: string }[];
  notes: { id: string; body: string; status: string }[];
};

const EMPTY: SearchResults = { boards: [], tickets: [], notes: [] };

export function SearchPage() {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResults>(EMPTY);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  React.useEffect(() => {
    const q = query.trim();
    setError(null);
    if (!q) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error("Search failed");
        setResults(await res.json());
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError("Couldn't search. Try again.");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 160);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [query]);

  const total = results.boards.length + results.tickets.length + results.notes.length;
  const hasQuery = query.trim().length > 0;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5 md:px-6 md:py-8">
      <header className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Search</h1>
        <p className="mt-1 text-sm text-fg-muted">Find boards, tickets, and notes across your workspace.</p>
      </header>

      <div className="sticky top-2 z-10 rounded-2xl border border-border bg-surface/95 p-2 shadow-card backdrop-blur md:top-4">
        <label className="flex items-center gap-2 rounded-xl bg-surface-2 px-3">
          <Search className="h-5 w-5 shrink-0 text-fg-subtle" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search boards, tickets, notes…"
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-fg-subtle"
            inputMode="search"
            enterKeyHint="search"
          />
          {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-fg-subtle" />}
        </label>
      </div>

      <div className="mt-5 space-y-5 pb-6">
        {!hasQuery ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface/50 px-4 py-8 text-center">
            <Search className="mx-auto h-7 w-7 text-fg-subtle" />
            <p className="mt-2 text-sm font-medium text-fg">Start typing to search everything.</p>
            <p className="mt-1 text-xs text-fg-subtle">Results match the desktop global search.</p>
          </div>
        ) : error ? (
          <p className="rounded-xl border border-danger/25 bg-danger-soft/40 px-3 py-2 text-sm text-danger">{error}</p>
        ) : total === 0 && !loading ? (
          <p className="rounded-xl border border-border bg-surface px-3 py-6 text-center text-sm text-fg-subtle">No results for “{query.trim()}”.</p>
        ) : (
          <>
            <ResultSection title="Boards" icon={Columns3} count={results.boards.length}>
              {results.boards.map((b) => (
                <ResultLink key={b.id} href={`/boards/${b.slug}`} icon={<span className="h-3 w-3 rounded-full" style={{ backgroundColor: tone(b.color).dot }} />} title={b.name} subtitle="Board" />
              ))}
            </ResultSection>

            <ResultSection title="Tickets" icon={Ticket} count={results.tickets.length}>
              {results.tickets.map((t) => (
                <ResultLink
                  key={t.id}
                  href={`/boards/${t.boardSlug}?ticket=${t.id}`}
                  icon={<span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: priorityMeta(t.priority).color }} />}
                  title={t.title}
                  subtitle={`${t.boardName}${t.column ? ` · ${t.column}` : ""}`}
                />
              ))}
            </ResultSection>

            <ResultSection title="Notes" icon={NotebookPen} count={results.notes.length}>
              {results.notes.map((n) => (
                <ResultLink key={n.id} href={`/notes?focus=${n.id}`} icon={<Hash className="h-4 w-4 text-fg-subtle" />} title={n.body} subtitle={`Note · ${n.status}`} />
              ))}
            </ResultSection>
          </>
        )}
      </div>
    </div>
  );
}

function ResultSection({
  title,
  icon: Icon,
  count,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
        <Icon className="h-3.5 w-3.5" />
        {title}
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[0.625rem]">{count}</span>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">{children}</div>
    </section>
  );
}

function ResultLink({ href, icon, title, subtitle }: { href: string; icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <Link
      href={href}
      className="group flex min-h-14 items-center gap-3 border-b border-border/60 px-3 py-2.5 transition-colors last:border-b-0 hover:bg-surface-2/60"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-fg">{title}</span>
        <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-fg-subtle">{subtitle}</span>
      </span>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-fg-subtle transition-colors group-hover:text-fg-muted" />
    </Link>
  );
}
