const HN_BASE = "https://hacker-news.firebaseio.com/v0"

export type HNStory = {
  id: number
  title: string
  url?: string
  by: string
  score: number
  descendants: number
  time: number
  kids?: number[]
  type: "story" | "job" | "ask" | "show"
}

export type HNComment = {
  id: number
  by?: string
  text?: string
  time: number
  kids?: number[]
  children: HNComment[]
  depth: number
}

class Semaphore {
  private running = 0
  private queue: (() => void)[] = []

  constructor(private maxConcurrent: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++
      return
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.running++
        resolve()
      })
    })
  }

  release(): void {
    this.running--
    const next = this.queue.shift()
    if (next) next()
  }
}

const semaphore = new Semaphore(20)

async function fetchItem(id: number): Promise<HNStory | HNComment | null> {
  await semaphore.acquire()
  try {
    const res = await fetch(`${HN_BASE}/item/${id}.json`, {
      cache: "no-store",
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  } finally {
    semaphore.release()
  }
}

export async function fetchFeed(
  type: "top" | "new" | "best",
  page = 1
): Promise<HNStory[]> {
  const endpoint = type === "new" ? "newstories" : type === "best" ? "beststories" : "topstories"
  const res = await fetch(`${HN_BASE}/${endpoint}.json`, {
    next: { revalidate: 60 },
  })
  const ids: number[] = await res.json()

  const start = (page - 1) * 30
  const pageIds = ids.slice(start, start + 30)

  const items = await Promise.all(pageIds.map(fetchItem))
  return items.filter(
    (item): item is HNStory =>
      item !== null && "title" in item && !("children" in item)
  )
}

async function fetchCommentTree(
  ids: number[],
  depth: number,
  counter: { count: number },
  onProgress?: (fetched: number) => void
): Promise<HNComment[]> {
  if (depth >= 3 || !ids || ids.length === 0) return []

  const items = await Promise.all(
    ids.slice(0, 30).map((id) => fetchItem(id))
  )

  const result: HNComment[] = []

  for (const item of items) {
    if (!item || counter.count >= 150) break
    const raw = item as Record<string, unknown>
    if (raw.dead || raw.deleted || !raw.by) continue
    counter.count++
    onProgress?.(counter.count)

    const comment: HNComment = {
      id: raw.id as number,
      by: raw.by as string,
      text: raw.text as string | undefined,
      time: raw.time as number,
      kids: raw.kids as number[] | undefined,
      children: [],
      depth,
    }

    if (raw.kids && counter.count < 150) {
      comment.children = await fetchCommentTree(
        raw.kids as number[],
        depth + 1,
        counter,
        onProgress
      )
    }

    result.push(comment)
  }

  return result
}

export async function fetchStoryWithComments(
  id: number,
  onProgress?: (fetched: number, total: number) => void
): Promise<{ story: HNStory; comments: HNComment[] } | null> {
  const item = await fetchItem(id)
  if (!item || !("title" in item)) return null

  const story = item as HNStory
  const total = Math.min(story.descendants ?? 0, 150)
  const counter = { count: 0 }
  const comments = story.kids
    ? await fetchCommentTree(story.kids, 0, counter,
        onProgress ? (n) => onProgress(n, total) : undefined)
    : []

  return { story, comments }
}

// Fetches only top-level (depth=0) comments — ~20-50 API calls vs 150+ for full tree.
// Each comment has its original kids[] preserved but children: [] (unloaded placeholder).
export async function fetchStoryShallow(
  id: number
): Promise<{ story: HNStory; comments: HNComment[] } | null> {
  const item = await fetchItem(id)
  if (!item || !("title" in item)) return null

  const story = item as HNStory
  if (!story.kids || story.kids.length === 0) return { story, comments: [] }

  const rawItems = await Promise.all(story.kids.slice(0, 50).map(fetchItem))
  const comments: HNComment[] = []

  for (const raw of rawItems) {
    if (!raw) continue
    const r = raw as Record<string, unknown>
    if (r.dead || r.deleted || !r.by) continue
    comments.push({
      id: r.id as number,
      by: r.by as string,
      text: r.text as string | undefined,
      time: r.time as number,
      kids: r.kids as number[] | undefined,
      children: [],
      depth: 0,
    })
  }

  return { story, comments }
}

/**
 * Fetches depth-1 replies for all shallow (top-level) comments in one batched parallel pass.
 * Populates each top-level comment's children[] with its immediate replies.
 * Uses the global semaphore — all kids across all comments are fetched concurrently.
 */
export async function fetchDepth1ForComments(
  comments: HNComment[],
  onProgress?: (fetched: number, total: number) => void
): Promise<HNComment[]> {
  const withKids = comments.filter(c => c.kids && c.kids.length > 0)
  if (withKids.length === 0) return comments

  const total = withKids.reduce((sum, c) => sum + Math.min(c.kids!.length, 30), 0)
  let fetched = 0

  return Promise.all(
    comments.map(async comment => {
      if (!comment.kids || comment.kids.length === 0) return comment

      const kidItems = await Promise.all(
        comment.kids.slice(0, 30).map(async id => {
          const item = await fetchItem(id)
          onProgress?.(++fetched, total)
          return item
        })
      )

      const children: HNComment[] = []
      for (const raw of kidItems) {
        if (!raw) continue
        const r = raw as Record<string, unknown>
        if (r.dead || r.deleted || !r.by) continue
        children.push({
          id: r.id as number,
          by: r.by as string,
          text: r.text as string | undefined,
          time: r.time as number,
          kids: r.kids as number[] | undefined,
          children: [],
          depth: 1,
        })
      }

      return { ...comment, children }
    })
  )
}

// Fetches immediate children of a single comment (one level deep).
// Each child has its own kids[] preserved but children: [] for further lazy loading.
export async function fetchCommentReplies(commentId: number): Promise<HNComment[]> {
  const item = await fetchItem(commentId)
  if (!item) return []

  const r = item as Record<string, unknown>
  const kids = r.kids as number[] | undefined
  if (!kids || kids.length === 0) return []

  const parentDepth = (r.depth as number | undefined) ?? 0
  const rawItems = await Promise.all(kids.slice(0, 30).map(fetchItem))
  const replies: HNComment[] = []

  for (const raw of rawItems) {
    if (!raw) continue
    const c = raw as Record<string, unknown>
    if (c.dead || c.deleted || !c.by) continue
    replies.push({
      id: c.id as number,
      by: c.by as string,
      text: c.text as string | undefined,
      time: c.time as number,
      kids: c.kids as number[] | undefined,
      children: [],
      depth: parentDepth + 1,
    })
  }

  return replies
}
