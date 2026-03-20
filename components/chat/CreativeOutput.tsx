'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { cn, getScoreBadgeStyle } from '@/lib/utils'
import ScoreCard from '@/components/ui/ScoreCard'
import type { ScoringResult } from '@/lib/gemini'

interface Generation {
  id: string
  imageUrl: string
  metaPrompt: string
  archetype: string
  aspectRatio: string
  variantNumber: number
  scoring?: ScoringResult
  scoringLoading?: boolean
  scoringError?: string
}

interface CreativeOutputProps {
  generations: Generation[]
  isGenerating: boolean
  briefConcept?: string
  logoUrl?: string | null
  productPhotoUrl?: string | null
  isRegeneratingImproved?: boolean
  onRegenerateStart?: () => void
  onAddGeneration?: (gen: Generation) => void
}

export default function CreativeOutput({ generations, isGenerating, briefConcept, logoUrl, productPhotoUrl, isRegeneratingImproved, onRegenerateStart, onAddGeneration }: CreativeOutputProps) {
  const [selectedIdx, setSelectedIdx] = useState(0)

  useEffect(() => {
    // Auto-select latest variant
    if (generations.length > 0) {
      setSelectedIdx(generations.length - 1)
    }
  }, [generations.length])

  if ((isGenerating && generations.length === 0) || isRegeneratingImproved) {
    return (
      <div className="flex flex-col items-center justify-center p-8 space-y-4">
        <div className="relative w-full max-w-xs aspect-[4/5] rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800">
          <div className="shimmer absolute inset-0" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-zinc-400 text-sm text-center leading-relaxed">
              {isRegeneratingImproved ? 'Applying improvements...' : briefConcept}
            </p>
          </div>
        </div>
        <p className="text-zinc-500 text-xs">
          {isRegeneratingImproved ? 'Regenerating with all improvements...' : 'Generating your creative...'}
        </p>
      </div>
    )
  }

  if (generations.length === 0) return null

  const selected = generations[selectedIdx] ?? generations[0]

  return (
    <div className="space-y-4">
      {/* Main image */}
      <div className={cn(
        'relative w-full max-w-sm mx-auto rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800',
        selected.aspectRatio === '9:16' ? 'aspect-[9/16]' :
        selected.aspectRatio === '1:1' ? 'aspect-square' :
        'aspect-[4/5]'
      )}>
        <Image
          src={selected.imageUrl}
          alt="Generated creative"
          fill
          className="object-cover"
          unoptimized
        />

        {/* Download button */}
        <a
          href={selected.imageUrl}
          download={`creative-${selected.id}.png`}
          className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm hover:bg-black/80 transition p-2 rounded-lg"
        >
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </a>

        {/* Aspect ratio badge */}
        <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-lg text-xs text-zinc-300">
          {selected.aspectRatio}
        </div>
      </div>

      {/* Variant selector */}
      {generations.length > 1 && (
        <div className="flex gap-2 flex-wrap justify-center">
          {generations.map((gen, i) => (
            <button
              key={gen.id}
              onClick={() => setSelectedIdx(i)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition',
                i === selectedIdx
                  ? 'bg-indigo-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              )}
            >
              Variant {gen.variantNumber}
              {gen.scoring && (
                <span className={cn('ml-1.5 px-1.5 py-0.5 rounded text-xs', getScoreBadgeStyle(gen.scoring.score_label))}>
                  {Math.round(gen.scoring.final_score)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Score card */}
      {(selected.scoring || selected.scoringLoading) && (
        <ScoreCard
          scoring={selected.scoring!}
          loading={selected.scoringLoading && !selected.scoring}
          archetype={selected.archetype}
          generationId={selected.id}
          logoUrl={logoUrl || undefined}
          productPhotoUrl={productPhotoUrl || undefined}
          onRegenerate={(newGenId, newImageUrl) => {
            onAddGeneration?.({
              id: newGenId,
              imageUrl: newImageUrl,
              metaPrompt: '',
              archetype: selected.archetype,
              aspectRatio: selected.aspectRatio,
              variantNumber: generations.length + 1,
              scoringLoading: true,
            })
          }}
        />
      )}
      {selected.scoringError && !selected.scoring && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-zinc-500 text-sm text-center">
          Score unavailable for this creative.
        </div>
      )}
    </div>
  )
}
