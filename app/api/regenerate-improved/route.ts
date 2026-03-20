import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { assemblMetaPrompt, generateImage } from '@/lib/gemini'
import { saveBase64Image, fileExists, readFileAsBase64 } from '@/lib/storage'
import { query } from '@/lib/db'
import { BriefJSON } from '@/lib/prompts/metaPromptAssembler'
import path from 'path'

export async function POST(request: NextRequest) {
  try {
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
        const scoreData = typeof raw === 'string' ? JSON.parse(raw) : raw
        const tips: Array<{ prompt_addition?: string }> = (scoreData as Record<string, unknown>).improvement_tips as Array<{ prompt_addition?: string }> || []
        const additions = tips
          .filter(t => t.prompt_addition)
          .map(t => t.prompt_addition!)
          .join(' ')

        if (additions) {
          enrichedBrief.hook_concept = [
            originalBrief.hook_concept,
            `[IMPROVEMENT DIRECTIVES: ${additions}]`,
          ].filter(Boolean).join(' ')
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

    // Load logo
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

    if (logoImageBase64) {
      enrichedBrief.brand_constraints = `${enrichedBrief.brand_constraints || 'none'}. LOGO INPUT PROVIDED: The brand logo has been provided as a visual reference image input. Embed the exact provided logo in the bottom-left corner of the final image, at approximately 10-12% of frame width. Preserve its exact colors, transparency, and shape without modification. Do NOT add any background rectangle, shadow, or padding behind the logo.`
    }

    // Assemble meta prompt + generate image (only 2 API calls — avoids Railway 30s timeout)
    const metaPrompt = await assemblMetaPrompt(enrichedBrief, productImageBase64, productImageMime)

    const inputImages: Array<{ base64Data: string; mimeType: string }> = []
    if (logoImageBase64 && logoImageMime) {
      inputImages.push({ base64Data: logoImageBase64, mimeType: logoImageMime })
    }
    if (productImageBase64 && productImageMime) {
      inputImages.push({ base64Data: productImageBase64, mimeType: productImageMime })
    }

    const generatedImage = await generateImage(
      metaPrompt,
      inputImages.length > 0 ? inputImages : undefined
    )

    const imageUrl = await saveBase64Image(generatedImage.base64Data, generatedImage.mimeType)

    // Save generation record
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
        generatedImage.base64Data,
      ]
    )
    const newGenerationId = rows[0].id

    // Return immediately — client will call /api/score separately (same pattern as initial generation)
    return NextResponse.json({
      generationId: newGenerationId,
      imageUrl,
      archetype: enrichedBrief.archetype,
    })
  } catch (err) {
    console.error('Regenerate-improved error:', err)
    const message = err instanceof Error ? err.message : 'Regeneration failed'
    return NextResponse.json(
      { error: `Regeneration failed: ${message}`, detail: message },
      { status: 500 }
    )
  }
}
