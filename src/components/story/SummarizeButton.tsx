'use client'
import { useState } from 'react'
import { Sparkles, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SentimentBadge } from './SentimentBadge'
import { motion, AnimatePresence } from 'motion/react'

type SummaryState = {
  streaming: boolean
  streamedText: string
  keyPoints: string[]
  sentiment: string
  summary: string
  done: boolean
  error: string | null
}

export function SummarizeButton({ storyId }: { storyId: number }) {
  const [state, setState] = useState<SummaryState>({
    streaming: false,
    streamedText: '',
    keyPoints: [],
    sentiment: '',
    summary: '',
    done: false,
    error: null,
  })
  const [open, setOpen] = useState(true)

  async function summarize() {
    setState(s => ({ ...s, streaming: true, streamedText: '', done: false, error: null }))
    setOpen(true)

    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId }),
      })

      if (!res.ok || !res.body) {
        throw new Error('Failed to connect to summary service')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value)
        const lines = text.split('\n').filter(l => l.startsWith('data: '))

        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'token') {
              setState(s => ({ ...s, streamedText: s.streamedText + data.token }))
            } else if (data.type === 'complete') {
              setState(s => ({
                ...s,
                streaming: false,
                done: true,
                keyPoints: data.keyPoints ?? [],
                sentiment: data.sentiment ?? 'neutral',
                summary: data.summary ?? s.streamedText,
                streamedText: '',
              }))
            } else if (data.type === 'error') {
              setState(s => ({ ...s, streaming: false, error: data.message }))
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      setState(s => ({ ...s, streaming: false, error: String(err) }))
    }
  }

  const { streaming, streamedText, keyPoints, sentiment, summary, done, error } = state

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          onClick={summarize}
          disabled={streaming}
          size="sm"
          className="gap-2 bg-brand hover:bg-brand-dark text-white border-0"
        >
          {streaming ? (
            <><Loader2 className="size-3.5 animate-spin" />Summarizing...</>
          ) : (
            <><Sparkles className="size-3.5" />{done ? 'Re-summarize' : 'Summarize Discussion'}</>
          )}
        </Button>
        {done && (
          <button onClick={() => setOpen(o => !o)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
            {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        )}
      </div>

      <AnimatePresence>
        {(streaming || done) && open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border-color)] space-y-3">
              {/* Streaming raw text */}
              {streaming && streamedText && (
                <p className="text-sm text-[var(--muted-foreground)] font-mono leading-relaxed whitespace-pre-wrap">
                  {streamedText}
                  <span className="inline-block w-0.5 h-4 bg-brand ml-0.5 animate-pulse" />
                </p>
              )}

              {/* Loading state */}
              {streaming && !streamedText && (
                <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Generating summary...</span>
                </div>
              )}

              {/* Complete result */}
              {done && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <SentimentBadge sentiment={sentiment} />
                  </div>
                  {keyPoints.length > 0 && (
                    <ul className="space-y-1">
                      {keyPoints.map((point, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-[var(--foreground)]">
                          <span className="text-brand mt-0.5 shrink-0">•</span>
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {summary && (
                    <p className="text-sm text-[var(--muted-foreground)] border-t border-[var(--border-color)] pt-3 leading-relaxed">
                      {summary}
                    </p>
                  )}
                </div>
              )}

              {/* Error */}
              {error && (
                <p className="text-sm text-red-500">Error: {error}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
