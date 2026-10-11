/** "2026.10.08" from public/openscad/VERSION, whose first line is the pinned snapshot URL. */
export function parseEngineVersion(text: string): string | null {
  return /OpenSCAD-(\d{4}\.\d{2}\.\d{2})/.exec(text)?.[1] ?? null
}

export function engineLabel(version: string | null): string {
  return version ? `OpenSCAD ${version} · manifold` : 'OpenSCAD · manifold'
}

export async function loadEngineVersion(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(`${import.meta.env.BASE_URL}openscad/VERSION`)
    return res.ok ? parseEngineVersion(await res.text()) : null
  } catch {
    return null
  }
}
