'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { cn, getScoreBadgeStyle, formatDate } from '@/lib/utils'

interface LibraryItem {
  id: string
  created_at: string
  image_url: string
  aspect_ratio: string
  variant_number: number
  archetype: string
  brief_json: Record<string, unknown>
  final_score: number | null
  score_label: string | null
  session_interface: string
}

export default function CreativeLibrary() {
  const [items, setItems] = useState<LibraryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    loadLibrary()
  }, [])

  async function loadLibrary() {
    try {
      const res = await fetch('/api/library')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setItems(data.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load library')
    } finally {
      setLoading(false)
    }
  }

  function handleReiterate(item: LibraryItem) {
    // Build a complete brief for chat iteration (fill defaults for any missing fields)
    const stored = item.brief_json as Record<string, unknown>
    const brief = {
      persona: (stored.persona as string) || '',
      jtbd: (stored.jtbd as string) || (stored.cta_text as string) || '',
      product: (stored.product as string) || '',
      pain_or_aspiration: (stored.pain_or_aspiration as string) || 'COMBINATION',
      platform: (stored.platform as string) || 'Feed',
      aspect_ratios: (stored.aspect_ratios as string[]) || [item.aspect_ratio || '4:5'],
      brand_constraints: (stored.brand_constraints as string) || 'none',
      archetype: (stored.archetype as string) || item.archetype || 'AUTO_SELECT',
      hook_concept: (stored.hook_concept as string) || '',
      psychological_trigger: (stored.psychological_trigger as string) || '',
      cta_text: (stored.cta_text as string) || '',
      emotional_lane: (stored.emotional_lane as string) || 'ASPIRATION',
    }
    const params = new URLSearchParams({ brief: encodeURIComponent(JSON.stringify(brief)) })
    router.push(`/chat?${params.toString()}`)
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-white">Creative Library</h1>
          <p className="text-zinc-400 text-sm mt-1">All your generated creatives</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="aspect-[4/5] rounded-xl shimmer" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="bg-red-950 border border-red-800 rounded-xl p-6 text-center">
          <p className="text-red-400">{error}</p>
          <button onClick={loadLibrary} className="mt-3 text-sm text-red-300 hover:text-red-200 underline">
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-white">Creative Library</h1>
        </div>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-zinc-400 text-sm">No creatives yet.</p>
          <p className="text-zinc-600 text-xs mt-1">Generate your first creative in Chat or Quick Form.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 pb-20 md:pb-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Creative Library</h1>
        <p className="text-zinc-400 text-sm mt-1">{items.length} creative{items.length !== 1 ? 's' : ''} generated</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {items.map(item => (
          <LibraryCard
            key={item.id}
            item={item}
            onReiterate={handleReiterate}
          />
        ))}
      </div>
    </div>
  )
}

function LibraryCard({
  item,
  onReiterate,
}: {
  item: LibraryItem
  onReiterate: (item: LibraryItem) => void
}) {
  const [showOverlay, setShowOverlay] = useState(false)

  const aspectClass = item.aspect_ratio === '9:16' ? 'aspect-[9/16]' :
    item.aspect_ratio === '1:1' ? 'aspect-square' : 'aspect-[4/5]'

  return (
    <div
      className="relative group rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 cursor-pointer"
      onClick={() => setShowOverlay(true)}
    >
      <div className={cn('relative', aspectClass)}>
        <Image
          src={item.image_url}
          alt="Creative"
          fill
          className="object-cover"
          unoptimized
        />

        {/* Score badge */}
        {item.final_score !== null && item.score_label && (
          <div className="absolute top-2 left-2">
            <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', getScoreBadgeStyle(item.score_label))}>
              {Math.round(item.final_score)}
            </span>
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-end p-3">
          <div className="w-full space-y-1">
            <p className="text-xs text-zinc-300 line-clamp-2">
              {(item.brief_json?.hook_concept as string) || (item.brief_json?.product as string) || 'Creative'}
            </p>
            <p className="text-xs text-zinc-500">{formatDate(item.created_at)}</p>
          </div>
        </div>
      </div>

      {/* Full overlay modal */}
      {showOverlay && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowOverlay(false)}
        >
          <div
            className="bg-zinc-900 rounded-2xl overflow-hidden max-w-sm w-full"
            onClick={e => e.stopPropagation()}
          >
            <div className={cn('relative', aspectClass)}>
              <Image
                src={item.image_url}
                alt="Creative"
                fill
                className="object-cover"
                unoptimized
              />
            </div>

            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {item.final_score !== null && item.score_label ? (
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', getScoreBadgeStyle(item.score_label))}>
                      {Math.round(item.final_score)} — {item.score_label}
                    </span>
                  ) : (
                    <span className="text-zinc-500 text-xs">No score</span>
                  )}
                </div>
                <span className="text-zinc-600 text-xs">{item.aspect_ratio}</span>
              </div>

              <p className="text-xs text-zinc-400 line-clamp-3">
                {(item.brief_json?.hook_concept as string) || (item.brief_json?.product as string) || '—'}
              </p>

              <div className="flex gap-2">
                <a
                  href={`${item.image_url}?download=1`}
                  download={`creative-${item.id}.png`}
                  onClick={e => e.stopPropagation()}
                  className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium py-2 rounded-xl transition flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download
                </a>
                <button
                  onClick={() => { setShowOverlay(false); onReiterate(item) }}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium py-2 rounded-xl transition flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Iterate
                </button>
              </div>
            </div>

            <button
              onClick={() => setShowOverlay(false)}
              className="absolute top-3 right-3 bg-black/60 p-1.5 rounded-lg hover:bg-black/80 transition"
            >
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
