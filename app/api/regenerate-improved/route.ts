import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { assemblMetaPrompt, generateImage, scoreCreative } from '@/lib/gemini'
import { saveBase64Image, fileExists, readFileAsBase64 } from '@/lib/storage'
import { query } from '@/lib/db'
import { getScoreLabel } from '@/lib/prompts/scoringPrompt'
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
      image_url: string
      brief_json: Record<string, unknown>
      archetype: string
      aspect_ratio: string
    }>(
      `SELECT id, session_id, image_url, brief_json, archetype, aspect_ratio FROM generations WHERE id = $1`,
      [generationId]
    )
    if (!genRows.length) {
      return NextResponse.json({ error: 'Generation not found' }, { status: 404 })
    }
    const gen = genRows[0]

    // Fetch the latest score to get improvement_tips with prompt_addition
    const scoreRows = await query<{ raw_response: string | Record<string, unknown> }>(
      `SELECT raw_response FROM scores WHERE generation_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [generationId]
    )

    // Build enriched brief: start with original, append prompt_additions
    const originalBrief = gen.brief_json as unknown as BriefJSON
    const enrichedBrief: BriefJSON = { ...originalBrief }

    if (scoreRows.length) {
      try {
        // raw_response is JSONB — may come back as object already
        const raw = scoreRows[0].raw_response
        const scoreData = typeof raw === 'string' ? JSON.parse(raw) : raw
        const tips: Array<{ prompt_addition?: string }> = scoreData.improvement_tips || []
        const additions = tips
          .filter(t => t.prompt_addition)
          .map(t => t.prompt_addition!)
          .join(' ')

        if (additions) {
          // Append improvements to the hook_concept so the meta-prompt assembler sees them
          enrichedBrief.hook_concept = [
            originalBrief.hook_concept,
            `[IMPROVEMENT DIRECTIVES: ${additions}]`,
          ].filter(Boolean).join(' ')
        }
      } catch {
        // If scoring data is malformed, proceed with original brief
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

    // Update brand_constraints to reference logo
    if (logoImageBase64) {
      enrichedBrief.brand_constraints = `${enrichedBrief.brand_constraints || 'none'}. LOGO INPUT PROVIDED: The brand logo has been provided as a visual reference image input. Embed the exact provided logo in the bottom-left corner of the final image, at approximately 10-12% of frame width. Preserve its exact colors and shape. Add a subtle background pad for legibility if needed.`
    }

    // Assemble meta prompt
    const metaPrompt = await assemblMetaPrompt(enrichedBrief, productImageBase64, productImageMime)

    // Build input images
    const inputImages: Array<{ base64Data: string; mimeType: string }> = []
    if (logoImageBase64 && logoImageMime) {
      inputImages.push({ base64Data: logoImageBase64, mimeType: logoImageMime })
    }
    if (productImageBase64 && productImageMime) {
      inputImages.push({ base64Data: productImageBase64, mimeType: productImageMime })
    }

    // Generate improved image
    const generatedImage = await generateImage(
      metaPrompt,
      inputImages.length > 0 ? inputImages : undefined
    )

    // Save image
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

    // Score the new creative
    const scoring = await scoreCreative(
      generatedImage.base64Data,
      generatedImage.mimeType,
      enrichedBrief
    )
    scoring.score_label = getScoreLabel(scoring.final_score)

    // Save score
    await query(
      `INSERT INTO scores
        (generation_id, raw_response, final_score, score_label, scroll_stop_gate, gate_passed)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        newGenerationId,
        JSON.stringify(scoring),
        scoring.final_score,
        scoring.score_label,
        scoring.scroll_stop_gate.gate_score,
        scoring.scroll_stop_gate.gate_passed,
      ]
    )

    return NextResponse.json({
      generationId: newGenerationId,
      imageUrl,
      scoring,
      archetype: enrichedBrief.archetype,
    })
  } catch (err) {
    console.error('Regenerate-improved error:', err)
    const message = err instanceof Error ? err.message : 'Regeneration failed'
    return NextResponse.json(
      { error: 'Regeneration failed — please try again.', detail: message },
      { status: 500 }
    )
  }
}
