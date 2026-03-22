'use client'
import { useState, useEffect } from 'react'

type BookmarkEntry = { id: number; storyId: number }

export function useBookmarks() {
  const [bookmarkedIds, setBookmarkedIds] = useState<Map<number, number>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/bookmarks')
      .then(r => r.json())
      .then(({ bookmarks }) => {
        const map = new Map<number, number>()
        bookmarks?.forEach((b: BookmarkEntry) => map.set(b.storyId, b.id))
        setBookmarkedIds(map)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function toggle(story: {
    id: number; title: string; url?: string; by: string;
    score: number; descendants: number
  }) {
    const existingId = bookmarkedIds.get(story.id)
    if (existingId) {
      // Optimistic remove
      setBookmarkedIds(prev => { const m = new Map(prev); m.delete(story.id); return m })
      await fetch(`/api/bookmarks/${existingId}`, { method: 'DELETE' }).catch(() => {
        // Revert on failure
        setBookmarkedIds(prev => new Map(prev).set(story.id, existingId))
      })
    } else {
      // Optimistic add (use placeholder id)
      setBookmarkedIds(prev => new Map(prev).set(story.id, -1))
      const res = await fetch('/api/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyId: story.id, title: story.title, url: story.url,
          author: story.by, points: story.score, commentCount: story.descendants,
        }),
      })
      if (res.ok) {
        const { bookmark } = await res.json()
        setBookmarkedIds(prev => new Map(prev).set(story.id, bookmark.id))
      } else {
        setBookmarkedIds(prev => { const m = new Map(prev); m.delete(story.id); return m })
      }
    }
  }

  return {
    isBookmarked: (storyId: number) => bookmarkedIds.has(storyId),
    toggle,
    loading,
  }
}
