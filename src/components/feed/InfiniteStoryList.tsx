'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { StoryCard } from './StoryCard'
import { useBookmarks } from '@/hooks/useBookmarks'
import { HNStory } from '@/lib/hn-api'
import { Loader2 } from 'lucide-react'

type Props = {
  initialStories: HNStory[]
  feedType: string
}

export function InfiniteStoryList({ initialStories, feedType }: Props) {
  const [stories, setStories] = useState<HNStory[]>(initialStories)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const { isBookmarked, toggle } = useBookmarks()
  const observerRef = useRef<IntersectionObserver | null>(null)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  // Reset when feed type changes
  useEffect(() => {
    setStories(initialStories)
    setPage(1)
    setHasMore(true)
  }, [feedType, initialStories])

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return
    setLoading(true)
    try {
      const nextPage = page + 1
      const res = await fetch(`/api/stories?type=${feedType}&page=${nextPage}`)
      const data = await res.json()
      const newStories: HNStory[] = data.stories ?? []
      if (newStories.length === 0) {
        setHasMore(false)
      } else {
        setStories(prev => [...prev, ...newStories])
        setPage(nextPage)
      }
    } catch {
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }, [loading, hasMore, page, feedType])

  useEffect(() => {
    if (!loadMoreRef.current) return
    observerRef.current?.disconnect()
    observerRef.current = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore() },
      { rootMargin: '200px' }
    )
    observerRef.current.observe(loadMoreRef.current)
    return () => observerRef.current?.disconnect()
  }, [loadMore])

  return (
    <div className="space-y-2">
      {stories.map(story => (
        <StoryCard
          key={story.id}
          story={story}
          isBookmarked={isBookmarked(story.id)}
          onBookmark={toggle}
        />
      ))}
      <div ref={loadMoreRef} className="py-4 flex justify-center">
        {loading && <Loader2 className="size-5 text-[var(--muted-foreground)] animate-spin" />}
        {!hasMore && stories.length > 0 && (
          <p className="text-xs text-[var(--muted-foreground)]">You've reached the end</p>
        )}
      </div>
    </div>
  )
}
