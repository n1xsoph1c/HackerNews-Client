'use client'
import { useEffect, useState } from 'react'
import { Cpu, MemoryStick, Zap } from 'lucide-react'

type Stats = {
  cpu: number | null
  ram: { used: number; total: number } | null
  gpu: { util: number; vramUsed: number; vramTotal: number } | null
  ollamaRunning: boolean
}

function Bar({ pct, danger }: { pct: number; danger?: boolean }) {
  const color = danger && pct > 80 ? 'bg-red-500' : danger && pct > 60 ? 'bg-amber-500' : 'bg-brand'
  return (
    <div className="h-1 rounded-full bg-[var(--muted)] overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function fmt(bytes: number) {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / 1024 ** 2).toFixed(0)} MB`
}

export function StatsPanel() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch('/api/stats')
        if (res.ok) setStats(await res.json())
      } catch { /* ignore */ }
    }
    poll()
    const id = setInterval(poll, 2000)
    return () => clearInterval(id)
  }, [])

  if (!stats) return null

  const { cpu, ram, gpu, ollamaRunning } = stats
  const ramPct = ram ? Math.round((ram.used / ram.total) * 100) : 0
  const vramPct = gpu ? Math.round((gpu.vramUsed / gpu.vramTotal) * 100) : 0

  return (
    <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border-color)] space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
          System
        </p>
        <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${
          ollamaRunning
            ? 'bg-green-500/10 text-green-500'
            : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
        }`}>
          {ollamaRunning ? '⚡ Ollama active' : 'Ollama idle'}
        </span>
      </div>

      {/* CPU */}
      {cpu !== null && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1 text-[var(--muted-foreground)]">
              <Cpu className="size-3" /> CPU
            </span>
            <span className={`font-mono font-medium ${cpu > 80 ? 'text-red-500' : cpu > 60 ? 'text-amber-500' : 'text-[var(--foreground)]'}`}>
              {cpu}%
            </span>
          </div>
          <Bar pct={cpu} danger />
        </div>
      )}

      {/* RAM */}
      {ram && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1 text-[var(--muted-foreground)]">
              <MemoryStick className="size-3" /> RAM
            </span>
            <span className="font-mono font-medium text-[var(--foreground)]">
              {fmt(ram.used)} / {fmt(ram.total)}
            </span>
          </div>
          <Bar pct={ramPct} danger />
        </div>
      )}

      {/* GPU */}
      {gpu ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1 text-[var(--muted-foreground)]">
              <Zap className="size-3" /> GPU
            </span>
            <span className="font-mono font-medium text-[var(--foreground)]">
              {gpu.util}% · {fmt(gpu.vramUsed)} / {fmt(gpu.vramTotal)} VRAM
            </span>
          </div>
          <Bar pct={gpu.util} />
        </div>
      ) : (
        <p className="text-xs text-[var(--muted-foreground)] italic">
          GPU metrics unavailable in this container
        </p>
      )}
    </div>
  )
}
