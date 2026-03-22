'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Flame, Bookmark, Cpu } from 'lucide-react'

const links = [
  { href: '/', icon: Flame, label: 'Feed' },
  { href: '/bookmarks', icon: Bookmark, label: 'Saved' },
  { href: '/models', icon: Cpu, label: 'Models' },
]

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[var(--background)]/80 backdrop-blur-xl border-t border-[var(--border-color)] safe-area-bottom">
      <div className="flex">
        {links.map(({ href, icon: Icon, label }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs transition-colors ${
                active ? 'text-brand' : 'text-[var(--muted-foreground)]'
              }`}
            >
              <Icon className="size-5" />
              <span>{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
