import { parseDiagnostics } from './diagnostics'
import type { LogLine, RenderResult } from './types'

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function failedResult(
  error: string,
  { logs = [], renderMs = 0 }: { logs?: LogLine[]; renderMs?: number } = {},
): RenderResult {
  return { ok: false, error, logs, diagnostics: parseDiagnostics(logs), renderMs }
}
