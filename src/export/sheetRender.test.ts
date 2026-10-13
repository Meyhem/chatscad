import type { MeshData } from '../render/types'
import { okResult } from '../test/results'
import { renderFrames } from './frames'
import { scaleBarLength, sheetLayout, sheetPoses, SHEET_SIZE, SHEET_VIEWS, type SheetLayout } from './sheet'
import { drawSheet, renderSheet, type SheetCanvas, type SheetColours } from './sheetRender'

const COLOURS: SheetColours = { paper: 'paper', ink: 'ink', muted: 'muted', fontSans: 'Sans', fontMono: 'Mono' }
const BOUNDS = { min: [-10, 5, 0], max: [30, 25, 10] } as MeshData['bounds']

type Call = [string, ...unknown[]]
function recorder(extra: Record<string, unknown> = {}) {
  const calls: Call[] = []
  const state: Record<string, unknown> = { ...extra }
  const ctx = new Proxy(state, {
    get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]) => void calls.push([k, ...args])),
    set: (t, k: string, v) => {
      t[k] = v
      calls.push([`set ${k}`, v])
      return true
    },
  })
  return { ctx: ctx as unknown as SheetCanvas, calls }
}
const fakeFrame = (i: number) => ({ width: 1, height: 1, data: new Uint8ClampedArray(4), i }) as unknown as ImageData

function drawn(layout: SheetLayout = sheetLayout(BOUNDS, SHEET_SIZE)) {
  const { ctx, calls } = recorder()
  const frames = SHEET_VIEWS.map((_, i) => fakeFrame(i))
  drawSheet(ctx, { layout, bounds: BOUNDS, frames, colours: COLOURS })
  return { calls, frames, layout }
}

afterEach(() => vi.restoreAllMocks())

it('paints the paper first, then each view image in its box', () => {
  const { calls, frames, layout } = drawn()
  expect(calls.slice(0, 2)).toEqual([
    ['set fillStyle', 'paper'],
    ['fillRect', 0, 0, ...SHEET_SIZE],
  ])
  const puts = calls.filter((c) => c[0] === 'putImageData')
  expect(puts).toEqual(SHEET_VIEWS.map((v, i) => ['putImageData', frames[i], Math.round(layout.images[v].x), Math.round(layout.images[v].y)]))
})

it('writes every view label, both dimensions per orthographic view, the caption and the scale bar label', () => {
  const { calls, layout } = drawn()
  const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
  expect(texts).toEqual([
    'Top',
    'Iso',
    'Front',
    'Right',
    '40 mm',
    '10 mm',
    '40 mm',
    '20 mm',
    '20 mm',
    '10 mm',
    '40 × 20 × 10 mm overall · third-angle projection · front, top and right to one scale',
    `${scaleBarLength(layout)} mm`,
  ])
})

it('draws arrowheads at both ends of every dimension and turns the vertical labels', () => {
  const { calls } = drawn()
  expect(calls.filter((c) => c[0] === 'fill')).toHaveLength(12) // 6 dimensions × 2 arrows
  expect(calls.filter((c) => c[0] === 'rotate')).toEqual([
    ['rotate', -Math.PI / 2],
    ['rotate', -Math.PI / 2],
    ['rotate', -Math.PI / 2],
  ])
})

it('uses only the sheet colours and the token font families', () => {
  const { calls } = drawn()
  const colours = new Set(calls.filter((c) => c[0] === 'set fillStyle' || c[0] === 'set strokeStyle').map((c) => c[1]))
  expect([...colours].sort()).toEqual(['ink', 'muted', 'paper'])
  const fonts = calls.filter((c) => c[0] === 'set font').map((c) => String(c[1]))
  expect(fonts.length).toBeGreaterThan(0)
  for (const f of fonts) expect(f.endsWith(' Sans') || f.endsWith(' Mono')).toBe(true)
})

it('renders the four views at the image size on paper, then returns the whole sheet', async () => {
  const r = okResult()
  if (!r.ok) throw new Error('fixture must succeed')
  const mesh = { ...r.mesh, bounds: BOUNDS }
  const sheet = { width: SHEET_SIZE[0], height: SHEET_SIZE[1] } as ImageData
  const { ctx, calls } = recorder({ getImageData: () => sheet })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  const render = vi.fn(async function* (_opts: Parameters<typeof renderFrames>[0]) {
    for (let i = 0; i < 4; i++) yield fakeFrame(i)
  })

  await expect(renderSheet({ mesh, size: SHEET_SIZE, colours: COLOURS, render })).resolves.toBe(sheet)
  const layout = sheetLayout(BOUNDS, SHEET_SIZE)
  expect(render).toHaveBeenCalledWith({
    mesh,
    size: [layout.images.front.w, layout.images.front.h],
    background: 'paper',
    edges: 'ink',
    cameras: sheetPoses(BOUNDS, layout),
  })
  expect(calls.filter((c) => c[0] === 'putImageData')).toHaveLength(4)
})

it('says what failed when the browser has no 2D canvas', async () => {
  const r = okResult()
  if (!r.ok) throw new Error('fixture must succeed')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  const render = vi.fn(async function* () {
    for (let i = 0; i < 4; i++) yield fakeFrame(i)
  })
  await expect(renderSheet({ mesh: r.mesh, size: SHEET_SIZE, colours: COLOURS, render })).rejects.toThrow('The browser has no 2D canvas to draw the sheet')
})
