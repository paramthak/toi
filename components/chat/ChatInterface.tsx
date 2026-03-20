'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import CreativeOutput from './CreativeOutput'
import type { ScoringResult } from '@/lib/gemini'
import type { BriefJSON } from '@/lib/prompts/metaPromptAssembler'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
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
}

interface ChatInterfaceProps {
  preloadedBrief?: BriefJSON
}

export default function ChatInterface({ preloadedBrief }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: preloadedBrief
        ? `Welcome back! I've loaded your previous brief. What would you like to change or improve?`
        : `Hi! I'm CreativeIQ. I'm going to help you build an Instagram ad that actually stops the scroll.\n\nTo start — what are you promoting, and who is it for?`,
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [generations, setGenerations] = useState<Generation[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [briefConcept, setBriefConcept] = useState<string | undefined>()
  const [pendingBrief, setPendingBrief] = useState<BriefJSON | null>(preloadedBrief || null)
  const [confirmed, setConfirmed] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Chat history for Gemini
  const geminiHistory = messages
    .slice(1) // skip intro
    .map(m => ({ role: m.role === 'assistant' ? 'model' as const : 'user' as const, parts: m.content }))

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isGenerating])

  const triggerGeneration = useCallback(async (brief: BriefJSON) => {
    setIsGenerating(true)
    setBriefConcept(brief.hook_concept)

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, brief, variantCount: 1, logoUrl }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generation failed')

      setSessionId(data.sessionId)
      const newGens: Generation[] = data.generations.map((g: Generation) => ({
        ...g,
        scoringLoading: true,
      }))
      setGenerations(prev => [...prev, ...newGens])

      // Score each generation in background
      for (const gen of data.generations) {
        scoreGeneration(gen.id)
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Generation failed'
      addAssistantMessage(
        `Generation failed — let's try again with a slightly adjusted prompt. (${errorMsg})`
      )
    } finally {
      setIsGenerating(false)
    }
  }, [sessionId, logoUrl])

  async function scoreGeneration(generationId: string) {
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

      // Add score feedback to chat
      if (data.scoring) {
        const score = Math.round(data.scoring.final_score)
        const label = data.scoring.score_label
        addAssistantMessage(
          score >= 75
            ? `Your creative scored **${score}/100 — ${label}**. ${data.scoring.scroll_stop_diagnosis} Would you like variants, or want to try a different direction?`
            : score >= 50
            ? `Scored **${score}/100 — ${label}**. ${data.scoring.improvement_tips?.[0]?.tip || ''} Want me to apply this improvement?`
            : `Scored **${score}/100 — ${label}**. ${data.scoring.scroll_stop_diagnosis} The fundamental issue needs fixing — shall I regenerate with a different approach?`
        )
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

  function addAssistantMessage(content: string) {
    setMessages(prev => [
      ...prev,
      { role: 'assistant', content, timestamp: new Date() },
    ])
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
          history: geminiHistory,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Chat failed')

      setSessionId(data.sessionId)

      // Remove BRIEF_JSON block from displayed message
      const displayResponse = data.response
        .replace(/<BRIEF_JSON>[\s\S]*?<\/BRIEF_JSON>/g, '')
        .trim()

      addAssistantMessage(displayResponse)

      // If brief is ready, set pending state
      if (data.briefData?.ready_to_generate) {
        setPendingBrief(data.briefData)
        setConfirmed(false)
      }
    } catch (err) {
      addAssistantMessage('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  async function handleConfirmGenerate() {
    if (!pendingBrief) return
    setConfirmed(true)
    setPendingBrief(null)
    await triggerGeneration(pendingBrief)
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
      addAssistantMessage(`Logo uploaded! I'll include it in your creative.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      addAssistantMessage(`Upload failed: ${msg}`)
    } finally {
      setLogoUploading(false)
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
      {/* Logo upload bar */}
      {!logoUrl && (
        <div className="flex-shrink-0 px-4 py-2 border-b border-zinc-800 bg-zinc-950">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={logoUploading}
            className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition"
          >
            {logoUploading ? (
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            )}
            Upload your logo (optional)
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.svg,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={handleLogoUpload}
          />
        </div>
      )}

      {logoUrl && (
        <div className="flex-shrink-0 px-4 py-2 border-b border-zinc-800 bg-zinc-950 flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-zinc-800 flex items-center justify-center">
            <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <span className="text-sm text-zinc-400">Logo ready</span>
          <button
            onClick={() => setLogoUrl(null)}
            className="ml-auto text-zinc-600 hover:text-zinc-400 text-xs"
          >
            Remove
          </button>
        </div>
      )}

      {/* Main content — split on desktop */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat column */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  'flex gap-3',
                  msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                )}
              >
                {msg.role === 'assistant' && (
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                )}
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-tr-sm'
                      : 'bg-zinc-900 text-zinc-200 rounded-tl-sm'
                  )}
                >
                  {renderMessage(msg.content)}
                </div>
              </div>
            ))}

            {/* Confirm generate button */}
            {pendingBrief && !confirmed && (
              <div className="flex gap-2 justify-start pl-10">
                <button
                  onClick={handleConfirmGenerate}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
                >
                  Yes, generate this →
                </button>
                <button
                  onClick={() => {
                    setPendingBrief(null)
                    addAssistantMessage('No problem — what would you like to adjust?')
                  }}
                  className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm px-4 py-2 rounded-xl transition"
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
            />
          </div>
        )}
      </div>

      {/* Creative output — mobile (below chat) */}
      {(generations.length > 0 || isGenerating) && (
        <div className="md:hidden flex-shrink-0 border-t border-zinc-800 px-4 py-4 max-h-[60vh] overflow-y-auto">
          <CreativeOutput
            generations={generations}
            isGenerating={isGenerating}
            briefConcept={briefConcept}
          />
        </div>
      )}
    </div>
  )
}

function renderMessage(content: string) {
  // Simple markdown-like rendering
  const parts = content.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
        }
        // Handle newlines
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
