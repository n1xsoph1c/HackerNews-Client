import { Suspense } from 'react'
import { fetchFeed } from '@/lib/hn-api'
import { FeedTabs } from '@/components/feed/FeedTabs'
import { InfiniteStoryList } from '@/components/feed/InfiniteStoryList'
import { Loader2 } from 'lucide-react'

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>
}) {
  const { type } = await searchParams
  const feedType = (type === 'new' || type === 'best') ? type : 'top'

  const stories = await fetchFeed(feedType, 1).catch(() => [])

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Hacker News</h1>
        <FeedTabs active={feedType} />
      </div>
      <Suspense fallback={<Loader2 className="mx-auto size-5 animate-spin text-[var(--muted-foreground)]" />}>
        <InfiniteStoryList initialStories={stories} feedType={feedType} />
      </Suspense>
    </div>
  )
}
