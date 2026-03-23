import { NextRequest, NextResponse } from "next/server"
import { execSync } from "child_process"
import { db } from "@/lib/db"

const SETTING_KEYS = {
  CPU_LIMIT: "ollama_cpu_limit",
  MEMORY_LIMIT: "ollama_memory_limit",
}

export async function POST(request: NextRequest) {
  try {
    const { cpuLimit, memoryLimitMB } = await request.json()

    if (!cpuLimit || !memoryLimitMB) {
      return NextResponse.json({ error: "Missing cpuLimit or memoryLimitMB" }, { status: 400 })
    }

    const cpuCount = parseInt(execSync("nproc").toString().trim()) || 4
    const cpuQuota = Math.floor((cpuLimit / 100) * cpuCount * 100000)

    const updatePromises = [
      db.setting.upsert({
        where: { key: SETTING_KEYS.CPU_LIMIT },
        update: { value: String(cpuLimit) },
        create: { key: SETTING_KEYS.CPU_LIMIT, value: String(cpuLimit) },
      }),
      db.setting.upsert({
        where: { key: SETTING_KEYS.MEMORY_LIMIT },
        update: { value: String(memoryLimitMB) },
        create: { key: SETTING_KEYS.MEMORY_LIMIT, value: String(memoryLimitMB) },
      }),
    ]

    await Promise.all(updatePromises)

    execSync(
      `docker update --cpu-quota ${cpuQuota} --memory ${memoryLimitMB}M ollama_ollama_1 2>/dev/null || docker update --cpu-quota ${cpuQuota} --memory ${memoryLimitMB}M ollama 2>/dev/null || echo "Container not found, will apply on restart"`,
      { timeout: 10000 }
    )

    try {
      execSync("docker restart ollama_ollama_1 2>/dev/null || docker restart ollama", { timeout: 30000 })
    } catch {
      console.log("Ollama container restart attempted")
    }

    return NextResponse.json({
      success: true,
      message: "Ollama resource limits updated. Container restart may take a few seconds.",
      applied: {
        cpuLimit,
        memoryLimitMB,
        cpuQuota,
      },
    })
  } catch (error) {
    console.error("Failed to update Ollama resource limits:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update limits" },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const [cpuSetting, memorySetting] = await Promise.all([
      db.setting.findUnique({ where: { key: SETTING_KEYS.CPU_LIMIT } }),
      db.setting.findUnique({ where: { key: SETTING_KEYS.MEMORY_LIMIT } }),
    ])

    return NextResponse.json({
      cpuLimit: cpuSetting ? parseInt(cpuSetting.value) : 50,
      memoryLimitMB: memorySetting ? parseInt(memorySetting.value) : 4096,
    })
  } catch (error) {
    console.error("Failed to get current settings:", error)
    return NextResponse.json({ error: "Failed to get settings" }, { status: 500 })
  }
}
