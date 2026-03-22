import { NextRequest } from "next/server"

export const maxDuration = 1800

export async function POST(request: NextRequest) {
  const { model } = await request.json()

  if (!model) {
    return new Response("Missing model name", { status: 400 })
  }

  const ollamaUrl = process.env.OLLAMA_BASE_URL ?? "http://ollama:11434"
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const res = await fetch(`${ollamaUrl}/api/pull`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: model }),
        })

        if (!res.ok) {
          throw new Error(`Ollama returned ${res.status}`)
        }

        const reader = res.body!.getReader()
        const dec = new TextDecoder()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = dec.decode(value)
          const lines = text.split("\n").filter(Boolean)

          for (const line of lines) {
            try {
              const parsed = JSON.parse(line)
              const event = `data: ${JSON.stringify(parsed)}\n\n`
              controller.enqueue(encoder.encode(event))
            } catch {
              // skip malformed lines
            }
          }
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: "success" })}\n\n`))
      } catch (err) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: "error", error: String(err) })}\n\n`))
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
