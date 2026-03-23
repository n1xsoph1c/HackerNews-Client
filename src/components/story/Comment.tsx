'use client'
import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
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
  const [loadedChildren, setLoadedChildren] = useState<HNComment[]>(comment.children ?? [])
  const [loadingReplies, setLoadingReplies] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const depthColor = DEPTH_COLORS[Math.min(comment.depth, 3)]
  // True when kids exist on HN but haven't been fetched yet
  const hasUnloaded = (comment.kids?.length ?? 0) > 0 && loadedChildren.length === 0
  const hasReplies = loadedChildren.length > 0
  // Total reply count — show before loading
  const replyCount = hasReplies ? loadedChildren.length : (comment.kids?.length ?? 0)

  async function loadReplies() {
    if (loadingReplies || !hasUnloaded) return
    setLoadingReplies(true)
    abortRef.current = new AbortController()
    try {
      const res = await fetch(`/api/comments/${comment.id}/replies`, {
        signal: abortRef.current.signal,
      })
      const { replies } = await res.json()
      setLoadedChildren(replies)
    } catch {
      // AbortError on unmount or network error — silently ignore
    } finally {
      setLoadingReplies(false)
    }
  }

  // Auto-load replies for depth < 2 (preserves current UX where shallow comments auto-expand)
  useEffect(() => {
    if (comment.depth < 2 && hasUnloaded) {
      loadReplies()
    }
    return () => abortRef.current?.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Listen for reveal events from "Worth Reading" clicks — expand if target is in this subtree
  useEffect(() => {
    function containsId(c: HNComment, id: number): boolean {
      if (c.id === id) return true
      return c.children.some(child => containsId(child, id))
    }

    function onReveal(e: Event) {
      const { id } = (e as CustomEvent<{ id: number }>).detail
      const inChildren = comment.children.some(c => containsId(c, id))
      const inKids = (comment.kids ?? []).includes(id)
      if (inChildren || inKids) {
        setExpanded(true)
        if (hasUnloaded) loadReplies()
      }
    }

    window.addEventListener('hn:reveal-comment', onReveal)
    return () => window.removeEventListener('hn:reveal-comment', onReveal)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comment.children, comment.kids, hasUnloaded])

  async function handleExpand() {
    if (hasUnloaded) await loadReplies()
    setExpanded(e => !e)
  }

  if (!comment.text && !hasReplies && !hasUnloaded) return null

  const showToggle = replyCount > 0

  return (
    <div id={`comment-${comment.id}`} className={isDesktop ? 'relative' : ''}>
      <div
        className={`pl-3 border-l-2 ${depthColor} ${comment.depth > 0 ? (isDesktop ? 'ml-6' : 'ml-3') : ''}`}
      >
        {/* Comment header */}
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs font-medium text-brand">{comment.by ?? '[deleted]'}</span>
          <span className="text-xs text-[var(--muted-foreground)]">{timeAgo(comment.time)}</span>
          {showToggle && (
            <button
              onClick={handleExpand}
              className="ml-auto flex items-center gap-0.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              {loadingReplies ? (
                <Loader2 className="size-3 animate-spin" />
              ) : expanded ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              <span>{replyCount} {replyCount === 1 ? 'reply' : 'replies'}</span>
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
              {loadedChildren.map(child => (
                <Comment key={child.id} comment={child} isDesktop={isDesktop} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
