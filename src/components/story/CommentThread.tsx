import { HNComment } from '@/lib/hn-api'
import { Comment } from './Comment'
import { MessageSquare } from 'lucide-react'

type Props = {
  comments: HNComment[]
  totalCount: number
}

export function CommentThread({ comments, totalCount }: Props) {
  if (comments.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-[var(--muted-foreground)]">
        <MessageSquare className="size-8 opacity-30" />
        <p className="text-sm">No comments yet</p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-xs text-[var(--muted-foreground)] mb-4">
        Showing {comments.length} of {totalCount} comments
      </p>
      <div className="space-y-4">
        {comments.map(comment => (
          <div key={comment.id} className="pb-4 border-b border-[var(--border-color)] last:border-0">
            <Comment comment={comment} isDesktop={false} />
          </div>
        ))}
      </div>
    </div>
  )
}
