'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { ModelCard } from '@/components/models/ModelCard'
import { PullForm } from '@/components/models/PullForm'
import { PullProgress } from '@/components/models/PullProgress'
import { StatsPanel } from '@/components/models/StatsPanel'
import { Separator } from '@/components/ui/separator'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

type OllamaModel = {
  name: string; size: number; modified_at: string; digest: string;
  details?: { parameter_size?: string; quantization_level?: string }
}

export default function ModelsPage() {
  const [models, setModels] = useState<OllamaModel[]>([])
  const [activeModel, setActiveModel] = useState('')
  const [loading, setLoading] = useState(true)
  const [ollamaDown, setOllamaDown] = useState(false)
  const [startupModel, setStartupModel] = useState<string | null>(null)
  const [autoPulling, setAutoPulling] = useState(false)
  const [pullingModel, setPullingModel] = useState<string | null>(null)
  const isInitialMount = useRef(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [modelsRes, activeRes] = await Promise.all([
        fetch('/api/ollama/models'),
        fetch('/api/ollama/active'),
      ])
      const modelsData = await modelsRes.json()
      const activeData = await activeRes.json()

      if (modelsRes.status === 503) {
        setOllamaDown(true)
      } else {
        setOllamaDown(false)
        const installed: OllamaModel[] = modelsData.models ?? []
        setModels(installed)
        const sm: string | null = modelsData.startupModel ?? null
        setStartupModel(sm)
        // Only trigger auto-pull on initial mount, not on refresh, and only if not already pulling
        if (isInitialMount.current && sm && !installed.some(m => m.name === sm) && !pullingModel) {
          setAutoPulling(true)
          setPullingModel(sm)
        }
      }
      setActiveModel(activeData.model ?? '')
    } catch {
      setOllamaDown(true)
    } finally {
      setLoading(false)
      isInitialMount.current = false
    }
  }, [pullingModel])

  useEffect(() => { refresh() }, [refresh])

  function handlePullComplete() {
    setAutoPulling(false)
    setPullingModel(null)
    refresh()
  }

  async function handleSetActive(modelName: string) {
    await fetch('/api/ollama/active', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName }),
    })
    setActiveModel(modelName)
    // If user sets active to a model we're pulling, clear the pulling state
    if (pullingModel === modelName) {
      setPullingModel(null)
      setAutoPulling(false)
    }
    toast.success(`Active model set to ${modelName}`)
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Models</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
            Manage Ollama models for AI summaries
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={refresh} className="size-9">
          <RefreshCw className="size-4" />
        </Button>
      </div>

      <div className="mb-6">
        <StatsPanel />
      </div>

      {ollamaDown && (
        <div className="p-4 mb-6 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-500">
          Ollama is not reachable. Make sure the service is running.
        </div>
      )}

      {/* Auto-pull startup model */}
      {autoPulling && startupModel && (
        <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border-color)] mb-4">
          <p className="text-xs font-medium text-[var(--foreground)] mb-3">
            Downloading startup model: {startupModel}
          </p>
          <PullProgress
            model={startupModel}
            onComplete={handlePullComplete}
          />
        </div>
      )}

      {/* Pull new model */}
      <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border-color)] mb-6">
        <PullForm onComplete={refresh} />
      </div>

      <Separator className="my-4 bg-[var(--border-color)]" />

      {/* Installed models */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">
          Installed Models
        </h2>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-[var(--muted-foreground)]" />
          </div>
        ) : models.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)] py-8 text-center">
            No models installed yet. Pull one above.
          </p>
        ) : (
          <div className="space-y-2">
            {models.map(model => (
              <ModelCard
                key={model.digest}
                model={model}
                isActive={model.name === activeModel}
                onSetActive={handleSetActive}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
