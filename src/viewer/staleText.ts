export function staleText(versionLabel: string | null): string {
  return versionLabel ? `Showing ${versionLabel}, the last version that compiled` : 'Showing the last model that compiled'
}
