'use client'
import { useState } from 'react'
import { CheckCircle2, Cpu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { motion } from 'motion/react'

type OllamaModel = {
  name: string; size: number; modified_at: string; digest: string;
  details?: { parameter_size?: string; quantization_level?: string }
}

type Props = {
  model: OllamaModel
  isActive: boolean
  onSetActive: (name: string) => Promise<void>
}

export function ModelCard({ model, isActive, onSetActive }: Props) {
  const [loading, setLoading] = useState(false)

  async function handleSetActive() {
    setLoading(true)
    await onSetActive(model.name).finally(() => setLoading(false))
  }

  function formatSize(bytes: number) {
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  }

  return (
    <motion.div
      layout
      className={`p-4 rounded-xl border transition-all duration-200 ${
        isActive
          ? 'bg-brand/5 border-brand/30'
          : 'bg-[var(--card-bg)] border-[var(--border-color)] hover:bg-[var(--surface)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 p-1.5 rounded-lg ${isActive ? 'bg-brand/15' : 'bg-[var(--surface)]'}`}>
            <Cpu className={`size-4 ${isActive ? 'text-brand' : 'text-[var(--muted-foreground)]'}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-[var(--foreground)]">{model.name}</h3>
              {isActive && (
                <span className="flex items-center gap-1 text-xs text-brand">
                  <CheckCircle2 className="size-3" />
                  Active
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <span className="text-xs text-[var(--muted-foreground)]">{formatSize(model.size)}</span>
              {model.details?.parameter_size && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)]">
                  {model.details.parameter_size}
                </span>
              )}
              {model.details?.quantization_level && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)]">
                  {model.details.quantization_level}
                </span>
              )}
            </div>
          </div>
        </div>

        {!isActive && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleSetActive}
            disabled={loading}
            className="shrink-0 text-xs"
          >
            {loading ? 'Setting...' : 'Set Active'}
          </Button>
        )}
      </div>
    </motion.div>
  )
}
