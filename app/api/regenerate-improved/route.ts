import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { assemblMetaPromptWithEval, generateImage } from '@/lib/openai'
import { saveBase64Image, fileExists, readFileAsBase64, compositeLogoOntoImage } from '@/lib/storage'
import { query } from '@/lib/db'
import { BriefJSON } from '@/lib/prompts/metaPromptAssembler'
import path from 'path'

export async function POST(request: NextRequest) {
  // Auth and validation before stream
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { generationId, logoUrl, productPhotoUrl } = await request.json() as {
    generationId: string
    logoUrl?: string
    productPhotoUrl?: string
  }

  if (!generationId) {
    return NextResponse.json({ error: 'generationId required' }, { status: 400 })
  }

  // Fetch the original generation
  const genRows = await query<{
    id: string
    session_id: string
    brief_json: Record<string, unknown>
    archetype: string
    aspect_ratio: string
  }>(
    `SELECT id, session_id, brief_json, archetype, aspect_ratio FROM generations WHERE id = $1`,
    [generationId]
  )
  if (!genRows.length) {
    return NextResponse.json({ error: 'Generation not found' }, { status: 404 })
  }
  const gen = genRows[0]

  // Fetch the latest score to get improvement_tips with prompt_addition
  const scoreRows = await query<{ raw_response: string | Record<string, unknown> }>(
    `SELECT raw_response FROM scores WHERE generation_id = $1 LIMIT 1`,
    [generationId]
  )

  // Build enriched brief: start with original, append prompt_additions
  const originalBrief = gen.brief_json as unknown as BriefJSON
  const enrichedBrief: BriefJSON = { ...originalBrief }

  if (scoreRows.length) {
    try {
      const raw = scoreRows[0].raw_response
      const scoreData = typeof raw === 'string' ? JSON.parse(raw) : raw as Record<string, unknown>
      const tips: Array<{ priority: number; tip: string; impact: string; factor: string; prompt_addition?: string }> =
        (scoreData.improvement_tips as typeof tips) || []
      const finalScore = scoreData.final_score as number | undefined
      const scoreLabel = scoreData.score_label as string | undefined

      if (tips.length > 0) {
        const mandatoryFixes = tips
          .filter(t => t.prompt_addition)
          .map((t, i) => `${i + 1}. [${t.impact.toUpperCase()} IMPACT — ${t.factor}]: ${t.tip}\n   PROMPT FIX: ${t.prompt_addition}`)
          .join('\n')

        enrichedBrief._refinement_notes = [
          `REFINEMENT MODE: Previous creative scored ${finalScore !== undefined ? Math.round(finalScore) : '?'}/100 (${scoreLabel || 'low score'}).`,
          `The following issues MUST be fixed in the new prompt:`,
          mandatoryFixes,
          `IMPORTANT: Keep the same archetype (${enrichedBrief.archetype}), emotional lane (${enrichedBrief.emotional_lane}), and core concept. Only fix the listed issues.`,
        ].join('\n')

        const additions = tips
          .filter(t => t.prompt_addition)
          .slice(0, 3)
          .map(t => t.prompt_addition!)
          .join(' ')
        if (additions) {
          enrichedBrief.hook_concept = `${originalBrief.hook_concept} [REQUIRED IMPROVEMENTS: ${additions}]`
        }
      }
    } catch {
      // Proceed with original brief if scoring data is malformed
    }
  }

  // Load product photo
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

  // Load logo — try filesystem first, fall back to _logo_b64 stored in original brief_json
  let logoImageBase64: string | undefined
  if (logoUrl) {
    const logoFilename = path.basename(logoUrl)
    if (fileExists(logoFilename)) {
      logoImageBase64 = readFileAsBase64(logoFilename)
    } else if (originalBrief._logo_b64) {
      logoImageBase64 = originalBrief._logo_b64
      console.log('[regenerate-improved] logo loaded from DB fallback (_logo_b64)')
    }
  }

  if (logoImageBase64) {
    enrichedBrief._logo_b64 = logoImageBase64
    enrichedBrief.brand_constraints = `${enrichedBrief.brand_constraints || 'none'}. Leave the bottom-left corner of the image clear (approx 15% width × 10% height) — the brand logo will be composited onto that area after generation.`
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        const metaPrompt = await assemblMetaPromptWithEval(
          enrichedBrief,
          productImageBase64,
          productImageMime,
          !!logoImageBase64,
          (msg) => emit({ type: 'status', message: msg })
        )

        emit({ type: 'status', message: 'Generating image...' })

        const generatedImage = await generateImage(metaPrompt, gen.aspect_ratio)

        // Composite the real logo onto the generated image using Sharp
        let finalBase64 = generatedImage.base64Data
        if (logoImageBase64) {
          try {
            emit({ type: 'status', message: 'Adding logo...' })
            finalBase64 = await compositeLogoOntoImage(generatedImage.base64Data, logoImageBase64)
          } catch (logoErr) {
            console.error('[regenerate] logo composite failed:', logoErr instanceof Error ? logoErr.message : logoErr)
          }
        }

        const imageUrl = await saveBase64Image(finalBase64, generatedImage.mimeType)

        const rows = await query<{ id: string }>(
          `INSERT INTO generations
            (session_id, brief_json, archetype, meta_prompt, image_url, aspect_ratio, variant_number, image_data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            gen.session_id,
            JSON.stringify(enrichedBrief),
            enrichedBrief.archetype,
            metaPrompt,
            imageUrl,
            gen.aspect_ratio,
            1,
            finalBase64,
          ]
        )
        const newGenerationId = rows[0].id

        emit({
          type: 'generation',
          data: {
            generationId: newGenerationId,
            imageUrl,
            archetype: enrichedBrief.archetype,
          },
        })

        emit({ type: 'done' })
      } catch (err) {
        console.error('Regenerate-improved error:', err)
        const message = err instanceof Error ? err.message : 'Regeneration failed'
        emit({ type: 'error', error: `Regeneration failed: ${message}`, detail: message })
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
