export default function Loading() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border-color)] space-y-3 animate-pulse"
        >
          {/* Domain chip */}
          <div className="h-4 w-24 rounded-full bg-[var(--muted)]" />
          {/* Title */}
          <div className="space-y-2">
            <div className="h-4 rounded bg-[var(--muted)]" style={{ width: `${75 + (i % 3) * 10}%` }} />
            <div className="h-4 rounded bg-[var(--muted)]" style={{ width: `${50 + (i % 4) * 8}%` }} />
          </div>
          {/* Meta row */}
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
