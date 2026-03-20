import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatScore(score: number): string {
  return Math.round(score).toString()
}

export function getScoreBadgeStyle(label: string): string {
  switch (label) {
    case 'Elite': return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
    case 'Launch Ready': return 'bg-green-500/20 text-green-400 border border-green-500/30'
    case 'Conditional Launch': return 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
    case 'Revise First': return 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
    case 'Significant Rebuild': return 'bg-red-500/20 text-red-400 border border-red-500/30'
    case 'Do Not Launch': return 'bg-red-900/40 text-red-500 border border-red-800/50'
    default: return 'bg-zinc-800 text-zinc-400 border border-zinc-700'
  }
}

export function getScoreRingColor(score: number): string {
  if (score >= 80) return '#22c55e'
  if (score >= 65) return '#eab308'
  if (score >= 50) return '#f97316'
  return '#ef4444'
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
