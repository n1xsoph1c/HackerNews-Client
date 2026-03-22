'use client'
import { useState, useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'

type Props = { onSearch: (query: string) => void; initialValue?: string }

export function SearchBar({ onSearch, initialValue = '' }: Props) {
  const [value, setValue] = useState(initialValue)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => onSearch(value), 300)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [value, onSearch])

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[var(--muted-foreground)]" />
      <Input
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="Search bookmarks..."
        className="pl-9 pr-8 bg-[var(--surface)] border-[var(--border-color)]"
      />
      {value && (
        <button
          onClick={() => setValue('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}
