import { NextRequest, NextResponse } from "next/server"
import { fetchFeed } from "@/lib/hn-api"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const type = (searchParams.get("type") ?? "top") as "top" | "new" | "best"
  const page = parseInt(searchParams.get("page") ?? "1", 10)

  try {
    const stories = await fetchFeed(type, page)
    return NextResponse.json({ stories, page, type })
  } catch (error) {
    console.error("Failed to fetch stories:", error)
    return NextResponse.json({ error: "Failed to fetch stories" }, { status: 500 })
  }
}
