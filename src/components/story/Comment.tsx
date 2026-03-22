'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { timeAgo } from '@/lib/time'
import { HNComment } from '@/lib/hn-api'

const DEPTH_COLORS = [
  'border-l-[var(--color-depth-0)]',
  'border-l-[var(--color-depth-1)]',
  'border-l-[var(--color-depth-2)]',
  'border-l-[var(--color-depth-3)]',
]

type Props = {
  comment: HNComment
  isDesktop?: boolean
}

export function Comment({ comment, isDesktop = false }: Props) {
  const [expanded, setExpanded] = useState(comment.depth < 2)
  const depthColor = DEPTH_COLORS[Math.min(comment.depth, 3)]
  const hasReplies = comment.children && comment.children.length > 0

  if (!comment.text && !hasReplies) return null

  return (
    <div className={isDesktop ? 'relative' : ''}>
      <div
        className={`pl-3 border-l-2 ${depthColor} ${comment.depth > 0 ? (isDesktop ? 'ml-6' : 'ml-3') : ''}`}
      >
        {/* Comment header */}
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs font-medium text-brand">{comment.by ?? '[deleted]'}</span>
          <span className="text-xs text-[var(--muted-foreground)]">{timeAgo(comment.time)}</span>
          {hasReplies && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="ml-auto flex items-center gap-0.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              <span>{comment.children.length} {comment.children.length === 1 ? 'reply' : 'replies'}</span>
            </button>
          )}
        </div>

        {/* Comment body — HN HTML */}
        {comment.text && (
          <div
            className="hn-text text-sm text-[var(--foreground)] leading-relaxed mb-2"
            dangerouslySetInnerHTML={{ __html: comment.text }}
          />
        )}

        {/* Nested replies */}
        <AnimatePresence>
          {hasReplies && expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden space-y-3 mt-3"
            >
              {comment.children.map(child => (
                <Comment key={child.id} comment={child} isDesktop={isDesktop} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
