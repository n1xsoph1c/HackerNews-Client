import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    await db.bookmark.delete({ where: { id: parseInt(id, 10) } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Bookmark not found" }, { status: 404 })
  }
}
