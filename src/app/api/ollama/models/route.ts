import { NextResponse } from "next/server"
import { getOllamaClient } from "@/lib/ollama"

export async function GET() {
  try {
    const ollama = getOllamaClient()
    const { models } = await ollama.list()
    return NextResponse.json({ models })
  } catch (error) {
    console.error("Failed to list models:", error)
    return NextResponse.json({ models: [], error: "Ollama not reachable" }, { status: 503 })
  }
}
