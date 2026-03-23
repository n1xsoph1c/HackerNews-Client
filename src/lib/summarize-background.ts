import { db } from './db'
import {
  getActiveModel,
  getOllamaClient,
  selectCommentsForSummary,
  buildSummaryMessages,
  parseStructuredSummary,
  findCommentId,
  isThinkingModel,
  getNumCtx,
} from './ollama'
import { fetchStoryWithComments, fetchDepth1ForComments } from './hn-api'
import { getCachedStory } from './story-cache'

// Module-level state — single Next.js process, single Ollama instance
const inFlightPromises = new Map<string, Promise<void>>()
let ollamaBusy = false

/** Returns the in-flight promise for a story+model, if one exists. */
export function getInFlightPromise(storyId: number, model: string): Promise<void> | undefined {
  return inFlightPromises.get(`${storyId}:${model}`)
}

/** Returns whether Ollama is currently busy with any summarization. */
export function isOllamaBusy(): boolean {
  return ollamaBusy
}

/**
 * Background pre-summarization. Fires from the story page server component.
 * Skips if: summary already cached, Ollama busy with another story, or job already in flight.
 * Explicit user clicks in /api/summarize bypass the ollamaBusy check and always proceed.
 */
export async function preSummarizeIfNeeded(
  storyId: number,
  storyTitle: string
): Promise<void> {
  const model = await getActiveModel()
  const key = `${storyId}:${model}`

  // Already running for this story — return same promise (dedup)
  const existing = inFlightPromises.get(key)
  if (existing) return existing

  // Ollama is busy with a different background job — skip (don't queue)
  if (ollamaBusy) return

  // Already cached and valid — nothing to do
  const cached = await db.summary.findUnique({ where: { storyId } })
  if (cached?.model === model && cached?.overview !== null) return

  // Start the job
  ollamaBusy = true
  const promise = runSummarize(storyId, storyTitle, model)
    .catch((err) => console.error('[pre-summ] error:', err))
    .finally(() => {
      inFlightPromises.delete(key)
      ollamaBusy = false
    })
  inFlightPromises.set(key, promise)
  return promise
}

async function runSummarize(storyId: number, storyTitle: string, model: string): Promise<void> {
  // Use shallow comments already in StoryCache — no extra API calls needed.
  // Falls back to full tree fetch only if cache is cold (very rare for pre-gen).
  const cachedStory = await getCachedStory(storyId)
  const comments = cachedStory?.comments ?? (await fetchStoryWithComments(storyId))?.comments
  if (!comments) return

  // Enrich with depth-1 replies for better summary quality (background has no time pressure)
  let enrichedComments = comments
  if (comments.some(c => c.kids && c.kids.length > 0)) {
    enrichedComments = await fetchDepth1ForComments(comments)
  }

  const commentsText = selectCommentsForSummary(enrichedComments, model)
  const messages = buildSummaryMessages(commentsText, storyTitle)
  const ollama = getOllamaClient()

  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), 180_000)

  let fullText = ''
  let thinkingText = ''
  try {
    const ollamaOptions: Record<string, unknown> = {
      temperature: 0,
      num_predict: 2000,
      num_ctx: getNumCtx(model),
    }
    if (isThinkingModel(model)) ollamaOptions.think = false

    const response = await ollama.chat({
      model,
      messages,
      stream: true,
      options: ollamaOptions,
    })
    for await (const chunk of response) {
      const raw = chunk.message as unknown as Record<string, unknown>
      const thinking = raw.thinking as string | undefined
      if (thinking) thinkingText += thinking
      if (chunk.message.content) fullText += chunk.message.content
    }
  } finally {
    clearTimeout(timeout)
  }
  if (!fullText && thinkingText) fullText = thinkingText

  await parseCacheAndStore(fullText, storyId, model, enrichedComments)
}

/** Shared parse + upsert logic used by both background pre-gen and the SSE route. */
export async function parseCacheAndStore(
  fullText: string,
  storyId: number,
  model: string,
  comments: NonNullable<Awaited<ReturnType<typeof fetchStoryWithComments>>>['comments']
): Promise<{
  overview: string
  insights: unknown[]
  worthReading: unknown[]
  verdict: string
  sentiment: string
  keyPoints: string[]
} | null> {
  const parsed = parseStructuredSummary(fullText)
  if (!parsed.overview && parsed.insights.length === 0) return null

  const worthReading = parsed.worthReading.map((wr) => ({
    ...wr,
    commentId: findCommentId(comments, wr.author, wr.preview),
  }))

  const fields = {
    overview: parsed.overview,
    insights: parsed.insights,
    worthReading,
    verdict: parsed.verdict,
    sentiment: parsed.sentiment,
    keyPoints: parsed.keyPoints,
    summary: parsed.overview,
    model,
  }

  await db.summary.upsert({
    where: { storyId },
    update: fields,
    create: { storyId, ...fields },
  })

  return { ...fields, worthReading, keyPoints: parsed.keyPoints }
}
