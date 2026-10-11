const CHUNK = 0x8000

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}

export function dataUrlToBlob(url: string): Blob {
  const match = /^data:([^;,]+);base64,(.*)$/.exec(url)
  if (!match) throw new Error('Not a base64 data URL')
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: match[1] })
}
