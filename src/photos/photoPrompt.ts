import { formatParamValue } from '../render/args'
import type { ParamValue } from '../render/types'
import { PHOTO_LABEL, type PhotoAngle, type PhotoScale } from './projectPhotos'

export interface PhotoContext {
  angles: PhotoAngle[]
  scale: PhotoScale
}

const SCALE_RULE: Record<PhotoScale, string> = {
  reference: 'Estimate sizes from the coin, card or ruler in the photos (a 1 euro coin is 23.25 mm, a US quarter 24.26 mm, a credit card 85.6 × 54 mm).',
  description: 'Take sizes only from the description; estimate the rest by proportion and mark them guessed.',
}

const angleList = (angles: readonly PhotoAngle[]) => angles.map((a) => PHOTO_LABEL[a].toLowerCase()).join(', ')

/** The system prompt section for a project that started from photos (spec P6). */
export function photoSection(ctx: PhotoContext): string {
  return [
    `Reference photos of the real object are attached to the request, each labelled with its angle (${angleList(ctx.angles)}).`,
    'The description is authoritative where it gives a size or a feature. Use the photos for shape, proportions and features.',
    'Sizes the photos cannot show are guesses: choose sensible values for a printed part and say so.',
    SCALE_RULE[ctx.scale],
    'End every Customizer annotation with its source: `from description`, `from photo` or `guessed`, for example `wall = 3; // [1.2:0.2:6] guessed`.',
    'The model is a starting point the user will correct, so keep it simple and parametric.',
  ].join(' ')
}

/** The sizes the user set in the Customizer, so a rewrite keeps them (spec P9). */
export function keepSizesSection(params: Record<string, ParamValue>): string {
  const entries = Object.entries(params)
  if (entries.length === 0) return ''
  return `The user set these sizes; keep them: ${entries.map(([k, v]) => `${k} = ${formatParamValue(v)}`).join(', ')}.`
}

/** The request behind "Refine with N photos" (spec P10). */
export function refineText(newAngles: readonly PhotoAngle[], keep: Record<string, ParamValue>): string {
  const parts = ['Compare the model with the reference photos and fix what differs.']
  if (newAngles.length > 0) parts.push(`New photos: ${angleList(newAngles)}.`)
  const sizes = keepSizesSection(keep)
  if (sizes) parts.push(sizes)
  return parts.join(' ')
}

export const PHOTO_PLAN_NOTE = 'Reference photos of the real object are attached. Plan checks for the features they show and for every size in the description.'

export const PHOTO_REVIEW_NOTE =
  'Reference photos of the real object are attached. Compare the rendered front view with the front photo and the top view with the top photo (the side photo matches the right view). A check fails when the render clearly differs from the photo in shape or in the presence of a feature.'
