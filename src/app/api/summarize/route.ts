import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import {
  getActiveModel,
  getOllamaClient,
  buildSummaryMessages,
  selectCommentsForSummary,
  parseStructuredSummary,
  findCommentId,
  isThinkingModel,
  getNumCtx,
} from "@/lib/ollama"
import { fetchStoryShallow, fetchDepth1ForComments, type HNComment } from "@/lib/hn-api"
import { getCachedStory } from "@/lib/story-cache"
import { getInFlightPromise, isOllamaBusy, parseCacheAndStore } from "@/lib/summarize-background"

export const maxDuration = 300

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { storyId, storyTitle } = body

  if (!storyId) {
    return new Response("Missing storyId", { status: 400 })
  }

  const model = await getActiveModel()

  // Return cached summary if it exists for the same model AND has rich fields
  const cached = await db.summary.findUnique({ where: { storyId } })
  if (cached && cached.model === model && cached.overview !== null) {
    return sseComplete({
      cached: true,
      overview: cached.overview,
      insights: cached.insights,
      worthReading: cached.worthReading,
      verdict: cached.verdict,
      sentiment: cached.sentiment,
      keyPoints: cached.keyPoints,
      summary: cached.summary,
    })
  }

  // If background pre-gen is already running for this story, await it then serve cache
  const inFlight = getInFlightPromise(storyId, model)
  if (inFlight) {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "token", token: "" })}\n\n`
          ))
          await inFlight
          const fresh = await db.summary.findUnique({ where: { storyId } })
          if (fresh?.overview) {
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({
                type: "complete",
                overview: fresh.overview,
                insights: fresh.insights,
                worthReading: fresh.worthReading,
                verdict: fresh.verdict,
                sentiment: fresh.sentiment,
                keyPoints: fresh.keyPoints,
                summary: fresh.summary,
              })}\n\n`
            ))
          } else {
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: "Summary generation failed, please try again" })}\n\n`
            ))
          }
        } catch (err) {
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: String(err) })}\n\n`
          ))
        } finally {
          controller.close()
        }
      },
    })
    return new Response(stream, sseHeaders())
  }

  // Ollama is busy with a different story's background pre-gen — wait for it then serve cache
  // This prevents the UI from getting stuck when user clicks Summarize while pre-gen is running
  if (isOllamaBusy()) {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "token", token: "" })}\n\n`
          ))
          // Poll until ollamaBusy is false, then check for cached summary
          let timeout = 0
          while (isOllamaBusy() && timeout < 120000) {
            await new Promise(r => setTimeout(r, 500))
            timeout += 500
          }
          const fresh = await db.summary.findUnique({ where: { storyId } })
          if (fresh?.overview) {
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({
                type: "complete",
                overview: fresh.overview,
                insights: fresh.insights,
                worthReading: fresh.worthReading,
                verdict: fresh.verdict,
                sentiment: fresh.sentiment,
                keyPoints: fresh.keyPoints,
                summary: fresh.summary,
              })}\n\n`
            ))
          } else {
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: "Summary generation timed out, please try again" })}\n\n`
            ))
          }
        } catch (err) {
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: String(err) })}\n\n`
          ))
        } finally {
          controller.close()
        }
      },
    })
    return new Response(stream, sseHeaders())
  }

  // No cache, no in-flight — generate progressively in up to 3 rounds:
  //   Round 1: shallow comments (StoryCache, essentially free) → immediate draft
  //   Round 2: + depth-1 replies for first 25 parents → improved summary
  //   Round 3: + depth-1 replies for remaining parents → final quality, cached
  // Each depth-1 batch is pre-fetched in the background while the LLM generates the prior round,
  // so fetch latency is hidden inside LLM generation time.
  const BATCH_SIZE = 25
  const encoder = new TextEncoder()
  const ollama = getOllamaClient()

  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      async function runLLM(commentsText: string, title: string): Promise<string> {
        const messages = buildSummaryMessages(commentsText, title)
        const abort = new AbortController()
        const timeout = setTimeout(() => abort.abort(), 180_000)
        let fullText = ""
        let thinkingText = ""
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
            if (thinking) {
              thinkingText += thinking
              emit({ type: "reasoning" })
            }
            const token = chunk.message.content
            if (token) {
              fullText += token
              emit({ type: "token", token })
            }
          }
        } finally {
          clearTimeout(timeout)
        }
        if (!fullText && thinkingText) return thinkingText
        return fullText
      }

      function parseRound(fullText: string, comments: HNComment[]) {
        const parsed = parseStructuredSummary(fullText)
        if (!parsed.overview && parsed.insights.length === 0) return null
        const worthReading = parsed.worthReading.map(wr => ({
          ...wr,
          commentId: findCommentId(comments, wr.author, wr.preview),
        }))
        return { ...parsed, worthReading }
      }

      try {
        // ── Fetch shallow comments ─────────────────────────────────────────
        const cachedStory = await getCachedStory(storyId)
        let shallowComments = cachedStory?.comments

        if (!shallowComments) {
          emit({ type: "phase", phase: "fetching" })
          const fetched = await fetchStoryShallow(storyId, (f, t) => emit({ type: "progress", fetched: f, total: t }))
          if (!fetched) {
            emit({ type: "error", message: "Story not found" })
            return
          }
          shallowComments = fetched.comments
        }

        const title = storyTitle ?? cachedStory?.story.title ?? String(storyId)

        // Determine how many rounds based on thread size and model capability
        const parentsWithKids = shallowComments.filter(c => c.kids && c.kids.length > 0)
        const hasReplies = parentsWithKids.length > 0
        const manyParents = parentsWithKids.length > BATCH_SIZE

        let totalRounds: number
        if (!hasReplies) {
          totalRounds = 1
        } else if (manyParents) {
          totalRounds = 3
        } else {
          totalRounds = 2
        }

        // ── Round 1 ────────────────────────────────────────────────────────
        emit({ type: "roundStart", round: 1, totalRounds })

        // Pre-fetch depth-1 batch 1 in background while LLM generates round 1
        // (no progress events — hidden inside LLM thinking time)
        const batch1Promise = totalRounds > 1
          ? fetchDepth1ForComments(parentsWithKids.slice(0, BATCH_SIZE))
          : Promise.resolve([] as HNComment[])

        emit({ type: "phase", phase: "thinking" })
        const round1Text = await runLLM(selectCommentsForSummary(shallowComments, model), title)

        const round1Result = parseRound(round1Text, shallowComments)
        if (round1Result) emit({ type: "roundComplete", round: 1, ...round1Result })

        if (totalRounds === 1) {
          if (round1Result) {
            await parseCacheAndStore(round1Text, storyId, model, shallowComments)
            emit({ type: "complete", ...round1Result })
          } else {
            emit({ type: "error", message: "Failed to parse summary" })
          }
          return
        }

        // ── Round 2 ────────────────────────────────────────────────────────
        // Batch 1 fetch ran in parallel with round 1 LLM — should be ready by now
        const enrichedBatch1 = await batch1Promise
        const enrichedMap = new Map<number, HNComment>()
        for (const c of enrichedBatch1) enrichedMap.set(c.id, c)
        const round2Comments = shallowComments.map(c => enrichedMap.get(c.id) ?? c)

        emit({ type: "roundStart", round: 2, totalRounds })

        // Pre-fetch depth-1 batch 2 in background while LLM generates round 2
        const batch2Promise = totalRounds > 2
          ? fetchDepth1ForComments(parentsWithKids.slice(BATCH_SIZE))
          : Promise.resolve([] as HNComment[])

        emit({ type: "phase", phase: "thinking" })
        const round2Text = await runLLM(selectCommentsForSummary(round2Comments, model), title)

        const round2Result = parseRound(round2Text, round2Comments)
        if (round2Result) emit({ type: "roundComplete", round: 2, ...round2Result })

        if (totalRounds === 2) {
          const result = await parseCacheAndStore(round2Text, storyId, model, round2Comments)
          if (result) {
            emit({ type: "complete", ...result })
          } else if (round2Result) {
            emit({ type: "complete", ...round2Result })
          } else if (round1Result) {
            emit({ type: "complete", ...round1Result })
          } else {
            emit({ type: "error", message: "Failed to generate summary" })
          }
          return
        }

        // ── Round 3 ────────────────────────────────────────────────────────
        // Batch 2 fetch ran in parallel with round 2 LLM — should be ready by now
        const enrichedBatch2 = await batch2Promise
        for (const c of enrichedBatch2) enrichedMap.set(c.id, c)
        const round3Comments = shallowComments.map(c => enrichedMap.get(c.id) ?? c)

        emit({ type: "roundStart", round: 3, totalRounds })
        emit({ type: "phase", phase: "thinking" })
        const round3Text = await runLLM(selectCommentsForSummary(round3Comments, model), title)

        const result = await parseCacheAndStore(round3Text, storyId, model, round3Comments)
        if (result) {
          emit({ type: "complete", ...result })
        } else if (round2Result) {
          emit({ type: "complete", ...round2Result })
        } else if (round1Result) {
          emit({ type: "complete", ...round1Result })
        } else {
          emit({ type: "error", message: "Failed to generate summary" })
        }
      } catch (err) {
        emit({ type: "error", message: String(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, sseHeaders())
}

function sseHeaders() {
  return {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  }
}

function sseComplete(data: Record<string, unknown>) {
  return new Response(
    `data: ${JSON.stringify({ type: "complete", ...data })}\n\n`,
    sseHeaders()
  )
}
