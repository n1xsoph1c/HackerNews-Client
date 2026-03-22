'use client'
import { useRouter } from 'next/navigation'

const tabs = [
  { value: 'top', label: 'Top' },
  { value: 'new', label: 'New' },
  { value: 'best', label: 'Best' },
]

export function FeedTabs({ active }: { active: string }) {
  const router = useRouter()

  return (
    <div className="flex gap-1 p-1 bg-[var(--surface)] rounded-xl w-fit">
      {tabs.map(tab => (
        <button
          key={tab.value}
          onClick={() => router.push(`/?type=${tab.value}`)}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            active === tab.value
              ? 'bg-[var(--background)] text-[var(--foreground)] shadow-sm'
              : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
