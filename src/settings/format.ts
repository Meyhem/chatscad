export function formatBytes(n: number): string {
  const gb = n / 1024 ** 3
  if (gb >= 1) return `${Number(gb.toFixed(1))} GB`
  const mb = n / 1024 ** 2
  if (mb >= 1) return `${Number(mb.toFixed(1))} MB`
  return `${Math.round(n / 1024)} KB`
}
