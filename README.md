# Short Video Demo Link
https://drive.google.com/file/d/1hgpymbLoPU5Hv9SftVgrECdqVOKqZIRj/view?usp=sharing

# HN Reader

A Hacker News client with AI-powered discussion summaries. One command to run everything.

```bash
docker compose up --build
```

Access at **http://localhost:8000**

---

## What It Does

- **Feed** — Browse top/new/best HN stories with infinite scroll
- **Story detail** — Threaded comment discussions, lazy-loaded for instant page opens
- **AI Summary** — Click "Summarize Discussion" for a streaming summary: key insights with explanations, clickable "worth reading" chips that scroll directly to specific comments
- **Bookmarks** — Save and search stories locally
- **Model Manager** — Install Ollama models, switch active model, watch live download progress (MB/s, ETA)

---

## Architecture

```
Browser
  └─► Next.js 16 App Router (SSR + API routes, port 8000)
        │
        ├─► /api/stories           HN Firebase API (story feed, comment trees)
        │       └── StoryCache     PostgreSQL cache (10-min TTL, stale-while-revalidate)
        │
        ├─► /api/comments/[id]/replies   Lazy reply loading (1 level per click)
        │
        ├─► /api/summarize         SSE streaming → Ollama → token-by-token
        │       └── Summary        PostgreSQL cache (invalidated on model change)
        │
        ├─► /api/bookmarks         CRUD, ILIKE search
        │
        └─► /api/ollama/*          Model management (list, pull, active)
                                   Ollama pull progress streamed via SSE
```

### Story Page Request Flow

```
User clicks story card
        │
        ▼
[Hover prefetch] → GET /api/stories/[id]
        │
        ▼
StoryCache hit? ─── YES ──► Serve from DB (~100ms)
        │
       NO
        │
        ▼
fetchStoryShallow()          ← depth-0 only, ~20-50 HN API calls
        │
        ├──► Render page immediately
        │
        └──► setCachedStory() (background, non-blocking)

User expands a comment with replies
        │
        ▼
GET /api/comments/[id]/replies   ← 1 level deep, ~5-30 HN API calls
        │
        ▼
Children append to Comment component state
```

### AI Summary Flow

Progressive multi-round summarization — the UI shows a draft immediately and refines it as more data arrives. Each depth-1 batch is pre-fetched in the background while the LLM generates the prior round, so fetch latency is hidden inside LLM generation time.

```
User clicks "Summarize Discussion"
        │
        ▼
POST /api/summarize { storyId, storyTitle }
        │
        ▼
Summary in DB? (same model + non-empty overview?)
        │
       YES ──────────────────────────────────────────► Return cached instantly
        │
       NO
        │
        ▼
getCachedStory()     ← shallow comments already in StoryCache (free, no API calls)
  or fetchStoryShallow() if cache miss
        │
        ▼
Determine round count based on thread size + model capability:
  ├── isSmallModel() or no replies  →  1 round  (CPU 3b/4b: fast, single-shot)
  ├── ≤ 25 parents with replies      →  2 rounds
  └── > 25 parents with replies      →  3 rounds
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│  Round 1 (immediate draft)                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ LLM ← shallow depth-0 comments                         │    │
│  │ SSE tokens → browser live preview                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│  └─► roundComplete event → UI renders draft summary            │
│  [in parallel while LLM runs: fetchDepth1ForComments(batch 1)] │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼ (if totalRounds ≥ 2)
┌─────────────────────────────────────────────────────────────────┐
│  Round 2 (improved summary)                                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ LLM ← shallow + depth-1 replies for first 25 parents   │    │
│  │ SSE tokens → browser live preview                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│  └─► roundComplete → UI replaces draft with refined summary    │
│  [in parallel while LLM runs: fetchDepth1ForComments(batch 2)] │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼ (if totalRounds = 3)
┌─────────────────────────────────────────────────────────────────┐
│  Round 3 (final quality)                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ LLM ← shallow + all depth-1 replies (both batches)     │    │
│  └─────────────────────────────────────────────────────────┘    │
│  └─► parseCacheAndStore() → db.summary.upsert()                │
│  └─► complete event → final UI                                  │
└─────────────────────────────────────────────────────────────────┘

selectCommentsForSummary() (runs at each round):
  ├── Flatten all comments with depth + char count
  ├── Filter < 40 chars (noise), cap each at 800 chars
  ├── Sort by depth-0 first, then length DESC
  ├── Sample across thread (beginning/middle/end for breadth)
  └── Pack into context budget:
        phi4-mini → 6,000 chars   (+ num_ctx: 8192 unlocked)
        3b/4b     → 3,500 chars
        7b/8b     → 6,000 chars
        70b+      → 12,000 chars

LLM output format — plain labeled text (no JSON):
  SENTIMENT: positive/negative/mixed/neutral
  OVERVIEW: 2-3 sentences on the core debate
  VERDICT: one sentence — is this thread worth reading?
  INSIGHT: headline; type; explanation; author
  WORTH: username; exact opening words; why it's notable

findCommentId() — matches WORTH entries back to real comment IDs
  using progressive fuzzy matching (40-char prefix → 40-char anywhere → 20-char)
  so "Worth Reading" chips scroll directly to the comment in the thread
```

---

## Stack

| Package | Version | Notes |
|---------|---------|-------|
| `next` | 16.2.x | App Router; `params`/`searchParams` are async Promises |
| `tailwindcss` | v4 | CSS-first config in `globals.css @theme {}` — no `tailwind.config.ts` |
| `motion` | 12.x | Formerly `framer-motion` — import from `'motion/react'` |
| `prisma` | 7.x | Rust-free; generated client at `src/generated/prisma/client` |
| `@prisma/adapter-pg` | — | Required by Prisma 7 for DB connections (replaces `url` in schema) |
| `ollama` | latest | Official JS client; streaming via `stream: true` |
| `shadcn/ui` | latest | `new-york` style, OKLCH colors, Tailwind v4-compatible |
| `lucide-react` | — | Icons throughout |

---

## Build Timeline

**Total time: ~1 working session (~8 hours)**

| Phase | Time spent | Where time went |
|-------|-----------|-----------------|
| Research & planning | ~1h | Next.js 16 async APIs, Tailwind v4 config changes, Prisma 7 breaking changes, motion rename |
| Scaffolding & deps | ~45m | create-next-app in temp dir (capital letters in pkg name), shadcn init issues, class-variance-authority missing |
| Prisma 7 debugging | ~1.5h | `prisma-client` generator needs explicit output path; datasource url removed; `@prisma/adapter-pg` required; import path changed to `@/generated/prisma/client` |
| Docker + infra | ~1h | Ollama healthcheck (curl not in image → `ollama list`); `prisma migrate deploy` fails without migration files → switched to `prisma db push`; Node 18 on VPS but Next.js 16 requires ≥20 |
| Backend API routes | ~1h | All 9 routes, SSE streaming for summarize + pull, BFS comment tree with Semaphore |
| Frontend components | ~1.5h | Story page two-column layout, Comment recursive with AnimatePresence, SummarizeButton SSE consumer, PullProgress |
| Performance pass | ~1h | StoryCache DB table, fetchStoryShallow, lazy reply loading, skeleton screens, hover prefetch |
| AI quality pass | ~45m | selectCommentsForSummary (smart sampling), rich prompt + output schema, commentId resolution, double-encoding fix |

**Biggest time sinks:**
1. **Prisma 7** — entirely undocumented breaking changes (generator name, adapter-based connection, output path required)
2. **Node version on VPS** — Next.js 16 requires Node 20, VPS had Node 18, required nvm setup
3. **Ollama Docker healthcheck** — curl/wget not available in `ollama/ollama` image
4. **LLM output parsing** — small models (3.2b) double-encode JSON (output the full JSON as a string inside the `overview` field)

---

## GPU Setup (Recommended)

CPU mode (default) uses `phi4-mini` — functional for smaller threads but can take 1-2 minutes per round on larger ones. For GPU (e.g. RTX 5060 Ti):

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
```

Override the model via env:
```bash
OLLAMA_MODEL=qwen2.5:7b docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
```

Context budget and round count scale automatically with model size and thread depth:
- `phi4-mini` → 6,000 chars + 8192 token context window unlocked
- `3b/4b` models → 3,500 chars
- `7b/8b` models → 6,000 chars
- `70b+` models → 12,000 chars

Small models (`3b`/`4b`, excluding `phi4-mini`) do only 1 round — fast and accurate enough for the context they can handle. Larger models do up to 3 rounds over progressively richer data.

---

## Environment Variables

```env
DATABASE_URL=postgresql://postgres:password@db:5432/hnapp
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=llama3.2:3b   # override per run
```

---

## Development

```bash
npm install
npm run dev           # Turbopack, port 3000
npm run build         # production build + type check

npx prisma db push    # sync schema to DB (idempotent)
npx prisma generate   # regenerate TS client after schema changes
npx prisma studio     # visual DB browser
```

Requires `.env` with `DATABASE_URL` + `OLLAMA_BASE_URL` pointing to running instances.

---

## Key Technical Decisions

**Why Ollama?** No API keys, no cost, runs entirely in Docker, model is swappable. On GPU it's excellent.

**Why `prisma db push` instead of migrations?** Single-dev portfolio project — `db push` is idempotent and schema-as-truth. Multi-environment production would use `prisma migrate`.

**Why shallow comment loading?** A 200-comment thread requires 200+ HN API calls at depth 3. Fetching depth-0 first drops this to ~30. Replies lazy-load per-comment on expand.

**Why PostgreSQL for caching instead of Redis?** Keep infrastructure minimal — Postgres is already present. For high-traffic use, Redis would be more appropriate for the hot path.

**Why smart comment sampling?** Sequential truncation always picks the same early comments, missing the rest of the thread. The sampler scores by depth + length and samples across beginning/middle/end for representative coverage within the LLM context window.

**Why SSE instead of WebSockets?** One-directional streaming (server→client), simpler, works with Next.js route handlers without extra setup. Ollama's JS client exposes an async iterator that maps naturally to SSE.

**Why plain-text output instead of JSON?** Early versions used `format: SummaryJsonSchema` (Zod → GBNF grammar-constrained decoding). This caused 1.7× slower generation per token and small models (especially phi4-mini) would exhaust `num_predict` entirely on internal reasoning with zero content output. Switching to labeled plain-text (`INSIGHT: headline; type; detail; author`) is more reliable, never throws on parse failure, and falls back gracefully when the model deviates.

**Why progressive rounds instead of one big call?** A single call over a large context budget is slow to start and gives vague results if the model is small. Progressive rounds let users see a draft in ~15-30s while the system quietly fetches more data and refines. Each batch of depth-1 replies is pre-fetched in the background while the prior LLM call runs, so fetch latency is hidden. The final round result is cached — subsequent loads are instant.

**Why phi4-mini as the default model?** phi4-mini (3.8B) outperforms llama3.2:3b on instruction-following and structured output while being similarly compact. On GPU it generates at ~30-60 tok/s. Key quirk: phi4-mini routes all content through its `thinking` field (chain-of-thought by default) — the Ollama API `think: false` option doesn't suppress this, so the code captures `thinkingText` as a fallback when `content` is empty.

**Model warm-up on startup:** After Docker pulls the model weights, a minimal generate request (`"hi"`, `num_predict: 1`) forces the model into memory/VRAM. Without this, the first real summarization request triggers a ~60s cold-load pause even though the model is downloaded.

---

## Docker Notes

- First run downloads the model in background — app starts immediately, track at `/models`
- `docker compose down -v` resets everything including DB and model volumes
- Volumes `postgres_data` + `ollama_data` persist across `docker compose down` (without `-v`)
- The `app` service entrypoint runs `prisma db push` then starts `node server.js`

---

## Resource Limits

Ollama's CPU and memory usage can be configured via the Models page UI or environment variables.

### Via UI (Recommended)
1. Go to **Models** tab
2. Click the ⚙️ settings icon in the System panel
3. Adjust CPU and Memory sliders
4. Click **Apply & Restart Ollama**

### Via Environment Variables
```bash
OLLAMA_CPU_LIMIT=4        # Number of CPU cores (GPU mode)
OLLAMA_MEMORY_LIMIT=8G     # Memory limit (e.g., 4G, 8G)
```

### Defaults
- **CPU**: 50% of available cores
- **Memory**: 50% of system RAM (auto-detected)

---

## Troubleshooting

### Summarize gets stuck at "fetching discussion 0/?"
**Cause**: Race condition when background pre-summarization and user-initiated summarize run concurrently.

**Fix**: The API now checks if Ollama is busy and waits for any background job to complete before starting a new one. This prevents two concurrent Ollama calls that would overload the model.

### Ollama shows 100% CPU usage
**Cause**: Multiple simultaneous summarization requests (background pre-gen + user click).

**Fix**: The `ollamaBusy` flag is now checked before starting new requests. Use the Resource Limits settings to cap Ollama's resource usage.

### Pulling indicator keeps reappearing on Models page
**Cause**: Auto-pull triggers on every page refresh, not just initial mount.

**Fix**: Auto-pull now only triggers on initial page load and tracks the pulling state to prevent re-triggering during refresh.

### GPU Setup Notes
For GPU acceleration, use the GPU override:
```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
```

The GPU compose file sets default resource limits (4 cores, 8GB memory) which can be overridden via environment variables.
