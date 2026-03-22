import { db } from "./db"
import type { HNStory, HNComment } from "./hn-api"

const FRESH_MS = 5  * 60 * 1000  // 0–5 min: serve immediately
const STALE_MS = 10 * 60 * 1000  // 5–10 min: serve stale + refresh in background

export type CachedStory = {
  story: HNStory
  comments: HNComment[]
  isStale: boolean
}

export async function getCachedStory(storyId: number): Promise<CachedStory | null> {
  try {
    const row = await db.storyCache.findUnique({ where: { storyId } })
    if (!row) return null

    const age = Date.now() - row.fetchedAt.getTime()
    if (age > STALE_MS) return null  // too old — treat as miss

    return {
      story: row.storyJson as unknown as HNStory,
      comments: row.commentsJson as unknown as HNComment[],
      isStale: age > FRESH_MS,
    }
  } catch {
    return null
  }
}

export async function setCachedStory(
  storyId: number,
  story: HNStory,
  comments: HNComment[]
): Promise<void> {
  try {
    await db.storyCache.upsert({
      where: { storyId },
      update: {
        storyJson: story as object,
        commentsJson: comments as unknown as object[],
        fetchedAt: new Date(),
      },
      create: {
        storyId,
        storyJson: story as object,
        commentsJson: comments as unknown as object[],
      },
    })
  } catch {
    // Cache write failure is non-fatal — app still works
  }
}
