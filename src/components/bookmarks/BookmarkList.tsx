'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ExternalLink, MessageSquare, Trash2, BookmarkX } from 'lucide-react'
import { SearchBar } from './SearchBar'
import { timeAgo, getDomain } from '@/lib/time'
import { motion, AnimatePresence } from 'motion/react'

type Bookmark = {
  id: number; storyId: number; title: string; url?: string | null;
  author: string; points: number; commentCount: number; hnUrl: string; createdAt: string
}

export function BookmarkList() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  const fetchBookmarks = useCallback(async (q: string) => {
    try {
      const url = q ? `/api/search?q=${encodeURIComponent(q)}` : '/api/bookmarks'
      const res = await fetch(url)
      const data = await res.json()
      setBookmarks(data.bookmarks ?? [])
    } catch {}
  }, [])

  useEffect(() => {
    fetchBookmarks('').finally(() => setLoading(false))
  }, [fetchBookmarks])

  const handleSearch = useCallback((q: string) => {
    setQuery(q)
    fetchBookmarks(q)
  }, [fetchBookmarks])

  const handleRemove = async (bookmark: Bookmark) => {
    // Optimistic
    setBookmarks(prev => prev.filter(b => b.id !== bookmark.id))
    await fetch(`/api/bookmarks/${bookmark.id}`, { method: 'DELETE' }).catch(() => {
      setBookmarks(prev => [...prev, bookmark].sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ))
    })
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-[var(--surface)] animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <SearchBar onSearch={handleSearch} />

      {bookmarks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-[var(--muted-foreground)]">
          <BookmarkX className="size-10 opacity-30" />
          <p className="text-sm">{query ? 'No results found' : 'No bookmarks yet'}</p>
          {!query && <Link href="/" className="text-xs text-brand hover:underline">Browse stories</Link>}
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {bookmarks.map(bookmark => {
              const domain = getDomain(bookmark.url ?? undefined)
              return (
                <motion.div
                  key={bookmark.id}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20, height: 0 }}
                  transition={{ duration: 0.15 }}
                  className="p-4 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl hover:bg-[var(--surface)] transition-colors"
                >
                  {domain && (
                    <p className="text-xs text-[var(--muted-foreground)] mb-1">{domain}</p>
                  )}
                  <Link href={`/story/${bookmark.storyId}`} className="block">
                    <h3 className="text-base font-medium text-[var(--foreground)] hover:text-brand transition-colors leading-snug mb-2">
                      {bookmark.title}
                    </h3>
                  </Link>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
                      <span className="text-brand font-medium">{bookmark.points} pts</span>
                      <span>by {bookmark.author}</span>
                      <span>{timeAgo(new Date(bookmark.createdAt).getTime() / 1000)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/story/${bookmark.storyId}`}
                        className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                      >
                        <MessageSquare className="size-3.5" />
                      </Link>
                      {bookmark.url && (
                        <a
                          href={bookmark.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      )}
                      <button
                        onClick={() => handleRemove(bookmark)}
                        className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-red-500 hover:bg-[var(--muted)] transition-colors"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
