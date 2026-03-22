import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import {
  getActiveModel,
  getOllamaClient,
  buildRichSummaryPrompt,
  selectCommentsForSummary,
  findCommentId,
} from "@/lib/ollama"
import { fetchStoryWithComments } from "@/lib/hn-api"

export const maxDuration = 300

type WorthReadingRaw = { author: string; preview: string; why: string }

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
    const data = JSON.stringify({
      type: "complete",
      cached: true,
      // Rich fields
      overview: cached.overview,
      insights: cached.insights,
      worthReading: cached.worthReading,
      verdict: cached.verdict,
      sentiment: cached.sentiment,
      // Legacy fallback fields
      keyPoints: cached.keyPoints,
      summary: cached.summary,
    })
    return new Response(`data: ${data}\n\n`, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    })
  }

  // Fetch full comment tree for summarization (needed for smart sampling + ID resolution)
  const storyData = await fetchStoryWithComments(storyId)
  if (!storyData) {
    return new Response("Story not found", { status: 404 })
  }

  const title = storyTitle || storyData.story.title
  const commentsText = selectCommentsForSummary(storyData.comments, model)
  const prompt = buildRichSummaryPrompt(commentsText, title)
  const ollama = getOllamaClient()

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let fullText = ""
      try {
        const response = await ollama.chat({
          model,
          messages: [{ role: "user", content: prompt }],
          stream: true,
        })

        for await (const chunk of response) {
          const token = chunk.message.content
          fullText += token
          const event = `data: ${JSON.stringify({ type: "token", token })}\n\n`
          controller.enqueue(encoder.encode(event))
        }

        // Parse and cache
        try {
          const jsonMatch = fullText.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            let parsed = JSON.parse(jsonMatch[0])
            // Small models sometimes wrap the full JSON inside the "overview" field.
            // Detect and unwrap: if overview is itself a valid JSON object, use that.
            if (
              parsed.overview &&
              typeof parsed.overview === "string" &&
              parsed.overview.trim().startsWith("{")
            ) {
              try {
                const inner = JSON.parse(parsed.overview)
                if (inner.insights || inner.worth_reading) parsed = inner
              } catch { /* not double-encoded — keep original */ }
            }

            // Resolve worth_reading comment IDs server-side
            const worthReadingRaw: WorthReadingRaw[] = parsed.worth_reading ?? []
            const worthReading = worthReadingRaw.map((wr) => ({
              ...wr,
              commentId: findCommentId(storyData.comments, wr.author, wr.preview),
            }))

            // Legacy keyPoints from insights titles for backward compat
            const keyPoints = (parsed.insights ?? []).map((i: { title: string }) => i.title)

            await db.summary.upsert({
              where: { storyId },
              update: {
                overview: parsed.overview ?? "",
                insights: parsed.insights ?? [],
                worthReading,
                verdict: parsed.verdict ?? "",
                sentiment: parsed.sentiment ?? "neutral",
                keyPoints,
                summary: parsed.overview ?? "",
                model,
              },
              create: {
                storyId,
                overview: parsed.overview ?? "",
                insights: parsed.insights ?? [],
                worthReading,
                verdict: parsed.verdict ?? "",
                sentiment: parsed.sentiment ?? "neutral",
                keyPoints,
                summary: parsed.overview ?? "",
                model,
              },
            })

            const doneEvent = `data: ${JSON.stringify({
              type: "complete",
              overview: parsed.overview,
              insights: parsed.insights,
              worthReading,
              verdict: parsed.verdict,
              sentiment: parsed.sentiment,
              keyPoints,
              summary: parsed.overview,
            })}\n\n`
            controller.enqueue(encoder.encode(doneEvent))
          }
        } catch {
          // JSON parse failed — send raw text as fallback
          const doneEvent = `data: ${JSON.stringify({
            type: "complete",
            overview: fullText,
            insights: [],
            worthReading: [],
            verdict: "",
            sentiment: "neutral",
            keyPoints: [],
            summary: fullText,
          })}\n\n`
          controller.enqueue(encoder.encode(doneEvent))
        }
      } catch (err) {
        const errEvent = `data: ${JSON.stringify({ type: "error", message: String(err) })}\n\n`
        controller.enqueue(encoder.encode(errEvent))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  })
}
