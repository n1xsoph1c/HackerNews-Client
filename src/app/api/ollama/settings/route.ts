import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { readFileSync } from "fs"

const SETTING_KEYS = {
  CPU_LIMIT: "ollama_cpu_limit",
  MEMORY_LIMIT: "ollama_memory_limit",
}

function detectSystemMemoryMB(): number {
  try {
    const meminfo = readFileSync("/proc/meminfo", "utf8")
    const totalKB = parseInt(meminfo.match(/MemTotal:\s+(\d+)/)?.[1] ?? "0")
    return Math.floor(totalKB / 1024)
  } catch {
    return 8192
  }
}

function getSystemCPUCount(): number {
  try {
    const cpus = readFileSync("/proc/cpuinfo", "utf8")
    const matches = cpus.match(/processor\s*:/g)
    return matches ? matches.length : 4
  } catch {
    return 4
  }
}

export async function GET() {
  try {
    const [cpuSetting, memorySetting] = await Promise.all([
      db.setting.findUnique({ where: { key: SETTING_KEYS.CPU_LIMIT } }),
      db.setting.findUnique({ where: { key: SETTING_KEYS.MEMORY_LIMIT } }),
    ])

    const systemMemoryMB = detectSystemMemoryMB()
    const systemCPUCount = getSystemCPUCount()

    const cpuLimit = cpuSetting ? parseInt(cpuSetting.value) : 50
    const memoryLimitMB = memorySetting ? parseInt(memorySetting.value) : Math.floor(systemMemoryMB * 0.5)

    return NextResponse.json({
      cpuLimit,
      memoryLimitMB,
      systemMemoryMB,
      systemCPUCount,
    })
  } catch (error) {
    console.error("Failed to get Ollama settings:", error)
    return NextResponse.json({ error: "Failed to get settings" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { cpuLimit, memoryLimitMB } = await request.json()

    if (cpuLimit !== undefined) {
      if (typeof cpuLimit !== "number" || cpuLimit < 10 || cpuLimit > 100) {
        return NextResponse.json({ error: "cpuLimit must be between 10 and 100" }, { status: 400 })
      }
      await db.setting.upsert({
        where: { key: SETTING_KEYS.CPU_LIMIT },
        update: { value: String(cpuLimit) },
        create: { key: SETTING_KEYS.CPU_LIMIT, value: String(cpuLimit) },
      })
    }

    if (memoryLimitMB !== undefined) {
      if (typeof memoryLimitMB !== "number" || memoryLimitMB < 512 || memoryLimitMB > 32768) {
        return NextResponse.json({ error: "memoryLimitMB must be between 512 and 32768" }, { status: 400 })
      }
      await db.setting.upsert({
        where: { key: SETTING_KEYS.MEMORY_LIMIT },
        update: { value: String(memoryLimitMB) },
        create: { key: SETTING_KEYS.MEMORY_LIMIT, value: String(memoryLimitMB) },
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to update Ollama settings:", error)
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 })
  }
}
