'use client'
import { useEffect, useState, useCallback } from 'react'
import { Cpu, MemoryStick, Zap, Settings, Loader2, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

type Stats = {
  cpu: number | null
  ram: { used: number; total: number } | null
  gpu: { util: number; vramUsed: number; vramTotal: number } | null
  ollamaRunning: boolean
}

type OllamaSettings = {
  cpuLimit: number
  memoryLimitMB: number
  systemMemoryMB: number
  systemCPUCount: number
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<OllamaSettings | null>(null)
  const [localCpu, setLocalCpu] = useState(50)
  const [localMemory, setLocalMemory] = useState(4096)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)

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

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/ollama/settings')
      if (res.ok) {
        const data = await res.json()
        setSettings(data)
        setLocalCpu(data.cpuLimit)
        setLocalMemory(data.memoryLimitMB)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (settingsOpen && !settings) {
      loadSettings()
    }
  }, [settingsOpen, settings, loadSettings])

  async function applySettings() {
    setApplying(true)
    setApplied(false)
    try {
      const res = await fetch('/api/docker/ollama', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpuLimit: localCpu, memoryLimitMB: localMemory }),
      })
      if (res.ok) {
        toast.success('Resource limits updated. Ollama will restart.')
        setApplied(true)
        setTimeout(() => setApplied(false), 3000)
        loadSettings()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to apply settings')
      }
    } catch (err) {
      toast.error('Failed to apply settings')
    } finally {
      setApplying(false)
    }
  }

  if (!stats) return null

  const { cpu, ram, gpu, ollamaRunning } = stats
  const ramPct = ram ? Math.round((ram.used / ram.total) * 100) : 0
  const vramPct = gpu ? Math.round((gpu.vramUsed / gpu.vramTotal) * 100) : 0

  const hasChanges = settings && (localCpu !== settings.cpuLimit || localMemory !== settings.memoryLimitMB)

  return (
    <div className="space-y-3">
      <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border-color)] space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
            System
          </p>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${
              ollamaRunning
                ? 'bg-green-500/10 text-green-500'
                : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
            }`}>
              {ollamaRunning ? '⚡ Ollama active' : 'Ollama idle'}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => { setSettingsOpen(!settingsOpen); if (!settings) loadSettings() }}
            >
              <Settings className={`size-3.5 transition-transform ${settingsOpen ? 'rotate-45' : ''}`} />
            </Button>
          </div>
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

      {/* Resource Limits Settings */}
      {settingsOpen && settings && (
        <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border-color)] space-y-4">
          <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
            Ollama Resource Limits
          </p>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1 text-[var(--muted-foreground)]">
                <Cpu className="size-3" /> CPU Limit
              </span>
              <span className="font-mono font-medium">{localCpu}% ({Math.ceil(settings.systemCPUCount * localCpu / 100)} cores)</span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              step="10"
              value={localCpu}
              onChange={(e) => setLocalCpu(parseInt(e.target.value))}
              className="w-full h-1 bg-[var(--muted)] rounded-full appearance-none cursor-pointer accent-brand"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1 text-[var(--muted-foreground)]">
                <MemoryStick className="size-3" /> Memory Limit
              </span>
              <span className="font-mono font-medium">
                {localMemory >= 1024 ? `${(localMemory / 1024).toFixed(1)} GB` : `${localMemory} MB`}
                {settings.systemMemoryMB > 0 && (
                  <span className="text-[var(--muted-foreground)] ml-1">
                    / {settings.systemMemoryMB >= 1024 ? `${(settings.systemMemoryMB / 1024).toFixed(0)} GB` : `${settings.systemMemoryMB} MB`} system
                  </span>
                )}
              </span>
            </div>
            <input
              type="range"
              min="512"
              max={Math.min(settings.systemMemoryMB || 16384, 16384)}
              step="256"
              value={localMemory}
              onChange={(e) => setLocalMemory(parseInt(e.target.value))}
              className="w-full h-1 bg-[var(--muted)] rounded-full appearance-none cursor-pointer accent-brand"
            />
          </div>

          <Button
            onClick={applySettings}
            disabled={applying || !hasChanges}
            size="sm"
            className="w-full gap-2"
          >
            {applying ? (
              <><Loader2 className="size-3.5 animate-spin" />Applying...</>
            ) : applied ? (
              <><CheckCircle2 className="size-3.5" />Applied!</>
            ) : (
              <>Apply & Restart Ollama</>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
