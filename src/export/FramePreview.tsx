import { useEffect, useRef, type ReactNode } from 'react'
import { IconSpinner } from '../ui/icons'

export function FramePreview({
  frame,
  label,
  placeholder,
  overlay,
}: {
  frame: ImageData | null
  label: string
  placeholder?: ReactNode
  overlay?: ReactNode
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvas.current
    if (!c || !frame) return
    c.width = frame.width
    c.height = frame.height
    c.getContext('2d')?.putImageData(frame, 0, 0)
  }, [frame])

  return (
    <div className="relative grid h-[300px] place-items-center overflow-hidden rounded-md border border-line bg-viewport">
      {frame ? (
        <canvas ref={canvas} role="img" aria-label={label} className="absolute inset-0 size-full object-contain" />
      ) : (
        (placeholder ?? (
          <span className="pc-status is-busy">
            <IconSpinner className="pc-i" aria-hidden="true" />
            Rendering preview…
          </span>
        ))
      )}
      {overlay}
    </div>
  )
}
