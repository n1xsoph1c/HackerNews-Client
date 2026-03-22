import { Ollama } from "ollama"
import { db } from "./db"
import type { HNComment } from "./hn-api"

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

// Context budget by model family — larger models get more input chars
function getContextBudget(model: string): number {
  if (model.includes("70b") || model.includes("72b")) return 12000
  if (model.includes("7b") || model.includes("8b") || model.includes("13b")) return 6000
  return 3500  // 3b models — llama3.2:3b context is 4096 tokens (~3500 chars safe)
}

type FlatComment = { id: number; by: string; text: string; depth: number }

function flattenAll(comments: HNComment[]): FlatComment[] {
  const result: FlatComment[] = []
  function walk(items: HNComment[]) {
    for (const c of items) {
      if (c.by && c.text) {
        const clean = c.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
        if (clean.length >= 40) result.push({ id: c.id, by: c.by, text: clean, depth: c.depth })
      }
      if (c.children.length > 0) walk(c.children)
    }
  }
  walk(comments)
  return result
}

// Intelligently select comments for summarization.
// Prefers top-level comments and longer ones (more signal), samples across
// the full thread (not just the start) so the whole discussion is represented.
export function selectCommentsForSummary(
  comments: HNComment[],
  model: string
): string {
  const budget = getContextBudget(model)
  const all = flattenAll(comments)

  if (all.length === 0) return ""

  // Bucket by depth, sort each bucket by length descending
  const d0 = all.filter(c => c.depth === 0).sort((a, b) => b.text.length - a.text.length)
  const d1 = all.filter(c => c.depth === 1).sort((a, b) => b.text.length - a.text.length)
  const d2 = all.filter(c => c.depth >= 2).sort((a, b) => b.text.length - a.text.length)

  // Within each bucket, interleave beginning/middle/end for thread breadth
  function spreadSample<T>(arr: T[], take: number): T[] {
    if (arr.length <= take) return arr
    const step = Math.floor(arr.length / take)
    const result: T[] = []
    for (let i = 0; i < take; i++) result.push(arr[Math.min(i * step, arr.length - 1)])
    return result
  }

  // Budget allocation: 60% depth-0, 30% depth-1, 10% depth-2+
  const d0Take = Math.ceil(d0.length * 0.6)
  const d1Take = Math.ceil(d1.length * 0.3)
  const d2Take = Math.ceil(d2.length * 0.1)

  const pool = [
    ...spreadSample(d0, d0Take),
    ...spreadSample(d1, d1Take),
    ...spreadSample(d2, d2Take),
  ]

  // Greedy pack into budget
  const lines: string[] = []
  let total = 0
  for (const c of pool) {
    const line = `[${c.by}]: ${c.text}`
    if (total + line.length + 1 > budget) continue  // skip if too long, try next
    lines.push(line)
    total += line.length + 1
  }

  return lines.join("\n")
}

export function buildRichSummaryPrompt(commentsText: string, storyTitle: string): string {
  return `You are analyzing a Hacker News discussion. Story: "${storyTitle}"

Respond ONLY with valid JSON in this exact format:
{
  "overview": "2-3 sentences: what is this about and why does the HN community care",
  "insights": [
    {
      "title": "3-6 word label",
      "detail": "explanation — one line if obvious, up to 2 sentences with backstory if complex or technical",
      "author": "username or null if synthesized from multiple",
      "type": "fact|debate|warning|tip|counterpoint"
    }
  ],
  "worth_reading": [
    {
      "author": "username",
      "preview": "exact first 80 characters of their comment text with no HTML tags",
      "why": "one sentence: why this specific comment is worth reading"
    }
  ],
  "sentiment": "positive|negative|mixed|neutral",
  "verdict": "one opinionated sentence summing up this discussion"
}

Rules:
- insights: 4-7 items, most important first
- worth_reading: 2-4 real authors with real text (not synthesized — must exist in comments below)
- preview MUST be exact text from the comments — it is used for navigation
- Be specific: reference actual claims, tools, names, numbers from the discussion

Comments:
${commentsText}`
}

// Server-side: find a comment's ID by matching author + start of preview text
export function findCommentId(
  comments: HNComment[],
  author: string,
  preview: string
): number | null {
  const normalize = (s: string) =>
    s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().toLowerCase()
  const needle = normalize(preview).slice(0, 60)
  if (!needle) return null

  const flat = flattenAll(comments)
  for (const c of flat) {
    if (c.by === author && normalize(c.text).startsWith(needle)) {
      return c.id
    }
  }
  return null
}

// @deprecated — kept for backward compat, use selectCommentsForSummary instead
export function flattenComments(
  comments: { by?: string; text?: string; children?: unknown[] }[],
  maxChars = 1500
): string {
  const lines: string[] = []
  let total = 0
  function walk(items: { by?: string; text?: string; children?: unknown[] }[], depth = 0) {
    for (const c of items) {
      if (total >= maxChars) return
      if (c.text && c.by) {
        const clean = c.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
        const line = `[${c.by}]: ${clean}`
        if (total + line.length > maxChars) return
        lines.push(line)
        total += line.length + 1
      }
      if (c.children && depth < 3) walk(c.children as typeof comments, depth + 1)
    }
  }
  walk(comments)
  return lines.join("\n")
}

// @deprecated — kept for backward compat
export function buildSummaryPrompt(commentsText: string): string {
  return `You are analyzing a Hacker News discussion thread. Based on the comments below, provide a structured analysis.

Respond with ONLY valid JSON in this exact format:
{
  "keyPoints": ["point 1", "point 2", "point 3"],
  "sentiment": "positive" | "negative" | "mixed" | "neutral",
  "summary": "2-3 sentence overview of the discussion"
}

Comments:
${commentsText}`
}
