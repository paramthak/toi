import { redirect } from 'next/navigation'
import { getAuthUser } from '@/lib/auth'
import NavBar from '@/components/ui/NavBar'
import CreativeLibrary from '@/components/library/CreativeLibrary'

export default async function LibraryPage() {
  const user = await getAuthUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-zinc-950">
      <NavBar />
      <div className="md:pt-14 pb-14 md:pb-0">
        <CreativeLibrary />
      </div>
    </div>
  )
}
