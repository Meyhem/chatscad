/** "2,310 tok" */
export function formatTokens(n: number): string {
  return `${Math.round(n).toLocaleString('en-US')} tok`
}

/** "$0.011" (3 decimals under $1, 2 decimals from $1), "$0.000" for 0, "price unknown" for null */
export function formatCost(usd: number | null): string {
  if (usd === null) return 'price unknown'
  const thousandths = Math.round(usd * 1000) / 1000
  if (thousandths < 1) return `$${thousandths.toFixed(3)}`
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
