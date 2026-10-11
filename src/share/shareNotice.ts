import { create } from 'zustand'

export interface Notice {
  tone: 'info' | 'error'
  title: string
  body: string
}

export const useShareNotice = create<{ notice: Notice | null; show(notice: Notice | null): void; dismiss(): void }>()((set) => ({
  notice: null,
  show: (notice) => set({ notice }),
  dismiss: () => set({ notice: null }),
}))
