import { create } from 'zustand'

/** Whether the New project dialog is open; the project menu, the no-project card and startup without projects open it. */
export const useNewProjectDialog = create<{ open: boolean; setOpen(open: boolean): void }>()((set) => ({ open: false, setOpen: (open) => set({ open }) }))
