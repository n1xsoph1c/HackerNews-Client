import { db } from "./db"
import type { HNStory, HNComment } from "./hn-api"

const FRESH_MS =  1 * 60 * 60 * 1000  // 0–1h: serve immediately
const STALE_MS = 24 * 60 * 60 * 1000  // 1–24h: serve stale + refresh in background
const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000  // prune non-bookmarked caches after 7 days

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

    // Passively prune old caches that aren't bookmarked
    pruneOldCaches().catch(() => {})
  } catch {
    // Cache write failure is non-fatal — app still works
  }
}

async function pruneOldCaches(): Promise<void> {
  const cutoff = new Date(Date.now() - PRUNE_AFTER_MS)

  // Find old cache entries
  const old = await db.storyCache.findMany({
    where: { fetchedAt: { lt: cutoff } },
    select: { storyId: true },
  })
  if (old.length === 0) return

  const oldIds = old.map(r => r.storyId)

  // Keep any that are bookmarked
  const bookmarked = await db.bookmark.findMany({
    where: { storyId: { in: oldIds } },
    select: { storyId: true },
  })
  const bookmarkedSet = new Set(bookmarked.map(b => b.storyId))

  const toDelete = oldIds.filter(id => !bookmarkedSet.has(id))
  if (toDelete.length > 0) {
    await db.storyCache.deleteMany({ where: { storyId: { in: toDelete } } })
  }
}
