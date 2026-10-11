import { create } from 'zustand'

export type ExportTab = 'model' | 'image' | 'turntable' | 'timelapse' | 'link'

interface ExportState {
  open: boolean
  tab: ExportTab
  openAt(tab: ExportTab): void
  setTab(tab: ExportTab): void
  close(): void
}

export const useExportStore = create<ExportState>()((set) => ({
  open: false,
  tab: 'model',
  openAt: (tab) => set({ open: true, tab }),
  setTab: (tab) => set({ tab }),
  close: () => set({ open: false }),
}))
