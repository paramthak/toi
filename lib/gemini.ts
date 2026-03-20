import { GoogleGenerativeAI, GenerativeModel, Part } from '@google/generative-ai'
import { META_PROMPT_ASSEMBLER_SYSTEM, BriefJSON, buildMetaPromptUserMessage } from './prompts/metaPromptAssembler'
import { SCORING_SYSTEM_PROMPT } from './prompts/scoringPrompt'

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
    model: 'gemini-1.5-flash',
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

// ─── Meta Prompt Assembly (Gemini Flash) ────────────────────────────────────

export async function assemblMetaPrompt(brief: BriefJSON): Promise<string> {
  const ai = getGenAI()
  const model = ai.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: META_PROMPT_ASSEMBLER_SYSTEM,
  })

  const result = await model.generateContent(buildMetaPromptUserMessage(brief))
  return result.response.text()
}

// ─── Image Generation (gemini-3-pro-image-preview) ──────────────────────────

export interface GeneratedImage {
  base64Data: string
  mimeType: string
}

export async function generateImage(metaPrompt: string): Promise<GeneratedImage> {
  const ai = getGenAI()
  // Using the exact model name from the PRD
  const model = ai.getGenerativeModel({ model: 'gemini-3-pro-image-preview' })

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: metaPrompt }] }],
    generationConfig: {
      // @ts-ignore — image generation response type
      responseModalities: ['image', 'text'],
    } as Record<string, unknown>,
  })

  const parts = result.response.candidates?.[0]?.content?.parts ?? []
  for (const part of parts) {
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
    model: 'gemini-1.5-flash',
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
