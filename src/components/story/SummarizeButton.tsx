'use client'
import { useState, useEffect } from 'react'
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

type Phase = 'idle' | 'fetching' | 'thinking'

type SummaryState = {
  streaming: boolean
  phase: Phase
  isReasoning: boolean
  fetchedComments: number
  totalComments: number
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
    toast('Comment not found in loaded thread')
    return
  }

  // Fire event so collapsed ancestor Comments auto-expand
  window.dispatchEvent(new CustomEvent('hn:reveal-comment', { detail: { id: commentId } }))

  // Poll for element (expansion + reply loading is async)
  let attempts = 0
  const interval = setInterval(() => {
    const el = document.getElementById(`comment-${commentId}`)
    if (el) {
      clearInterval(interval)
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('ring-2', 'ring-offset-1', 'ring-[var(--color-brand)]', 'rounded-lg')
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-offset-1', 'ring-[var(--color-brand)]', 'rounded-lg')
      }, 2000)
    } else if (++attempts > 15) {
      clearInterval(interval)
      toast('Comment not visible — it may be beyond the loaded depth')
    }
  }, 200)
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
    phase: 'idle',
    isReasoning: false,
    fetchedComments: 0,
    totalComments: 0,
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

  // Progressive extraction — show overview + insights as they stream, before full JSON is complete
  useEffect(() => {
    const { streaming, streamedText } = state
    if (!streaming || !streamedText) return

    // Extract overview as soon as the JSON string value is closed
    const ovMatch = streamedText.match(/"overview"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    if (ovMatch && !state.overview) {
      const decoded = ovMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')
      setState(s => ({ ...s, overview: decoded }))
    }

    // Extract completed insight objects (each has at least title + type)
    const insightMatches = [
      ...streamedText.matchAll(/\{\s*"title"\s*:[^{}]*"type"\s*:\s*"[^"]*"\s*\}/g)
    ]
    if (insightMatches.length > state.insights.length) {
      try {
        const newInsights = insightMatches.map(m => JSON.parse(m[0])) as Insight[]
        setState(s => ({ ...s, insights: newInsights }))
      } catch { /* partial match — skip */ }
    }
  }, [state.streamedText]) // eslint-disable-line react-hooks/exhaustive-deps

  async function summarize() {
    setState(s => ({ ...s, streaming: true, phase: 'fetching', isReasoning: false, fetchedComments: 0, totalComments: 0, streamedText: '', overview: '', insights: [], worthReading: [], verdict: '', sentiment: '', done: false, error: null }))
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
            if (data.type === 'phase') {
              setState(s => ({ ...s, phase: data.phase as Phase }))
            } else if (data.type === 'reasoning') {
              setState(s => ({ ...s, isReasoning: true }))
            } else if (data.type === 'progress') {
              setState(s => ({ ...s, fetchedComments: data.fetched, totalComments: data.total }))
            } else if (data.type === 'token') {
              setState(s => ({ ...s, isReasoning: false, streamedText: s.streamedText + data.token }))
            } else if (data.type === 'complete') {
              setState(s => ({
                ...s,
                streaming: false,
                phase: 'idle',
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
              setState(s => ({ ...s, streaming: false, phase: 'idle', error: data.message }))
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      setState(s => ({ ...s, streaming: false, phase: 'idle', error: String(err) }))
    }
  }

  const { streaming, phase, isReasoning, fetchedComments, totalComments, streamedText, overview,
          insights, worthReading, verdict, sentiment, keyPoints, summary, done, error } = state

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

              {/* Streaming state — phase-aware with progressive reveal */}
              {streaming && (
                <div className="space-y-3">
                  {/* Fetching phase: progress bar */}
                  {phase === 'fetching' && (() => {
                    const pct = totalComments > 0 ? Math.round((fetchedComments / totalComments) * 100) : 0
                    const filled = Math.round(pct / 5)
                    const bar = '█'.repeat(filled) + '░'.repeat(20 - filled)
                    return (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                          <Loader2 className="size-3 animate-spin shrink-0" />
                          <span>Fetching discussion threads…</span>
                        </div>
                        <div className="font-mono text-xs text-[var(--muted-foreground)] tracking-tight">
                          [{bar}] {fetchedComments}/{totalComments > 0 ? totalComments : '?'}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Thinking phase: label */}
                  {phase === 'thinking' && (
                    <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                      <Loader2 className="size-3 animate-spin shrink-0" />
                      <span>
                        {streamedText
                          ? 'Building summary…'
                          : isReasoning
                          ? 'Model reasoning…'
                          : 'Analyzing comments…'}
                      </span>
                      {isReasoning && (
                        <span className="flex gap-0.5">
                          {[0, 1, 2].map(i => (
                            <span key={i} className="inline-block w-1 h-1 rounded-full bg-amber-500 animate-pulse"
                              style={{ animationDelay: `${i * 150}ms` }} />
                          ))}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Progressive overview — appears as soon as extracted from stream */}
                  {overview && (
                    <motion.p
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-sm text-[var(--foreground)] leading-relaxed"
                    >
                      {overview}
                    </motion.p>
                  )}

                  {/* Progressive insights — each fades in as parsed */}
                  {insights.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                        Key Insights
                      </p>
                      <div className="space-y-2">
                        {insights.map((insight, i) => {
                          const type = (insight.type ?? 'fact') as InsightType
                          return (
                            <motion.div
                              key={i}
                              initial={{ opacity: 0, x: -6 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: i * 0.05 }}
                              className={`pl-3 border-l-2 ${INSIGHT_BORDER[type] ?? 'border-l-blue-500/60'} space-y-0.5`}
                            >
                              <div className="flex items-center gap-1.5">
                                {INSIGHT_ICONS[type] ?? INSIGHT_ICONS.fact}
                                <span className="text-xs font-semibold text-[var(--foreground)]">{insight.title}</span>
                                {insight.author && (
                                  <span className="text-xs text-brand ml-auto shrink-0">@{insight.author}</span>
                                )}
                              </div>
                              {insight.detail && (
                                <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">{insight.detail}</p>
                              )}
                            </motion.div>
                          )
                        })}
                      </div>
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
