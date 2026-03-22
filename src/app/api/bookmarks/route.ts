import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET() {
  try {
    const bookmarks = await db.bookmark.findMany({
      orderBy: { createdAt: "desc" }
    })
    return NextResponse.json({ bookmarks })
  } catch (error) {
    console.error("Failed to fetch bookmarks:", error)
    return NextResponse.json({ error: "Failed to fetch bookmarks" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { storyId, title, url, author, points, commentCount } = body

    if (!storyId || !title || !author) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const bookmark = await db.bookmark.upsert({
      where: { storyId },
      update: { points, commentCount },
      create: {
        storyId,
        title,
        url,
        author,
        points: points ?? 0,
        commentCount: commentCount ?? 0,
        hnUrl: `https://news.ycombinator.com/item?id=${storyId}`,
      }
    })

    return NextResponse.json({ bookmark }, { status: 201 })
  } catch (error) {
    console.error("Failed to create bookmark:", error)
    return NextResponse.json({ error: "Failed to create bookmark" }, { status: 500 })
  }
}
