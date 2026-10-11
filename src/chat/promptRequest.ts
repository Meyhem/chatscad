import { useEffect } from 'react'
import { create } from 'zustand'

export const ANNOTATE_PROMPT =
  'Add OpenSCAD Customizer annotations to every top-level parameter: a range comment such as // [10:1:200] for numbers, a list of options for choices, a one-line description on the line above each, and /* [Group] */ tabs where they help. Do not change any value or the geometry.'

export const ADD_PARAMETERS_PROMPT =
  'Make this model parametric: move every tunable dimension into a top-level variable before the first module, in millimetres, with an OpenSCAD Customizer range comment and a one-line description. Do not change the geometry.'

export interface PromptRequestState {
  request: { text: string; id: number } | null
  ask(text: string): void
  clear(): void
}

let nextId = 0

export const usePromptRequest = create<PromptRequestState>()((set) => ({
  request: null,
  ask: (text) => set({ request: { text, id: ++nextId } }),
  clear: () => set({ request: null }),
}))

/**
 * Puts text into the chat composer (screen Main: textarea "Prompt") through the native value setter, so the
 * composer's React state follows. The person reviews it and presses Send; nothing is sent from here.
 */
export function fillComposer(text: string, root: ParentNode = document): boolean {
  const el = root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prompt"]')
  if (!el) return false
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, text)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.focus()
  return true
}

/** Mounted once in the App: applies a pending request as soon as the composer exists. */
export function ComposerBridge() {
  const request = usePromptRequest((s) => s.request)
  useEffect(() => {
    if (request && fillComposer(request.text)) usePromptRequest.getState().clear()
  })
  return null
}
