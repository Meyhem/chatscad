import type { ReactNode } from 'react'

/** Preview on the left, options in a 300 px column on the right; stacked on phones. */
export function TabBody({ children }: { children: ReactNode }) {
  return <div className="grid gap-6 px-6 py-5 md:grid-cols-[minmax(0,1fr)_300px]">{children}</div>
}

export function TabFooter({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3 border-t border-line px-6 py-4">{children}</div>
}
