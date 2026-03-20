import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { assemblMetaPrompt, generateImage } from '@/lib/gemini'
import { saveBase64Image, fileExists, readFileAsBase64 } from '@/lib/storage'
import path from 'path'
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
      productPhotoUrl,
    } = await request.json() as {
      sessionId: string
      brief: BriefJSON
      variantCount: number
      logoUrl?: string
      productPhotoUrl?: string
    }

    if (!brief) {
      return NextResponse.json({ error: 'Brief required' }, { status: 400 })
    }

    // Load product photo for vision-assisted prompt assembly
    let productImageBase64: string | undefined
    let productImageMime: string | undefined
    if (productPhotoUrl) {
      const filename = path.basename(productPhotoUrl)
      if (fileExists(filename)) {
        productImageBase64 = readFileAsBase64(filename)
        const ext = path.extname(filename).toLowerCase().replace('.', '')
        productImageMime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
      }
    }

    // Load logo for direct embedding as input image (raster only — SVG unsupported)
    let logoImageBase64: string | undefined
    let logoImageMime: string | undefined
    if (logoUrl) {
      const logoFilename = path.basename(logoUrl)
      const logoExt = path.extname(logoFilename).toLowerCase().replace('.', '')
      if (logoExt !== 'svg' && fileExists(logoFilename)) {
        logoImageBase64 = readFileAsBase64(logoFilename)
        logoImageMime = logoExt === 'jpg' || logoExt === 'jpeg' ? 'image/jpeg' : 'image/png'
      }
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

      // Update brand_constraints to reference logo as provided input image
      if (logoImageBase64) {
        variantBrief.brand_constraints = `${variantBrief.brand_constraints || 'none'}. LOGO INPUT PROVIDED: The brand logo has been provided as a visual reference image input. Embed the exact provided logo in the bottom-left corner of the final image, at approximately 10-12% of frame width. Preserve its exact colors, transparency, and shape without modification. Do NOT add any background rectangle, shadow, or padding behind the logo.`
      } else if (logoUrl) {
        // SVG fallback: text-only instruction
        variantBrief.brand_constraints = `${variantBrief.brand_constraints || 'none'}. Place brand logo in bottom-right corner.`
      }

      // Assemble meta prompt (with optional product photo for vision context)
      const metaPrompt = await assemblMetaPrompt(variantBrief, productImageBase64, productImageMime)

      // Build input images for image generation (logo first, then product)
      const inputImages: Array<{ base64Data: string; mimeType: string }> = []
      if (logoImageBase64 && logoImageMime) {
        inputImages.push({ base64Data: logoImageBase64, mimeType: logoImageMime })
      }
      if (productImageBase64 && productImageMime) {
        inputImages.push({ base64Data: productImageBase64, mimeType: productImageMime })
      }

      // Generate image — retry once on failure with simplified brief
      let generatedImage
      let attempt = 0
      while (attempt < 2) {
        try {
          generatedImage = await generateImage(
            metaPrompt,
            inputImages.length > 0 ? inputImages : undefined
          )
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

      // Save image to storage (filesystem)
      const imageUrl = await saveBase64Image(
        generatedImage.base64Data,
        generatedImage.mimeType
      )

      // Save generation record with image_data for DB-backed persistence
      const aspectRatio = brief.aspect_ratios?.[0] || '4:5'
      const rows = await query<{ id: string }>(
        `INSERT INTO generations
          (session_id, brief_json, archetype, meta_prompt, image_url, aspect_ratio, variant_number, image_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          activeSessionId,
          JSON.stringify(variantBrief),
          variantBrief.archetype,
          metaPrompt,
          imageUrl,
          aspectRatio,
          i,
          generatedImage.base64Data,
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
