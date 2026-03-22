import { Ollama } from "ollama"
import { db } from "./db"

export function getOllamaClient() {
  return new Ollama({ host: process.env.OLLAMA_BASE_URL ?? "http://ollama:11434" })
}

export async function getActiveModel(): Promise<string> {
  try {
    const setting = await db.setting.findUnique({ where: { key: "active_model" } })
    return setting?.value ?? process.env.OLLAMA_MODEL ?? "llama3.2:3b"
  } catch {
    return process.env.OLLAMA_MODEL ?? "llama3.2:3b"
  }
}

export function buildSummaryPrompt(commentsText: string): string {
  return `You are analyzing a Hacker News discussion thread. Based on the comments below, provide a structured analysis.

Respond with ONLY valid JSON in this exact format:
{
  "keyPoints": ["point 1", "point 2", "point 3"],
  "sentiment": "positive" | "negative" | "mixed" | "neutral",
  "summary": "2-3 sentence overview of the discussion"
}

Rules:
- keyPoints: 3-5 bullet points of the most discussed topics/ideas
- sentiment: overall emotional tone of the discussion
- summary: concise overview, no fluff

Comments:
${commentsText}`
}

export function flattenComments(comments: { by?: string; text?: string; children?: unknown[] }[], maxChars = 1500): string {
  const lines: string[] = []
  let total = 0

  function walk(items: { by?: string; text?: string; children?: unknown[] }[], depth = 0) {
    for (const c of items) {
      if (total >= maxChars) return
      if (c.text && c.by) {
        const clean = c.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        const line = `[${c.by}]: ${clean}`
        if (total + line.length > maxChars) return
        lines.push(line)
        total += line.length + 1
      }
      if (c.children && depth < 3) walk(c.children as { by?: string; text?: string; children?: unknown[] }[], depth + 1)
    }
  }

  walk(comments)
  return lines.join('\n')
}
