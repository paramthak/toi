import { redirect } from 'next/navigation'
import { getAuthUser } from '@/lib/auth'
import NavBar from '@/components/ui/NavBar'
import ChatInterface from '@/components/chat/ChatInterface'

interface Props {
  searchParams: { brief?: string }
}

export default async function ChatPage({ searchParams }: Props) {
  const user = await getAuthUser()
  if (!user) redirect('/login')

  let preloadedBrief = undefined
  if (searchParams.brief) {
    try {
      preloadedBrief = JSON.parse(decodeURIComponent(searchParams.brief))
    } catch {
      // ignore malformed brief
    }
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-950">
      <NavBar />
      <div className="flex-1 overflow-hidden md:pt-14 pb-14 md:pb-0">
        <ChatInterface preloadedBrief={preloadedBrief} />
      </div>
    </div>
  )
}
