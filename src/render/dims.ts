import type { Bounds } from './types'

const fmt = (n: number) => String(Number(n.toFixed(2)))

export function formatDimParts({ min, max }: Bounds): [string, string, string] {
  return [fmt(max[0] - min[0]), fmt(max[1] - min[1]), fmt(max[2] - min[2])]
}

export function formatDims(bounds: Bounds): string {
  return `${formatDimParts(bounds).join(' × ')} mm`
}
