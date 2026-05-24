import OpenAI, { toFile } from 'openai'
import { META_PROMPT_ASSEMBLER_SYSTEM, BriefJSON, buildMetaPromptUserMessage } from './prompts/metaPromptAssembler'
import { SCORING_SYSTEM_PROMPT } from './prompts/scoringPrompt'
import { PROMPT_EVALUATOR_SYSTEM, PROMPT_REFINER_SYSTEM } from './prompts/promptEvaluator'

let openaiClient: OpenAI | null = null

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
    openaiClient = new OpenAI({ apiKey })
  }
  return openaiClient
}

// ─── Chat ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'model'
  parts: string
}

export async function sendChatMessage(
  history: ChatMessage[],
  userMessage: string,
  systemPrompt: string
): Promise<string> {
  const client = getOpenAI()

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history.map(msg => ({
      role: msg.role === 'model' ? 'assistant' as const : 'user' as const,
      content: msg.parts,
    })),
    { role: 'user', content: userMessage },
  ]

  const response = await client.chat.completions.create({
    model: 'gpt-4.1',
    messages,
  })

  return response.choices[0].message.content ?? ''
}

// ─── Meta Prompt Assembly ────────────────────────────────────────────────────

export async function assemblMetaPrompt(
  brief: BriefJSON,
  productImageBase64?: string,
  productImageMime?: string
): Promise<string> {
  const client = getOpenAI()

  const userContent: OpenAI.Chat.ChatCompletionContentPart[] = []

  if (productImageBase64 && productImageMime) {
    userContent.push({
      type: 'image_url',
      image_url: {
        url: `data:${productImageMime};base64,${productImageBase64}`,
        detail: 'high',
      },
    })
    userContent.push({
      type: 'text',
      text: `The image above is a product/app screenshot. Use it to inform visual composition, colors, and subject matter in your prompt output.\n\nBrief JSON:\n${buildMetaPromptUserMessage(brief)}`,
    })
  } else {
    userContent.push({ type: 'text', text: buildMetaPromptUserMessage(brief) })
  }

  const response = await client.chat.completions.create({
    model: 'gpt-4.1',
    messages: [
      { role: 'system', content: META_PROMPT_ASSEMBLER_SYSTEM },
      { role: 'user', content: userContent },
    ],
  })

  return response.choices[0].message.content ?? ''
}

// ─── Prompt Evaluator + Refiner ──────────────────────────────────────────────

interface PromptEvalResult {
  score: number
  passed: boolean
  weaknesses: string[]
  quick_fixes: string[]
}

async function evaluatePrompt(prompt: string, logoProvided: boolean, hasCta: boolean): Promise<PromptEvalResult> {
  const client = getOpenAI()
  const tags: string[] = []
  if (logoProvided) tags.push('[LOGO IS PROVIDED IN THIS BRIEF]')
  tags.push(hasCta ? '[CTA IS PROVIDED IN THIS BRIEF]' : '[NO CTA IN THIS BRIEF — absence of CTA is correct]')
  const input = tags.length ? `${tags.join('\n')}\n\n${prompt}` : prompt

  const response = await client.chat.completions.create({
    model: 'gpt-4.1',
    messages: [
      { role: 'system', content: PROMPT_EVALUATOR_SYSTEM },
      { role: 'user', content: input },
    ],
  })

  const text = response.choices[0].message.content ?? ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return { score: 0, passed: false, weaknesses: ['Evaluator returned no JSON'], quick_fixes: [] }
  return JSON.parse(jsonMatch[0]) as PromptEvalResult
}

async function refinePrompt(
  prompt: string,
  weaknesses: string[],
  quick_fixes: string[],
  brief: BriefJSON
): Promise<string> {
  const client = getOpenAI()
  const fixes = weaknesses.map((w, i) => `• ${w}\n  FIX: ${quick_fixes[i] || 'Address this weakness'}`).join('\n')
  const context = JSON.stringify({ hook_concept: brief.hook_concept, archetype: brief.archetype, cta_text: brief.cta_text, emotional_lane: brief.emotional_lane }, null, 2)
  const input = `CURRENT PROMPT:\n${prompt}\n\nWEAKNESSES TO FIX:\n${fixes}\n\nBRIEF CONTEXT:\n${context}`

  const response = await client.chat.completions.create({
    model: 'gpt-4.1',
    messages: [
      { role: 'system', content: PROMPT_REFINER_SYSTEM },
      { role: 'user', content: input },
    ],
  })

  return response.choices[0].message.content ?? ''
}

/**
 * Assembles a meta-prompt with a text-only eval-refine loop.
 * Runs up to EVAL_MAX_ITERATIONS (default 3, override via env var).
 * After maxIterations, always sends whatever prompt we have to the image model.
 * statusCallback receives granular status messages for SSE streaming.
 */
const EVAL_MAX_ITERATIONS = process.env.EVAL_MAX_ITERATIONS
  ? parseInt(process.env.EVAL_MAX_ITERATIONS, 10)
  : 3

export async function assemblMetaPromptWithEval(
  brief: BriefJSON,
  productImageBase64?: string,
  productImageMime?: string,
  logoProvided?: boolean,
  statusCallback?: (msg: string) => void
): Promise<string> {
  statusCallback?.('Writing image prompt...')
  let prompt = await assemblMetaPrompt(brief, productImageBase64, productImageMime)
  const hasCta = !!(brief.cta_text?.trim())

  for (let i = 0; i < EVAL_MAX_ITERATIONS; i++) {
    let evalResult: PromptEvalResult
    try {
      statusCallback?.(`Evaluating prompt quality (${i + 1}/${EVAL_MAX_ITERATIONS})...`)
      evalResult = await evaluatePrompt(prompt, logoProvided ?? false, hasCta)
      statusCallback?.(`Prompt score: ${evalResult.score}/100${evalResult.passed ? ' ✓' : ` — refining...`}`)
    } catch (err) {
      console.log(`[PromptEval] iteration ${i + 1} eval failed:`, err instanceof Error ? err.message : err)
      break
    }

    console.log(`[PromptEval] iteration ${i + 1}: score=${evalResult.score}, passed=${evalResult.passed}`)

    if (evalResult.passed) break
    if (i === EVAL_MAX_ITERATIONS - 1) break

    try {
      prompt = await refinePrompt(prompt, evalResult.weaknesses, evalResult.quick_fixes, brief)
    } catch (err) {
      console.log(`[PromptEval] iteration ${i + 1} refine failed:`, err instanceof Error ? err.message : err)
      break
    }
  }

  return prompt
}

// ─── Image Generation (gpt-image-1) ─────────────────────────────────────────

export interface GeneratedImage {
  base64Data: string
  mimeType: string
}

export interface InputImage {
  base64Data: string
  mimeType: string
}

// Maps brief aspect ratios to gpt-image-2 supported sizes
function aspectRatioToSize(aspectRatio?: string): '1024x1024' | '1024x1536' | '1536x1024' {
  switch (aspectRatio) {
    case '1:1':  return '1024x1024'
    case '4:5':  return '1024x1536'  // portrait feed
    case '9:16': return '1024x1536'  // stories / reels
    default:     return '1024x1024'
  }
}

export async function generateImage(
  metaPrompt: string,
  aspectRatio?: string,
): Promise<GeneratedImage> {
  const client = getOpenAI()
  const size = aspectRatioToSize(aspectRatio)

  const fullPrompt = metaPrompt +
    '\n\nIf headline or body text is specified, render it as clearly readable text in the image. Do not leave placeholder shapes where text should be.'

  console.log(`[generateImage] calling images.generate — model=gpt-image-2 size=${size}`)
  const response = await client.images.generate({
    model: 'gpt-image-2',
    prompt: fullPrompt,
    size,
    n: 1,
  })

  console.log('[generateImage] images.generate response received')
  const b64 = response.data?.[0]?.b64_json
  if (!b64) throw new Error('No image returned from OpenAI image generation')
  return { base64Data: b64, mimeType: 'image/png' }
}

// ─── Scoring (GPT-4.1 Vision) ────────────────────────────────────────────────

export interface ScoringResult {
  scroll_stop_gate: {
    visual_hook_score: number
    pattern_interrupt_score: number
    gate_score: number
    gate_passed: boolean
  }
  click_through_factors: {
    visual_hierarchy: number
    psychological_trigger: number
    human_element: number
    cta_execution: number
    information_architecture: number
    color_contrast: number
    platform_fit: number
  }
  click_through_score: number
  final_score: number
  score_label: string
  improvement_tips: Array<{
    priority: number
    tip: string
    impact: string
    factor: string
    prompt_addition: string
  }>
  scroll_stop_diagnosis: string
}

export async function scoreCreative(
  imageBase64: string,
  mimeType: string,
  brief: BriefJSON
): Promise<ScoringResult> {
  const client = getOpenAI()

  const response = await client.chat.completions.create({
    model: 'gpt-4.1',
    messages: [
      { role: 'system', content: SCORING_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${imageBase64}`,
              detail: 'high',
            },
          },
          {
            type: 'text',
            text: `Brief context:\n${JSON.stringify(brief, null, 2)}`,
          },
        ],
      },
    ],
  })

  const text = response.choices[0].message.content ?? ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No valid JSON in scoring response')

  return JSON.parse(jsonMatch[0]) as ScoringResult
}
