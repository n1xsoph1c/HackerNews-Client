import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import {
  getActiveModel,
  getOllamaClient,
  buildSummaryMessages,
  selectCommentsForSummary,
  SummaryJsonSchema,
} from "@/lib/ollama"
import { fetchStoryWithComments } from "@/lib/hn-api"
import { getInFlightPromise, parseCacheAndStore } from "@/lib/summarize-background"

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
          // Emit a waiting token so the client knows something is happening
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
            // Background job failed — fall through would require re-fetch; emit error
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

  // No cache, no in-flight — generate now (explicit user request, always proceeds)
  // fetchStoryWithComments is moved inside the stream so the HTTP response starts immediately
  const encoder = new TextEncoder()
  const ollama = getOllamaClient()

  const stream = new ReadableStream({
    async start(controller) {
      let fullText = ""
      try {
        // Signal: fetching comments from HN API
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ type: "phase", phase: "fetching" })}\n\n`
        ))

        const storyData = await fetchStoryWithComments(storyId, (fetched, total) => {
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "progress", fetched, total })}\n\n`
          ))
        })
        if (!storyData) {
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: "Story not found" })}\n\n`
          ))
          return
        }

        const title = storyTitle || storyData.story.title
        const commentsText = selectCommentsForSummary(storyData.comments, model)
        const messages = buildSummaryMessages(commentsText, title)

        // Signal: LLM is now generating
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ type: "phase", phase: "thinking" })}\n\n`
        ))

        const abort = new AbortController()
        const timeout = setTimeout(() => abort.abort(), 120_000)

        try {
          const response = await ollama.chat({
            model,
            messages,
            format: SummaryJsonSchema,
            stream: true,
            options: { temperature: 0 },
          })

          for await (const chunk of response) {
            // Thinking models (qwen3, deepseek-r1, etc.) put reasoning in message.thinking
            // and emit empty content tokens during that phase — detect and signal separately
            const thinking = (chunk.message as unknown as Record<string, unknown>).thinking
            if (thinking) {
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: "reasoning" })}\n\n`
              ))
            }

            const token = chunk.message.content
            if (token) {
              fullText += token
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: "token", token })}\n\n`
              ))
            }
          }
        } finally {
          clearTimeout(timeout)
        }

        // Parse, cache, and send complete event
        const result = await parseCacheAndStore(fullText, storyId, model, storyData.comments)
        if (result) {
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "complete", ...result })}\n\n`
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
