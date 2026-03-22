# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

HN Reader — a Hacker News client with AI-powered discussion summaries. Next.js 16 full-stack app (frontend + API routes), PostgreSQL via Prisma 7, Ollama (self-hosted LLM in Docker) for summaries. Everything starts with `docker compose up`.

External port: **8000** → maps to internal port 3000.

---

## Dev Commands

```bash
# Local dev (requires .env with DATABASE_URL and OLLAMA_BASE_URL)
npm run dev          # Next.js dev server (Turbopack, port 3000)
npm run build        # Production build (standalone output)
npm run lint         # ESLint

# Database
npx prisma migrate dev --name <name>   # Create + apply migration
npx prisma migrate deploy              # Apply migrations (used in Docker)
npx prisma generate                    # Regenerate client after schema change
npx prisma studio                      # Visual DB browser

# Docker (primary workflow)
docker compose up --build              # CPU mode (VPS default)
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build  # GPU mode (RTX PC)
docker compose down -v                 # Tear down + remove volumes
```

---

## Stack & Key Versions

| Package | Version | Critical note |
|---------|---------|---------------|
| `next` | 16.x | Turbopack default; `params`/`searchParams`/`cookies()`/`headers()` are **async** |
| `tailwindcss` | v4 | CSS-first config via `@theme {}` in `globals.css` — **no `tailwind.config.ts`** |
| `@tailwindcss/postcss` | v4 | PostCSS plugin name changed from v3 |
| `motion` | 12.x | Formerly `framer-motion` — import from `'motion/react'` |
| `prisma` | 7.x | Rust-free, ESM-first |
| `ollama` | latest | Official JS client; streaming via `stream: true` |
| `shadcn/ui` | latest | `new-york` style, OKLCH colors, Tailwind v4-compatible |

---

## Architecture

### Request flow
```
Browser → Next.js App Router
  → Server Components (initial SSR)
  → /api/* Route Handlers (data fetching, mutations)
    → lib/hn-api.ts   (HN Firebase API, BFS + semaphore)
    → lib/db.ts       (Prisma singleton)
    → lib/ollama.ts   (Ollama client wrapper)
```

### Next.js 16 async pattern (required everywhere)
```typescript
// Page props — params AND searchParams are Promises
export default async function Page({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ type?: string }>
}) {
  const { id } = await params
  const { type } = await searchParams
}

// Server utilities are async
const cookieStore = await cookies()
const headersList = await headers()
```

### Tailwind v4 config pattern
```css
/* src/app/globals.css */
@import "tailwindcss";

@theme {
  --color-brand: oklch(0.7 0.2 40);   /* HN orange accent */
  --font-sans: var(--font-geist-sans);
}
```
All custom tokens go in `@theme {}`. Dark mode uses `class` strategy — toggled by adding `dark` class to `<html>`.

### Database models
- **Bookmark** — saved HN stories (storyId unique)
- **Summary** — cached AI summaries per storyId (includes `model` field to invalidate on model switch)
- **Setting** — key/value store; `active_model` key holds current Ollama model name

### AI summary flow
1. `POST /api/summarize { storyId }` — check Summary cache first
2. Fetch story comments via `lib/hn-api.ts`, flatten to text, truncate to ~8000 chars
3. Call Ollama with streaming enabled; prompt asks for `{ keyPoints, sentiment, summary }` JSON
4. Forward stream as SSE (`Content-Type: text/event-stream`)
5. On stream complete, parse JSON and upsert into Summary table
6. Frontend consumes SSE with `fetch()` + `ReadableStream`

```typescript
export const maxDuration = 300  // set on /api/summarize route
```

### Ollama model pull flow
1. `POST /api/ollama/pull { model }` — calls `OLLAMA_BASE_URL/api/pull` with streaming
2. Ollama returns NDJSON: `{ status, completed, total }` per line
3. Backend forwards as SSE; frontend computes speed (MB/s) and ETA from deltas

### HN API concurrency
- `lib/hn-api.ts` uses a Semaphore (max 20 concurrent) for comment tree BFS
- Depth limit: 3 levels, total cap: 150 comments
- Skips items where `dead === true` or `deleted === true`
- Comment `text` field is HTML (HN uses `<p>`, `<a>`, `<code>`) — render with `dangerouslySetInnerHTML`

### UI layout
- **Mobile**: bottom tab bar (Feed / Bookmarks / Models), cards with depth-colored left borders, `AnimatePresence` for reply expansion
- **Desktop**: two-column — sticky left panel (story meta + AI summary), right panel (flowing conversation-style comments with connecting lines)
- Theme toggle persists to `localStorage`; `dark` class applied to `<html>`

### Environment variables
```
DATABASE_URL=postgresql://postgres:password@db:5432/hnapp
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=llama3.2:3b   # default; user can override
```

### Docker notes
- `app` service entrypoint: runs `prisma migrate deploy` then `node server.js`
- Model pull happens in background on startup (`curl` to Ollama's `/api/pull`)
- GPU: use `docker-compose.gpu.yml` override file (adds nvidia device reservation to `ollama` service)
- `next.config.ts` must have `output: 'standalone'` for the Docker multi-stage build
