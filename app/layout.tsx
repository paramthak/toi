import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CreativeIQ — AI Ad Creative Generator',
  description: 'Generate high-CTR Instagram ad creatives with AI',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-zinc-950 text-white antialiased">
        {children}
      </body>
    </html>
  )
}
