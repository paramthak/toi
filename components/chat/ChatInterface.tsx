'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import CreativeOutput from './CreativeOutput'
import type { ScoringResult } from '@/lib/openai'
import type { BriefJSON } from '@/lib/prompts/metaPromptAssembler'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  imageUrl?: string
}

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
  brief?: BriefJSON
}

interface ChatInterfaceProps {
  preloadedBrief?: BriefJSON
}

const ARCHETYPE_WHY: Record<string, string> = {
  UGC_STYLE: 'the authentic UGC aesthetic lowers the viewer\'s ad guard, making them far more receptive than polished branded content',
  HIGH_INFORMATION: 'the feature-dense layout speaks directly to a problem-aware audience already in decision mode — it answers objections before they arise',
  BEFORE_AFTER: 'the visual contrast between the pain state and resolution creates an immediate emotional gap that the viewer wants to close by clicking',
  MINIMALIST: 'visual isolation forces undivided attention onto the single message, creating cognitive relief in a busy feed',
  TESTIMONIAL_SCREENSHOT: 'the screenshot-style social proof feels real and earned, not manufactured — specificity drives credibility',
  UGLY_ANTI_DESIGN: 'the deliberate imperfection signals no manipulation budget, creating involuntary trust with a skeptical audience',
  PATTERN_INTERRUPT: 'the visual anomaly triggers an involuntary orienting reflex — the brain physically cannot scroll past it',
  MEME_IFIED: 'the familiar format lowers cognitive load while the brand hijacks existing emotional associations',
  AUTO_SELECT: 'the system selected the highest-performing creative pattern for this specific audience and product combination',
}

function buildWhyThisWorks(brief: BriefJSON | undefined, scoring: ScoringResult): string {
  const archetype = brief?.archetype || ''
  const trigger = brief?.psychological_trigger || ''
  const lane = brief?.emotional_lane || ''

  const archetypeReason = ARCHETYPE_WHY[archetype] || 'this creative uses a psychologically proven engagement pattern'
  const triggerNote = trigger
    ? ` The **${trigger.toLowerCase().replace(/_/g, ' ')}** trigger is the core click mechanic.`
    : ''
  const laneNote = lane === 'PAIN'
    ? ' It leads with loss aversion — the most powerful motivator in cold traffic.'
    : lane === 'ASPIRATION'
    ? ' The aspirational framing creates forward momentum — the viewer imagines themselves in that outcome.'
    : ''
  const gateNote = scoring.scroll_stop_gate.gate_passed
    ? ' The scroll-stop gate passed — the visual hook is strong enough to arrest attention.'
    : ' Note: the scroll-stop gate is marginal — the hook could be stronger.'

  return `**Here's why this creative is built to work:** ${archetypeReason}.${triggerNote}${laneNote}${gateNote}`
}

export default function ChatInterface({ preloadedBrief }: ChatInterfaceProps) {
  const isPreloaded = Boolean(preloadedBrief)

  const buildInitialMessage = (brief?: BriefJSON) => {
    if (!brief) {
      return `Hi! I'm CreativeIQ. I'm going to help you build an Instagram ad that actually stops the scroll.\n\nTo start — what are you promoting, and who is it for?`
    }
    const lines = ['I\'ve loaded your creative brief. Here\'s what I have ready to generate:']
    if (brief.hook_concept) lines.push(`\n**Hook:** ${brief.hook_concept}`)
    if (brief.product) lines.push(`**Product:** ${brief.product}`)
    if (brief.archetype && brief.archetype !== 'AUTO_SELECT') {
      lines.push(`**Style:** ${brief.archetype.replace(/_/g, ' ')}`)
    }
    if (brief.cta_text) lines.push(`**CTA:** ${brief.cta_text}`)
    lines.push('\nHit **Generate** to create this, or tell me what to adjust.')
    return lines.join('\n')
  }

  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: buildInitialMessage(preloadedBrief),
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [productPhotoUrl, setProductPhotoUrl] = useState<string | null>(null)
  const [productPhotoUploading, setProductPhotoUploading] = useState(false)
  const [generations, setGenerations] = useState<Generation[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [isRegeneratingImproved, setIsRegeneratingImproved] = useState(false)
  const [briefConcept, setBriefConcept] = useState<string | undefined>()
  const [pendingBrief, setPendingBrief] = useState<BriefJSON | null>(preloadedBrief || null)
  const [confirmed, setConfirmed] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const productPhotoInputRef = useRef<HTMLInputElement>(null)

  // Chat history for OpenAI
  // History must start with 'user' — trim any leading model/assistant messages
  const chatHistoryRaw = messages
    .filter(m => !m.imageUrl) // skip image messages from history
    .slice(1) // skip intro message
    .map(m => ({ role: m.role === 'assistant' ? 'model' as const : 'user' as const, parts: m.content }))
  const firstUserIdx = chatHistoryRaw.findIndex(m => m.role === 'user')
  const chatHistory = firstUserIdx >= 0 ? chatHistoryRaw.slice(firstUserIdx) : []

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isGenerating])

  // Restore session from localStorage (only when not iterating from library)
  useEffect(() => {
    if (isPreloaded) return
    try {
      const savedId = localStorage.getItem('ciq_chat_sessionId')
      const savedMsgs = localStorage.getItem('ciq_chat_messages')
      if (savedId && savedMsgs) {
        const parsed = JSON.parse(savedMsgs) as Array<Message & { timestamp: string }>
        const restored = parsed.map(m => ({ ...m, timestamp: new Date(m.timestamp) }))
        if (restored.length > 1) {
          setSessionId(savedId)
          setMessages(restored)
        }
      }
    } catch {
      // ignore
    }
  }, [])

  // Save session to localStorage
  useEffect(() => {
    if (isPreloaded || messages.length <= 1) return
    try {
      if (sessionId) localStorage.setItem('ciq_chat_sessionId', sessionId)
      localStorage.setItem('ciq_chat_messages', JSON.stringify(messages))
    } catch {
      // ignore
    }
  }, [messages, sessionId, isPreloaded])

  function addAssistantMessage(content: string, imageUrl?: string) {
    setMessages(prev => [
      ...prev,
      { role: 'assistant', content, timestamp: new Date(), imageUrl },
    ])
  }

  const triggerGeneration = useCallback(async (brief: BriefJSON) => {
    setIsGenerating(true)
    setBriefConcept(brief.hook_concept)

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, brief, variantCount: 1, logoUrl, productPhotoUrl }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Generation failed')
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let firstGenShown = false

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
            if (event.type === 'done') {
              const sid = event.sessionId as string | undefined
              if (sid) setSessionId(sid)
            } else if (event.type === 'generation') {
              const g = event.data as Generation
              const newGen: Generation = { ...g, scoringLoading: true, brief }
              setGenerations(prev => [...prev, newGen])
              if (!firstGenShown) {
                firstGenShown = true
                addAssistantMessage('Your creative is ready! Scoring it now...', g.imageUrl)
              }
              scoreGeneration(g.id, brief)
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
      const errorMsg = err instanceof Error ? err.message : 'Generation failed'
      addAssistantMessage(
        `Generation hit a snag. (${errorMsg}) — Want to try again?`
      )
    } finally {
      setIsGenerating(false)
    }
  }, [sessionId, logoUrl, productPhotoUrl])

  async function scoreGeneration(generationId: string, brief?: BriefJSON) {
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

      if (data.scoring) {
        const scoring: ScoringResult = data.scoring
        const score = Math.round(scoring.final_score)
        const label = scoring.score_label

        // Why this creative works (before score)
        const whyMsg = buildWhyThisWorks(brief, scoring)
        addAssistantMessage(whyMsg)

        // Score message
        const topTip = scoring.improvement_tips?.[0]
        const scoreMsg = score >= 75
          ? `**Score: ${score}/100 — ${label}** ✓\n\n${scoring.scroll_stop_diagnosis}\n\nWant to generate more variants or try a different direction?`
          : score >= 50
          ? `**Score: ${score}/100 — ${label}**\n\n${scoring.scroll_stop_diagnosis}\n\n**Top improvement:** ${topTip?.tip || ''}\n\nShall I apply this and regenerate?`
          : `**Score: ${score}/100 — ${label}**\n\n${scoring.scroll_stop_diagnosis}\n\nThe creative needs a different approach. Want me to regenerate with a stronger hook?`

        addAssistantMessage(scoreMsg)
      }
    } catch {
      setGenerations(prev =>
        prev.map(g =>
          g.id === generationId
            ? { ...g, scoringError: 'Score unavailable', scoringLoading: false }
            : g
        )
      )
    }
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: text, timestamp: new Date() }])
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: text,
          history: chatHistory,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Chat failed')

      setSessionId(data.sessionId)

      // Remove BRIEF_JSON block from displayed message (handle model typos in closing tag)
      const displayResponse = data.response
        .replace(/<BRIEF_JSON>[\s\S]*?<\/[A-Z_]*JSON>/g, '')
        .trim()

      addAssistantMessage(displayResponse)

      // If brief is ready, set pending state
      if (data.briefData?.ready_to_generate) {
        setPendingBrief(data.briefData)
        setConfirmed(false)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error('Chat send error:', msg)
      addAssistantMessage(`Something went wrong: ${msg}. Please try again.`)
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  async function handleConfirmGenerate() {
    if (!pendingBrief) return
    const briefToGenerate = pendingBrief
    setConfirmed(true)
    setPendingBrief(null)
    await triggerGeneration(briefToGenerate)
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
      addAssistantMessage('Logo uploaded! I\'ll include it in your creative.')
    } catch (err) {
      addAssistantMessage(`Logo upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setLogoUploading(false)
    }
  }

  async function handleProductPhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setProductPhotoUploading(true)
    const formData = new FormData()
    formData.append('logo', file) // reuse upload endpoint
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setProductPhotoUrl(data.logoUrl)
      addAssistantMessage('Product photo added! I\'ll use it to make the creative more accurate.')
    } catch (err) {
      addAssistantMessage(`Product photo upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setProductPhotoUploading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-56px)]">
      {/* Upload bar */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-zinc-800 bg-zinc-950 flex items-center gap-3 flex-wrap">
        {/* Logo */}
        {logoUrl ? (
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded bg-green-900 flex items-center justify-center">
              <svg className="w-2.5 h-2.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className="text-xs text-zinc-400">Logo ready</span>
            <button onClick={() => setLogoUrl(null)} className="text-zinc-600 hover:text-zinc-400 text-xs">✕</button>
          </div>
        ) : (
          <button
            onClick={() => logoInputRef.current?.click()}
            disabled={logoUploading}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition"
          >
            {logoUploading ? (
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            )}
            Upload logo
          </button>
        )}

        <span className="text-zinc-700 text-xs">|</span>

        {/* Product photo */}
        {productPhotoUrl ? (
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded bg-green-900 flex items-center justify-center">
              <svg className="w-2.5 h-2.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className="text-xs text-zinc-400">Product photo ready</span>
            <button onClick={() => setProductPhotoUrl(null)} className="text-zinc-600 hover:text-zinc-400 text-xs">✕</button>
          </div>
        ) : (
          <button
            onClick={() => productPhotoInputRef.current?.click()}
            disabled={productPhotoUploading}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition"
          >
            {productPhotoUploading ? (
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            )}
            Add product photo
          </button>
        )}

        <input ref={logoInputRef} type="file" accept=".png,.svg,.jpg,.jpeg,.webp" className="hidden" onChange={handleLogoUpload} />
        <input ref={productPhotoInputRef} type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" onChange={handleProductPhotoUpload} />
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat column */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={cn('flex gap-3', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
                {msg.role === 'assistant' && (
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                )}
                <div className="max-w-[85%] space-y-2">
                  {/* Inline image */}
                  {msg.imageUrl && (
                    <div className="relative rounded-xl overflow-hidden w-48 aspect-[4/5] bg-zinc-800">
                      <Image src={msg.imageUrl} alt="Generated creative" fill className="object-cover" unoptimized />
                      <a
                        href={`${msg.imageUrl}?download=1`}
                        download
                        onClick={e => e.stopPropagation()}
                        className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 p-1.5 rounded-lg transition"
                      >
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      </a>
                    </div>
                  )}
                  {/* Text content */}
                  {msg.content && (
                    <div className={cn(
                      'rounded-2xl px-4 py-3 text-sm leading-relaxed',
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-tr-sm'
                        : 'bg-zinc-900 text-zinc-200 rounded-tl-sm'
                    )}>
                      {renderMessage(msg.content)}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Confirm generate buttons */}
            {pendingBrief && !confirmed && (
              <div className="flex gap-2 justify-start pl-10">
                <button
                  onClick={handleConfirmGenerate}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Generate this →
                </button>
                <button
                  onClick={() => {
                    setPendingBrief(null)
                    addAssistantMessage('No problem — what would you like to change?')
                  }}
                  className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm px-4 py-2.5 rounded-xl transition"
                >
                  Adjust
                </button>
              </div>
            )}

            {loading && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div className="bg-zinc-900 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="flex-shrink-0 px-4 py-3 border-t border-zinc-800 bg-zinc-950">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                rows={1}
                disabled={loading || isGenerating}
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none transition disabled:opacity-50"
                style={{ minHeight: '46px', maxHeight: '120px' }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || loading || isGenerating}
                className="flex-shrink-0 w-11 h-11 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-xl flex items-center justify-center transition"
              >
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Creative output — desktop right panel */}
        {(generations.length > 0 || isGenerating) && (
          <div className="hidden md:flex w-80 flex-col border-l border-zinc-800 overflow-y-auto p-4">
            <CreativeOutput
              generations={generations}
              isGenerating={isGenerating}
              briefConcept={briefConcept}
              logoUrl={logoUrl}
              productPhotoUrl={productPhotoUrl}
              isRegeneratingImproved={isRegeneratingImproved}
              onRegenerateStart={() => setIsRegeneratingImproved(true)}
              onAddGeneration={gen => {
                setIsRegeneratingImproved(false)
                setGenerations(prev => [...prev, gen])
                scoreGeneration(gen.id)
              }}
            />
          </div>
        )}
      </div>

      {/* Creative output — mobile */}
      {(generations.length > 0 || isGenerating || isRegeneratingImproved) && (
        <div className="md:hidden flex-shrink-0 border-t border-zinc-800 px-4 py-4 max-h-[60vh] overflow-y-auto">
          <CreativeOutput
            generations={generations}
            isGenerating={isGenerating}
            briefConcept={briefConcept}
            logoUrl={logoUrl}
            productPhotoUrl={productPhotoUrl}
            isRegeneratingImproved={isRegeneratingImproved}
            onRegenerateStart={() => setIsRegeneratingImproved(true)}
            onAddGeneration={gen => {
              setIsRegeneratingImproved(false)
              setGenerations(prev => [...prev, gen])
              scoreGeneration(gen.id)
            }}
          />
        </div>
      )}
    </div>
  )
}

function renderMessage(content: string) {
  const parts = content.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
        }
        return part.split('\n').map((line, j) => (
          <span key={`${i}-${j}`}>
            {j > 0 && <br />}
            {line}
          </span>
        ))
      })}
    </>
  )
}
