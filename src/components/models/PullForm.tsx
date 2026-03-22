'use client'
import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PullProgress } from './PullProgress'

type Props = { onComplete: () => void }

export function PullForm({ onComplete }: Props) {
  const [modelName, setModelName] = useState('')
  const [pulling, setPulling] = useState(false)
  const [pullingModel, setPullingModel] = useState('')

  const suggestions = ['llama3.2:3b', 'qwen2.5:3b', 'phi3.5:mini', 'llama3.1:8b', 'mistral:7b']

  function handlePull() {
    const name = modelName.trim()
    if (!name) return
    setPullingModel(name)
    setPulling(true)
    setModelName('')
  }

  function handleComplete() {
    setPulling(false)
    setPullingModel('')
    onComplete()
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-[var(--foreground)] mb-1">Pull a model</h3>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">
          Enter a model name from{' '}
          <a href="https://ollama.com/library" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
            ollama.com/library
          </a>
        </p>

        <div className="flex gap-2">
          <Input
            value={modelName}
            onChange={e => setModelName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handlePull()}
            placeholder="e.g. llama3.2:3b"
            className="bg-[var(--surface)] border-[var(--border-color)]"
            disabled={pulling}
          />
          <Button
            onClick={handlePull}
            disabled={!modelName.trim() || pulling}
            className="gap-2 bg-brand hover:bg-brand-dark text-white border-0 shrink-0"
          >
            <Download className="size-4" />
            Pull
          </Button>
        </div>

        {/* Quick suggestions */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {suggestions.map(s => (
            <button
              key={s}
              onClick={() => setModelName(s)}
              disabled={pulling}
              className="text-xs px-2 py-1 rounded-lg bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {pulling && pullingModel && (
        <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border-color)]">
          <p className="text-xs font-medium text-[var(--foreground)] mb-3">Pulling {pullingModel}...</p>
          <PullProgress model={pullingModel} onComplete={handleComplete} />
        </div>
      )}
    </div>
  )
}
