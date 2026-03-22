import Link from 'next/link'
import { ExternalLink, ArrowLeft, MessageSquare, TrendingUp, Clock } from 'lucide-react'
import { timeAgo, getDomain } from '@/lib/time'
import { HNStory } from '@/lib/hn-api'

export function StoryHeader({ story }: { story: HNStory }) {
  const domain = getDomain(story.url)

  return (
    <div className="space-y-4">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
        <ArrowLeft className="size-4" />
        Back to feed
      </Link>

      <div>
        {domain && (
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--surface)] border border-[var(--border-color)] text-[var(--muted-foreground)]">
              {domain}
            </span>
          </div>
        )}

        <h1 className="text-xl md:text-2xl font-semibold text-[var(--foreground)] leading-snug mb-3">
          {story.title}
        </h1>

        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--muted-foreground)]">
          <span className="flex items-center gap-1 text-brand font-medium">
            <TrendingUp className="size-3.5" />
            {story.score} points
          </span>
          <span>by <span className="text-[var(--foreground)]">{story.by}</span></span>
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" />
            {timeAgo(story.time)}
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="size-3.5" />
            {story.descendants ?? 0} comments
          </span>
        </div>
      </div>

      {story.url && (
        <a
          href={story.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--surface)] border border-[var(--border-color)] text-sm hover:bg-[var(--surface-hover)] transition-colors"
        >
          <ExternalLink className="size-4 text-brand" />
          <span className="truncate max-w-xs">{domain ?? story.url}</span>
        </a>
      )}
    </div>
  )
}
