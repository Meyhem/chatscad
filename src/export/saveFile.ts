export type SaveOutcome = 'shared' | 'downloaded' | 'cancelled'

function isTouchDevice(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
}

function download(file: File): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

/** Web Share with a file on touch devices (downloads are unreliable on iOS), else a download link. */
export async function saveFile(
  blob: Blob,
  filename: string,
  { preferShare = isTouchDevice() }: { preferShare?: boolean } = {},
): Promise<SaveOutcome> {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' })
  if (preferShare && typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    }
  }
  download(file)
  return 'downloaded'
}

export const exportStl = (stl: ArrayBuffer) => saveFile(new Blob([stl], { type: 'model/stl' }), 'model.stl')
export const exportScad = (code: string) => saveFile(new Blob([code], { type: 'text/plain' }), 'model.scad')
