export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <div className="h-7 w-40 rounded-lg bg-surface-2 animate-pulse-soft" />
      <div className="mt-2 h-4 w-64 rounded bg-surface-2 animate-pulse-soft" />
      <div className="mt-6 space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-2xl border border-border bg-surface-2/60 animate-pulse-soft" />
        ))}
      </div>
    </div>
  );
}
