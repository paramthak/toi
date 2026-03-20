import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getFilePath, fileExists } from '@/lib/storage'
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

    if (!fileExists(safeName)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const filepath = getFilePath(safeName)
    const buffer = fs.readFileSync(filepath)

    const ext = path.extname(safeName).toLowerCase().replace('.', '')
    const contentType = ext === 'svg' ? 'image/svg+xml' :
      ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
      ext === 'webp' ? 'image/webp' :
      'image/png'

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (err) {
    console.error('File serve error:', err)
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}
