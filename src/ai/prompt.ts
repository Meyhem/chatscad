import type { RenderResult } from '../render/types'
import { librarySection } from './libraryPrompt'
import type { ContentPart, LlmMessage } from './types'
import { scopeInstruction } from './scope'

export interface PromptContext {
  code: string // current editor code ('' when empty)
  errors?: string // compiler errors for auto-fix
  libraries?: string[] // M3: enabled libraries
  selection?: { startLine: number; endLine: number; label: string } // M5: scoped edit
}

export const SYSTEM_PROMPT = `You are ChatSCAD's modelling assistant. You write OpenSCAD for parts that will be 3D printed.

Rules for the code:
- Write valid OpenSCAD only. Units are millimetres.
- Put every tunable dimension in a top-level variable with an OpenSCAD Customizer comment, for example \`width = 40; // [10:1:200]\`, and group the variables under \`/* [Group] */\` headings.
- Make one named module per logical part, and call the modules at the end of the file.
- Set $fn on round primitives (48 to 96 is usually enough) so previews stay fast.
- Never use import(), surface() or any file that is not in the code.

How to reply:
- Start with one or two short sentences that say what you made or changed. No headings and no list of every parameter.
- To write a whole file, put all of it in one \`\`\`openscad fenced block.
- To change the current file, use one or more SEARCH/REPLACE blocks instead of a fence:
<<<<<<< SEARCH
exact lines from the current file
=======
replacement lines
>>>>>>> REPLACE
- Each SEARCH must copy the current lines exactly, including indentation and comments, and must match only one place in the file. Keep blocks small and in file order.
- When you are asked to fix compiler errors, change only what is needed to make the file compile.`

function buildBaseSystemPrompt(ctx: PromptContext): string {
  const libraries = librarySection(ctx.libraries ?? []) || 'No external libraries are available: do not use include <…> or use <…>.'
  return `${SYSTEM_PROMPT}\n\n${libraries}`
}

/** Turns the chat history plus the new user text into provider messages, putting the current code and any errors into the final user message. */
export function buildMessages(history: LlmMessage[], userText: string | ContentPart[], ctx: PromptContext): LlmMessage[] {
  const empty = ctx.code.trim() === ''
  const fullFile = history.length === 0 || empty
  const parts: string[] = [
    empty ? 'The editor is empty.' : `Current main.scad:\n\`\`\`openscad\n${ctx.code.endsWith('\n') ? ctx.code : `${ctx.code}\n`}\`\`\``,
  ]
  if (ctx.errors && ctx.errors.trim() !== '') parts.push(`OpenSCAD reported these errors:\n\`\`\`text\n${ctx.errors.trim()}\n\`\`\``)
  parts.push(
    fullFile
      ? 'Reply with the complete file in one ```openscad block.'
      : 'Reply with SEARCH/REPLACE blocks against the current main.scad, or with the complete file in one ```openscad block if most of it changes.',
  )
  const context = parts.join('\n\n')
  const content: LlmMessage['content'] =
    typeof userText === 'string' ? `${context}\n\nRequest: ${userText}` : [{ type: 'text', text: `${context}\n\nRequest:` }, ...userText]
  return [...history, { role: 'user', content }]
}

const MAX_ERROR_CHARS = 4000

/** The compiler's own words for a failed render, for the auto-fix request. */
export function formatCompileErrors(result: RenderResult): string {
  if (result.ok) return ''
  const lines = result.logs.filter((l) => /^(ERROR|WARNING|Execution aborted)/.test(l.text)).map((l) => l.text)
  const text = lines.length > 0 ? lines.join('\n') : result.error
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS)}\n…` : text
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const base = buildBaseSystemPrompt(ctx)
  // M5: a scoped edit names its lines. Auto-fix requests (ctx.errors) are not scoped: the line numbers are stale by then.
  return ctx.selection && !ctx.errors ? `${base}\n\n${scopeInstruction(ctx.selection, ctx.code)}` : base
}
