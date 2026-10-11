/** While a reply streams, show only the prose before the first code fence or SEARCH block. */
export function streamingText(text: string): { prose: string; writing: boolean } {
  const cut = text.search(/```|<<<<<<< SEARCH/)
  return cut < 0 ? { prose: text.trim(), writing: false } : { prose: text.slice(0, cut).trim(), writing: true }
}
