import { isLibraryName, LIBRARY_INFO } from '../render/libraries'

/** The system prompt mentions a library only when the project enables it (D8). */
export function librarySection(libraries: string[]): string {
  const enabled = libraries.filter(isLibraryName)
  if (enabled.length === 0) return ''
  const lines = enabled.map((name) => `- ${name} ${LIBRARY_INFO[name].version}: ${LIBRARY_INFO[name].usage}`)
  return `Libraries available in this project (use no others):\n${lines.join('\n')}`
}
