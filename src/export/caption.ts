/** Draws "v3 · “prompt”" in a panel-coloured strip at the bottom left of a frame. */
export function drawCaption(frame: ImageData, text: string, colors: { ink: string; panel: string }): ImageData {
  if (typeof OffscreenCanvas === 'undefined') return frame
  const canvas = new OffscreenCanvas(frame.width, frame.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return frame
  ctx.putImageData(frame, 0, 0)
  const pad = Math.round(frame.height / 30)
  const fontPx = Math.max(12, Math.round(frame.height / 24))
  ctx.font = `500 ${fontPx}px "JetBrains Mono", ui-monospace, monospace`
  const maxText = frame.width - 4 * pad
  const textWidth = Math.min(ctx.measureText(text).width, maxText)
  const stripHeight = Math.round(fontPx * 1.8)
  const top = frame.height - pad - stripHeight
  ctx.globalAlpha = 0.85
  ctx.fillStyle = colors.panel
  ctx.fillRect(pad, top, textWidth + 2 * pad, stripHeight)
  ctx.globalAlpha = 1
  ctx.fillStyle = colors.ink
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 2 * pad, top + stripHeight / 2, maxText)
  return ctx.getImageData(0, 0, frame.width, frame.height)
}
