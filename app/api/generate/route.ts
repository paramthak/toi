import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { assemblMetaPrompt, generateImage } from '@/lib/gemini'
import { saveBase64Image } from '@/lib/storage'
import { query } from '@/lib/db'
import { BriefJSON } from '@/lib/prompts/metaPromptAssembler'

const VARIATION_DIRECTIVES: Record<number, string> = {
  2: 'Use a slightly different composition angle. Same subject, slightly different framing and lighting direction.',
  3: 'Shift the dominant colour palette to a complementary alternative while preserving all other elements.',
  4: 'Adjust the human element — different expression, same emotional lane.',
  5: 'Modify the text overlay — rewrite the headline with a different angle on the same psychological trigger.',
  6: 'Combine a different composition angle with a different background environment.',
  7: 'Use warm tones with a different subject position and background environment.',
  8: 'Shift colour palette and adjust the human expression while keeping the core composition.',
  9: 'Different background environment with modified text overlay.',
  10: 'Maximum variation — different composition, colour, and background while preserving the core message.',
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const {
      sessionId,
      brief,
      variantCount = 1,
      logoUrl,
    } = await request.json() as {
      sessionId: string
      brief: BriefJSON
      variantCount: number
      logoUrl?: string
    }

    if (!brief) {
      return NextResponse.json({ error: 'Brief required' }, { status: 400 })
    }

    // Validate sessionId or create a session
    let activeSessionId = sessionId
    if (!activeSessionId) {
      const rows = await query<{ id: string }>(
        `INSERT INTO sessions (interface, username) VALUES ('chat', $1) RETURNING id`,
        [user.username]
      )
      activeSessionId = rows[0].id
    }

    const generations: Array<{
      id: string
      imageUrl: string
      metaPrompt: string
      archetype: string
      aspectRatio: string
      variantNumber: number
    }> = []

    // Generate each variant sequentially (streaming UX on frontend handles this)
    for (let i = 1; i <= Math.min(variantCount, 10); i++) {
      const variantBrief = { ...brief }
      if (i > 1) {
        variantBrief.variant_instruction = `Variant ${i} of ${variantCount}: ${VARIATION_DIRECTIVES[i] || VARIATION_DIRECTIVES[6]}`
      }

      // Add logo context if available
      if (logoUrl) {
        variantBrief.brand_constraints = `${variantBrief.brand_constraints || ''}. Logo available at: ${logoUrl} — place in bottom corner.`
      }

      // Assemble meta prompt
      const metaPrompt = await assemblMetaPrompt(variantBrief)

      // Generate image — retry once on failure
      let generatedImage
      let attempt = 0
      while (attempt < 2) {
        try {
          generatedImage = await generateImage(metaPrompt)
          break
        } catch (err) {
          attempt++
          if (attempt >= 2) throw err
          // Simplify the brief slightly on retry
          const simplifiedBrief = { ...variantBrief, hook_concept: 'simplified version' }
          const retryPrompt = await assemblMetaPrompt(simplifiedBrief)
          generatedImage = await generateImage(retryPrompt)
        }
      }

      if (!generatedImage) throw new Error('Image generation returned null')

      // Save image to storage
      const imageUrl = await saveBase64Image(
        generatedImage.base64Data,
        generatedImage.mimeType
      )

      // Save generation record
      const aspectRatio = brief.aspect_ratios?.[0] || '4:5'
      const rows = await query<{ id: string }>(
        `INSERT INTO generations
          (session_id, brief_json, archetype, meta_prompt, image_url, aspect_ratio, variant_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          activeSessionId,
          JSON.stringify(variantBrief),
          variantBrief.archetype,
          metaPrompt,
          imageUrl,
          aspectRatio,
          i,
        ]
      )

      generations.push({
        id: rows[0].id,
        imageUrl,
        metaPrompt,
        archetype: variantBrief.archetype,
        aspectRatio,
        variantNumber: i,
      })
    }

    return NextResponse.json({ sessionId: activeSessionId, generations })
  } catch (err) {
    console.error('Generate error:', err)
    const message = err instanceof Error ? err.message : 'Generation failed'
    return NextResponse.json(
      { error: 'Generation failed — let\'s try again with a slightly adjusted prompt.', detail: message },
      { status: 500 }
    )
  }
}
