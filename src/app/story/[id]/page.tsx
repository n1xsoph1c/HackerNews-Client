import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { after } from 'next/server'
import { fetchStoryShallow } from '@/lib/hn-api'
import { getCachedStory, setCachedStory } from '@/lib/story-cache'
import { preSummarizeIfNeeded } from '@/lib/summarize-background'
import { StoryHeader } from '@/components/story/StoryHeader'
import { SummarizeButton } from '@/components/story/SummarizeButton'
import { CommentThread } from '@/components/story/CommentThread'
import { Loader2 } from 'lucide-react'

export default async function StoryPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const storyId = parseInt(id, 10)

  // Check cache first for instant repeat visits
  const cached = await getCachedStory(storyId)
  let story, comments

  if (cached) {
    story = cached.story
    comments = cached.comments
  } else {
    // Cache miss — fetch shallow (depth=0 only, fast)
    const data = await fetchStoryShallow(storyId).catch(() => null)
    if (!data) notFound()
    story = data.story
    comments = data.comments
    // Cache in background — don't await so page renders ASAP
    setCachedStory(storyId, story, comments).catch(console.error)
  }

  // Pre-generate summary after response is sent — will be instant when user clicks Summarize
  after(() => preSummarizeIfNeeded(storyId, story.title).catch(() => {}))

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Mobile: stacked layout */}
      <div className="md:hidden space-y-6">
        <StoryHeader story={story} />
        <SummarizeButton storyId={storyId} storyTitle={story.title} />
        <div>
          <h2 className="text-sm font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-4">
            Discussion
          </h2>
          <Suspense fallback={<Loader2 className="size-5 animate-spin text-[var(--muted-foreground)]" />}>
            <CommentThread comments={comments} totalCount={story.descendants ?? 0} />
          </Suspense>
        </div>
      </div>

      {/* Desktop: two-column immersive layout */}
      <div className="hidden md:grid md:grid-cols-[380px_1fr] gap-8">
        {/* Left panel: sticky */}
        <div className="sticky top-20 self-start space-y-6 max-h-[calc(100vh-6rem)] overflow-y-auto scrollbar-thin pr-2">
          <StoryHeader story={story} />
          <div className="border-t border-[var(--border-color)] pt-6">
            <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">
              AI Summary
            </p>
            <SummarizeButton storyId={storyId} storyTitle={story.title} />
          </div>
        </div>

        {/* Right panel: comments */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-base font-semibold">
              Discussion
              <span className="ml-2 text-sm font-normal text-[var(--muted-foreground)]">
                ({story.descendants ?? 0} comments)
              </span>
            </h2>
          </div>
          <Suspense fallback={<Loader2 className="size-5 animate-spin text-[var(--muted-foreground)]" />}>
            <CommentThread comments={comments} totalCount={story.descendants ?? 0} isDesktop />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
