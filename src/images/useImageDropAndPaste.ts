import { useEffect, type RefObject } from 'react'
import { NO_VISION_EXPLANATION, useAttachments } from './attachments'

export function useImageDropAndPaste(ref: RefObject<HTMLElement | null>, vision: boolean): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const take = (files: ArrayLike<File> | null | undefined): boolean => {
      const images = Array.from(files ?? []).filter((f) => f.type.startsWith('image/'))
      if (images.length === 0) return false
      if (vision) void useAttachments.getState().addFiles(images)
      else useAttachments.getState().setError(NO_VISION_EXPLANATION)
      return true
    }
    const onPaste = (e: ClipboardEvent) => {
      if (take(e.clipboardData?.files)) e.preventDefault()
    }
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      if (take(e.dataTransfer?.files)) e.preventDefault()
    }
    el.addEventListener('paste', onPaste)
    el.addEventListener('dragover', onDragOver)
    el.addEventListener('drop', onDrop)
    return () => {
      el.removeEventListener('paste', onPaste)
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('drop', onDrop)
    }
  }, [ref, vision])
}
