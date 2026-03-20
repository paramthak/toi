import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
    const offset = parseInt(searchParams.get('offset') || '0')

    const rows = await query<{
      id: string
      created_at: string
      image_url: string
      aspect_ratio: string
      variant_number: number
      archetype: string
      brief_json: Record<string, unknown>
      final_score: number | null
      score_label: string | null
      session_interface: string
    }>(
      `SELECT
        g.id,
        g.created_at,
        g.image_url,
        g.aspect_ratio,
        g.variant_number,
        g.archetype,
        g.brief_json,
        s.final_score,
        s.score_label,
        sess.interface as session_interface
      FROM generations g
      JOIN sessions sess ON sess.id = g.session_id
      LEFT JOIN scores s ON s.generation_id = g.id
      WHERE sess.username = $1
      ORDER BY g.created_at DESC
      LIMIT $2 OFFSET $3`,
      [user.username, limit, offset]
    )

    return NextResponse.json({ items: rows, offset, limit })
  } catch (err) {
    console.error('Library error:', err)
    return NextResponse.json({ error: 'Failed to load library' }, { status: 500 })
  }
}
