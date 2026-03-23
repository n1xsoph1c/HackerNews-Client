import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import {
  getActiveModel,
  getOllamaClient,
  buildSummaryMessages,
  selectCommentsForSummary,
  SummarySchema,
  SummaryJsonSchema,
  findCommentId,
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

  // No cache, no in-flight — generate incrementally in up to 2 rounds:
  //   Round 1: shallow comments (from StoryCache, essentially free) → immediate summary
  //   Round 2: depth-1 replies fetched in one parallel batch → refined summary + DB cache
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
        const timeout = setTimeout(() => abort.abort(), 120_000)
        let fullText = ""
        try {
          const response = await ollama.chat({
            model,
            messages,
            format: SummaryJsonSchema,
            stream: true,
            options: { temperature: 0 },
          })
          for await (const chunk of response) {
            const thinking = (chunk.message as unknown as Record<string, unknown>).thinking
            if (thinking) emit({ type: "reasoning" })
            const token = chunk.message.content
            if (token) {
              fullText += token
              emit({ type: "token", token })
            }
          }
        } finally {
          clearTimeout(timeout)
        }
        return fullText
      }

      function parseRound1(fullText: string, comments: HNComment[]) {
        const parsed = SummarySchema.parse(JSON.parse(fullText))
        const worthReading = (parsed.worth_reading ?? []).map(wr => ({
          ...wr,
          commentId: findCommentId(comments, wr.author, wr.preview),
        }))
        return {
          overview: parsed.overview,
          insights: parsed.insights,
          worthReading,
          verdict: parsed.verdict,
          sentiment: parsed.sentiment,
          keyPoints: parsed.insights.map(i => i.title),
        }
      }

      try {
        // ── Round 1: shallow comments ──────────────────────────────────────
        emit({ type: "roundStart", round: 1, totalRounds: 2 })

        const cachedStory = await getCachedStory(storyId)
        let shallowComments = cachedStory?.comments

        if (!shallowComments) {
          // Cache miss — fetch shallow (fast: ~20-50 API calls)
          emit({ type: "phase", phase: "fetching" })
          const fetched = await fetchStoryShallow(storyId, (fetched, total) => emit({ type: "progress", fetched, total }))
          if (!fetched) {
            emit({ type: "error", message: "Story not found" })
            return
          }
          shallowComments = fetched.comments
        }

        const title = storyTitle ?? cachedStory?.story.title ?? String(storyId)

        emit({ type: "phase", phase: "thinking" })
        const round1Text = await runLLM(selectCommentsForSummary(shallowComments, model), title)

        let round1Result: ReturnType<typeof parseRound1> | null = null
        try {
          round1Result = parseRound1(round1Text, shallowComments)
          emit({ type: "roundComplete", round: 1, ...round1Result })
        } catch {
          // Round 1 parse failed — proceed to round 2 silently
        }

        // ── Round 2: depth-1 replies ───────────────────────────────────────
        const hasReplies = shallowComments.some(c => c.kids && c.kids.length > 0)

        if (!hasReplies) {
          // No replies exist — round 1 is final; cache and emit complete
          if (round1Result) {
            await parseCacheAndStore(round1Text, storyId, model, shallowComments)
            emit({ type: "complete", ...round1Result })
          } else {
            emit({ type: "error", message: "Failed to parse summary" })
          }
          return
        }

        emit({ type: "roundStart", round: 2, totalRounds: 2 })
        emit({ type: "phase", phase: "fetching" })

        const enrichedComments = await fetchDepth1ForComments(
          shallowComments,
          (fetched, total) => emit({ type: "progress", fetched, total })
        )

        emit({ type: "phase", phase: "thinking" })
        const round2Text = await runLLM(selectCommentsForSummary(enrichedComments, model), title)

        const result = await parseCacheAndStore(round2Text, storyId, model, enrichedComments)
        if (result) {
          emit({ type: "complete", ...result })
        } else if (round1Result) {
          // Round 2 parse failed — fall back to cached round 1
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
