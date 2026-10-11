import type { Diagnostic, LogLine } from './types'

const PREFIX = /^(ERROR|WARNING):\s*(.*)$/
/** `, in file main.scad, line 12` or ` in file "/main.scad", line 3` */
const LOCATION = /,?\s*in file\s+"?([^",]+?)"?,\s*line\s+(\d+)/

export function parseDiagnosticLine(text: string): Diagnostic | null {
  const m = PREFIX.exec(text.trim())
  if (!m) return null
  const loc = LOCATION.exec(m[2])
  if (!loc || !/(^|\/)main\.scad$/.test(loc[1])) return null
  const message = m[2].replace(LOCATION, '').replace(/\s{2,}/g, ' ').trim()
  return { severity: m[1] === 'ERROR' ? 'error' : 'warning', line: Number(loc[2]), message }
}

export function parseDiagnostics(logs: LogLine[]): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const { text } of logs) {
    const d = parseDiagnosticLine(text)
    if (d) out.push(d)
  }
  return out
}
