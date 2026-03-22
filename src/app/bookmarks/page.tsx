import { BookmarkList } from '@/components/bookmarks/BookmarkList'

export default function BookmarksPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-xl font-semibold mb-6">Saved Stories</h1>
      <BookmarkList />
    </div>
  )
}
