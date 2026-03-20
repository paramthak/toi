import { GoogleGenerativeAI, GenerativeModel, Part } from '@google/generative-ai'
import { META_PROMPT_ASSEMBLER_SYSTEM, BriefJSON, buildMetaPromptUserMessage } from './prompts/metaPromptAssembler'
import { SCORING_SYSTEM_PROMPT } from './prompts/scoringPrompt'
import { PROMPT_EVALUATOR_SYSTEM, PROMPT_REFINER_SYSTEM } from './prompts/promptEvaluator'

let genAI: GoogleGenerativeAI | null = null

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set')
    genAI = new GoogleGenerativeAI(apiKey)
  }
  return genAI
}

// ─── Chat (Gemini Flash) ─────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'model'
  parts: string
}

export async function sendChatMessage(
  history: ChatMessage[],
  userMessage: string,
  systemPrompt: string
): Promise<string> {
  const ai = getGenAI()
  const model = ai.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: systemPrompt,
  })

  const chat = model.startChat({
    history: history.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.parts }],
    })),
  })

  const result = await chat.sendMessage(userMessage)
  return result.response.text()
}

// ─── Brief Enrichment (derives hook_concept + trigger from persona + product) ─

export async function enrichBriefWithConcepts(brief: BriefJSON): Promise<{ hook_concept: string; psychological_trigger: string }> {
  const ai = getGenAI()
  const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash' })
  const result = await model.generateContent(
    `You are a creative strategist for Instagram advertising.

Given the brief below, derive:
1. hook_concept: A SPECIFIC, concrete creative hook for the ad headline. It must reference the actual product/offer/action — NOT generic phrases like "Study Abroad" or "Learn More". Be direct about what the ad is selling or promoting. One sentence, action-oriented, punchy.
2. psychological_trigger: Exactly one of: LOSS_AVERSION, CURIOSITY_GAP, SOCIAL_PROOF, NOVELTY, URGENCY — whichever best fits the product and persona.

Brief:
- Product/Offer: ${brief.product}
- Target Persona: ${brief.persona}
- CTA: ${brief.cta_text}
- Platform: ${brief.platform}

Return ONLY valid JSON with no other text:
{"hook_concept": "...", "psychological_trigger": "..."}`
  )
  const text = result.response.text()
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return { hook_concept: brief.product.slice(0, 120), psychological_trigger: 'CURIOSITY_GAP' }
  try {
    return JSON.parse(jsonMatch[0]) as { hook_concept: string; psychological_trigger: string }
  } catch {
    return { hook_concept: brief.product.slice(0, 120), psychological_trigger: 'CURIOSITY_GAP' }
  }
}

// ─── Meta Prompt Assembly (Gemini Flash) ────────────────────────────────────

export async function assemblMetaPrompt(
  brief: BriefJSON,
  productImageBase64?: string,
  productImageMime?: string
): Promise<string> {
  const ai = getGenAI()
  const model = ai.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: META_PROMPT_ASSEMBLER_SYSTEM,
  })

  const parts: Part[] = []

  if (productImageBase64 && productImageMime) {
    parts.push({
      inlineData: {
        data: productImageBase64,
        mimeType: productImageMime as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
      },
    })
    parts.push({
      text: `The image above is a product/app screenshot. Use it to inform visual composition, colors, and subject matter in your prompt output.\n\nBrief JSON:\n${buildMetaPromptUserMessage(brief)}`,
    })
  } else {
    parts.push({ text: buildMetaPromptUserMessage(brief) })
  }

  const result = await model.generateContent(parts)
  return result.response.text()
}

// ─── Prompt Evaluator + Refiner (text-only, pre-image-gen quality gate) ─────

interface PromptEvalResult {
  score: number
  passed: boolean
  weaknesses: string[]
  quick_fixes: string[]
}

async function evaluatePrompt(prompt: string, logoProvided: boolean, brief?: BriefJSON): Promise<PromptEvalResult> {
  const ai = getGenAI()
  const model = ai.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: PROMPT_EVALUATOR_SYSTEM,
  })
  const briefContext = brief
    ? `BRIEF CONTEXT:\n${JSON.stringify({ persona: brief.persona, product: brief.product, hook_concept: brief.hook_concept, cta_text: brief.cta_text }, null, 2)}\n\n`
    : ''
  const logoNote = logoProvided ? '[LOGO IS PROVIDED IN THIS BRIEF]\n\n' : ''
  const input = `${logoNote}${briefContext}PROMPT TO EVALUATE:\n${prompt}`
  const result = await model.generateContent(input)
  const text = result.response.text()
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
  const ai = getGenAI()
  const model = ai.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: PROMPT_REFINER_SYSTEM,
  })
  const fixes = weaknesses.map((w, i) => `• ${w}\n  FIX: ${quick_fixes[i] || 'Address this weakness'}`).join('\n')
  const context = JSON.stringify({ hook_concept: brief.hook_concept, archetype: brief.archetype, cta_text: brief.cta_text, emotional_lane: brief.emotional_lane }, null, 2)
  const input = `CURRENT PROMPT:\n${prompt}\n\nWEAKNESSES TO FIX:\n${fixes}\n\nBRIEF CONTEXT:\n${context}`
  const result = await model.generateContent(input)
  return result.response.text()
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

  for (let i = 0; i < EVAL_MAX_ITERATIONS; i++) {
    let evalResult: PromptEvalResult
    try {
      statusCallback?.(`Evaluating prompt quality (${i + 1}/${EVAL_MAX_ITERATIONS})...`)
      evalResult = await evaluatePrompt(prompt, logoProvided ?? false, brief)
      statusCallback?.(`Prompt score: ${evalResult.score}/100${evalResult.passed ? ' ✓' : ` — refining...`}`)
    } catch (err) {
      console.log(`[PromptEval] iteration ${i + 1} eval failed:`, err instanceof Error ? err.message : err)
      break
    }

    console.log(`[PromptEval] iteration ${i + 1}: score=${evalResult.score}, passed=${evalResult.passed}`)

    if (evalResult.passed) break
    if (i === EVAL_MAX_ITERATIONS - 1) break // Last attempt — use current prompt as-is

    try {
      prompt = await refinePrompt(prompt, evalResult.weaknesses, evalResult.quick_fixes, brief)
    } catch (err) {
      console.log(`[PromptEval] iteration ${i + 1} refine failed:`, err instanceof Error ? err.message : err)
      break
    }
  }

  return prompt
}

// ─── Image Generation (gemini-3-pro-image-preview) ──────────────────────────

export interface GeneratedImage {
  base64Data: string
  mimeType: string
}

export interface InputImage {
  base64Data: string
  mimeType: string
}

export async function generateImage(
  metaPrompt: string,
  inputImages?: InputImage[]
): Promise<GeneratedImage> {
  const ai = getGenAI()
  const model = ai.getGenerativeModel({ model: 'gemini-3-pro-image-preview' })

  const parts: Part[] = []

  // Add input reference images (logo, product photo) FIRST so the model sees them as context
  if (inputImages && inputImages.length > 0) {
    for (const img of inputImages) {
      parts.push({
        inlineData: {
          data: img.base64Data,
          mimeType: img.mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
        },
      })
    }
  }

  // Append the meta-prompt with a mandatory text rendering suffix
  const fullPrompt = metaPrompt +
    '\n\nCRITICAL RENDERING MANDATE: This is a real Instagram advertisement. ALL text elements described above MUST be physically rendered as clearly readable text IN the generated image. Do not omit any text overlays. The headline, CTA button/text, and any specified copy must appear as legible characters in the final image. An ad without readable text cannot function.'

  parts.push({ text: fullPrompt })

  const result = await model.generateContent({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      // @ts-ignore — image generation response type
      responseModalities: ['image', 'text'],
    } as Record<string, unknown>,
  })

  const responseParts = result.response.candidates?.[0]?.content?.parts ?? []
  for (const part of responseParts) {
    // @ts-ignore — inlineData is present for image responses
    if (part.inlineData) {
      return {
        // @ts-ignore
        base64Data: part.inlineData.data,
        // @ts-ignore
        mimeType: part.inlineData.mimeType || 'image/png',
      }
    }
  }

  throw new Error('No image returned from Gemini image generation')
}

// ─── Scoring (Gemini Vision) ─────────────────────────────────────────────────

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
  const ai = getGenAI()
  const model = ai.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SCORING_SYSTEM_PROMPT,
  })

  const imagePart: Part = {
    inlineData: {
      data: imageBase64,
      mimeType: mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
    },
  }

  const briefPart: Part = {
    text: `Brief context:\n${JSON.stringify(brief, null, 2)}`,
  }

  const result = await model.generateContent([imagePart, briefPart])
  const text = result.response.text()

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No valid JSON in scoring response')

  return JSON.parse(jsonMatch[0]) as ScoringResult
}
