import { NextRequest, NextResponse } from "next/server"
import { fetchStoryWithComments } from "@/lib/hn-api"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const data = await fetchStoryWithComments(parseInt(id, 10))
    if (!data) return NextResponse.json({ error: "Story not found" }, { status: 404 })
    return NextResponse.json(data)
  } catch (error) {
    console.error("Failed to fetch story:", error)
    return NextResponse.json({ error: "Failed to fetch story" }, { status: 500 })
  }
}
