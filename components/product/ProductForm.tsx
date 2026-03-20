'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import ScoreCard from '@/components/ui/ScoreCard'
import Image from 'next/image'
import type { ScoringResult } from '@/lib/gemini'

const ARCHETYPES = [
  { value: 'AUTO', label: 'Auto (Recommended)', description: 'System picks highest-CTR approach' },
  { value: 'UGC_STYLE', label: 'UGC Style', description: 'Authentic, phone-shot look' },
  { value: 'UGLY_ANTI_DESIGN', label: 'Ugly / Anti-Design', description: 'Deliberately violates design norms' },
  { value: 'MINIMALIST', label: 'Minimalist', description: 'Single focal point, lots of space' },
  { value: 'HIGH_INFORMATION', label: 'High-Information', description: 'Feature-dense with bullets' },
  { value: 'BEFORE_AFTER', label: 'Before / After', description: 'Split transformation visual' },
  { value: 'TESTIMONIAL_SCREENSHOT', label: 'Testimonial', description: 'Screenshot or review style' },
  { value: 'PATTERN_INTERRUPT', label: 'Pattern Interrupt', description: 'Maximum scroll-stop anomaly' },
  { value: 'MEME_IFIED', label: 'Meme-ified', description: 'Cultural format hijack' },
]

const ASPECT_RATIOS = [
  { value: '4:5', label: 'Feed (4:5)', sublabel: '1080×1350' },
  { value: '9:16', label: 'Stories (9:16)', sublabel: '1080×1920' },
  { value: '1:1', label: 'Reels Cover (1:1)', sublabel: '1080×1080' },
]

interface GenerationResult {
  id: string
  imageUrl: string
  aspectRatio: string
  variantNumber: number
  scoring?: ScoringResult
  scoringLoading?: boolean
}

export default function ProductForm() {
  const [persona, setPersona] = useState('')
  const [cta, setCta] = useState('')
  const [product, setProduct] = useState('')
  const [aspectRatios, setAspectRatios] = useState<string[]>(['4:5'])
  const [archetype, setArchetype] = useState('AUTO')
  const [variantCount, setVariantCount] = useState(1)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generations, setGenerations] = useState<GenerationResult[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  function validate() {
    const errs: Record<string, string> = {}
    if (!persona.trim() || persona.trim().length < 20) {
      errs.persona = 'Your persona description needs a bit more detail — who exactly is this ad for?'
    }
    if (!cta.trim()) errs.cta = 'CTA is required.'
    if (!product.trim() || product.trim().length < 10) {
      errs.product = 'Please describe your product in more detail.'
    }
    if (aspectRatios.length === 0) errs.aspectRatios = 'Select at least one placement.'
    if (!logoUrl) errs.logo = 'Please upload your logo.'
    return errs
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoUploading(true)
    const formData = new FormData()
    formData.append('logo', file)
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setLogoUrl(data.logoUrl)
    } catch (err) {
      setErrors(prev => ({ ...prev, logo: err instanceof Error ? err.message : 'Upload failed' }))
    } finally {
      setLogoUploading(false)
    }
  }

  async function handleGenerate() {
    const errs = validate()
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    setGenerating(true)
    setGenerations([])

    const brief = {
      persona,
      jtbd: cta,
      product,
      pain_or_aspiration: 'COMBINATION' as const,
      platform: aspectRatios.join(', '),
      aspect_ratios: aspectRatios,
      brand_constraints: 'none',
      archetype: archetype === 'AUTO' ? 'AUTO_SELECT' : archetype,
      hook_concept: '',
      psychological_trigger: '',
      cta_text: cta,
      emotional_lane: 'ASPIRATION' as const,
    }

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, variantCount, logoUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      const gens: GenerationResult[] = data.generations.map((g: GenerationResult) => ({
        ...g,
        scoringLoading: true,
      }))
      setGenerations(gens)
      setSelectedIdx(0)

      // Score each
      for (const gen of data.generations) {
        scoreGen(gen.id)
      }
    } catch (err) {
      setErrors({ submit: err instanceof Error ? err.message : 'Generation failed' })
    } finally {
      setGenerating(false)
    }
  }

  async function scoreGen(generationId: string) {
    try {
      const res = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generationId }),
      })
      const data = await res.json()
      setGenerations(prev =>
        prev.map(g =>
          g.id === generationId
            ? { ...g, scoring: data.scoring, scoringLoading: false }
            : g
        )
      )
    } catch {
      setGenerations(prev =>
        prev.map(g =>
          g.id === generationId ? { ...g, scoringLoading: false } : g
        )
      )
    }
  }

  const selected = generations[selectedIdx]

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 pb-20 md:pb-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Quick Form</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Already know your brief? Paste it in and generate immediately.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Left — form */}
        <div className="space-y-5">
          {/* Persona */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Target Persona <span className="text-red-400">*</span>
            </label>
            <textarea
              value={persona}
              onChange={e => setPersona(e.target.value)}
              rows={4}
              placeholder="Who is this ad for? Age, what they want, what they're worried about. Paste a persona doc or describe in 2-3 sentences."
              className={cn(
                'w-full bg-zinc-900 border rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none transition',
                errors.persona ? 'border-red-500' : 'border-zinc-700'
              )}
            />
            {errors.persona && <p className="text-red-400 text-xs mt-1">{errors.persona}</p>}
          </div>

          {/* CTA */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              CTA — What action should they take? <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={cta}
              onChange={e => setCta(e.target.value)}
              placeholder="e.g. Book a free call, Apply now, Learn more"
              className={cn(
                'w-full bg-zinc-900 border rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition',
                errors.cta ? 'border-red-500' : 'border-zinc-700'
              )}
            />
            {errors.cta && <p className="text-red-400 text-xs mt-1">{errors.cta}</p>}
          </div>

          {/* Product */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Product / Offer Description <span className="text-red-400">*</span>
            </label>
            <textarea
              value={product}
              onChange={e => setProduct(e.target.value)}
              rows={4}
              placeholder="What are you advertising? What's the most compelling thing about it? Include any real results or numbers if you have them."
              className={cn(
                'w-full bg-zinc-900 border rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none transition',
                errors.product ? 'border-red-500' : 'border-zinc-700'
              )}
            />
            {errors.product && <p className="text-red-400 text-xs mt-1">{errors.product}</p>}
          </div>

          {/* Aspect ratios */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Placement <span className="text-red-400">*</span>
            </label>
            <div className="flex gap-2 flex-wrap">
              {ASPECT_RATIOS.map(r => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => {
                    setAspectRatios(prev =>
                      prev.includes(r.value)
                        ? prev.filter(v => v !== r.value)
                        : [...prev, r.value]
                    )
                  }}
                  className={cn(
                    'flex flex-col items-center px-4 py-2 rounded-xl border text-sm transition',
                    aspectRatios.includes(r.value)
                      ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                      : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500'
                  )}
                >
                  <span className="font-medium">{r.label}</span>
                  <span className="text-xs opacity-60">{r.sublabel}</span>
                </button>
              ))}
            </div>
            {errors.aspectRatios && <p className="text-red-400 text-xs mt-1">{errors.aspectRatios}</p>}
          </div>

          {/* Creative style */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Creative Style
            </label>
            <select
              value={archetype}
              onChange={e => setArchetype(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
            >
              {ARCHETYPES.map(a => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
            <p className="text-zinc-500 text-xs mt-1">
              Leave on Auto and the system will pick the highest-CTR approach for your brief.
            </p>
          </div>

          {/* Logo */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Logo <span className="text-red-400">*</span>
            </label>
            {logoUrl ? (
              <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3">
                <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-zinc-300">Logo uploaded</span>
                <button onClick={() => setLogoUrl(null)} className="ml-auto text-zinc-600 hover:text-zinc-400 text-xs">Remove</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={logoUploading}
                className={cn(
                  'w-full bg-zinc-900 border border-dashed rounded-xl px-4 py-4 text-sm transition flex flex-col items-center gap-2',
                  errors.logo ? 'border-red-500' : 'border-zinc-700 hover:border-zinc-500',
                  'text-zinc-400 hover:text-zinc-300'
                )}
              >
                {logoUploading ? (
                  <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                )}
                <span>Upload logo (PNG or SVG)</span>
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".png,.svg,.jpg,.jpeg"
              className="hidden"
              onChange={handleLogoUpload}
            />
            {errors.logo && <p className="text-red-400 text-xs mt-1">{errors.logo}</p>}
          </div>

          {/* Variant count */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Number of variants: <span className="text-indigo-400">{variantCount}</span>
            </label>
            <input
              type="range"
              min={1}
              max={10}
              value={variantCount}
              onChange={e => setVariantCount(parseInt(e.target.value))}
              className="w-full accent-indigo-600"
            />
            <div className="flex justify-between text-xs text-zinc-600 mt-1">
              <span>1</span>
              <span>10</span>
            </div>
          </div>

          {errors.submit && (
            <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3 text-red-400 text-sm">
              {errors.submit}
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition flex items-center justify-center gap-2"
          >
            {generating ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating...
              </>
            ) : `Generate ${variantCount > 1 ? `${variantCount} variants` : 'creative'} →`}
          </button>
        </div>

        {/* Right — output */}
        <div className="space-y-4">
          {generating && generations.length === 0 && (
            <div className="relative w-full aspect-[4/5] rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800">
              <div className="shimmer absolute inset-0" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              </div>
            </div>
          )}

          {generations.length > 0 && (
            <>
              {/* Variant selector */}
              {generations.length > 1 && (
                <div className="flex gap-2 flex-wrap">
                  {generations.map((gen, i) => (
                    <button
                      key={gen.id}
                      onClick={() => setSelectedIdx(i)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-medium transition',
                        i === selectedIdx ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                      )}
                    >
                      Variant {gen.variantNumber}
                    </button>
                  ))}
                </div>
              )}

              {selected && (
                <>
                  <div className={cn(
                    'relative w-full rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800',
                    selected.aspectRatio === '9:16' ? 'aspect-[9/16]' :
                    selected.aspectRatio === '1:1' ? 'aspect-square' : 'aspect-[4/5]'
                  )}>
                    <Image
                      src={selected.imageUrl}
                      alt="Generated creative"
                      fill
                      className="object-cover"
                      unoptimized
                    />
                    <a
                      href={selected.imageUrl}
                      download
                      className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm hover:bg-black/80 p-2 rounded-lg transition"
                    >
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </a>
                  </div>

                  {(selected.scoring || selected.scoringLoading) && (
                    <ScoreCard
                      scoring={selected.scoring!}
                      loading={selected.scoringLoading && !selected.scoring}
                    />
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
