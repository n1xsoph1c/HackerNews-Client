import Link from 'next/link'
import { Flame } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'
import { ActiveModelChip } from './ActiveModelChip'

export function Navbar() {
  return (
    <nav className="hidden md:flex items-center justify-between px-6 py-3 border-b border-[var(--border-color)] bg-[var(--background)] sticky top-0 z-50">
      <div className="flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2 font-semibold text-brand">
          <Flame className="size-5" />
          <span>HN Reader</span>
        </Link>
        <div className="flex items-center gap-1">
          <Link href="/" className="px-3 py-1.5 text-sm rounded-md hover:bg-[var(--surface)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
            Feed
          </Link>
          <Link href="/bookmarks" className="px-3 py-1.5 text-sm rounded-md hover:bg-[var(--surface)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
            Bookmarks
          </Link>
          <Link href="/models" className="px-3 py-1.5 text-sm rounded-md hover:bg-[var(--surface)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
            Models
          </Link>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ActiveModelChip />
        <ThemeToggle />
      </div>
    </nav>
  )
}
