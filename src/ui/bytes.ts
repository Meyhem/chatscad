/** "5.2" for 5,240,000 bytes. Decimal megabytes, as download sizes are usually quoted. */
export function formatMegabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1)
}

/** "9.4 KB" below 1 MB, "1.6 MB" from 1 MB. */
export function formatSize(bytes: number): string {
  return bytes < 1_000_000 ? `${(bytes / 1000).toFixed(1)} KB` : `${formatMegabytes(bytes)} MB`
}
