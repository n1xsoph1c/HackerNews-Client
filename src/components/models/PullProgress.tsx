'use client'
import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { CheckCircle2, XCircle } from 'lucide-react'

type ProgressState = {
  status: string
  completed: number
  total: number
  speedMBs: number
  etaSeconds: number
  done: boolean
  error: string | null
}

export function PullProgress({
  model,
  onComplete,
}: {
  model: string
  onComplete: () => void
}) {
  const [state, setState] = useState<ProgressState>({
    status: 'Starting...',
    completed: 0,
    total: 0,
    speedMBs: 0,
    etaSeconds: 0,
    done: false,
    error: null,
  })

  const lastUpdate = useRef<{ time: number; completed: number } | null>(null)
  const onCompleteRef = useRef(onComplete)
  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function startPull() {
      try {
        const res = await fetch('/api/ollama/pull', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model }),
          signal: controller.signal,
        })

        if (!res.ok || !res.body) throw new Error('Failed to start pull')

        const reader = res.body.getReader()
        const decoder = new TextDecoder()

        while (!cancelled) {
          const { done, value } = await reader.read()
          if (done) break

          const text = decoder.decode(value)
          const lines = text.split('\n').filter(l => l.startsWith('data: '))

          for (const line of lines) {
            try {
              const data = JSON.parse(line.slice(6))

              if (data.status === 'success') {
                setState(s => ({ ...s, done: true, status: 'Complete!' }))
                onCompleteRef.current()
                return
              }

              if (data.status === 'error') {
                setState(s => ({ ...s, error: data.error ?? 'Unknown error' }))
                return
              }

              // Calculate speed from deltas
              let speedMBs = 0
              let etaSeconds = 0
              if (data.completed && data.total) {
                const now = Date.now()
                if (lastUpdate.current) {
                  const dt = (now - lastUpdate.current.time) / 1000
                  const db = data.completed - lastUpdate.current.completed
                  if (dt > 0) {
                    speedMBs = db / dt / 1024 / 1024
                    const remaining = data.total - data.completed
                    etaSeconds = speedMBs > 0 ? remaining / (speedMBs * 1024 * 1024) : 0
                  }
                }
                lastUpdate.current = { time: now, completed: data.completed }
              }

              setState(s => ({
                ...s,
                status: data.status ?? s.status,
                completed: data.completed ?? s.completed,
                total: data.total ?? s.total,
                speedMBs: speedMBs || s.speedMBs,
                etaSeconds: etaSeconds || s.etaSeconds,
              }))
            } catch { /* skip */ }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setState(s => ({ ...s, error: String(err) }))
        }
      }
    }

    startPull()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [model])

  const { status, completed, total, speedMBs, etaSeconds, done, error } = state
  const pct = total > 0 ? (completed / total) * 100 : 0

  function formatBytes(bytes: number) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  }

  function formatEta(seconds: number) {
    if (seconds < 60) return `${Math.round(seconds)}s`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-500">
        <XCircle className="size-4" />
        <span>Error: {error}</span>
      </div>
    )
  }

  if (done) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-500">
        <CheckCircle2 className="size-4" />
        <span>{model} installed successfully</span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
        <span className="capitalize">{status}</span>
        <span>{Math.round(pct)}%</span>
      </div>

      <div className="h-1.5 rounded-full bg-[var(--muted)] overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-brand"
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
        <span>
          {total > 0 ? `${formatBytes(completed)} / ${formatBytes(total)}` : '...'}
        </span>
        <div className="flex items-center gap-2">
          {speedMBs > 0 && <span>{speedMBs.toFixed(1)} MB/s</span>}
          {etaSeconds > 0 && <span>ETA: {formatEta(etaSeconds)}</span>}
        </div>
      </div>
    </div>
  )
}
