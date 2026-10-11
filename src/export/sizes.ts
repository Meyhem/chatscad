export interface SizeOption {
  label: string
  size: [number, number]
}

export const IMAGE_SIZES: SizeOption[] = [
  { label: '1080 × 1080 px', size: [1080, 1080] },
  { label: '1920 × 1080 px', size: [1920, 1080] },
  { label: '800 × 600 px', size: [800, 600] },
]

export const GIF_SIZES: SizeOption[] = [
  { label: '480 × 480 px', size: [480, 480] },
  { label: '640 × 480 px', size: [640, 480] },
  { label: '1080 × 1080 px', size: [1080, 1080] },
]

/** The live preview renders at most `maxWidth` wide, keeping the aspect ratio. */
export function previewSize([w, h]: [number, number], maxWidth = 480): [number, number] {
  const scale = Math.min(1, maxWidth / w)
  return [Math.round(w * scale), Math.round(h * scale)]
}
