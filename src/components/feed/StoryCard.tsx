'use client'
import Link from 'next/link'
import { MessageSquare, ExternalLink, Bookmark, BookmarkCheck } from 'lucide-react'
import { timeAgo, getDomain } from '@/lib/time'
import { HNStory } from '@/lib/hn-api'

type Props = {
  story: HNStory
  isBookmarked: boolean
  onBookmark: (story: HNStory) => void
  showRemove?: boolean
  onRemove?: () => void
}

export function StoryCard({ story, isBookmarked, onBookmark, showRemove, onRemove }: Props) {
  const domain = getDomain(story.url)

  return (
    <div className="group p-4 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl hover:border-[var(--surface-hover)] hover:bg-[var(--surface)] transition-all duration-200">
      {/* Source domain */}
      {domain && (
        <div className="text-xs text-[var(--muted-foreground)] mb-1.5 flex items-center gap-1">
          <span>{domain}</span>
        </div>
      )}

      {/* Title */}
      <Link href={`/story/${story.id}`} className="block">
        <h2 className="text-base font-medium text-[var(--foreground)] group-hover:text-brand transition-colors leading-snug mb-2">
          {story.title}
        </h2>
      </Link>

      {/* Meta row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
          <span className="font-medium text-brand">{story.score} pts</span>
          <span>by {story.by}</span>
          <span>{timeAgo(story.time)}</span>
        </div>

        <div className="flex items-center gap-1">
          {/* External link */}
          {story.url && (
            <a
              href={story.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <ExternalLink className="size-3.5" />
            </a>
          )}

          {/* Comments link */}
          <Link
            href={`/story/${story.id}`}
            className="flex items-center gap-1 p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <MessageSquare className="size-3.5" />
            <span className="text-xs">{story.descendants ?? 0}</span>
          </Link>

          {/* Bookmark button */}
          {showRemove ? (
            <button
              onClick={onRemove}
              className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-red-500 hover:bg-[var(--muted)] transition-colors"
            >
              <Bookmark className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              onClick={() => onBookmark(story)}
              className={`p-1.5 rounded-lg transition-colors ${
                isBookmarked
                  ? 'text-brand hover:text-brand/80'
                  : 'text-[var(--muted-foreground)] hover:text-brand hover:bg-[var(--muted)]'
              }`}
            >
              {isBookmarked ? <BookmarkCheck className="size-3.5" /> : <Bookmark className="size-3.5" />}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
