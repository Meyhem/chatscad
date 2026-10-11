export type GlyphShape =
  | { kind: 'polygon'; face: 'f-l' | 'f-r' | 'f-top'; points: string }
  | { kind: 'ellipse'; face: 'f-hole'; cx: number; cy: number; rx: number; ry: number }

/** The screens' iso line glyph; `pc-thumb` and `pc-variant-view` colour the faces from tokens. */
export function Glyph({ shapes }: { shapes: GlyphShape[] }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      {shapes.map((s, i) =>
        s.kind === 'polygon' ? (
          <polygon key={i} className={s.face} points={s.points} />
        ) : (
          <ellipse key={i} className={s.face} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} />
        ),
      )}
    </svg>
  )
}

export const FAILED_GLYPH: GlyphShape[] = [
  { kind: 'polygon', face: 'f-l', points: '14,36 50,54 50,82 14,64' },
  { kind: 'polygon', face: 'f-r', points: '50,54 86,36 86,64 50,82' },
  { kind: 'polygon', face: 'f-top', points: '50,18 86,36 50,54 14,36' },
]

export const BOX_GLYPH: GlyphShape[] = [...FAILED_GLYPH, { kind: 'ellipse', face: 'f-hole', cx: 50, cy: 36, rx: 12, ry: 6 }]
