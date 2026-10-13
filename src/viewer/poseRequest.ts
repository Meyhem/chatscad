import { create } from 'zustand'
import type { CameraPose } from '../export/frames'

/** A camera pose the viewer should move to once; `token` changes on every request so the same pose can be asked for twice. */
export const usePoseRequest = create<{ pose: CameraPose | null; token: number; request(pose: CameraPose): void }>()((set) => ({
  pose: null,
  token: 0,
  request: (pose) => set((s) => ({ pose, token: s.token + 1 })),
}))
