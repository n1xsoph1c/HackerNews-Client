import { NextRequest, NextResponse } from "next/server"
import { fetchCommentReplies } from "@/lib/hn-api"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const replies = await fetchCommentReplies(parseInt(id, 10))
    return NextResponse.json({ replies })
  } catch (error) {
    console.error("Failed to fetch replies:", error)
    return NextResponse.json({ replies: [] })
  }
}
