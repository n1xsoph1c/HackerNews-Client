'use client'
import { useState } from 'react'
import {
  Sparkles, Loader2, ChevronDown, ChevronUp,
  Info, MessageSquare, AlertTriangle, Lightbulb, ArrowLeftRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SentimentBadge } from './SentimentBadge'
import { motion, AnimatePresence } from 'motion/react'
import { toast } from 'sonner'

type InsightType = 'fact' | 'debate' | 'warning' | 'tip' | 'counterpoint'

type Insight = {
  title: string
  detail: string
  author: string | null
  type: InsightType
}

type WorthReading = {
  author: string
  preview: string
  why: string
  commentId: number | null
}

type SummaryState = {
  streaming: boolean
  streamedText: string
  // Rich fields
  overview: string
  insights: Insight[]
  worthReading: WorthReading[]
  verdict: string
  sentiment: string
  // Legacy fallback
  keyPoints: string[]
  summary: string
  done: boolean
  error: string | null
}

const INSIGHT_ICONS: Record<InsightType, React.ReactNode> = {
  fact:         <Info className="size-3.5 shrink-0 text-blue-500" />,
  debate:       <MessageSquare className="size-3.5 shrink-0 text-amber-500" />,
  warning:      <AlertTriangle className="size-3.5 shrink-0 text-red-500" />,
  tip:          <Lightbulb className="size-3.5 shrink-0 text-green-500" />,
  counterpoint: <ArrowLeftRight className="size-3.5 shrink-0 text-purple-500" />,
}

const INSIGHT_BORDER: Record<InsightType, string> = {
  fact:         'border-l-blue-500/60',
  debate:       'border-l-amber-500/60',
  warning:      'border-l-red-500/60',
  tip:          'border-l-green-500/60',
  counterpoint: 'border-l-purple-500/60',
}

function scrollToComment(commentId: number | null) {
  if (!commentId) {
    toast('Expand parent comments to find this one')
    return
  }
  const el = document.getElementById(`comment-${commentId}`)
  if (!el) {
    toast('Comment not visible — scroll down or expand replies')
    return
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ring-2', 'ring-offset-1', 'ring-[var(--color-brand)]', 'rounded-lg')
  setTimeout(() => {
    el.classList.remove('ring-2', 'ring-offset-1', 'ring-[var(--color-brand)]', 'rounded-lg')
  }, 2000)
}

export function SummarizeButton({
  storyId,
  storyTitle,
}: {
  storyId: number
  storyTitle: string
}) {
  const [state, setState] = useState<SummaryState>({
    streaming: false,
    streamedText: '',
    overview: '',
    insights: [],
    worthReading: [],
    verdict: '',
    sentiment: '',
    keyPoints: [],
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
        body: JSON.stringify({ storyId, storyTitle }),
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
                streamedText: '',
                overview: data.overview ?? '',
                insights: data.insights ?? [],
                worthReading: data.worthReading ?? [],
                verdict: data.verdict ?? '',
                sentiment: data.sentiment ?? 'neutral',
                keyPoints: data.keyPoints ?? [],
                summary: data.summary ?? '',
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

  const { streaming, streamedText, overview, insights, worthReading, verdict, sentiment,
          keyPoints, summary, done, error } = state

  // Detect old-format summary (no overview — legacy cached result)
  const isLegacyFormat = done && !overview && (keyPoints.length > 0 || summary)

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
          <button
            onClick={() => setOpen(o => !o)}
            className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
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
            <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border-color)] space-y-4">

              {/* Streaming state — show token count progress, not raw JSON */}
              {streaming && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                    <Loader2 className="size-3.5 animate-spin shrink-0" />
                    <span>
                      {streamedText
                        ? `Thinking… (${streamedText.length} tokens)`
                        : 'Analyzing discussion…'}
                    </span>
                  </div>
                  {streamedText && (
                    <div className="flex gap-1">
                      {[0, 1, 2].map(i => (
                        <span
                          key={i}
                          className="inline-block w-1.5 h-1.5 rounded-full bg-brand animate-pulse"
                          style={{ animationDelay: `${i * 150}ms` }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Rich summary result */}
              {done && !isLegacyFormat && (
                <div className="space-y-4">
                  {/* Sentiment + overview */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <SentimentBadge sentiment={sentiment} />
                    </div>
                    {overview && (
                      <p className="text-sm text-[var(--foreground)] leading-relaxed">{overview}</p>
                    )}
                  </div>

                  {/* Insights */}
                  {insights.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                        Key Insights
                      </p>
                      <div className="space-y-2">
                        {insights.map((insight, i) => {
                          const type = (insight.type ?? 'fact') as InsightType
                          return (
                            <div
                              key={i}
                              className={`pl-3 border-l-2 ${INSIGHT_BORDER[type] ?? 'border-l-blue-500/60'} space-y-0.5`}
                            >
                              <div className="flex items-center gap-1.5">
                                {INSIGHT_ICONS[type] ?? INSIGHT_ICONS.fact}
                                <span className="text-xs font-semibold text-[var(--foreground)]">
                                  {insight.title}
                                </span>
                                {insight.author && (
                                  <span className="text-xs text-brand ml-auto shrink-0">
                                    @{insight.author}
                                  </span>
                                )}
                              </div>
                              {insight.detail && (
                                <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                                  {insight.detail}
                                </p>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Worth reading — clickable chips that scroll to comments */}
                  {worthReading.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                        Worth Reading
                      </p>
                      <div className="space-y-1.5">
                        {worthReading.map((wr, i) => (
                          <button
                            key={i}
                            onClick={() => scrollToComment(wr.commentId)}
                            className="w-full text-left p-2.5 rounded-lg border border-[var(--border-color)]
                                       hover:border-brand hover:bg-brand/5 transition-colors group"
                          >
                            <div className="flex items-baseline gap-1.5 mb-0.5">
                              <span className="text-xs font-medium text-brand shrink-0">
                                @{wr.author}
                              </span>
                              <span className="text-xs text-[var(--muted-foreground)] truncate italic">
                                &ldquo;{wr.preview}&hellip;&rdquo;
                              </span>
                            </div>
                            <p className="text-xs text-[var(--foreground)] leading-snug">{wr.why}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Verdict */}
                  {verdict && (
                    <p className="text-xs text-[var(--muted-foreground)] italic border-t border-[var(--border-color)] pt-3 leading-relaxed">
                      {verdict}
                    </p>
                  )}
                </div>
              )}

              {/* Legacy format fallback (old cached summaries) */}
              {isLegacyFormat && (
                <div className="space-y-3">
                  <SentimentBadge sentiment={sentiment} />
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
