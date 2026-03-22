# DEVELOPMENT PLAN

> Status legend: ⬜ pending | 🔄 in progress | ✅ done

This document tracks the full build of **HN Reader** — a Hacker News client with AI-powered discussion summaries.
Any developer or AI agent picking this up should start here to understand what's done, what's next, and what decisions were made.

---

## What We're Building

A Hacker News reader where you can:
- Browse HN stories (top / new / best feeds)
- Read threaded comment discussions
- Get AI summaries of comment threads (streamed live, powered by a local Ollama model)
- Bookmark stories and search your saved list
- Manage Ollama models (install new ones, switch active model, watch live download progress)

**One command to run everything:** `docker compose up --build`
**Access at:** `http://localhost:8000`

---

## Tech Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Framework | Next.js 16 (App Router) | Full-stack in one repo, SSR + API routes |
| Database | PostgreSQL + Prisma 7 | Reliable, simple schema, great DX |
| AI/LLM | Ollama (self-hosted Docker) | No API keys, runs locally, model swappable |
| Styling | Tailwind v4 + shadcn/ui | Modern, CSS-first config, polished components |
| Animations | motion (v12) | Smooth transitions, replaces framer-motion |
| Icons | lucide-react | User requirement |

---

## Phase 1 — Project Setup ✅

### 1.1 Repository + Docs ✅
- [x] `CLAUDE.md` — guidance for AI agents working in this repo
- [x] `DEVELOPMENT_PLAN.md` — this file
- [x] `.gitignore` — ignores node_modules, .env, .next, README.md

### 1.2 Next.js Scaffold ⬜
- [ ] Run `npx create-next-app@latest` in project root
  - TypeScript, App Router, Tailwind, ESLint, src/ dir, no import alias
- [ ] Verify: `npm run dev` starts on port 3000

### 1.3 Install Extra Dependencies ⬜
```bash
npm install prisma@7 @prisma/client@7 motion ollama lucide-react
npm install -D @types/node
npx shadcn@latest init   # choose: new-york style, yes to TypeScript
```

### 1.4 Configure Tailwind v4 ⬜
- [ ] Replace `postcss.config.mjs` contents:
  ```js
  export default { plugins: { "@tailwindcss/postcss": {} } }
  ```
- [ ] Replace `src/app/globals.css` with:
  ```css
  @import "tailwindcss";
  @theme {
    --color-brand: oklch(0.7 0.2 40);
    --font-sans: var(--font-geist-sans);
  }
  ```
- [ ] Delete `tailwind.config.ts` if created (not needed in v4)

### 1.5 Configure Next.js ⬜
- [ ] `next.config.ts` — set `output: 'standalone'`

---

## Phase 2 — Database + Infrastructure ⬜

### 2.1 Prisma Schema ⬜
File: `prisma/schema.prisma`

Three models:
- **Bookmark** — saved stories (storyId unique)
- **Summary** — cached AI summaries (storyId unique, includes `model` field)
- **Setting** — key/value; `active_model` key = current Ollama model name

### 2.2 Docker Files ⬜
Files to create:
- `docker-compose.yml` — postgres + ollama (CPU) + app; external port **8000**
- `docker-compose.gpu.yml` — override that adds nvidia GPU to ollama service
- `Dockerfile` — multi-stage: deps → builder (prisma generate + next build) → runner
- `entrypoint.sh` — runs `prisma migrate deploy`, background model pull, then `node server.js`
- `.env.example` — documents required env vars

Key env vars used by docker-compose:
```
DATABASE_URL=postgresql://postgres:password@db:5432/hnapp
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=llama3.2:3b
```

---

## Phase 3 — Backend ⬜

All files in `src/app/api/` and `src/lib/`.

### 3.1 Library Utilities ⬜

**`src/lib/db.ts`** — Prisma singleton (safe for Next.js hot reload in dev)

**`src/lib/hn-api.ts`** — HN Firebase API client
- Base URL: `https://hacker-news.firebaseio.com/v0/`
- `fetchStories(type, page)` → paginated list of 30 story objects
- `fetchStoryWithComments(id)` → story + comment tree (BFS, depth 3, max 150)
- Semaphore: max 20 concurrent requests
- Skip dead/deleted items

**`src/lib/ollama.ts`** — thin wrapper around the `ollama` npm package
- `getActiveModel()` — reads from Setting table, falls back to `OLLAMA_MODEL` env var
- Helper to build system prompt for HN discussion summarization

### 3.2 API Routes ⬜

| File | Method | What it does |
|------|--------|-------------|
| `api/stories/route.ts` | GET `?type=top&page=1` | Returns 30 stories from HN |
| `api/stories/[id]/route.ts` | GET | Returns story + full comment tree |
| `api/bookmarks/route.ts` | GET, POST | List all / add new bookmark |
| `api/bookmarks/[id]/route.ts` | DELETE | Remove a bookmark |
| `api/search/route.ts` | GET `?q=term` | ILIKE search on bookmark titles |
| `api/summarize/route.ts` | POST `{storyId}` | SSE stream: AI summary (cached) |
| `api/ollama/models/route.ts` | GET | List installed Ollama models |
| `api/ollama/pull/route.ts` | POST `{model}` | SSE stream: pull progress |
| `api/ollama/active/route.ts` | GET, PUT | Get / set active model |

Important: `api/summarize/route.ts` must export `export const maxDuration = 300`

---

## Phase 4 — Frontend ⬜

### 4.1 Root Layout + Navigation ⬜
- `src/app/layout.tsx` — sets up `<html>` with dark class, Geist font, renders AppShell
- `src/components/layout/AppShell.tsx` — wraps content, provides theme context
- `src/components/layout/Navbar.tsx` — desktop top bar: logo, nav links, active model chip, theme toggle
- `src/components/layout/BottomNav.tsx` — mobile only, 3 tabs: Feed / Bookmarks / Models

### 4.2 Feed Page (`/`) ⬜
- `src/app/page.tsx` — server component, passes feed type from searchParams
- `src/components/feed/FeedTabs.tsx` — top/new/best pill selector
- `src/components/feed/StoryCard.tsx` — card: title, domain, points, author, time ago, comment count, bookmark toggle
- `src/components/feed/InfiniteStoryList.tsx` — client component, fetches pages, IntersectionObserver for scroll

### 4.3 Story Detail Page (`/story/[id]`) ⬜
- `src/app/story/[id]/page.tsx` — fetches story + comments server-side
- `src/components/story/StoryHeader.tsx` — title, source chip, meta row (points, author, time, comments)
- `src/components/story/SummarizeButton.tsx` — button that triggers SSE fetch, renders streaming output
- `src/components/story/SentimentBadge.tsx` — colored badge: positive/negative/mixed/neutral
- `src/components/story/CommentThread.tsx` — responsive: mobile stacked cards OR desktop two-column
- `src/components/story/Comment.tsx` — recursive component, renders HTML safely, collapse/expand replies

**Comment UI rules:**
- Mobile: left border accent by depth (0=orange, 1=blue-gray, 2+=muted), tap to expand
- Desktop: root comments as cards, replies as indented bubbles with vertical connecting line, max 3 depth, "show N more" at depth 3

### 4.4 Bookmarks Page (`/bookmarks`) ⬜
- `src/app/bookmarks/page.tsx`
- `src/components/bookmarks/SearchBar.tsx` — debounced input, updates URL search param
- `src/components/bookmarks/BookmarkList.tsx` — same StoryCard component, remove button

### 4.5 Models Page (`/models`) ⬜
- `src/app/models/page.tsx`
- `src/components/models/ModelCard.tsx` — shows model name, size, "Set Active" button, active indicator
- `src/components/models/PullForm.tsx` — text input for model name + pull button
- `src/components/models/PullProgress.tsx` — SSE consumer: animated progress bar, MB/s speed, ETA countdown, status text

---

## Phase 5 — Polish + README ⬜

### 5.1 Theme system ⬜
- Dark mode default, `localStorage` persistence
- `dark` class on `<html>` element
- Smooth 200ms color transitions on all elements

### 5.2 Loading + error states ⬜
- Skeleton cards for feed loading
- Error boundaries for API failures
- Empty states for bookmarks (no saves yet)

### 5.3 README ⬜
- Setup instructions (just `docker compose up`)
- Architecture decisions
- Tradeoffs
- Future improvements

---

## Key Patterns to Follow

### Never forget: Next.js 16 async
```typescript
// params and searchParams are Promises in Next.js 16
const { id } = await params        // NOT params.id directly
const { type } = await searchParams // NOT searchParams.type directly
```

### SSE streaming pattern (frontend)
```typescript
const res = await fetch('/api/summarize', { method: 'POST', body: JSON.stringify({ storyId }) })
const reader = res.body!.getReader()
const decoder = new TextDecoder()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  const chunk = decoder.decode(value)
  // process chunk (SSE lines start with "data: ")
}
```

### Motion animations
```typescript
import { motion, AnimatePresence } from 'motion/react'  // NOT 'framer-motion'
```

### Tailwind v4 custom tokens
```css
/* In globals.css @theme block — not tailwind.config.ts */
@theme { --color-brand: oklch(0.7 0.2 40); }
/* Usage in JSX */
className="text-brand bg-brand/10"
```

---

## Current Status

| Phase | Status |
|-------|--------|
| 1 — Project Setup | 🔄 In progress (docs done, scaffold pending) |
| 2 — Database + Docker | ⬜ Pending |
| 3 — Backend | ⬜ Pending |
| 4 — Frontend | ⬜ Pending |
| 5 — Polish + README | ⬜ Pending |

**Last updated:** Phase 1.1 complete (CLAUDE.md + DEVELOPMENT_PLAN.md + .gitignore created)
