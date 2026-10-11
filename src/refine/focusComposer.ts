/** "Ask AI": put the cursor in the chat composer, where the pick chip already shows. */
export function focusComposer(): boolean {
  const textarea = document.querySelector<HTMLTextAreaElement>('.pc-composer textarea')
  textarea?.focus()
  return textarea !== null
}
