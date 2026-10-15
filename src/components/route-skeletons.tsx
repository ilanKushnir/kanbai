/** Page-shaped placeholders: shown by loading.tsx and, instantly, by the tab bar on tap. */

export function TodaySkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 pb-10 md:px-8 md:pt-8">
      <div className="kb-hero -mx-4 -mt-4 h-56 md:-mx-8 md:-mt-8 md:h-72 md:rounded-b-[2rem]">
        <div className="relative z-10 flex h-full flex-col justify-end gap-2 px-4 pb-4 md:px-8 md:pb-6">
          <div className="h-3 w-32 rounded bg-white/15" />
          <div className="h-8 w-56 rounded-lg bg-white/20" />
          <div className="h-4 w-64 rounded bg-white/10" />
        </div>
      </div>
      <div className="mt-6 space-y-3 lg:max-w-[calc(100%-20rem)]">
        <div className="h-12 rounded-2xl border border-border bg-surface" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 rounded-2xl border border-border bg-surface-2/60 animate-pulse-soft" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <div className="h-9 w-40 rounded-lg bg-surface-2 animate-pulse-soft" />
      <div className="mt-2 h-4 w-64 rounded bg-surface-2 animate-pulse-soft" />
      <div className="mt-6 space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-2xl border border-border bg-surface-2/60 animate-pulse-soft" style={{ animationDelay: `${i * 100}ms` }} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonFor({ href }: { href: string }) {
  return href === "/today" ? <TodaySkeleton /> : <PageSkeleton />;
}
