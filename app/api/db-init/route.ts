import { NextRequest, NextResponse } from 'next/server'
import { initDb } from '@/lib/db'

// Called once at startup to initialize the DB schema
export async function POST(request: NextRequest) {
  // Only allow in server-side context with a secret
  const authHeader = request.headers.get('authorization')
  const initSecret = process.env.DB_INIT_SECRET || process.env.JWT_SECRET

  if (!initSecret || authHeader !== `Bearer ${initSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await initDb()
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('DB init error:', err)
    return NextResponse.json({ error: 'DB init failed' }, { status: 500 })
  }
}
