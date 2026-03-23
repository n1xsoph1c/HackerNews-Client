import { NextResponse } from "next/server"
import { readFileSync } from "fs"
import { execSync } from "child_process"

function parseProcStat() {
  const line = readFileSync("/proc/stat", "utf8").split("\n")[0]
  const nums = line.replace(/^cpu\s+/, "").split(/\s+/).map(Number)
  const [user, nice, system, idle, iowait = 0, irq = 0, softirq = 0] = nums
  return {
    idle: idle + iowait,
    total: user + nice + system + idle + iowait + irq + softirq,
  }
}

export async function GET() {
  const result: {
    cpu: number | null
    ram: { used: number; total: number } | null
    gpu: { util: number; vramUsed: number; vramTotal: number } | null
    ollamaRunning: boolean
  } = { cpu: null, ram: null, gpu: null, ollamaRunning: false }

  // CPU: diff two /proc/stat samples 200ms apart
  try {
    const s1 = parseProcStat()
    await new Promise((r) => setTimeout(r, 200))
    const s2 = parseProcStat()
    const idleDelta = s2.idle - s1.idle
    const totalDelta = s2.total - s1.total
    result.cpu = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0
  } catch { /* not on Linux */ }

  // RAM: /proc/meminfo
  try {
    const meminfo = readFileSync("/proc/meminfo", "utf8")
    const total = parseInt(meminfo.match(/MemTotal:\s+(\d+)/)?.[1] ?? "0") * 1024
    const available = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] ?? "0") * 1024
    result.ram = { used: total - available, total }
  } catch { /* not on Linux */ }

  // GPU: nvidia-smi (available in ollama container, not app — may fail)
  try {
    const out = execSync(
      "nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits",
      { timeout: 2000 }
    ).toString().trim()
    const [util, vramUsedMiB, vramTotalMiB] = out.split(",").map((s) => parseInt(s.trim()))
    result.gpu = {
      util,
      vramUsed: vramUsedMiB * 1024 * 1024,
      vramTotal: vramTotalMiB * 1024 * 1024,
    }
  } catch { /* nvidia-smi not available in this container */ }

  // Ollama running models (proxy for GPU activity)
  try {
    const ollamaUrl = process.env.OLLAMA_BASE_URL ?? "http://ollama:11434"
    const res = await fetch(`${ollamaUrl}/api/ps`, { signal: AbortSignal.timeout(2000) })
    if (res.ok) {
      const data = await res.json()
      result.ollamaRunning = (data.models?.length ?? 0) > 0
    }
  } catch { /* ollama unreachable */ }

  return NextResponse.json(result)
}
