import { create } from 'zustand'

/** Whether the project Photos dialog is open; the Agent header button and the Sizes card both open it. */
export const usePhotosDialog = create<{ open: boolean; setOpen(open: boolean): void }>()((set) => ({ open: false, setOpen: (open) => set({ open }) }))
