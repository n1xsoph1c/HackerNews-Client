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
  counter: { count: number }
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
        counter
      )
    }

    result.push(comment)
  }

  return result
}

export async function fetchStoryWithComments(
  id: number
): Promise<{ story: HNStory; comments: HNComment[] } | null> {
  const item = await fetchItem(id)
  if (!item || !("title" in item)) return null

  const story = item as HNStory
  const counter = { count: 0 }
  const comments = story.kids
    ? await fetchCommentTree(story.kids, 0, counter)
    : []

  return { story, comments }
}
