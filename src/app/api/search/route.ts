import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? ""

  try {
    const bookmarks = await db.bookmark.findMany({
      where: q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { author: { contains: q, mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: { createdAt: "desc" },
    })
    return NextResponse.json({ bookmarks })
  } catch (error) {
    console.error("Search failed:", error)
    return NextResponse.json({ error: "Search failed" }, { status: 500 })
  }
}
