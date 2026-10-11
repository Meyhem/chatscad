/** Fired before focusing, so a layout that hides the chat (the phone tabs) can show it first, synchronously. */
export const SHOW_CHAT_EVENT = 'promptcad:show-chat'

/** "Ask AI": put the cursor in the chat composer, where the pick chip already shows. */
export function focusComposer(): boolean {
  window.dispatchEvent(new Event(SHOW_CHAT_EVENT))
  const textarea = document.querySelector<HTMLTextAreaElement>('.pc-composer textarea')
  textarea?.focus()
  return textarea !== null
}
