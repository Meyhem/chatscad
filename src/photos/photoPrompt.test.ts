import { keepSizesSection, photoSection, refineText } from './photoPrompt'

it('describes the photos and the scale rule', () => {
  const text = photoSection({ angles: ['front', 'top'], scale: 'reference' })
  expect(text).toContain('Reference photos of the real object are attached')
  expect(text).toContain('front, top')
  expect(text).toContain('1 euro coin is 23.25 mm')
  expect(text).toContain('`from description`, `from photo` or `guessed`')
  expect(photoSection({ angles: ['photo'], scale: 'description' })).toContain('Take sizes only from the description')
})

it('lists the sizes the user set, or nothing', () => {
  expect(keepSizesSection({})).toBe('')
  expect(keepSizesSection({ wall: 3.2, cup_depth: 28, label: 'ABC' })).toBe('The user set these sizes; keep them: wall = 3.2, cup_depth = 28, label = "ABC".')
})

it('writes the refine request with the new angles and kept sizes', () => {
  expect(refineText(['side'], { wall: 3.2 })).toBe(
    'Compare the model with the reference photos and fix what differs. New photos: side. The user set these sizes; keep them: wall = 3.2.',
  )
  expect(refineText([], {})).toBe('Compare the model with the reference photos and fix what differs.')
})
