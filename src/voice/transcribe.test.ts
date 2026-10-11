import { transcribe } from './transcribe'

const config = { baseUrl: 'https://fake-llm.test/v1/', apiKey: 'test-key', model: 'whisper-1' }
const audio = new Blob(['RIFF'], { type: 'audio/webm;codecs=opus' })

function fakeFetch(response: Response | Error) {
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    if (response instanceof Error) throw response
    return response
  })
}

it('posts the recording as multipart to the profile endpoint and returns the text', async () => {
  const fetchImpl = fakeFetch(new Response(JSON.stringify({ text: ' make it five slots ' }), { status: 200 }))
  expect(await transcribe(audio, config, undefined, fetchImpl as unknown as typeof fetch)).toBe('make it five slots')
  const [url, init] = fetchImpl.mock.calls[0]
  expect(url).toBe('https://fake-llm.test/v1/audio/transcriptions')
  expect(init?.method).toBe('POST')
  expect(init?.headers).toEqual({ Authorization: 'Bearer test-key' })
  const form = init?.body as FormData
  expect(form.get('model')).toBe('whisper-1')
  expect((form.get('file') as File).name).toBe('speech.webm')
})

it('sends no Authorization header without a key', async () => {
  const fetchImpl = fakeFetch(new Response(JSON.stringify({ text: 'hi' })))
  await transcribe(audio, { ...config, apiKey: '' }, undefined, fetchImpl as unknown as typeof fetch)
  expect(fetchImpl.mock.calls[0][1]?.headers).toEqual({})
})

it('says what failed', async () => {
  const run = (r: Response | Error) => transcribe(audio, config, undefined, fakeFetch(r) as unknown as typeof fetch)
  await expect(run(new Response('nope', { status: 401 }))).rejects.toThrow('Transcription failed: the provider answered HTTP 401.')
  await expect(run(new TypeError('Failed to fetch'))).rejects.toThrow(
    "Transcription failed: could not reach fake-llm.test. Check the connection and the provider's CORS settings.",
  )
  await expect(run(new Response(JSON.stringify({ result: 'x' })))).rejects.toThrow('Transcription failed: the reply had no text.')
})
