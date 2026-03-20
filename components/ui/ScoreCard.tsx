'use client'

import { cn, getScoreBadgeStyle, getScoreRingColor, formatScore } from '@/lib/utils'
import type { ScoringResult } from '@/lib/gemini'

interface ScoreCardProps {
  scoring: ScoringResult
  loading?: boolean
}

const FACTOR_LABELS: Record<string, string> = {
  visual_hierarchy: 'Visual Hierarchy',
  psychological_trigger: 'Psychological Trigger',
  human_element: 'Human Element',
  cta_execution: 'CTA Execution',
  information_architecture: 'Information Architecture',
  color_contrast: 'Colour & Contrast',
  platform_fit: 'Platform Fit',
}

const FACTOR_WEIGHTS: Record<string, number> = {
  visual_hierarchy: 22,
  psychological_trigger: 20,
  human_element: 15,
  cta_execution: 13,
  information_architecture: 12,
  color_contrast: 10,
  platform_fit: 8,
}

export default function ScoreCard({ scoring, loading }: ScoreCardProps) {
  if (loading) {
    return (
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full shimmer" />
          <div className="flex-1 space-y-2">
            <div className="h-5 w-24 rounded shimmer" />
            <div className="h-3 w-36 rounded shimmer" />
          </div>
        </div>
        <p className="text-zinc-500 text-sm">Analysing your creative...</p>
        <div className="flex gap-1">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-1.5 flex-1 rounded-full shimmer" />
          ))}
        </div>
      </div>
    )
  }

  const score = Math.round(scoring.final_score)
  const circumference = 2 * Math.PI * 45
  const offset = circumference - (score / 100) * circumference
  const ringColor = getScoreRingColor(score)

  return (
    <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
      {/* Header */}
      <div className="p-5 flex items-center gap-4 border-b border-zinc-800">
        {/* Score ring */}
        <div className="relative flex-shrink-0">
          <svg width="64" height="64" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="45" fill="none" stroke="#27272a" strokeWidth="8" />
            <circle
              cx="50" cy="50" r="45"
              fill="none"
              stroke={ringColor}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              transform="rotate(-90 50 50)"
              style={{ transition: 'stroke-dashoffset 1s ease-out' }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-lg font-bold text-white">{score}</span>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', getScoreBadgeStyle(scoring.score_label))}>
              {scoring.score_label}
            </span>
          </div>
          <p className="text-zinc-400 text-xs leading-relaxed line-clamp-2">
            {scoring.scroll_stop_diagnosis}
          </p>
        </div>
      </div>

      {/* Factor bars */}
      <div className="p-4 space-y-2.5">
        {Object.entries(scoring.click_through_factors).map(([key, value]) => (
          <div key={key}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-zinc-400">{FACTOR_LABELS[key] || key}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">{FACTOR_WEIGHTS[key]}%</span>
                <span className={cn(
                  'text-xs font-semibold',
                  value >= 75 ? 'text-green-400' : value >= 50 ? 'text-yellow-400' : 'text-red-400'
                )}>{value}</span>
              </div>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${value}%`,
                  backgroundColor: value >= 75 ? '#22c55e' : value >= 50 ? '#eab308' : '#ef4444',
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Improvement tips */}
      {scoring.improvement_tips?.length > 0 && (
        <div className="border-t border-zinc-800 p-4 space-y-3">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Improvement Tips
          </p>
          {scoring.improvement_tips.map((tip, i) => (
            <div key={i} className="flex gap-3">
              <div className={cn(
                'flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold mt-0.5',
                tip.impact === 'High' ? 'bg-red-950 text-red-400' :
                tip.impact === 'Medium' ? 'bg-yellow-950 text-yellow-400' :
                'bg-zinc-800 text-zinc-400'
              )}>
                {tip.priority}
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">{tip.tip}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
