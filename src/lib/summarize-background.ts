import { db } from './db'
import {
  getActiveModel,
  getOllamaClient,
  selectCommentsForSummary,
  buildRichSummaryPrompt,
  findCommentId,
} from './ollama'
import { fetchStoryWithComments } from './hn-api'

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
  const promise = runSummarize(storyId, storyTitle, model).finally(() => {
    inFlightPromises.delete(key)
    ollamaBusy = false
  })
  inFlightPromises.set(key, promise)
  return promise
}

async function runSummarize(storyId: number, storyTitle: string, model: string): Promise<void> {
  const storyData = await fetchStoryWithComments(storyId)
  if (!storyData) return

  const commentsText = selectCommentsForSummary(storyData.comments, model)
  const prompt = buildRichSummaryPrompt(commentsText, storyTitle)
  const ollama = getOllamaClient()

  let fullText = ''
  const response = await ollama.chat({
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
    options: { temperature: 0, num_predict: 400 },
  })
  for await (const chunk of response) fullText += chunk.message.content

  await parseCacheAndStore(fullText, storyId, model, storyData.comments)
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
  const jsonMatch = fullText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  let parsed = JSON.parse(jsonMatch[0])

  // Small model double-encoding fix: overview sometimes wraps the full JSON
  if (parsed.overview && typeof parsed.overview === 'string' && parsed.overview.trim().startsWith('{')) {
    try {
      const inner = JSON.parse(parsed.overview)
      if (inner.insights || inner.worth_reading) parsed = inner
    } catch { /* not double-encoded */ }
  }

  const worthReadingRaw: WorthReadingRaw[] = parsed.worth_reading ?? []
  const worthReading = worthReadingRaw.map((wr) => ({
    ...wr,
    commentId: findCommentId(comments, wr.author, wr.preview),
  }))
  const keyPoints = (parsed.insights ?? []).map((i: { title: string }) => i.title)

  const fields = {
    overview: parsed.overview ?? '',
    insights: parsed.insights ?? [],
    worthReading,
    verdict: parsed.verdict ?? '',
    sentiment: parsed.sentiment ?? 'neutral',
    keyPoints,
    summary: parsed.overview ?? '',
    model,
  }

  await db.summary.upsert({
    where: { storyId },
    update: fields,
    create: { storyId, ...fields },
  })

  return { ...fields, worthReading, keyPoints }
}
