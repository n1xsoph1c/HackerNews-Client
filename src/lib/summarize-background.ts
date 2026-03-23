import { db } from './db'
import {
  getActiveModel,
  getOllamaClient,
  selectCommentsForSummary,
  buildRichSummaryPrompt,
  findCommentId,
  SummarySchema,
  SummaryJsonSchema,
} from './ollama'
import { fetchStoryWithComments } from './hn-api'
import { getCachedStory } from './story-cache'

// Module-level state — single Next.js process, single Ollama instance
const inFlightPromises = new Map<string, Promise<void>>()
let ollamaBusy = false

/** Returns the in-flight promise for a story+model, if one exists. */
export function getInFlightPromise(storyId: number, model: string): Promise<void> | undefined {
  return inFlightPromises.get(`${storyId}:${model}`)
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

  const commentsText = selectCommentsForSummary(comments, model)
  const prompt = buildRichSummaryPrompt(commentsText, storyTitle)
  const ollama = getOllamaClient()

  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), 120_000)

  let fullText = ''
  try {
    const response = await ollama.chat({
      model,
      messages: [{ role: 'user', content: prompt }],
      format: SummaryJsonSchema,
      stream: true,
      options: { temperature: 0 },
    })
    for await (const chunk of response) fullText += chunk.message.content
  } finally {
    clearTimeout(timeout)
  }

  await parseCacheAndStore(fullText, storyId, model, comments)
}

type WorthReadingRaw = { author: string; preview: string; why: string }

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
  const parsed = SummarySchema.parse(JSON.parse(fullText))

  const worthReadingRaw: WorthReadingRaw[] = parsed.worth_reading ?? []
  const worthReading = worthReadingRaw.map((wr) => ({
    ...wr,
    commentId: findCommentId(comments, wr.author, wr.preview),
  }))
  const keyPoints = parsed.insights.map((i) => i.title)

  const fields = {
    overview: parsed.overview,
    insights: parsed.insights,
    worthReading,
    verdict: parsed.verdict,
    sentiment: parsed.sentiment,
    keyPoints,
    summary: parsed.overview,
    model,
  }

  await db.summary.upsert({
    where: { storyId },
    update: fields,
    create: { storyId, ...fields },
  })

  return { ...fields, worthReading, keyPoints }
}
