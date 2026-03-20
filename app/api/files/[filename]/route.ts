import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getFilePath, fileExists } from '@/lib/storage'
import { query } from '@/lib/db'
import fs from 'fs'
import path from 'path'

export async function GET(
  request: NextRequest,
  { params }: { params: { filename: string } }
) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const filename = params.filename
    // Security: prevent path traversal
    const safeName = path.basename(filename)
    if (safeName !== filename) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
    }

    const ext = path.extname(safeName).toLowerCase().replace('.', '')
    const contentType = ext === 'svg' ? 'image/svg+xml' :
      ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
      ext === 'webp' ? 'image/webp' :
      'image/png'

    let buffer: Buffer

    if (fileExists(safeName)) {
      buffer = fs.readFileSync(getFilePath(safeName))
    } else {
      // Fallback: load image_data from DB
      const rows = await query<{ image_data: string | null }>(
        `SELECT image_data FROM generations WHERE image_url = $1 LIMIT 1`,
        [`/api/files/${safeName}`]
      )

      if (!rows.length || !rows[0].image_data) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      buffer = Buffer.from(rows[0].image_data, 'base64')
    }

    const isDownload = request.nextUrl.searchParams.get('download') === '1'
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    }
    if (isDownload) {
      headers['Content-Disposition'] = `attachment; filename="${safeName}"`
    }

    return new NextResponse(new Uint8Array(buffer), { headers })
  } catch (err) {
    console.error('File serve error:', err)
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}
