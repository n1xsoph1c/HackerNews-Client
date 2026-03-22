import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { getActiveModel, getOllamaClient, buildSummaryPrompt, flattenComments } from "@/lib/ollama"
import { fetchStoryWithComments } from "@/lib/hn-api"

export const maxDuration = 300

export async function POST(request: NextRequest) {
  const { storyId } = await request.json()

  if (!storyId) {
    return new Response("Missing storyId", { status: 400 })
  }

  const model = await getActiveModel()

  // Return cached summary if exists for same model
  const cached = await db.summary.findUnique({ where: { storyId } })
  if (cached && cached.model === model) {
    const data = JSON.stringify({
      type: "complete",
      keyPoints: cached.keyPoints,
      sentiment: cached.sentiment,
      summary: cached.summary,
      cached: true,
    })
    return new Response(`data: ${data}\n\n`, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    })
  }

  // Fetch comments
  const storyData = await fetchStoryWithComments(storyId)
  if (!storyData) {
    return new Response("Story not found", { status: 404 })
  }

  const commentsText = flattenComments(storyData.comments)
  const prompt = buildSummaryPrompt(commentsText)
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

        // Parse and cache the final JSON result
        try {
          const jsonMatch = fullText.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0])
            await db.summary.upsert({
              where: { storyId },
              update: {
                keyPoints: parsed.keyPoints ?? [],
                sentiment: parsed.sentiment ?? "neutral",
                summary: parsed.summary ?? "",
                model,
              },
              create: {
                storyId,
                keyPoints: parsed.keyPoints ?? [],
                sentiment: parsed.sentiment ?? "neutral",
                summary: parsed.summary ?? "",
                model,
              },
            })
            const doneEvent = `data: ${JSON.stringify({ type: "complete", ...parsed })}\n\n`
            controller.enqueue(encoder.encode(doneEvent))
          }
        } catch {
          // If JSON parse fails, send raw text
          const doneEvent = `data: ${JSON.stringify({ type: "complete", summary: fullText, keyPoints: [], sentiment: "neutral" })}\n\n`
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
