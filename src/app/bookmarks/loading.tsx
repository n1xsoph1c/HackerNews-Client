export default function Loading() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4 animate-pulse">
      {/* Search bar skeleton */}
      <div className="h-10 rounded-lg bg-[var(--muted)]" />
      {/* Story card skeletons */}
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border-color)] space-y-3"
        >
          <div className="h-4 w-24 rounded-full bg-[var(--muted)]" />
          <div className="space-y-2">
            <div className="h-4 rounded bg-[var(--muted)]" style={{ width: `${70 + (i % 4) * 8}%` }} />
            <div className="h-4 rounded bg-[var(--muted)]" style={{ width: `${45 + (i % 3) * 10}%` }} />
          </div>
          <div className="flex items-center gap-3">
            <div className="h-3 w-12 rounded bg-[var(--muted)]" />
            <div className="h-3 w-16 rounded bg-[var(--muted)]" />
            <div className="h-3 w-10 rounded bg-[var(--muted)]" />
          </div>
        </div>
      ))}
    </div>
  )
}
