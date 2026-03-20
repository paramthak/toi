import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { scoreCreative } from '@/lib/gemini'
import { readFileAsBase64, fileExists } from '@/lib/storage'
import { query } from '@/lib/db'
import path from 'path'

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { generationId } = await request.json()
    if (!generationId) {
      return NextResponse.json({ error: 'generationId required' }, { status: 400 })
    }

    // Fetch generation
    const rows = await query<{
      id: string
      image_url: string
      brief_json: Record<string, unknown>
      archetype: string
    }>(
      `SELECT id, image_url, brief_json, archetype FROM generations WHERE id = $1`,
      [generationId]
    )

    if (!rows.length) {
      return NextResponse.json({ error: 'Generation not found' }, { status: 404 })
    }

    const gen = rows[0]

    // Extract filename from URL
    const filename = path.basename(gen.image_url)
    if (!fileExists(filename)) {
      return NextResponse.json(
        { error: 'Score unavailable for this creative.' },
        { status: 404 }
      )
    }

    // Read image as base64
    const imageBase64 = readFileAsBase64(filename)

    // Determine mime type from extension
    const ext = path.extname(filename).toLowerCase().replace('.', '')
    const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`

    // Score the creative
    const scoring = await scoreCreative(imageBase64, mimeType, gen.brief_json as unknown as Parameters<typeof scoreCreative>[2])

    // Save score to DB
    await query(
      `INSERT INTO scores
        (generation_id, raw_response, final_score, score_label, scroll_stop_gate, gate_passed)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [
        generationId,
        JSON.stringify(scoring),
        scoring.final_score,
        scoring.score_label,
        scoring.scroll_stop_gate.gate_score,
        scoring.scroll_stop_gate.gate_passed,
      ]
    )

    return NextResponse.json({ scoring })
  } catch (err) {
    console.error('Score error:', err)
    return NextResponse.json(
      { error: 'Score unavailable for this creative.' },
      { status: 500 }
    )
  }
}
