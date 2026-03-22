import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getActiveModel } from "@/lib/ollama"

export async function GET() {
  try {
    const model = await getActiveModel()
    return NextResponse.json({ model })
  } catch {
    return NextResponse.json({ model: process.env.OLLAMA_MODEL ?? "llama3.2:3b" })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { model } = await request.json()

    if (!model) {
      return NextResponse.json({ error: "Missing model name" }, { status: 400 })
    }

    await db.setting.upsert({
      where: { key: "active_model" },
      update: { value: model },
      create: { key: "active_model", value: model },
    })

    return NextResponse.json({ model })
  } catch (error) {
    console.error("Failed to update active model:", error)
    return NextResponse.json({ error: "Failed to update model" }, { status: 500 })
  }
}
