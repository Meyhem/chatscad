import { computeCost } from '../ai/cost'
import { ProviderError, type ContentPart, type LlmProvider, type ModelPrice, type Usage } from '../ai/types'
import type { ChatMessage } from '../chat/chatStore'
import { presetPose, renderFrames } from '../export/frames'
import { blobToBase64 } from '../images/base64'
import { imageDataToPng } from '../images/imageData'
import { errorMessage } from '../render/result'
import type { MeshData } from '../render/types'
import { readToken } from '../theme/tokens'

type ImagePart = Extract<ContentPart, { type: 'image' }>

export const VISUAL_CHECK_SYSTEM =
  'You check renders of 3D models written in OpenSCAD. Units are millimetres. Answer briefly and plainly.'
export const VISUAL_CHECK_QUESTION = 'Does this match the request? Answer yes or no and one sentence.'
const MAX_ANSWER_CHARS = 400
const ISO_SIZE: [number, number] = [768, 768]

/** One iso frame of the mesh from M4's offscreen frame renderer, on the viewport colour. */
export async function renderIsoImage(mesh: MeshData): Promise<ImagePart> {
  const frames = renderFrames({ mesh, size: ISO_SIZE, background: readToken('viewport'), cameras: [presetPose(mesh.bounds, 'iso')] })
  const first = await frames.next()
  await frames.return(undefined)
  if (first.done) throw new Error('The renderer produced no image')
  return { type: 'image', mediaType: 'image/png', data: await blobToBase64(await imageDataToPng(first.value)) }
}

export async function runVisualCheck(opts: {
  provider: LlmProvider
  model: string
  request: string
  mesh: MeshData
  signal?: AbortSignal
  renderImage?(mesh: MeshData): Promise<ImagePart>
}): Promise<{ answer: string; usage: Usage }> {
  const image = await (opts.renderImage ?? renderIsoImage)(opts.mesh)
  let text = ''
  let usage: Usage = { inputTokens: 0, outputTokens: 0 }
  const events = opts.provider.streamChat(
    {
      model: opts.model,
      system: VISUAL_CHECK_SYSTEM,
      maxTokens: 200,
      messages: [{ role: 'user', content: [{ type: 'text', text: `Request: ${opts.request}\n\n${VISUAL_CHECK_QUESTION}` }, image] }],
    },
    opts.signal,
  )
  for await (const event of events) {
    if (event.type === 'text') text += event.delta
    else if (event.type === 'usage') usage = event.usage
  }
  const answer = text.replace(/\s+/g, ' ').trim().slice(0, MAX_ANSWER_CHARS)
  return { answer: answer === '' ? 'No answer.' : answer, usage }
}

function note(text: string, model: string, usage: Usage | null, price: ModelPrice | undefined): Omit<ChatMessage, 'id'> {
  return {
    role: 'note',
    text,
    turnLabel: null,
    model,
    usage: usage
      ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cost: computeCost(usage, price).cost }
      : null,
    status: 'done',
  }
}

const wasStopped = (e: unknown) =>
  (e instanceof ProviderError && e.kind === 'aborted') || (e instanceof DOMException && e.name === 'AbortError')

/** Runs at most once per turn, after the first successful render; the answer is shown, never acted on. */
export async function maybeVisualCheck(opts: {
  enabled: boolean
  vision: boolean
  provider: LlmProvider
  model: string
  request: string
  mesh: MeshData
  price?: ModelPrice
  signal?: AbortSignal
  renderImage?(mesh: MeshData): Promise<ImagePart>
  addNote(note: Omit<ChatMessage, 'id'>): void
  onUsage?(usage: Usage): void
}): Promise<void> {
  if (!opts.enabled || !opts.vision) return
  try {
    const { answer, usage } = await runVisualCheck(opts)
    opts.onUsage?.(usage)
    opts.addNote(note(`Visual check: ${answer}`, opts.model, usage, opts.price))
  } catch (e) {
    if (wasStopped(e)) return
    opts.addNote(note(`Visual check failed: ${errorMessage(e)}`, opts.model, null, opts.price))
  }
}
