'use client'
import { useEffect, useState } from 'react'
import { Cpu } from 'lucide-react'

export function ActiveModelChip() {
  const [model, setModel] = useState<string>('')

  useEffect(() => {
    fetch('/api/ollama/active')
      .then(r => r.json())
      .then(d => setModel(d.model ?? ''))
      .catch(() => {})
  }, [])

  if (!model) return null

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--surface)] border border-[var(--border-color)] text-xs text-[var(--muted-foreground)]">
      <Cpu className="size-3" />
      <span>{model}</span>
    </div>
  )
}
