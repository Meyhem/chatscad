import { useEffect } from 'react'
import { useProjectStore } from '../history/projectStore'

export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.cm-editor, input, textarea, select, [contenteditable="true"]') !== null
}

/** Version undo/redo outside the editor; inside it, CodeMirror's own undo handles keystrokes. */
export function useUndoShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isEditableTarget(e.target)) return
      const key = e.key.toLowerCase()
      const redo = (key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey)
      const undo = key === 'z' && !e.shiftKey
      if (!undo && !redo) return
      e.preventDefault()
      void (redo ? useProjectStore.getState().redo() : useProjectStore.getState().undo())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
