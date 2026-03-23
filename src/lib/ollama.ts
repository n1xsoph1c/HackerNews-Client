import { Ollama } from "ollama"
import { z } from "zod"
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

// Zod schema — used for grammar-constrained generation via Ollama format param
export const SummarySchema = z.object({
  overview: z.string(),
  insights: z.array(z.object({
    title: z.string(),
    detail: z.string(),
    author: z.string().nullable(),
    type: z.enum(["fact", "debate", "warning", "tip", "counterpoint"]),
  })),
  worth_reading: z.array(z.object({
    author: z.string(),
    preview: z.string(),
    why: z.string(),
  })),
  sentiment: z.enum(["positive", "negative", "mixed", "neutral"]),
  verdict: z.string(),
})

export type SummaryOutput = z.infer<typeof SummarySchema>
export const SummaryJsonSchema = z.toJSONSchema(SummarySchema)

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
        const clean = c.text
          .replace(/<[^>]+>/g, " ")
          .replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&")
          .replace(/&#x2F;/gi, "/").replace(/&#x27;/gi, "'").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
          .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
          .replace(/\s+/g, " ").trim()
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

  // Cap each comment at 800 chars so long comments don't monopolize the budget
  const capped = all.map(c => ({ ...c, text: c.text.slice(0, 800) }))

  // Bucket by depth, sort each bucket by length descending
  const d0 = capped.filter(c => c.depth === 0).sort((a, b) => b.text.length - a.text.length)
  const d1 = capped.filter(c => c.depth === 1).sort((a, b) => b.text.length - a.text.length)
  const d2 = capped.filter(c => c.depth >= 2).sort((a, b) => b.text.length - a.text.length)

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
    if (total + line.length + 1 > budget) continue
    lines.push(line)
    total += line.length + 1
  }

  return lines.join("\n")
}

export function buildSummaryMessages(commentsText: string, storyTitle: string) {
  const lineCount = commentsText.split('\n').filter(l => l.trim()).length
  const maxInsights = Math.max(1, Math.min(5, lineCount))
  const maxWorthReading = Math.max(1, Math.min(3, lineCount))

  return [
    {
      role: "system" as const,
      content:
        "You are an expert reader and analyst of Hacker News discussions. " +
        "Your job is to distill threads into sharp, opinionated summaries that save the reader time " +
        "and surface what actually matters. You write like a thoughtful senior engineer journaling " +
        "after reading a thread — concise, direct, no filler. " +
        "Output ONLY valid JSON. Never invent authors, quotes, or topics absent from the input.",
    },
    {
      role: "user" as const,
      content:
        `Analyze this Hacker News thread and produce a JSON summary.\n\n` +
        `Story: "${storyTitle}"\n\n` +
        `FIELDS:\n` +
        `- overview: 2-3 sentences. Name the core tension or debate. What do people actually disagree about? Be specific, not generic.\n` +
        `- insights: up to ${maxInsights} items. Each insight has:\n` +
        `    title: 4-8 word headline ONLY (e.g. "CRDTs break program semantics" or "Tooling beats algorithmic fixes") — NOT a full sentence\n` +
        `    detail: 1-2 sentences elaborating with the actual claim or evidence from the comment\n` +
        `    author: exact username from comments\n` +
        `    type: pick the most fitting — "fact" (technical claim/data), "debate" (contested opinion), "warning" (risk/downside), "tip" (actionable advice), "counterpoint" (challenges the main view). Vary types across insights.\n` +
        `- worth_reading: up to ${maxWorthReading} comments worth reading in full. Use exact opening words as preview.\n` +
        `- sentiment: overall tone (positive/negative/mixed/neutral)\n` +
        `- verdict: one punchy sentence — should you read this thread, and why?\n\n` +
        (commentsText ? `Comments:\n${commentsText}` : "(No comments yet — respond accordingly)"),
    },
  ]
}

// Server-side: find a comment's ID by matching author + preview text.
// Uses progressively looser matching to handle LLM paraphrasing.
export function findCommentId(
  comments: HNComment[],
  author: string,
  preview: string
): number | null {
  const norm = (s: string) =>
    s.replace(/<[^>]+>/g, " ")
     .replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&")
     .replace(/&#x2F;/gi, "/").replace(/&#x27;/gi, "'").replace(/&quot;/g, '"')
     .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
     .replace(/\s+/g, " ").trim().toLowerCase()

  // Strip LLM-added leading quotes / trailing ellipsis
  const cleaned = norm(preview).replace(/^["'""']+/, "").replace(/[…"'""'…]+$/, "").trim()
  const n40 = cleaned.slice(0, 40)
  const n20 = cleaned.slice(0, 20)
  if (n20.length < 5) return null

  const flat = flattenAll(comments)

  // Pass 1: exact author, 40-char prefix
  for (const c of flat) {
    if (c.by === author && norm(c.text).startsWith(n40)) return c.id
  }
  // Pass 2: exact author, 40-char anywhere
  for (const c of flat) {
    if (c.by === author && norm(c.text).includes(n40)) return c.id
  }
  // Pass 3: exact author, 20-char anywhere (handles heavy paraphrasing)
  for (const c of flat) {
    if (c.by === author && norm(c.text).includes(n20)) return c.id
  }

  return null
}
