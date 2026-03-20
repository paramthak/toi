'use client'

import { useState, useRef } from 'react'
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
  archetype: string
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
  const [productPhotoUrl, setProductPhotoUrl] = useState<string | null>(null)
  const [productPhotoUploading, setProductPhotoUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatingStatus, setGeneratingStatus] = useState('')
  const [regeneratingImproved, setRegeneratingImproved] = useState(false)
  const [regenStatus, setRegenStatus] = useState('')
  const [generations, setGenerations] = useState<GenerationResult[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const logoRef = useRef<HTMLInputElement>(null)
  const productPhotoRef = useRef<HTMLInputElement>(null)

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

  async function handleProductPhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setProductPhotoUploading(true)
    const formData = new FormData()
    formData.append('logo', file)
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setProductPhotoUrl(data.logoUrl)
    } catch (err) {
      setErrors(prev => ({ ...prev, productPhoto: err instanceof Error ? err.message : 'Upload failed' }))
    } finally {
      setProductPhotoUploading(false)
    }
  }

  async function handleGenerate() {
    const errs = validate()
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    setGenerating(true)
    setGeneratingStatus('')
    setGenerations([])
    setSelectedIdx(0)

    const selectedArchetype = archetype === 'AUTO' ? 'AUTO_SELECT' : archetype

    const brief = {
      persona,
      jtbd: cta,
      product,
      pain_or_aspiration: 'COMBINATION' as const,
      platform: aspectRatios.join(', '),
      aspect_ratios: aspectRatios,
      brand_constraints: 'none',
      archetype: selectedArchetype,
      hook_concept: '',
      psychological_trigger: '',
      cta_text: cta,
      emotional_lane: 'ASPIRATION' as const,
    }

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, variantCount, logoUrl, productPhotoUrl }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Generation failed')
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
              setGeneratingStatus(event.message as string)
            } else if (event.type === 'generation') {
              const g = event.data as GenerationResult
              const newGen: GenerationResult = { ...g, archetype: selectedArchetype, scoringLoading: true }
              setGenerations(prev => {
                const next = [...prev, newGen]
                setSelectedIdx(next.length - 1)
                return next
              })
              scoreGen(g.id)
            } else if (event.type === 'error') {
              throw new Error((event.error as string) || 'Generation failed')
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue
            throw parseErr
          }
        }
      }
    } catch (err) {
      setErrors({ submit: err instanceof Error ? err.message : 'Generation failed' })
    } finally {
      setGenerating(false)
      setGeneratingStatus('')
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
              placeholder="Who is this ad for? Age, what they want, what they're worried about."
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
              placeholder="What are you advertising? What's the most compelling thing about it?"
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
                      prev.includes(r.value) ? prev.filter(v => v !== r.value) : [...prev, r.value]
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
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">Creative Style</label>
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
                onClick={() => logoRef.current?.click()}
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
            <input ref={logoRef} type="file" accept=".png,.svg,.jpg,.jpeg" className="hidden" onChange={handleLogoUpload} />
            {errors.logo && <p className="text-red-400 text-xs mt-1">{errors.logo}</p>}
          </div>

          {/* Product photo (optional) */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Product / App Screenshot <span className="text-zinc-500 font-normal">(optional — improves AI accuracy)</span>
            </label>
            {productPhotoUrl ? (
              <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3">
                <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-zinc-300">Product photo ready</span>
                <button onClick={() => setProductPhotoUrl(null)} className="ml-auto text-zinc-600 hover:text-zinc-400 text-xs">Remove</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => productPhotoRef.current?.click()}
                disabled={productPhotoUploading}
                className="w-full bg-zinc-900 border border-dashed border-zinc-700 hover:border-zinc-500 rounded-xl px-4 py-4 text-sm text-zinc-400 hover:text-zinc-300 transition flex flex-col items-center gap-2"
              >
                {productPhotoUploading ? (
                  <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                )}
                <span>Upload product/app screenshot (PNG or JPG)</span>
              </button>
            )}
            <input ref={productPhotoRef} type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" onChange={handleProductPhotoUpload} />
            {errors.productPhoto && <p className="text-red-400 text-xs mt-1">{errors.productPhoto}</p>}
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
          {/* Regenerating status bar — shown above existing variants, doesn't hide them */}
          {regeneratingImproved && (
            <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
              <svg className="w-4 h-4 animate-spin flex-shrink-0 text-indigo-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-xs text-zinc-400 truncate">{regenStatus || 'Applying improvements...'}</span>
            </div>
          )}

          {/* Initial generation shimmer — only when no generations exist yet */}
          {generating && generations.length === 0 && (
            <div className="relative w-full rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 aspect-[4/5]">
              <div className="shimmer absolute inset-0" />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4">
                <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                {generatingStatus && (
                  <p className="text-zinc-400 text-xs mt-1 text-center">{generatingStatus}</p>
                )}
              </div>
            </div>
          )}

          {/* Generations list — always visible when present */}
          {generations.length > 0 && (
            <>
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

              {/* Status text during multi-variant generation (after first arrives) */}
              {generating && generatingStatus && (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <svg className="w-3 h-3 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="truncate">{generatingStatus}</span>
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
                      href={`${selected.imageUrl}?download=1`}
                      download
                      className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm hover:bg-black/80 p-2 rounded-lg transition"
                    >
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </a>
                  </div>

                  {(selected.scoring || selected.scoringLoading) && !regeneratingImproved && (
                    <ScoreCard
                      scoring={selected.scoring!}
                      loading={selected.scoringLoading && !selected.scoring}
                      archetype={selected.archetype}
                      generationId={selected.id}
                      logoUrl={logoUrl || undefined}
                      productPhotoUrl={productPhotoUrl || undefined}
                      onRegenerateStart={() => setRegeneratingImproved(true)}
                      onRegenStatus={setRegenStatus}
                      onRegenerate={(newGenId, newImageUrl) => {
                        setRegeneratingImproved(false)
                        setRegenStatus('')
                        const newGen: GenerationResult = {
                          id: newGenId,
                          imageUrl: newImageUrl,
                          aspectRatio: selected.aspectRatio,
                          variantNumber: generations.length + 1,
                          archetype: selected.archetype,
                          scoringLoading: true,
                        }
                        setGenerations(prev => {
                          const next = [...prev, newGen]
                          setSelectedIdx(next.length - 1)
                          return next
                        })
                        scoreGen(newGenId)
                      }}
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
