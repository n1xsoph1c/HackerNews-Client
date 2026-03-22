export default function Loading() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-6 animate-pulse">
      {/* Mobile layout */}
      <div className="md:hidden space-y-6">
        {/* Story header skeleton */}
        <div className="space-y-3">
          <div className="h-4 w-16 rounded bg-[var(--muted)]" />
          <div className="h-6 rounded bg-[var(--muted)] w-full" />
          <div className="h-6 rounded bg-[var(--muted)] w-4/5" />
          <div className="flex gap-3 pt-1">
            <div className="h-3 w-12 rounded bg-[var(--muted)]" />
            <div className="h-3 w-16 rounded bg-[var(--muted)]" />
            <div className="h-3 w-14 rounded bg-[var(--muted)]" />
          </div>
          <div className="h-8 w-36 rounded-lg bg-[var(--muted)]" />
        </div>
        {/* AI button skeleton */}
        <div className="h-9 w-44 rounded-lg bg-[var(--muted)]" />
        {/* Comments skeleton */}
        <CommentSkeletons />
      </div>

      {/* Desktop two-column layout */}
      <div className="hidden md:grid md:grid-cols-[380px_1fr] gap-8">
        {/* Left panel */}
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="h-4 w-16 rounded bg-[var(--muted)]" />
            <div className="h-6 rounded bg-[var(--muted)] w-full" />
            <div className="h-6 rounded bg-[var(--muted)] w-4/5" />
            <div className="flex gap-3 pt-1">
              <div className="h-3 w-12 rounded bg-[var(--muted)]" />
              <div className="h-3 w-16 rounded bg-[var(--muted)]" />
              <div className="h-3 w-14 rounded bg-[var(--muted)]" />
            </div>
            <div className="h-8 w-36 rounded-lg bg-[var(--muted)]" />
          </div>
          {/* AI summary section */}
          <div className="border-t border-[var(--border-color)] pt-6 space-y-3">
            <div className="h-3 w-20 rounded bg-[var(--muted)]" />
            <div className="h-9 w-44 rounded-lg bg-[var(--muted)]" />
          </div>
        </div>

        {/* Right panel */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <div className="h-5 w-40 rounded bg-[var(--muted)]" />
          </div>
          <CommentSkeletons count={8} />
        </div>
      </div>
    </div>
  )
}

function CommentSkeletons({ count = 5 }: { count?: number }) {
  const widths = [90, 75, 85, 60, 80, 70, 95, 65]
  return (
    <div className="space-y-4">
      {[...Array(count)].map((_, i) => (
        <div
          key={i}
          className="pb-4 border-b border-[var(--border-color)] last:border-0 pl-3 border-l-2"
          style={{ borderLeftColor: `var(--color-depth-${i % 4})` }}
        >
          {/* Author + time */}
          <div className="flex items-center gap-2 mb-2">
            <div className="h-3 w-20 rounded bg-[var(--muted)]" />
            <div className="h-3 w-12 rounded bg-[var(--muted)]" />
          </div>
          {/* Comment text lines */}
          <div className="space-y-2">
            <div className="h-3 rounded bg-[var(--muted)]" style={{ width: `${widths[i % widths.length]}%` }} />
            <div className="h-3 rounded bg-[var(--muted)]" style={{ width: `${widths[(i + 3) % widths.length]}%` }} />
            {i % 3 === 0 && (
              <div className="h-3 rounded bg-[var(--muted)]" style={{ width: `${widths[(i + 5) % widths.length]}%` }} />
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
