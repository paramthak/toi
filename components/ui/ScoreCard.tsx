'use client'

import { useState } from 'react'
import { cn, getScoreBadgeStyle, getScoreRingColor } from '@/lib/utils'
import type { ScoringResult } from '@/lib/openai'

const FACTOR_LABELS: Record<string, string> = {
  visual_hierarchy: 'Visual Hierarchy',
  psychological_trigger: 'Psychological Trigger',
  human_element: 'Human Element',
  cta_execution: 'CTA Execution',
  information_architecture: 'Info Architecture',
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

const ARCHETYPE_NAME: Record<string, string> = {
  UGC_STYLE: 'UGC Style',
  HIGH_INFORMATION: 'High-Information',
  BEFORE_AFTER: 'Before / After',
  MINIMALIST: 'Minimalist',
  TESTIMONIAL_SCREENSHOT: 'Testimonial Screenshot',
  UGLY_ANTI_DESIGN: 'Ugly / Anti-Design',
  PATTERN_INTERRUPT: 'Pattern Interrupt',
  MEME_IFIED: 'Meme-ified',
  AUTO_SELECT: 'Auto-Selected',
}

const ARCHETYPE_WHY_SHORT: Record<string, string> = {
  UGC_STYLE: 'Authentic look lowers ad guard — viewers engage as if it\'s organic content',
  HIGH_INFORMATION: 'Feature-dense layout answers objections before they arise for decision-mode audiences',
  BEFORE_AFTER: 'Visual pain-to-resolution contrast creates an emotional gap that drives clicks',
  MINIMALIST: 'Visual isolation forces undivided attention onto the single message',
  TESTIMONIAL_SCREENSHOT: 'Screenshot-style social proof feels earned, not manufactured — specificity drives credibility',
  UGLY_ANTI_DESIGN: 'Deliberate imperfection signals no manipulation budget, building involuntary trust',
  PATTERN_INTERRUPT: 'Visual anomaly triggers involuntary orienting reflex — the brain cannot scroll past it',
  MEME_IFIED: 'Familiar format lowers cognitive load while hijacking existing emotional associations',
  AUTO_SELECT: 'Highest-performing pattern selected for this specific audience and product',
}

function getTopFactors(factors: ScoringResult['click_through_factors']): Array<{ key: string; value: number }> {
  return Object.entries(factors)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([key, value]) => ({ key, value }))
}

interface ScoreCardProps {
  scoring: ScoringResult
  loading?: boolean
  archetype?: string
  generationId?: string
  logoUrl?: string
  productPhotoUrl?: string
  onRegenerateStart?: () => void
  onRegenerate?: (generationId: string, imageUrl: string) => void
  onRegenStatus?: (msg: string) => void
}

export default function ScoreCard({
  scoring,
  loading,
  archetype,
  generationId,
  logoUrl,
  productPhotoUrl,
  onRegenerateStart,
  onRegenerate,
  onRegenStatus,
}: ScoreCardProps) {
  const [regenerating, setRegenerating] = useState(false)
  const [regenStatus, setRegenStatus] = useState('')
  const [regenerateError, setRegenerateError] = useState<string | null>(null)

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
  const gatePassed = scoring.scroll_stop_gate.gate_passed
  const archetypeKey = archetype || 'AUTO_SELECT'
  const topFactors = getTopFactors(scoring.click_through_factors)

  async function handleRegenerate() {
    if (!generationId) return
    setRegenerating(true)
    setRegenStatus('')
    setRegenerateError(null)
    onRegenerateStart?.()

    try {
      const res = await fetch('/api/regenerate-improved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generationId, logoUrl, productPhotoUrl }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Regeneration failed')
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as { type: string; [key: string]: unknown }
            if (event.type === 'status') {
              const msg = event.message as string
              setRegenStatus(msg)
              onRegenStatus?.(msg)
            } else if (event.type === 'generation') {
              const data = event.data as { generationId: string; imageUrl: string }
              onRegenerate?.(data.generationId, data.imageUrl)
            } else if (event.type === 'error') {
              throw new Error((event.error as string) || 'Regeneration failed')
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue
            throw parseErr
          }
        }
      }
    } catch (err) {
      setRegenerateError(err instanceof Error ? err.message : 'Regeneration failed')
    } finally {
      setRegenerating(false)
      setRegenStatus('')
    }
  }

  return (
    <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
      {/* Header — score ring + label */}
      <div className="p-5 flex items-center gap-4 border-b border-zinc-800">
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
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', getScoreBadgeStyle(scoring.score_label))}>
              {scoring.score_label}
            </span>
            {gatePassed ? (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">
                Gate ✓
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-950 text-red-400 border border-red-800">
                Gate ✗
              </span>
            )}
          </div>
          <p className="text-zinc-400 text-xs leading-relaxed line-clamp-2">
            {scoring.scroll_stop_diagnosis}
          </p>
        </div>
      </div>

      {/* Gate failure banner */}
      {!gatePassed && (
        <div className="mx-4 mt-4 bg-red-950/60 border border-red-800 rounded-xl px-3 py-2.5">
          <p className="text-xs font-semibold text-red-400 mb-0.5">Scroll-stop gate failed</p>
          <p className="text-xs text-red-300/80 leading-relaxed">
            Visual hook score: <span className="font-mono text-red-300">{scoring.scroll_stop_gate.visual_hook_score.toFixed(2)}</span> ·
            Pattern interrupt: <span className="font-mono text-red-300">{scoring.scroll_stop_gate.pattern_interrupt_score.toFixed(2)}</span>.
            Score capped at 45 — the sub-scores below are accurate but the ad will not be served until the hook arrests attention.
          </p>
        </div>
      )}

      {/* Why this creative works */}
      <div className="mx-4 mt-4 bg-indigo-950/30 border border-indigo-800/40 rounded-xl px-3 py-3">
        <p className="text-xs font-semibold text-indigo-400 mb-2 uppercase tracking-wider">Why this creative works</p>
        <ul className="space-y-1.5">
          <li className="flex items-start gap-2 text-xs text-zinc-300">
            <span className="text-indigo-400 mt-0.5 flex-shrink-0">▸</span>
            <span>
              <span className="font-semibold text-indigo-300">{ARCHETYPE_NAME[archetypeKey] || archetypeKey}:</span>{' '}
              {ARCHETYPE_WHY_SHORT[archetypeKey] || 'Proven engagement pattern selected for this audience'}
            </span>
          </li>
          {topFactors[0] && (
            <li className="flex items-start gap-2 text-xs text-zinc-300">
              <span className="text-indigo-400 mt-0.5 flex-shrink-0">▸</span>
              <span>
                <span className="font-semibold text-zinc-200">{FACTOR_LABELS[topFactors[0].key]}:</span>{' '}
                scored {topFactors[0].value} — strongest element driving click intent
              </span>
            </li>
          )}
          {topFactors[1] && (
            <li className="flex items-start gap-2 text-xs text-zinc-300">
              <span className="text-indigo-400 mt-0.5 flex-shrink-0">▸</span>
              <span>
                <span className="font-semibold text-zinc-200">{FACTOR_LABELS[topFactors[1].key]}:</span>{' '}
                scored {topFactors[1].value} — supporting the primary hook
              </span>
            </li>
          )}
          {gatePassed && (
            <li className="flex items-start gap-2 text-xs text-zinc-300">
              <span className="text-emerald-400 mt-0.5 flex-shrink-0">▸</span>
              <span>Gate score: <span className="font-semibold text-emerald-300">{scoring.scroll_stop_gate.gate_score.toFixed(2)}</span> — visual hook passed the scroll-stop threshold</span>
            </li>
          )}
        </ul>
      </div>

      {/* Factor bars */}
      <div className="p-4 pt-3 space-y-2.5">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Factor Breakdown</p>
        {Object.entries(scoring.click_through_factors).map(([key, value]) => (
          <div key={key}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-zinc-400">{FACTOR_LABELS[key] || key}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-600">{FACTOR_WEIGHTS[key]}%</span>
                <span className={cn(
                  'text-xs font-semibold',
                  !gatePassed ? 'text-zinc-500' :
                  value >= 75 ? 'text-green-400' : value >= 50 ? 'text-yellow-400' : 'text-red-400'
                )}>{value}</span>
              </div>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${value}%`,
                  backgroundColor: !gatePassed ? '#52525b' :
                    value >= 75 ? '#22c55e' : value >= 50 ? '#eab308' : '#ef4444',
                }}
              />
            </div>
          </div>
        ))}
        {!gatePassed && (
          <p className="text-xs text-zinc-600 italic pt-1">Bars dimmed — gate failure prevents these scores from contributing to final result</p>
        )}
      </div>

      {/* Improvement tips */}
      {scoring.improvement_tips?.length > 0 && (
        <div className="border-t border-zinc-800 p-4 space-y-3">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Improvement Tips
          </p>
          {scoring.improvement_tips.map((tip, i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex gap-2.5 items-start">
                <div className={cn(
                  'flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold mt-0.5',
                  tip.impact === 'High' ? 'bg-red-950 text-red-400' :
                  tip.impact === 'Medium' ? 'bg-amber-950 text-amber-400' :
                  'bg-zinc-800 text-zinc-400'
                )}>
                  {tip.priority}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-zinc-200 leading-relaxed">{tip.tip}</p>
                  <span className={cn(
                    'text-xs font-semibold',
                    tip.impact === 'High' ? 'text-red-400' :
                    tip.impact === 'Medium' ? 'text-amber-400' : 'text-zinc-500'
                  )}>{tip.impact} impact · {tip.factor.replace(/_/g, ' ')}</span>
                </div>
              </div>
              {tip.prompt_addition && (
                <div className="ml-7 bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2">
                  <p className="text-xs text-zinc-500 mb-1 font-medium">Add to prompt:</p>
                  <p className="text-xs text-zinc-300 font-mono leading-relaxed">{tip.prompt_addition}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Regenerate button */}
      {generationId && (
        <div className="border-t border-zinc-800 p-4">
          {regenerateError && (
            <p className="text-xs text-red-400 mb-2">{regenerateError}</p>
          )}
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 rounded-xl transition flex items-center justify-center gap-2"
          >
            {regenerating ? (
              <>
                <svg className="w-4 h-4 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="truncate">{regenStatus || 'Regenerating with improvements...'}</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Regenerate with all improvements →
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
