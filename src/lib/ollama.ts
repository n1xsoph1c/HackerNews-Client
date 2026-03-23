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

// Context budget — chars of comment text to feed the LLM per round.
// Budget = (num_ctx - 2500 prompt tokens - 2000 output tokens) * 3.5 chars/token, rounded down.
// 3-round progressive approach means even a 16k budget covers the most signal-rich comments.
function getContextBudget(model: string): number {
  if (model.includes("70b") || model.includes("72b")) return 48000  // ~14k tokens, fits in 32k ctx
  if (model.includes("7b") || model.includes("8b") || model.includes("13b")) return 24000  // ~7k tokens, fits in 16k ctx
  if (model.includes("phi4") || model.includes("phi-4")) return 16000  // ~4.5k tokens, fits in 8k ctx safely
  return 10000  // 3b/4b: ~2.8k tokens, fits in 8k ctx
}

// Returns the Ollama num_ctx to request — sized to hold budget + prompt + output with margin.
export function getNumCtx(model: string): number {
  if (model.includes("70b") || model.includes("72b")) return 32768
  if (model.includes("phi4") || model.includes("phi-4")) return 8192   // safe KV cache on 8GB GPU
  if (model.includes("7b") || model.includes("8b") || model.includes("13b")) return 16384
  return 8192
}

// Returns true for models that default to chain-of-thought reasoning.
// These output tokens into the `thinking` field before emitting any `content` tokens.
// Sending think:false disables the reasoning step; models that don't support the option ignore it.
export function isThinkingModel(model: string): boolean {
  const m = model.toLowerCase()
  return (
    m.includes("qwen3") ||
    m.includes("deepseek-r") ||
    m.includes("phi4") ||       // phi4-mini outputs thinking by default
    m.includes(":thinking") ||
    m.includes(":think")
  )
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
  const maxInsights = lineCount >= 30 ? 10 : lineCount >= 15 ? 7 : Math.max(2, lineCount)
  const maxWorthReading = lineCount >= 20 ? 5 : lineCount >= 10 ? 3 : Math.max(1, Math.floor(lineCount / 3))

  return [
    {
      role: "system" as const,
      content:
        "You are a sharp analyst of Hacker News discussions. " +
        "Output ONLY the labeled lines below, in the exact order shown. No extra text, no markdown, no JSON.",
    },
    {
      role: "user" as const,
      content:
        `Analyze the Hacker News discussion below. Thread title: "${storyTitle}"\n\n` +
        `Output these labeled lines IN THIS EXACT ORDER:\n\n` +
        `SENTIMENT: [one word: positive, negative, mixed, or neutral]\n` +
        `OVERVIEW: [3-5 sentences: what the topic actually is, the main positions people hold, what they agree and disagree on, and any surprising conclusions the thread reaches]\n` +
        (commentsText
          ? `INSIGHT: [headline 4-8 words]; [type: fact/debate/warning/tip/counterpoint]; [2-3 sentence explanation with specific details from the comments]; [author username]\n`.repeat(maxInsights).trimEnd()
          : '') +
        `\nWORTH: [username]; [exact opening words of their comment]; [one sentence why it is uniquely valuable]\n`.repeat(maxWorthReading).trimEnd() +
        `\nVERDICT: [2-3 sentences: what someone learns from this thread, who should read it, key takeaway]\n\n` +
        `Rules:\n` +
        `- Headlines must be your own words, NOT a quote. Example: "RAM walls block on-device LLMs"\n` +
        `- Only reference usernames and quotes that appear in the comments\n` +
        `- Write exactly ${maxInsights} INSIGHT lines and exactly ${maxWorthReading} WORTH lines\n` +
        (commentsText ? `\nComments:\n${commentsText}` : "\nNo comments yet.\n\nSENTIMENT: neutral\nOVERVIEW: No comments yet."),
    },
  ]
}

const VALID_INSIGHT_TYPES = new Set(["fact", "debate", "warning", "tip", "counterpoint"])
const VALID_SENTIMENTS = new Set(["positive", "negative", "mixed", "neutral"])

export type ParsedSummary = {
  overview: string
  insights: Array<{ title: string; detail: string; author: string | null; type: string }>
  worthReading: Array<{ author: string; preview: string; why: string }>
  verdict: string
  sentiment: string
  keyPoints: string[]
}

/**
 * Parses the LLM output — tries structured plain-text first, falls back to JSON.
 * Never throws — returns whatever fields are present; missing fields get empty defaults.
 * Does NOT require OVERVIEW to be present — uses VERDICT as fallback if needed.
 */
export function parseStructuredSummary(text: string): ParsedSummary {
  // ── Try structured plain-text format ──────────────────────────────────────
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  const getField = (prefix: string) =>
    lines.find(l => l.toLowerCase().startsWith(prefix.toLowerCase()))
      ?.slice(prefix.length).trim() ?? ''

  // Check whether this looks like our labeled-line format at all
  const hasAnyLabel = lines.some(l =>
    /^(overview|sentiment|insight|worth|verdict)[\s:]/i.test(l)
  )

  if (hasAnyLabel) {
    const overview = getField('OVERVIEW:')
    const verdict = getField('VERDICT:')
    const rawSentiment = getField('SENTIMENT:').toLowerCase()
    const sentiment = VALID_SENTIMENTS.has(rawSentiment) ? rawSentiment : 'neutral'

    function parseInsightLine(content: string) {
      // Strip leading number prefix: "1. ", "2. ", "10. " etc.
      const stripped = content.replace(/^\d+\.\s*/, '')

      // Try separators in order of preference: "; " → " | " → " - " → " – "
      const sep = stripped.includes('; ') ? /\s*;\s*/
        : stripped.includes(' | ') ? /\s*\|\s*/
        : stripped.match(/ [-–] /) ? / [-–] /
        : null

      const parts = sep ? stripped.split(sep) : [stripped]
      const firstLower = parts[0]?.trim().toLowerCase() ?? ''
      let title: string, type: string, detail: string, author: string | null

      if (VALID_INSIGHT_TYPES.has(firstLower)) {
        // Model skipped title: [type, detail, author?]
        type = firstLower
        detail = parts[1]?.trim() ?? ''
        author = parts[2]?.trim() || null
        title = detail.slice(0, 60)
      } else {
        title = parts[0]?.trim() ?? ''
        // Second field may be type, or may be detail (if model used only 2 fields)
        const second = parts[1]?.trim().toLowerCase() ?? ''
        if (VALID_INSIGHT_TYPES.has(second)) {
          type = second
          detail = parts[2]?.trim() ?? ''
          author = parts[3]?.trim() || null
        } else {
          // Model used 2-field format: headline - explanation (no type field)
          type = 'fact'
          detail = parts.slice(1).join(' ').trim()
          author = null
        }
      }
      // Strip "Type - " or "Type: " prefix that model adds to titles
      const typePrefix = new RegExp(`^(${[...VALID_INSIGHT_TYPES].join('|')})[/\\s\\w]*[-:]+\\s+`, 'i')
      title = title.replace(typePrefix, '').trim()

      // If title is now empty, or is just a type word, derive from detail
      if (!title || VALID_INSIGHT_TYPES.has(title.toLowerCase())) {
        title = detail.slice(0, 60)
      }

      // If detail starts with type in brackets, extract the type
      if (!VALID_INSIGHT_TYPES.has(type)) {
        const embedded = detail.match(/^[\[(](\w+)[\])][\s:]*/i)
        if (embedded && VALID_INSIGHT_TYPES.has(embedded[1].toLowerCase())) {
          type = embedded[1].toLowerCase()
          detail = detail.slice(embedded[0].length).trim()
        }
      }
      return { title, type: VALID_INSIGHT_TYPES.has(type) ? type : 'fact', detail, author }
    }

    // Parse INSIGHT lines — handle "INSIGHT: ...", "INSIGHT 1: ...", numbered list items
    let insights = lines
      .filter(l => /^insight[\s:|]/i.test(l) && !/^insight:\s*$/.test(l.toLowerCase()))
      .map(l => parseInsightLine(l.replace(/^insight[\s:#0-9.]*[|;]?\s*/i, '')))
      .filter(i => i.title.length > 0)

    // Fallback: model output a markdown table (| Type | Headline | ... rows)
    if (insights.length === 0) {
      let inTable = false
      const tableInsights: typeof insights = []
      for (const line of lines) {
        if (/^insight[\s:]/i.test(line)) { inTable = true; continue }
        if (!inTable) continue
        if (/^worth[\s:]/i.test(line)) break
        if (/^\|[-:\s|]+\|/.test(line)) continue  // separator row
        if (line.startsWith('|') && !line.toLowerCase().includes('headline') && !line.toLowerCase().includes('type')) {
          const cells = line.split('|').map(c => c.trim()).filter(Boolean)
          if (cells.length >= 2) {
            const typeLower = cells[0].toLowerCase()
            tableInsights.push({
              title: cells[1] ?? '',
              type: VALID_INSIGHT_TYPES.has(typeLower) ? typeLower : 'fact',
              detail: cells[2] ?? '',
              author: cells[3] || null,
            })
          }
        }
      }
      insights = tableInsights.filter(i => i.title.length > 0)
    }

    // Parse WORTH lines — extract HN username first, then preview/why
    // HN usernames are alphanumeric + hyphens, always come first on the line
    const worthReading = lines
      .filter(l => /^worth[\s:|]/i.test(l))
      .map(l => {
        const content = l
          .replace(/^worth[\s:#0-9.]*[|;]?\s*/i, '')
          .replace(/^\d+\.\s*/, '')
          .replace(/^[\[(\s]+/, '')  // strip leading bracket/paren
        // Extract HN username (letters, digits, hyphens — no spaces)
        const usernameMatch = content.match(/^([\w-]+)/)
        if (!usernameMatch) return null
        const author = usernameMatch[1]
        // Extract a quoted preview if the model wrapped it in quotes
        const quotedMatch = content.match(/["""]([\w].{8,120}?)["""]/)
        const preview = quotedMatch?.[1]?.trim() ?? ''
        // Everything after the author (and optional separator) that isn't the quote is "why"
        const afterAuthor = content.slice(author.length).replace(/^[\s\[\]():"';|–-]+/, '').trim()
        const why = afterAuthor
          .replace(/^["""]\s*.{8,120}?\s*["""]\s*[-–;|]?\s*/, '')  // strip leading quote block
          .trim() || afterAuthor
        return { author, preview, why }
      })
      .filter((w): w is NonNullable<typeof w> => w !== null && w.author.length > 0)

    // Accept the result if we have at least overview, verdict, or insights
    // Model sometimes skips OVERVIEW — synthesize from verdict or insight details
    let effectiveOverview = overview
    if (!effectiveOverview) {
      effectiveOverview = verdict ||
        insights.slice(0, 3).map(i => i.detail).filter(Boolean).join(' ')
    }

    if (effectiveOverview || insights.length > 0) {
      return {
        overview: effectiveOverview,
        insights,
        worthReading,
        verdict,
        sentiment,
        keyPoints: insights.map(i => i.title),
      }
    }
  }

  // ── Fallback: try JSON (model may still output old format) ─────────────────
  try {
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = JSON.parse(jsonText) as Record<string, any>
    if (j.overview || j.summary) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const insights = (j.insights ?? []).map((i: any) => ({
        title: String(i.title ?? ''),
        type: VALID_INSIGHT_TYPES.has(String(i.type)) ? String(i.type) : 'fact',
        detail: String(i.detail ?? ''),
        author: i.author ?? null,
      })).filter((i: { title: string }) => i.title.length > 0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const worthReading = (j.worth_reading ?? []).map((w: any) => ({
        author: String(w.author ?? ''),
        preview: String(w.preview ?? ''),
        why: String(w.why ?? ''),
      })).filter((w: { author: string }) => w.author.length > 0)
      const rawSentiment = String(j.sentiment ?? '').toLowerCase()
      return {
        overview: String(j.overview ?? j.summary ?? ''),
        insights,
        worthReading,
        verdict: String(j.verdict ?? ''),
        sentiment: VALID_SENTIMENTS.has(rawSentiment) ? rawSentiment : 'neutral',
        keyPoints: insights.map((i: { title: string }) => i.title),
      }
    }
  } catch { /* not valid JSON — fall through */ }

  // ── Nothing parsed — return empty result ──────────────────────────────────
  return { overview: '', insights: [], worthReading: [], verdict: '', sentiment: 'neutral', keyPoints: [] }
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
