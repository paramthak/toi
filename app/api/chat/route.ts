import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { sendChatMessage, ChatMessage } from '@/lib/gemini'
import { CHAT_SYSTEM_PROMPT } from '@/lib/prompts/chatSystemPrompt'
import { query } from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { sessionId, message, history } = await request.json()

    if (!message) {
      return NextResponse.json({ error: 'Message required' }, { status: 400 })
    }

    // Create or validate session
    let activeSessionId = sessionId
    if (!activeSessionId) {
      const rows = await query<{ id: string }>(
        `INSERT INTO sessions (interface, username) VALUES ('chat', $1) RETURNING id`,
        [user.username]
      )
      activeSessionId = rows[0].id
    }

    // Send to Gemini Flash
    const chatHistory: ChatMessage[] = history || []
    const response = await sendChatMessage(chatHistory, message, CHAT_SYSTEM_PROMPT)

    // Check if the response contains a BRIEF_JSON block (ready to generate)
    // Use flexible closing tag to handle model typos like </BRIF_JSON>
    const briefMatch = response.match(/<BRIEF_JSON>([\s\S]*?)<\/[A-Z_]*JSON>/)
    let briefData = null
    if (briefMatch) {
      try {
        briefData = JSON.parse(briefMatch[1].trim())
      } catch {
        // Ignore parse errors — continue conversation
      }
    }

    return NextResponse.json({
      sessionId: activeSessionId,
      response,
      briefData,
    })
  } catch (err) {
    console.error('Chat error:', err)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
