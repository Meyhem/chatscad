import { formatLines, type LineRange } from '../scad/statements'
import type { PromptContext } from './prompt'
import type { ContentPart, Usage } from './types'

export type ScopedSelection = NonNullable<PromptContext['selection']>

/** Lines without CRLF and without trailing blank lines, so a reply that drops the final newline still compares equal. */
const lines = (text: string) => text.replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n')

export function scopeInstruction(selection: ScopedSelection, code: string): string {
  const where = formatLines(selection)
  const quoted = lines(code).slice(selection.startLine - 1, selection.endLine).join('\n')
  return [
    `The user selected one part of the model, "${selection.label}", at ${where} of the current file.`,
    `Edit only ${where}. Keep every other line exactly as it is.`,
    `Every SEARCH block must change only ${where}. If the request cannot be done there, change nothing and say why.`,
    `The selected ${selection.startLine === selection.endLine ? 'line is' : 'lines are'}:`,
    '```openscad',
    quoted,
    '```',
  ].join('\n')
}

export function changedOutsideRange(before: string, after: string, { startLine, endLine }: LineRange): boolean {
  const b = lines(before)
  const a = lines(after)
  const head = Math.max(0, startLine - 1)
  const tail = Math.max(0, b.length - endLine)
  if (a.length < head + tail) return true
  for (let i = 0; i < head; i++) if (a[i] !== b[i]) return true
  for (let i = 1; i <= tail; i++) if (a[a.length - i] !== b[b.length - i]) return true
  return false
}

export function scopeCorrection(selection: ScopedSelection): string {
  const where = formatLines(selection)
  return `Your previous reply changed lines outside ${where}. Reply again and change only ${where}; keep every other line exactly as it is.`
}

export function scopeRejected(selection: ScopedSelection): string {
  return `The reply changed lines outside ${formatLines(selection)}, so it was not applied. Ask again, or clear the selected part to allow changes anywhere.`
}

export function withCorrection(userText: string | ContentPart[], correction: string): string | ContentPart[] {
  return typeof userText === 'string' ? `${userText}\n\n${correction}` : [...userText, { type: 'text', text: correction }]
}

export function addUsage(a: Usage, b: Usage): Usage {
  const reported = a.costUsd !== undefined || b.costUsd !== undefined
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    ...(reported ? { costUsd: (a.costUsd ?? 0) + (b.costUsd ?? 0) } : {}),
  }
}
