import { isAbortError } from '../util/abort'

export interface TranscribeConfig {
  baseUrl: string
  apiKey: string
  model: string
}

function extensionFor(type: string): string {
  if (type.includes('ogg')) return 'ogg'
  if (type.includes('mp4') || type.includes('aac')) return 'm4a'
  if (type.includes('wav')) return 'wav'
  return 'webm'
}

/** OpenAI-compatible `POST {baseUrl}/audio/transcriptions`, multipart `file` + `model`. */
export async function transcribe(
  audio: Blob,
  { baseUrl, apiKey, model }: TranscribeConfig,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const form = new FormData()
  form.append('file', audio, `speech.${extensionFor(audio.type)}`)
  form.append('model', model)
  const url = `${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`

  let res: Response
  try {
    res = await fetchImpl(url, { method: 'POST', headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, body: form, signal })
  } catch (e) {
    if (isAbortError(e)) throw e
    throw new Error(`Transcription failed: could not reach ${new URL(url).host}. Check the connection and the provider's CORS settings.`)
  }
  if (!res.ok) throw new Error(`Transcription failed: the provider answered HTTP ${res.status}.`)
  const body = (await res.json().catch(() => null)) as { text?: unknown } | null
  if (typeof body?.text !== 'string') throw new Error('Transcription failed: the reply had no text.')
  return body.text.trim()
}
