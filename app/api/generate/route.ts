import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { assemblMetaPrompt, assemblMetaPromptWithEval, generateImage } from '@/lib/openai'
import { saveBase64Image, fileExists, readFileAsBase64, compositeLogoOntoImage } from '@/lib/storage'
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
  // Auth and validation must happen before stream starts
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

  // Load product photo (for prompt context only)
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

  // Load logo — used for Sharp compositing after generation (supports SVG too)
  let logoImageBase64: string | undefined
  if (logoUrl) {
    const logoFilename = path.basename(logoUrl)
    if (fileExists(logoFilename)) {
      logoImageBase64 = readFileAsBase64(logoFilename)
    }
  }

  // Validate or create session
  let activeSessionId = sessionId
  if (!activeSessionId) {
    const rows = await query<{ id: string }>(
      `INSERT INTO sessions (interface, username) VALUES ('chat', $1) RETURNING id`,
      [user.username]
    )
    activeSessionId = rows[0].id
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        const total = Math.min(variantCount, 10)

        for (let i = 1; i <= total; i++) {
          const variantLabel = total > 1 ? `Variant ${i}/${total}: ` : ''

          const variantBrief = { ...brief }
          if (i > 1) {
            variantBrief.variant_instruction = `Variant ${i} of ${variantCount}: ${VARIATION_DIRECTIVES[i] || VARIATION_DIRECTIVES[6]}`
          }

          if (logoImageBase64) {
            variantBrief._logo_b64 = logoImageBase64
            // Tell the prompt assembler a logo will be composited — leave bottom-left clear
            variantBrief.brand_constraints = `${variantBrief.brand_constraints || 'none'}. Leave the bottom-left corner of the image clear (approx 15% width × 10% height) — the brand logo will be composited onto that area after generation.`
          }

          const metaPrompt = await assemblMetaPromptWithEval(
            variantBrief,
            productImageBase64,
            productImageMime,
            !!logoImageBase64,
            (msg) => emit({ type: 'status', message: `${variantLabel}${msg}` })
          )

          emit({ type: 'status', message: `${variantLabel}Generating image...` })

          const aspectRatio = brief.aspect_ratios?.[0] ?? '4:5'

          // Generate image — retry once with simplified brief on failure
          let generatedImage
          try {
            console.log('[generate] attempt 1: calling generateImage')
            generatedImage = await generateImage(metaPrompt, aspectRatio)
            console.log('[generate] attempt 1: success')
          } catch (err) {
            console.error('[generate] attempt 1 failed:', err instanceof Error ? err.message : err)
            emit({ type: 'status', message: `${variantLabel}Retrying with simplified brief...` })
            try {
              const simplifiedBrief = { ...variantBrief, hook_concept: 'simplified version' }
              const retryPrompt = await assemblMetaPrompt(simplifiedBrief)
              console.log('[generate] attempt 2: calling generateImage')
              generatedImage = await generateImage(retryPrompt, aspectRatio)
              console.log('[generate] attempt 2: success')
            } catch (retryErr) {
              console.error('[generate] attempt 2 failed:', retryErr instanceof Error ? retryErr.message : retryErr)
              throw retryErr
            }
          }

          if (!generatedImage) throw new Error('Image generation returned null')

          // Composite the real logo onto the generated image using Sharp
          let finalBase64 = generatedImage.base64Data
          if (logoImageBase64) {
            try {
              emit({ type: 'status', message: `${variantLabel}Adding logo...` })
              finalBase64 = await compositeLogoOntoImage(generatedImage.base64Data, logoImageBase64)
              console.log('[generate] logo composited successfully')
            } catch (logoErr) {
              console.error('[generate] logo composite failed (using image without logo):', logoErr instanceof Error ? logoErr.message : logoErr)
            }
          }

          const imageUrl = await saveBase64Image(finalBase64, generatedImage.mimeType)

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
              finalBase64,
            ]
          )

          emit({
            type: 'generation',
            data: {
              id: rows[0].id,
              imageUrl,
              metaPrompt,
              archetype: variantBrief.archetype,
              aspectRatio,
              variantNumber: i,
            },
          })
        }

        emit({ type: 'done', sessionId: activeSessionId })
      } catch (err) {
        console.error('Generate error:', err)
        const message = err instanceof Error ? err.message : 'Generation failed'
        emit({ type: 'error', error: `Generation failed — let's try again with a slightly adjusted prompt.`, detail: message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
