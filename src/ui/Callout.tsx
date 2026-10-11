import type { ReactNode } from 'react'
import { IconCheck, IconInfo, IconWarning } from './icons'

const ICONS = { info: IconInfo, ok: IconCheck, warn: IconWarning, error: IconWarning } as const

export function Callout({
  tone,
  title,
  role,
  children,
}: {
  tone: keyof typeof ICONS
  title: string
  role?: 'status' | 'alert'
  children?: ReactNode
}) {
  const Icon = ICONS[tone]
  return (
    <div role={role} className={`pc-callout is-${tone}`}>
      <Icon className="pc-i" aria-hidden="true" />
      <div className="pc-callout-body">
        <strong>{title}</strong>
        {children}
      </div>
    </div>
  )
}
