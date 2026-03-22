import { NextRequest, NextResponse } from "next/server"
import { fetchStoryWithComments } from "@/lib/hn-api"
import { getCachedStory, setCachedStory } from "@/lib/story-cache"

async function refreshStoryCache(storyId: number) {
  const data = await fetchStoryWithComments(storyId)
  if (data) await setCachedStory(storyId, data.story, data.comments)
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const storyId = parseInt(id, 10)

  try {
    const cached = await getCachedStory(storyId)

    if (cached && !cached.isStale) {
      return NextResponse.json({ story: cached.story, comments: cached.comments })
    }

    if (cached && cached.isStale) {
      // Return stale immediately, refresh in background
      refreshStoryCache(storyId).catch(console.error)
      return NextResponse.json({ story: cached.story, comments: cached.comments, stale: true })
    }

    // Cache miss — fetch from HN
    const data = await fetchStoryWithComments(storyId)
    if (!data) return NextResponse.json({ error: "Story not found" }, { status: 404 })
    await setCachedStory(storyId, data.story, data.comments)
    return NextResponse.json(data)
  } catch (error) {
    console.error("Failed to fetch story:", error)
    return NextResponse.json({ error: "Failed to fetch story" }, { status: 500 })
  }
}
