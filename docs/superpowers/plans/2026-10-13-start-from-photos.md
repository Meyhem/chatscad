# Start from photos — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new project can start from one photo or several tagged angles of a real object plus a description; the photos stay with the project, every build and review sees them, and every size in the result says where it came from.

**Architecture:** Photos are stored on the project (`Project.photos`, image blobs) and joined to the outgoing content parts of every builder, planner and reviewer request in that project. A photo section in the system prompt asks the builder to end each Customizer annotation with its source; the customizer parser reads it, the dock and a new Sizes card show it. The new project dialog grows a Photos path; a Photos dialog on the Agent header adds angles later and sends a refine request.

**Tech Stack:** React 19, Zustand, Dexie, Vitest + Testing Library (jsdom), Playwright, existing `pc-*` design classes and tokens.

**Spec:** [`docs/superpowers/specs/2026-10-13-start-from-photos-design.md`](../specs/2026-10-13-start-from-photos-design.md). Screens: `design/screens/Photo*.dc.html`.

## Global Constraints

- TDD: write the failing test first and watch it fail. Tests that read the filesystem start with `// @vitest-environment node`. Database tests import `'fake-indexeddb/auto'` and call `resetDb()`.
- Tokens only: no hex colours and no Tailwind palette classes in `src/`. Use `bg-panel`, `text-ink`, `text-ink-muted`, `text-warn`, `border-line`, `border-accent`, `bg-inset`, the CSS variables and the `pc-*` classes.
- Copy: sentence case, units on every number ("25 mm"), the `×` sign, errors say what failed and where, no exclamation marks or emoji. Copy comes from the spec's "UI copy" section.
- Model output is untrusted: React text nodes only, never HTML.
- All asset URLs work under `BASE_PATH`.
- Photos: at most 5 per project (`MAX_PROJECT_PHOTOS`), downscaled to 1024 px on the long edge (`PHOTO_MAX_EDGE`), description at most 2,000 characters (`MAX_BRIEF_CHARS`).
- After each task: `npm run typecheck`, `npm test`, then one conventional commit. Run `npm run e2e` before every push, and push `main` after each green task (CLAUDE.md). Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **A photo that fails to decode** (a HEIC file renamed `.jpg`): the dialog skips it with "Could not read IMG_0412.jpg. Add a PNG, JPEG or WebP image." and still submits with the rest. Test in Task 6.
2. **A sixth photo**: "Up to 5 photos per project. IMG_0412.jpg was not added." and nothing else changes. Tests in Tasks 1 and 6.
3. **An annotation with trailing words that are not a source** (`// [1:10] mm`): the slider still works and `source` is `null`. Test in Task 2.
4. **A photo blob evicted from IndexedDB**: the turn is sent with the photos that loaded and a note says "1 photo could not be loaded". Test in Task 4.
5. **A project file whose photo data is not an image** (text in `data`, or 50 MB of base64): import is refused with a message naming `project.photos[0].data`. Test in Task 5.

---

### Task 1: Project photos — types, preparation, storage

**Files:**
- Create: `src/photos/projectPhotos.ts`, `src/photos/projectPhotos.test.ts`
- Modify: `src/images/prepareImage.ts` (a `maxEdge` parameter), `src/db/db.ts:96-106` (`Project`), `src/db/projects.ts` (`deleteProjectCascade`), `src/history/projectStore.ts` (`NewProjectOptions`, `newProject`, `setPhotos`, `setBrief`)
- Test: `src/db/repos.test.ts` (cascade), `src/history/projectStore.test.ts` (new fields)

**Interfaces:**
- Produces:
  ```ts
  export type PhotoAngle = 'photo' | 'front' | 'top' | 'side' | 'back' | 'bottom' | 'other'
  export type PhotoScale = 'reference' | 'description'
  export interface ProjectPhoto { id: string; blobId: string; angle: PhotoAngle; addedAt: number }
  export const PHOTO_ANGLES: readonly PhotoAngle[]          // ['front','top','side','back','bottom','other']
  export const MAX_PROJECT_PHOTOS = 5
  export const PHOTO_MAX_EDGE = 1024
  export const MAX_BRIEF_CHARS = 2000
  export const PHOTO_LABEL: Record<PhotoAngle, string>     // 'Photo','Front','Top','Side','Back','Bottom','Other angle'
  export const tooManyPhotos = (name: string) => string
  export const unreadablePhoto = (name: string) => string
  export function preparePhoto(blob: Blob, type?: OutputType, codec?: ImageCodec): Promise<PreparedImage>
  export interface LoadedPhoto { photo: ProjectPhoto; blob: Blob; mediaType: 'image/png' | 'image/jpeg' }
  export function loadPhotos(photos: readonly ProjectPhoto[], load?: (id: string) => Promise<Blob | null>): Promise<{ loaded: LoadedPhoto[]; missing: number }>
  export function photoParts(loaded: readonly LoadedPhoto[], toBase64?: (b: Blob) => Promise<string>): Promise<ContentPart[]>
  ```
  `Project` gains `photos?: ProjectPhoto[]`, `brief?: string`, `scale?: PhotoScale`, and `origin` gains `'photos'`. `useProjectStore` gains `setPhotos(photos: ProjectPhoto[]): Promise<void>` and `setBrief(brief: string): Promise<void>`; `NewProjectOptions` gains `photos?`, `brief?`, `scale?`.

- [ ] **Step 1: Write the failing unit test** (`src/photos/projectPhotos.test.ts`)

```ts
import type { ImageCodec } from '../images/prepareImage'
import { loadPhotos, MAX_PROJECT_PHOTOS, PHOTO_LABEL, photoParts, preparePhoto, tooManyPhotos, type ProjectPhoto } from './projectPhotos'

const codec: ImageCodec = {
  decode: async () => ({ width: 4000, height: 3000 }),
  encode: async (_i, width, height, type) => new Blob([`${width}x${height}`], { type }),
}

const photo = (angle: ProjectPhoto['angle'], blobId = `b-${angle}`): ProjectPhoto => ({ id: `p-${angle}`, blobId, angle, addedAt: 1 })

it('downscales a photo to 1024 px on the long edge', async () => {
  const out = await preparePhoto(new Blob(['x'], { type: 'image/jpeg' }), 'image/jpeg', codec)
  expect([out.width, out.height]).toEqual([1024, 768])
  expect(await out.blob.text()).toBe('1024x768')
})

it('loads the photos that exist and counts the missing ones', async () => {
  const blobs: Record<string, Blob> = { 'b-front': new Blob(['f'], { type: 'image/jpeg' }) }
  const { loaded, missing } = await loadPhotos([photo('front'), photo('top')], async (id) => blobs[id] ?? null)
  expect(loaded.map((l) => l.photo.angle)).toEqual(['front'])
  expect(loaded[0]!.mediaType).toBe('image/jpeg')
  expect(missing).toBe(1)
})

it('turns loaded photos into labelled image parts, in order', async () => {
  const loaded = [
    { photo: photo('top'), blob: new Blob(['t'], { type: 'image/png' }), mediaType: 'image/png' as const },
    { photo: photo('other'), blob: new Blob(['o'], { type: 'image/jpeg' }), mediaType: 'image/jpeg' as const },
  ]
  const parts = await photoParts(loaded, async (b) => `base64:${await b.text()}`)
  expect(parts).toEqual([
    { type: 'text', text: 'Reference photo (top)' },
    { type: 'image', mediaType: 'image/png', data: 'base64:t' },
    { type: 'text', text: 'Reference photo (other angle)' },
    { type: 'image', mediaType: 'image/jpeg', data: 'base64:o' },
  ])
})

it('names the limit and the file that was not added', () => {
  expect(MAX_PROJECT_PHOTOS).toBe(5)
  expect(tooManyPhotos('IMG_0412.jpg')).toBe('Up to 5 photos per project. IMG_0412.jpg was not added.')
  expect(PHOTO_LABEL.other).toBe('Other angle')
})
```

- [ ] **Step 2: Run it.** `npx vitest run src/photos/projectPhotos.test.ts` — expected: FAIL, module not found.

- [ ] **Step 3: Give `prepareImage` a size parameter** (`src/images/prepareImage.ts`)

```ts
/** Downscales to at most `maxEdge` px on the long edge and re-encodes (which also drops EXIF data such as location). */
export async function prepareImage(blob: Blob, type: OutputType, codec: ImageCodec = browserCodec, maxEdge = MAX_IMAGE_EDGE): Promise<PreparedImage> {
  const image = await codec.decode(blob)
  try {
    const { width, height } = fitWithin(image.width, image.height, maxEdge)
    return { blob: await codec.encode(image, width, height, type, JPEG_QUALITY), mediaType: type, width, height }
  } finally {
    image.close?.()
  }
}
```

- [ ] **Step 4: Implement** `src/photos/projectPhotos.ts`

```ts
import type { ContentPart } from '../ai/types'
import { loadImage } from '../db/images'
import { blobToBase64 } from '../images/base64'
import { outputTypeFor, prepareImage, type ImageCodec, type OutputType, type PreparedImage } from '../images/prepareImage'

/** Where a photo was taken from. 'photo' is the one-photo case (no angle chosen). */
export type PhotoAngle = 'photo' | 'front' | 'top' | 'side' | 'back' | 'bottom' | 'other'
/** How the builder gets sizes: from a coin, card or ruler in the photos, or only from the description. */
export type PhotoScale = 'reference' | 'description'

export interface ProjectPhoto {
  id: string
  blobId: string
  angle: PhotoAngle
  addedAt: number
}

export const PHOTO_ANGLES: readonly PhotoAngle[] = ['front', 'top', 'side', 'back', 'bottom', 'other']
export const MAX_PROJECT_PHOTOS = 5
/** Smaller than chat attachments: the photos go with every request in the project. */
export const PHOTO_MAX_EDGE = 1024
export const MAX_BRIEF_CHARS = 2000

export const PHOTO_LABEL: Record<PhotoAngle, string> = {
  photo: 'Photo',
  front: 'Front',
  top: 'Top',
  side: 'Side',
  back: 'Back',
  bottom: 'Bottom',
  other: 'Other angle',
}

export const tooManyPhotos = (name: string): string => `Up to ${MAX_PROJECT_PHOTOS} photos per project. ${name} was not added.`
export const unreadablePhoto = (name: string): string => `Could not read ${name}. Add a PNG, JPEG or WebP image.`

export function preparePhoto(blob: Blob, type: OutputType = outputTypeFor(blob.type), codec?: ImageCodec): Promise<PreparedImage> {
  return codec ? prepareImage(blob, type, codec, PHOTO_MAX_EDGE) : prepareImage(blob, type, undefined, PHOTO_MAX_EDGE)
}

export interface LoadedPhoto {
  photo: ProjectPhoto
  blob: Blob
  mediaType: 'image/png' | 'image/jpeg'
}

/** The photos whose blobs are still in the database; `missing` counts the rest. */
export async function loadPhotos(
  photos: readonly ProjectPhoto[],
  load: (id: string) => Promise<Blob | null> = loadImage,
): Promise<{ loaded: LoadedPhoto[]; missing: number }> {
  const loaded: LoadedPhoto[] = []
  let missing = 0
  for (const photo of photos) {
    const blob = await load(photo.blobId)
    if (!blob) missing++
    else loaded.push({ photo, blob, mediaType: blob.type === 'image/png' ? 'image/png' : 'image/jpeg' })
  }
  return { loaded, missing }
}

/** Content parts for a request: each photo preceded by its angle, in project order. */
export async function photoParts(loaded: readonly LoadedPhoto[], toBase64: (b: Blob) => Promise<string> = blobToBase64): Promise<ContentPart[]> {
  const parts: ContentPart[] = []
  for (const { photo, blob, mediaType } of loaded) {
    parts.push({ type: 'text', text: `Reference photo (${PHOTO_LABEL[photo.angle].toLowerCase()})` })
    parts.push({ type: 'image', mediaType, data: await toBase64(blob) })
  }
  return parts
}
```

- [ ] **Step 5: Run it.** `npx vitest run src/photos/projectPhotos.test.ts src/images` — expected: PASS.

- [ ] **Step 6: Write the failing store and cascade tests.** Append to `src/history/projectStore.test.ts` (follow its existing `beforeEach` with `resetDb()`):

```ts
it('keeps photos, the brief and the scale on a photo project', async () => {
  const photos = [{ id: 'p1', blobId: 'b1', angle: 'front' as const, addedAt: 1 }]
  const project = await store().newProject({ code: '', origin: 'photos', photos, brief: 'A bracket', scale: 'reference' })
  expect(project).toMatchObject({ origin: 'photos', photos, brief: 'A bracket', scale: 'reference' })
  await store().setPhotos([...photos, { id: 'p2', blobId: 'b2', angle: 'top', addedAt: 2 }])
  await store().setBrief('A bracket, 50 mm tall')
  const saved = await db.projects.get(project.id)
  expect(saved?.photos).toHaveLength(2)
  expect(saved?.brief).toBe('A bracket, 50 mm tall')
})

it('leaves photos off a blank project', async () => {
  const project = await store().newProject({ code: '', origin: 'blank' })
  expect('photos' in project).toBe(false)
})
```

Append to `src/db/repos.test.ts`:

```ts
it('deletes a project’s photo blobs with the project', async () => {
  await db.blobs.put({ id: 'photo-1', kind: 'image', data: new Blob(['x']) })
  await db.projects.put({
    id: 'pp', name: 'P', createdAt: 1, updatedAt: 1, headVersionId: null, providerProfileId: null, enabledLibraries: [], origin: 'photos',
    photos: [{ id: 'p1', blobId: 'photo-1', angle: 'front', addedAt: 1 }],
  })
  await deleteProjectCascade('pp')
  expect(await db.blobs.get('photo-1')).toBeUndefined()
})
```

- [ ] **Step 7: Run them.** `npx vitest run src/history/projectStore.test.ts src/db/repos.test.ts` — expected: FAIL (type errors on `photos`, `setPhotos`; the blob survives).

- [ ] **Step 8: Implement the data changes.**

`src/db/db.ts`, in `Project`:

```ts
import type { PhotoScale, ProjectPhoto } from '../photos/projectPhotos'
…
  origin: 'blank' | 'gallery' | 'shared-link' | 'photos'
  /** Reference photos of the real object (spec P3); absent on projects that did not start from photos. */
  photos?: ProjectPhoto[]
  /** The description the project started from (spec P4). */
  brief?: string
  scale?: PhotoScale
```

`src/db/projects.ts`, inside the transaction of `deleteProjectCascade`, before `bulkDelete`:

```ts
    const project = await db.projects.get(id)
    const blobIds = [
      ...versions.flatMap((v) => (v.thumbnailBlobId ? [v.thumbnailBlobId] : [])),
      ...messages.flatMap((m) => m.imageBlobIds),
      ...(project?.photos ?? []).map((p) => p.blobId),
    ]
```

`src/history/projectStore.ts`:

```ts
import type { PhotoScale, ProjectPhoto } from '../photos/projectPhotos'

export interface NewProjectOptions {
  …
  photos?: ProjectPhoto[]
  brief?: string
  scale?: PhotoScale
}
// ProjectState:
  setPhotos(photos: ProjectPhoto[]): Promise<void>
  setBrief(brief: string): Promise<void>
// newProject draft:
        origin: opts.origin,
        ...(opts.photos ? { photos: opts.photos } : {}),
        ...(opts.brief !== undefined ? { brief: opts.brief } : {}),
        ...(opts.scale ? { scale: opts.scale } : {}),
// actions, next to setChecks:
    async setPhotos(photos) {
      const project = get().project
      if (!project) return
      const updated: Project = { ...project, photos, updatedAt: Date.now() }
      set({ project: updated })
      await putProject(updated)
    },

    async setBrief(brief) {
      const project = get().project
      if (!project) return
      const updated: Project = { ...project, brief: brief.slice(0, MAX_BRIEF_CHARS), updatedAt: Date.now() }
      set({ project: updated })
      await putProject(updated)
    },
```

Import `MAX_BRIEF_CHARS` from `../photos/projectPhotos`. Any exhaustive `switch` on `origin` (grep `case 'shared-link'`) gets a `'photos'` arm with the label "Photos".

- [ ] **Step 9: Run** `npm run typecheck && npx vitest run src/history src/db src/photos` — expected: PASS.

- [ ] **Step 10: Commit.**

```bash
git add src/photos src/images/prepareImage.ts src/db/db.ts src/db/projects.ts src/db/repos.test.ts src/history/projectStore.ts src/history/projectStore.test.ts
git commit -m "feat: reference photos, brief and scale on a project"
```

---

### Task 2: Parameter sources in the customizer

**Files:**
- Modify: `src/scad/customizer.ts:13-21` (`CustomizerParam.source`), `:116-123` (`annotationAfter`), `:235-245` (building the param), `src/customizer/ParamRow.tsx:51-56,140-147`
- Test: `src/scad/customizer.test.ts`, `src/customizer/ParamRow.test.tsx`

**Interfaces:**
- Produces: `CustomizerParam.source: ParamSource` with `export type ParamSource = 'description' | 'photo' | 'guess' | null` and `export const SOURCE_LABEL: Record<Exclude<ParamSource, null>, string> = { description: 'From description', photo: 'From photo', guess: 'Guessed' }`, both exported from `src/scad/customizer.ts`. Task 7 reads `source`.

- [ ] **Step 1: Write the failing parser tests** (append to `src/scad/customizer.test.ts`, inside the existing `describe` of `parseCustomizer`)

```ts
  it('reads a size source after the annotation and keeps the control', () => {
    const code = ['rod_d = 25; // [15:0.5:40] from description', 'wall = 3; // [1.2:0.2:6] guessed', 'plate_w = 22; // [14:1:40] from photo', 'n = 4; // 1 guessed', 'plain = 2; // [1:9]'].join('\n')
    const params = parseCustomizer(code)
    expect(params.map((p) => p.source)).toEqual(['description', 'guess', 'photo', 'guess', null])
    expect(params[0]!.control).toEqual({ kind: 'slider', min: 15, step: 0.5, max: 40 })
    expect(params[3]!.control).toEqual({ kind: 'number', step: 1 })
    expect(params[3]!.annotated).toBe(true)
  })

  it('ignores trailing words that are not a source', () => {
    const [p] = parseCustomizer('w = 5; // [1:10] mm')
    expect(p!.source).toBeNull()
    expect(p!.control).toEqual({ kind: 'slider', min: 1, step: 1, max: 10 })
  })

  it('reads a source on an un-annotated number too', () => {
    const [p] = parseCustomizer('depth = 24; // guessed')
    expect(p!.source).toBe('guess')
    expect(p!.control).toEqual({ kind: 'number' })
    expect(p!.annotated).toBe(false)
  })
```

- [ ] **Step 2: Run** `npx vitest run src/scad/customizer.test.ts` — expected: FAIL (`source` undefined, the slider with trailing text falls back to a number input).

- [ ] **Step 3: Implement.** In `src/scad/customizer.ts`:

```ts
/** Where a size came from, from the words after the Customizer annotation (spec P7). */
export type ParamSource = 'description' | 'photo' | 'guess' | null

export const SOURCE_LABEL: Record<Exclude<ParamSource, null>, string> = {
  description: 'From description',
  photo: 'From photo',
  guess: 'Guessed',
}

export interface CustomizerParam {
  …
  annotated: boolean
  source: ParamSource
}

interface Assignment {
  …
  annotation: string | null
  source: ParamSource
}

const SOURCE = /\s*(from (?:the )?description|from (?:the )?photos?|guessed)\s*$/i

/** Splits "[1:10] guessed" into the annotation and the source; words that are not a source stay with the annotation. */
export function splitSource(text: string | null): { annotation: string | null; source: ParamSource } {
  if (text === null) return { annotation: null, source: null }
  const m = SOURCE.exec(text)
  if (!m) return { annotation: text, source: null }
  const word = m[1]!.toLowerCase()
  const source: ParamSource = word === 'guessed' ? 'guess' : word.includes('photo') ? 'photo' : 'description'
  const rest = text.slice(0, m.index).trim()
  return { annotation: rest === '' ? null : rest, source }
}
```

In `scanAssignments`, where the assignment is pushed (around line 169), replace `annotation: annotationAfter(tokens, end),` with:

```ts
              ...splitSource(annotationAfter(tokens, end)),
```

(`splitSource` returns `annotation` and `source`, so the object literal gets both.) In the function that builds `CustomizerParam` from an `Assignment` (around line 235), add `source: a.source` to `base`. An un-annotated number whose only trailing text is a source now has `annotation === null`, so `annotated` stays false and the control is `{ kind: 'number' }`, which the third test expects.

- [ ] **Step 4: Run** `npx vitest run src/scad` — expected: PASS. Fix any `CustomizerParam` literals in other tests that now lack `source` (add `source: null`).

- [ ] **Step 5: Write the failing row test** (append to `src/customizer/ParamRow.test.tsx`, using its existing render helper):

```ts
it('shows where a size came from, and marks a guess', () => {
  render(<ParamRow param={{ name: 'wall', defaultValue: 3, control: { kind: 'slider', min: 1, step: 0.2, max: 6 }, group: '', description: '', line: 1, annotated: true, source: 'guess' }} value={3} onChange={() => {}} />)
  const hint = screen.getByText('Guessed')
  expect(hint).toHaveClass('text-warn')
  expect(screen.queryByText('[1 : 0.2 : 6]')).toBeNull()
})
```

- [ ] **Step 6: Run** `npx vitest run src/customizer/ParamRow.test.tsx` — expected: FAIL.

- [ ] **Step 7: Implement** in `ParamRow.tsx`: the source replaces the range hint when present.

```ts
import { SOURCE_LABEL, type CustomizerParam } from '../scad/customizer'
…
  const rangeHint = c.kind === 'slider' ? `[${c.min} : ${c.step} : ${c.max}]` : c.kind === 'number' && c.step !== undefined ? `step ${c.step}` : null
  const hint = param.source ? SOURCE_LABEL[param.source] : rangeHint
…
        {hint && <small className={param.source === 'guess' ? 'text-warn' : undefined}>{hint}</small>}
```

- [ ] **Step 8: Run** `npm run typecheck && npx vitest run src/customizer src/scad` — expected: PASS.

- [ ] **Step 9: Commit.**

```bash
git add src/scad/customizer.ts src/scad/customizer.test.ts src/customizer/ParamRow.tsx src/customizer/ParamRow.test.tsx
git commit -m "feat: customizer parameters carry a size source"
```

---

### Task 3: Prompt sections for photo projects

**Files:**
- Create: `src/photos/photoPrompt.ts`, `src/photos/photoPrompt.test.ts`
- Modify: `src/ai/prompt.ts` (`PromptContext.photos`, `PromptContext.keepParams`, `buildSystemPrompt`, `buildMessages`)
- Test: `src/ai/prompt.test.ts`

**Interfaces:**
- Produces, in `src/photos/photoPrompt.ts`:
  ```ts
  export interface PhotoContext { angles: PhotoAngle[]; scale: PhotoScale }
  export function photoSection(ctx: PhotoContext): string
  export function keepSizesSection(params: Record<string, ParamValue>): string   // '' when empty
  export function refineText(newAngles: PhotoAngle[], keep: Record<string, ParamValue>): string
  export const PHOTO_PLAN_NOTE: string
  export const PHOTO_REVIEW_NOTE: string
  ```
  `PromptContext` gains `photos?: PhotoContext` and `keepParams?: Record<string, ParamValue>`.

- [ ] **Step 1: Write the failing tests** (`src/photos/photoPrompt.test.ts`)

```ts
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
```

Append to `src/ai/prompt.test.ts`:

```ts
it('adds the photo section to the system prompt and the kept sizes to the request', () => {
  const system = buildSystemPrompt({ code: '', photos: { angles: ['front'], scale: 'description' } })
  expect(system).toContain('Reference photos of the real object are attached')
  expect(buildSystemPrompt({ code: '' })).not.toContain('Reference photos')
  const [last] = buildMessages([], 'Make it taller', { code: 'h = 1;', keepParams: { h: 2 } }).slice(-1)
  expect(last!.content).toContain('The user set these sizes; keep them: h = 2.')
})
```

- [ ] **Step 2: Run** `npx vitest run src/photos/photoPrompt.test.ts src/ai/prompt.test.ts` — expected: FAIL.

- [ ] **Step 3: Implement** `src/photos/photoPrompt.ts`

```ts
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
```

`formatParamValue` renders strings as JSON (`"ABC"`), numbers plainly, vectors as `[1,2]`.

In `src/ai/prompt.ts`:

```ts
import { keepSizesSection, photoSection, type PhotoContext } from '../photos/photoPrompt'
import type { ParamValue } from '../render/types'

export interface PromptContext {
  …
  /** Spec P6: the project started from photos; the photos themselves travel as content parts. */
  photos?: PhotoContext
  /** Spec P9: parameter overrides the builder must keep. */
  keepParams?: Record<string, ParamValue>
}

function buildBaseSystemPrompt(ctx: PromptContext): string {
  const libraries = …
  const photos = ctx.photos ? `\n\n${photoSection(ctx.photos)}` : ''
  return `${SYSTEM_PROMPT}\n\n${libraries}${photos}`
}
```

In `buildMessages`, after the errors part and before the "Reply with…" line:

```ts
  const keep = ctx.keepParams ? keepSizesSection(ctx.keepParams) : ''
  if (keep) parts.push(keep)
```

- [ ] **Step 4: Run** `npm run typecheck && npx vitest run src/photos src/ai` — expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/photos/photoPrompt.ts src/photos/photoPrompt.test.ts src/ai/prompt.ts src/ai/prompt.test.ts
git commit -m "feat: prompt sections for projects that start from photos"
```

---

### Task 4: Photos ride with every builder, planner and reviewer request

**Files:**
- Modify: `src/chat/sendPrompt.ts` (`SendDeps.showPhotos`, photos joined to the turn), `src/agent/plan.ts` (`photos` option), `src/agent/review.ts` (`photos` option), `src/agent/agentStore.ts` (`AgentDeps.send` options, `projectPhotoParts`, pass photos to plan and review, `submit` extra `showPhotos`)
- Test: `src/chat/sendPrompt.test.ts`, `src/agent/plan.test.ts`, `src/agent/review.test.ts`, `src/agent/agentStore.test.ts`

**Interfaces:**
- Consumes: `loadPhotos`, `photoParts` (Task 1); `PromptContext.photos`, `keepParams` (Task 3).
- Produces:
  - `SendDeps` gains `showPhotos?: boolean` (the user bubble shows the project photos) and `loadPhotos?: typeof loadPhotos` (tests inject blobs).
  - `AgentDeps.send(text: string, opts?: { display?: string; transcript?: string; showPhotos?: boolean }): Promise<TurnOutcome>` replaces the positional form.
  - `runPlan(opts & { photos?: ContentPart[] })`, `runReview(opts & { photos?: ContentPart[] })`.
  - `useAgentStore.submit(text, deps?, extra?: { audioTranscript?; mode?; showPhotos?: boolean })`.
  - `export async function projectPhotoParts(): Promise<{ parts: ContentPart[]; missing: number }>` in `agentStore.ts`.

- [ ] **Step 1: Write the failing send test** (append to `src/chat/sendPrompt.test.ts`; follow the file's existing fake provider and store setup)

```ts
it('sends the project photos with the request, notes a missing one and keeps the user’s sizes', async () => {
  useProjectStore.setState({
    project: {
      id: 'p', name: 'P', createdAt: 1, updatedAt: 1, headVersionId: null, providerProfileId: null, enabledLibraries: [], origin: 'photos',
      photos: [
        { id: 'a', blobId: 'blob-front', angle: 'front', addedAt: 1 },
        { id: 'b', blobId: 'blob-gone', angle: 'top', addedAt: 2 },
      ],
      scale: 'reference',
    },
  })
  useAppStore.setState({ code: 'h = 10;', params: { h: 12 } })
  const requests: Array<{ system: string; content: unknown }> = []
  const provider = fakeProvider((req) => {
    requests.push({ system: req.system, content: req.messages.at(-1)!.content })
    return 'Done.\n\n```openscad\nh = 12; // [1:20] from description\ncube(h);\n```'
  })
  await sendPrompt('Make it taller', {
    createProvider: () => provider,
    render: okRender,
    showPhotos: true,
    loadPhotos: async (photos) => ({
      loaded: photos.filter((p) => p.blobId === 'blob-front').map((photo) => ({ photo, blob: new Blob(['f'], { type: 'image/jpeg' }), mediaType: 'image/jpeg' as const })),
      missing: 1,
    }),
    turnInput: { saveImage: async () => 'saved', toBase64: async (b) => `b64:${await b.text()}`, captureViewport: async () => null },
  })
  expect(requests[0]!.system).toContain('Reference photos of the real object are attached')
  const content = requests[0]!.content as Array<{ type: string; text?: string; data?: string }>
  expect(content.map((p) => p.type)).toEqual(['text', 'text', 'image'])
  expect(content[1]).toEqual({ type: 'text', text: 'Reference photo (front)' })
  expect(content[0]!.text).toContain('The user set these sizes; keep them: h = 12.')
  const messages = useChatStore.getState().messages
  expect(messages[0]!.imageBlobIds).toEqual(['blob-front', 'blob-gone'])
  expect(messages.some((m) => m.role === 'note' && m.text === '1 photo could not be loaded')).toBe(true)
})
```

If the file has no `fakeProvider(reply)` helper, write one at the top of the test: an `LlmProvider` whose `streamChat` yields `{ type: 'text', delta: reply(req) }` then `{ type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }`, and `okRender` returns `{ ok: true, mesh: …, logs: [], diagnostics: [], renderMs: 1 }` copied from the file's existing render stub.

- [ ] **Step 2: Run** `npx vitest run src/chat/sendPrompt.test.ts` — expected: FAIL (`showPhotos` unknown, two text parts missing).

- [ ] **Step 3: Implement in `sendPrompt.ts`.**

```ts
import { loadPhotos as defaultLoadPhotos, photoParts } from '../photos/projectPhotos'
import type { ContentPart } from '../ai/types'
import { useProjectStore } from '../history/projectStore'

export interface SendDeps {
  …
  /** Spec P4: the user bubble shows the project's photos (the first request of a photo project). */
  showPhotos?: boolean
  loadPhotos?: typeof defaultLoadPhotos
}
```

After `useAttachments.getState().clear()` and before `const provider = …`:

```ts
  // Spec P6: a photo project's reference photos go with every request.
  const project = useProjectStore.getState().project
  const photos = project?.photos ?? []
  let userText = input.userText
  let photoCtx: PromptContext['photos'] | undefined
  let missingPhotos = 0
  if (photos.length > 0) {
    const { loaded, missing } = await (deps.loadPhotos ?? defaultLoadPhotos)(photos)
    missingPhotos = missing
    const parts = await photoParts(loaded, deps.turnInput?.toBase64)
    const head: ContentPart[] = typeof userText === 'string' ? [{ type: 'text', text: userText }] : userText
    userText = [...head, ...parts]
    photoCtx = { angles: loaded.map((l) => l.photo.angle), scale: project?.scale ?? 'reference' }
  }
```

`PromptContext` is imported from `../ai/prompt`. The user message gains the photo ids when asked:

```ts
  const shownImages = [...input.imageBlobIds, ...(deps.showPhotos ? photos.map((p) => p.blobId) : [])]
  chat.addMessage({
    …
    ...(shownImages.length > 0 ? { imageBlobIds: shownImages } : {}),
  })
  if (missingPhotos > 0) chat.addMessage(note(`${missingPhotos} ${missingPhotos === 1 ? 'photo' : 'photos'} could not be loaded`))
```

In the `runTurn` call use `userText` (the joined parts) instead of `input.userText`, and extend `ctx`:

```ts
      ctx: {
        code: …,
        libraries: currentLibraries(),
        ...(input.selection ? { selection: input.selection } : {}),
        ...(photoCtx ? { photos: photoCtx } : {}),
        ...(photos.length > 0 && Object.keys(useAppStore.getState().params).length > 0 ? { keepParams: useAppStore.getState().params } : {}),
      },
```

`keepParams` is the raw override map (`app.params`), which holds only values the user changed; that is what P9 wants. The history entry (`{ role: 'user', content: userText }`) keeps the plain `userText` string as before; photos are never replayed from history.

- [ ] **Step 4: Run** `npx vitest run src/chat` — expected: PASS.

- [ ] **Step 5: Write the failing planner and reviewer tests.** Append to `src/agent/plan.test.ts`:

```ts
it('sends the photos after the request, with the planning note', async () => {
  const seen: unknown[] = []
  const provider = jsonProvider((req) => (seen.push(req.messages[0]!.content), { checks: [{ kind: 'size', text: 'About 50 mm tall' }], parts: ['body'] }))
  await runPlan({ provider, model: 'm', request: 'A bracket', photos: [{ type: 'text', text: 'Reference photo (front)' }, { type: 'image', mediaType: 'image/jpeg', data: 'x' }] })
  expect(seen[0]).toEqual([
    { type: 'text', text: 'Reference photos of the real object are attached. Plan checks for the features they show and for every size in the description.\n\nRequest: A bracket' },
    { type: 'text', text: 'Reference photo (front)' },
    { type: 'image', mediaType: 'image/jpeg', data: 'x' },
  ])
})
```

Append to `src/agent/review.test.ts` (reuse its existing `deps` stub and the options object its other tests pass to `runReview`):

```ts
it('appends the reference photos and the review note to the content', async () => {
  const seen: unknown[] = []
  const provider = jsonProvider((req) => (seen.push(req.messages[0]!.content), PASSING_REVIEW))
  await runReview({ ...baseOpts, provider, photos: [{ type: 'text', text: 'Reference photo (top)' }, { type: 'image', mediaType: 'image/png', data: 'y' }] }, deps)
  const content = seen[0] as Array<{ type: string; text?: string }>
  expect(content.at(-3)!.text).toContain('Compare the rendered front view with the front photo')
  expect(content.slice(-2)).toEqual([{ type: 'text', text: 'Reference photo (top)' }, { type: 'image', mediaType: 'image/png', data: 'y' }])
})
```

(`jsonProvider`, `baseOpts` and `PASSING_REVIEW` are whatever those files already name their fake provider, base options and a passing review JSON; use the existing names.)

- [ ] **Step 6: Run** `npx vitest run src/agent/plan.test.ts src/agent/review.test.ts` — expected: FAIL.

- [ ] **Step 7: Implement.** `src/agent/plan.ts`:

```ts
import type { ContentPart, LlmProvider, Usage } from '../ai/types'
import { PHOTO_PLAN_NOTE } from '../photos/photoPrompt'
…
export async function runPlan(opts: { provider: LlmProvider; model: string; request: string; photos?: ContentPart[]; signal?: AbortSignal }): Promise<Plan & { usage: Usage }> {
  const request = `Request: ${opts.request}`
  const content: string | ContentPart[] =
    opts.photos && opts.photos.length > 0 ? [{ type: 'text', text: `${PHOTO_PLAN_NOTE}\n\n${request}` }, ...opts.photos] : request
  const { value, usage } = await askForJson({ provider: opts.provider, model: opts.model, system: PLAN_SYSTEM, content, parse: parsePlan, signal: opts.signal })
  return { ...value, usage }
}
```

`src/agent/review.ts`: add `photos?: ContentPart[]` to the `runReview` options and, where `content` is built:

```ts
    content: [
      ...buildReviewContent({ … }),
      ...(opts.photos && opts.photos.length > 0 ? [{ type: 'text' as const, text: PHOTO_REVIEW_NOTE }, ...opts.photos] : []),
    ],
```

- [ ] **Step 8: Run** `npx vitest run src/agent/plan.test.ts src/agent/review.test.ts` — expected: PASS.

- [ ] **Step 9: Write the failing store test** (append to `src/agent/agentStore.test.ts`, following its existing fake `AgentDeps` pattern):

```ts
it('passes the project photos to the planner and the reviewer, and shows them on the first request', async () => {
  useProjectStore.setState({
    project: {
      id: 'p', name: 'P', createdAt: 1, updatedAt: 1, headVersionId: null, providerProfileId: null, enabledLibraries: [], origin: 'photos',
      photos: [{ id: 'a', blobId: 'blob-a', angle: 'front', addedAt: 1 }], scale: 'reference',
    },
  })
  await db.blobs.put({ id: 'blob-a', kind: 'image', data: new Blob(['f'], { type: 'image/jpeg' }) })
  const planRequests: unknown[] = []
  const sends: unknown[] = []
  const deps = fakeDeps({
    onPlan: (req) => planRequests.push(req.messages[0]!.content),
    send: async (text, opts) => (sends.push([text, opts]), { sent: true, startedEmpty: true, rendered: okRender, stopped: false }),
  })
  useSettingsStore.setState((s) => ({ settings: { ...s.settings, reviewApprovePlan: false } }))
  await useAgentStore.getState().submit('A bracket', deps, { showPhotos: true })
  expect((planRequests[0] as Array<{ type: string }>).map((p) => p.type)).toEqual(['text', 'text', 'image'])
  expect(sends[0]![1]).toMatchObject({ showPhotos: true })
})
```

Adapt `fakeDeps` to the file's existing helper: it must let the test observe the planner request and intercept `send`.

- [ ] **Step 10: Run** `npx vitest run src/agent/agentStore.test.ts` — expected: FAIL.

- [ ] **Step 11: Implement in `agentStore.ts`.**

```ts
import type { ContentPart, LlmProvider, Usage } from '../ai/types'
import { loadPhotos, photoParts } from '../photos/projectPhotos'

export interface SendOptions {
  display?: string
  transcript?: string
  showPhotos?: boolean
}

export interface AgentDeps {
  send(text: string, opts?: SendOptions): Promise<TurnOutcome>
  …
}

const browserDeps: AgentDeps = {
  send: (text, opts = {}) =>
    sendPrompt(text, {
      ...(opts.display ? { displayText: opts.display } : {}),
      ...(opts.transcript ? { audioTranscript: opts.transcript } : {}),
      ...(opts.showPhotos ? { showPhotos: true } : {}),
    }),
  …
}

/** The open project's reference photos as content parts (spec P6); empty for other projects. */
export async function projectPhotoParts(): Promise<{ parts: ContentPart[]; missing: number }> {
  const photos = useProjectStore.getState().project?.photos ?? []
  if (photos.length === 0) return { parts: [], missing: 0 }
  const { loaded, missing } = await loadPhotos(photos)
  return { parts: await photoParts(loaded), missing }
}
```

- `plan(request, then, deps, transcript, showPhotos?)`: load `const { parts } = await projectPhotoParts()` and pass `photos: parts` to `runPlan`; keep `showPhotos` on the card (`PlanCard.showPhotos?: boolean`) so `approvePlan` and `skipPlan` forward it to `build`.
- `build(text, display, review, round, deps, transcript, showPhotos = false)`: `deps.send(text, { display, transcript, showPhotos })`.
- `reviewRound`: `const { parts } = await projectPhotoParts()` before `runReview`, pass `photos: parts`.
- `submit(text, deps, extra)`: `extra.showPhotos` flows into both `plan(...)` and `build(...)` calls.
- `fixIssues`: `build(fixText(…), { display }, …)` — update to the options form.

Update every `deps.send(` call site and the existing tests that stub `send` with positional arguments.

- [ ] **Step 12: Run** `npm run typecheck && npx vitest run src/agent src/chat` — expected: PASS.

- [ ] **Step 13: Commit.**

```bash
git add src/chat/sendPrompt.ts src/chat/sendPrompt.test.ts src/agent/plan.ts src/agent/plan.test.ts src/agent/review.ts src/agent/review.test.ts src/agent/agentStore.ts src/agent/agentStore.test.ts
git commit -m "feat: reference photos go with every builder, planner and reviewer request"
```

---

### Task 5: Photos in project files

**Files:**
- Modify: `src/history/projectFile.ts` (`ProjectFile.project.photos`, `brief`, `scale`; `ORIGINS`; parse; export; import)
- Test: `src/history/projectFile.test.ts`

**Interfaces:**
- Produces: `ProjectFile['project']` gains `photos?: FilePhoto[]`, `brief?: string`, `scale?: PhotoScale` with `export interface FilePhoto { angle: PhotoAngle; mediaType: 'image/png' | 'image/jpeg'; data: string /* base64 */ }`.

- [ ] **Step 1: Write the failing tests** (append to `src/history/projectFile.test.ts`)

```ts
it('exports and imports photos, the brief and the scale', async () => {
  await db.blobs.put({ id: 'ph-1', kind: 'image', data: new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }) })
  const project = await store().newProject({
    code: 'cube(1);', origin: 'photos', brief: 'A bracket', scale: 'description',
    photos: [{ id: 'p1', blobId: 'ph-1', angle: 'front', addedAt: 1 }],
  })
  const file = await exportProject(project.id)
  expect(file.project).toMatchObject({ origin: 'photos', brief: 'A bracket', scale: 'description' })
  expect(file.project.photos).toEqual([{ angle: 'front', mediaType: 'image/png', data: 'iVBORw==' }])

  const parsed = parseImport(JSON.parse(JSON.stringify(file)))
  expect(parsed.ok).toBe(true)
  const imported = await importProjectFile((parsed as { ok: true; files: ProjectFile[] }).files[0]!)
  expect(imported.photos).toHaveLength(1)
  expect(imported.photos![0]!.angle).toBe('front')
  const blob = await db.blobs.get(imported.photos![0]!.blobId)
  expect(blob?.kind).toBe('image')
  expect(new Uint8Array(await blob!.data.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]))
  expect(imported.brief).toBe('A bracket')
})

it('refuses photo data that is not base64 image data, or too many photos', async () => {
  const base = (await exportProject((await sampleProject()).id)) as ProjectFile
  const bad = { ...base, project: { ...base.project, origin: 'photos', photos: [{ angle: 'front', mediaType: 'image/png', data: 'not base64!!' }] } }
  expect(parseImport(bad)).toEqual({ ok: false, error: 'project.photos[0].data must be base64 image data' })
  const many = { ...base, project: { ...base.project, photos: Array.from({ length: 6 }, () => ({ angle: 'top', mediaType: 'image/jpeg', data: 'AA==' })) } }
  expect(parseImport(many)).toEqual({ ok: false, error: 'project.photos must have at most 5 items' })
  const wrongAngle = { ...base, project: { ...base.project, photos: [{ angle: 'diagonal', mediaType: 'image/jpeg', data: 'AA==' }] } }
  expect(parseImport(wrongAngle)).toEqual({ ok: false, error: 'project.photos[0].angle must be one of photo, front, top, side, back, bottom, other' })
})
```

Check how the file's existing `list(o, key, path, max)` helper phrases its "too many" error and match that text exactly in the second test.

- [ ] **Step 2: Run** `npx vitest run src/history/projectFile.test.ts` — expected: FAIL.

- [ ] **Step 3: Implement.**

```ts
import { MAX_BRIEF_CHARS, MAX_PROJECT_PHOTOS, PHOTO_ANGLES, type PhotoAngle, type PhotoScale, type ProjectPhoto } from '../photos/projectPhotos'
import { saveImage } from '../db/images'
import { blobToBase64, dataUrlToBlob } from '../images/base64'

export interface FilePhoto { angle: PhotoAngle; mediaType: 'image/png' | 'image/jpeg'; data: string }

export interface ProjectFile {
  …
  project: { name: string; origin: Project['origin']; enabledLibraries: string[]; checks?: Check[]; photos?: FilePhoto[]; brief?: string; scale?: PhotoScale }
  …
}

const ORIGINS: readonly Project['origin'][] = ['blank', 'gallery', 'shared-link', 'photos']
const ANGLES: readonly PhotoAngle[] = ['photo', ...PHOTO_ANGLES]
const MEDIA: readonly FilePhoto['mediaType'][] = ['image/png', 'image/jpeg']
const SCALES: readonly PhotoScale[] = ['reference', 'description']
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const MAX_PHOTO_CHARS = 4_000_000 // about 3 MB of image data
```

In `parseProject`, after `checks`:

```ts
  const photos =
    project.photos === undefined
      ? undefined
      : list(project, 'photos', `${p}project.`, MAX_PROJECT_PHOTOS).map((raw, i): FilePhoto => {
          const path = `${p}project.photos[${i}].`
          const x = obj(raw, `${p}project.photos[${i}]`)
          const data = str(x, 'data', path, MAX_PHOTO_CHARS)
          if (data === '' || data.length % 4 !== 0 || !BASE64.test(data)) fail(`${path}data`, 'must be base64 image data')
          return { angle: oneOf(x, 'angle', path, ANGLES), mediaType: oneOf(x, 'mediaType', path, MEDIA), data }
        })
  const brief = project.brief === undefined ? undefined : str(project, 'brief', `${p}project.`, MAX_BRIEF_CHARS)
  const scale = project.scale === undefined ? undefined : oneOf(project, 'scale', `${p}project.`, SCALES)
```

and in the returned `project` object: `...(photos ? { photos } : {}), ...(brief !== undefined ? { brief } : {}), ...(scale ? { scale } : {})`. If `oneOf`'s message does not already read "must be one of a, b, c", match the test to its actual wording.

`exportProject`: load each photo blob (`db.blobs.get(p.blobId)`), skip missing ones, and write `photos: await Promise.all(...)` with `{ angle, mediaType: blob.data.type === 'image/png' ? 'image/png' : 'image/jpeg', data: await blobToBase64(blob.data) }`, plus `brief` and `scale` when present. `blobToBase64` returns the bare base64 (check `src/images/base64.ts`; if it returns a data URL, strip up to the comma).

`importProjectFile`: before the transaction,

```ts
  const photos: ProjectPhoto[] = []
  for (const f of file.project.photos ?? []) {
    const blobId = await saveImage(dataUrlToBlob(`data:${f.mediaType};base64,${f.data}`))
    photos.push({ id: crypto.randomUUID(), blobId, angle: f.angle, addedAt: now })
  }
```

and on the `project` literal: `...(photos.length > 0 ? { photos } : {}), ...(file.project.brief !== undefined ? { brief: file.project.brief } : {}), ...(file.project.scale ? { scale: file.project.scale } : {})`.

- [ ] **Step 4: Run** `npm run typecheck && npx vitest run src/history` — expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/history/projectFile.ts src/history/projectFile.test.ts
git commit -m "feat: project files carry reference photos, the brief and the scale"
```

---

### Task 6: New project dialog — Start from photos

**Files:**
- Create: `src/photos/PhotoSlots.tsx`, `src/photos/PhotoSlots.test.tsx`, `src/photos/photoDraft.ts`, `src/photos/photoDraft.test.ts`
- Modify: `src/workbench/NewProjectDialog.tsx`, `src/workbench/NewProjectDialog.test.tsx`, `src/workbench/ProjectMenu.tsx:211-217`, `src/ui/icons.ts` (add `Camera as IconCamera`, `Image as IconImage` from lucide if missing)
- Screens: `design/screens/PhotoNew.dc.html`, `PhotoPhone.dc.html`

**Interfaces:**
- Produces:
  ```ts
  // photoDraft.ts — the photos chosen in a dialog before they are saved
  export interface DraftPhoto { id: string; angle: PhotoAngle; blob: Blob; mediaType: 'image/png' | 'image/jpeg'; url: string; name: string }
  export interface DraftState { photos: DraftPhoto[]; error: string | null }
  export async function addDraftPhotos(state: DraftState, files: readonly File[], angle: PhotoAngle, prepare?: (b: Blob) => Promise<PreparedImage>, objectUrl?: (b: Blob) => string): Promise<DraftState>
  export function removeDraftPhoto(state: DraftState, id: string, revoke?: (url: string) => void): DraftState
  export function layoutFor(layout: 'one' | 'angles', photos: readonly DraftPhoto[]): DraftPhoto[]   // 'one' keeps the first photo only, retagged 'photo'; 'angles' retags a 'photo' as 'other'
  // PhotoSlots.tsx
  export function PhotoSlots(props: { layout: 'one' | 'angles'; photos: readonly DraftPhoto[]; onAdd(files: File[], angle: PhotoAngle): void; onRemove(id: string): void; error?: string | null })
  // NewProjectDialog
  export interface NewProjectResult { name: string; enabledLibraries: LibraryName[]; photos?: { photos: DraftPhoto[]; brief: string; scale: PhotoScale } }
  // props: { onCreate(result: NewProjectResult): void; onClose(): void; vision?: boolean }
  ```

- [ ] **Step 1: Write the failing draft tests** (`src/photos/photoDraft.test.ts`)

```ts
import { addDraftPhotos, layoutFor, removeDraftPhoto, type DraftState } from './photoDraft'

const file = (name: string, type = 'image/jpeg') => new File(['x'], name, { type })
const prepare = async (b: Blob) => ({ blob: b, mediaType: 'image/jpeg' as const, width: 10, height: 10 })
const url = () => 'blob:1'
const empty: DraftState = { photos: [], error: null }

it('adds photos with their angle and stops at five', async () => {
  let state = await addDraftPhotos(empty, [file('a.jpg'), file('b.jpg')], 'front', prepare, url)
  expect(state.photos.map((p) => p.angle)).toEqual(['front', 'front'])
  for (const n of ['c', 'd', 'e']) state = await addDraftPhotos(state, [file(`${n}.jpg`)], 'top', prepare, url)
  state = await addDraftPhotos(state, [file('f.jpg')], 'side', prepare, url)
  expect(state.photos).toHaveLength(5)
  expect(state.error).toBe('Up to 5 photos per project. f.jpg was not added.')
})

it('skips a file that is not an image or cannot be read, and keeps the rest', async () => {
  const failing = async (b: Blob) => (b.size === 0 ? Promise.reject(new Error('no')) : prepare(b))
  const state = await addDraftPhotos(empty, [file('notes.txt', 'text/plain'), new File([], 'bad.jpg', { type: 'image/jpeg' }), file('ok.jpg')], 'other', failing, url)
  expect(state.photos.map((p) => p.name)).toEqual(['ok.jpg'])
  expect(state.error).toBe('Could not read bad.jpg. Add a PNG, JPEG or WebP image.')
})

it('removes a photo and revokes its url', async () => {
  const state = await addDraftPhotos(empty, [file('a.jpg')], 'front', prepare, url)
  const revoke = vi.fn()
  expect(removeDraftPhoto(state, state.photos[0]!.id, revoke).photos).toEqual([])
  expect(revoke).toHaveBeenCalledWith('blob:1')
})

it('retags photos when the layout changes', async () => {
  const state = await addDraftPhotos(empty, [file('a.jpg'), file('b.jpg')], 'front', prepare, url)
  expect(layoutFor('one', state.photos).map((p) => p.angle)).toEqual(['photo'])
  const one = layoutFor('one', state.photos)
  expect(layoutFor('angles', one).map((p) => p.angle)).toEqual(['other'])
})
```

- [ ] **Step 2: Run** `npx vitest run src/photos/photoDraft.test.ts` — expected: FAIL.

- [ ] **Step 3: Implement** `src/photos/photoDraft.ts`

```ts
import type { PreparedImage } from '../images/prepareImage'
import { MAX_PROJECT_PHOTOS, preparePhoto, tooManyPhotos, unreadablePhoto, type PhotoAngle } from './projectPhotos'

export interface DraftPhoto {
  id: string
  angle: PhotoAngle
  blob: Blob
  mediaType: 'image/png' | 'image/jpeg'
  /** Object URL for the thumbnail; revoked on remove. */
  url: string
  name: string
}

export interface DraftState {
  photos: DraftPhoto[]
  error: string | null
}

export async function addDraftPhotos(
  state: DraftState,
  files: readonly File[],
  angle: PhotoAngle,
  prepare: (b: Blob) => Promise<PreparedImage> = (b) => preparePhoto(b),
  objectUrl: (b: Blob) => string = (b) => URL.createObjectURL(b),
): Promise<DraftState> {
  let photos = state.photos
  let error: string | null = null
  for (const file of files) {
    if (photos.length >= MAX_PROJECT_PHOTOS) {
      error = tooManyPhotos(file.name)
      break
    }
    if (!file.type.startsWith('image/')) {
      error = unreadablePhoto(file.name)
      continue
    }
    try {
      const image = await prepare(file)
      photos = [...photos, { id: crypto.randomUUID(), angle, blob: image.blob, mediaType: image.mediaType, url: objectUrl(image.blob), name: file.name }]
    } catch {
      error = unreadablePhoto(file.name)
    }
  }
  return { photos, error }
}

export function removeDraftPhoto(state: DraftState, id: string, revoke: (url: string) => void = (u) => URL.revokeObjectURL(u)): DraftState {
  const photo = state.photos.find((p) => p.id === id)
  if (photo) revoke(photo.url)
  return { photos: state.photos.filter((p) => p.id !== id), error: null }
}

/** One photo keeps the first photo, untagged; several angles turns an untagged photo into "other". */
export function layoutFor(layout: 'one' | 'angles', photos: readonly DraftPhoto[]): DraftPhoto[] {
  if (layout === 'one') return photos.slice(0, 1).map((p) => ({ ...p, angle: 'photo' }))
  return photos.map((p) => (p.angle === 'photo' ? { ...p, angle: 'other' } : p))
}
```

Note `layoutFor('one')` drops photos beyond the first without revoking; the dialog revokes on unmount (Step 7).

- [ ] **Step 4: Run** `npx vitest run src/photos/photoDraft.test.ts` — expected: PASS.

- [ ] **Step 5: Write the failing slots test** (`src/photos/PhotoSlots.test.tsx`)

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { PhotoSlots } from './PhotoSlots'
import type { DraftPhoto } from './photoDraft'

const photo = (angle: DraftPhoto['angle']): DraftPhoto => ({ id: `id-${angle}`, angle, blob: new Blob(), mediaType: 'image/jpeg', url: 'blob:x', name: `${angle}.jpg` })

it('shows a slot per angle, filled ones with their photo and a remove button', () => {
  const onRemove = vi.fn()
  render(<PhotoSlots layout="angles" photos={[photo('front')]} onAdd={() => {}} onRemove={onRemove} />)
  expect(screen.getByRole('img', { name: 'Front photo' })).toHaveAttribute('src', 'blob:x')
  for (const label of ['Top', 'Side', 'Back', 'Bottom', 'Other angle']) expect(screen.getByRole('button', { name: `Add ${label.toLowerCase()} photo` })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Remove front photo' }))
  expect(onRemove).toHaveBeenCalledWith('id-front')
})

it('passes chosen files with the slot’s angle, and shows the error', () => {
  const onAdd = vi.fn()
  render(<PhotoSlots layout="angles" photos={[]} onAdd={onAdd} onRemove={() => {}} error="Up to 5 photos per project. f.jpg was not added." />)
  const input = screen.getByLabelText('Add top photo') as HTMLInputElement
  const file = new File(['x'], 't.jpg', { type: 'image/jpeg' })
  fireEvent.change(input, { target: { files: [file] } })
  expect(onAdd).toHaveBeenCalledWith([file], 'top')
  expect(screen.getByRole('alert')).toHaveTextContent('f.jpg was not added.')
})

it('shows one large slot in the one-photo layout', () => {
  render(<PhotoSlots layout="one" photos={[]} onAdd={() => {}} onRemove={() => {}} />)
  expect(screen.getByRole('button', { name: 'Add photo' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Add top photo' })).toBeNull()
})
```

- [ ] **Step 6: Run** `npx vitest run src/photos/PhotoSlots.test.tsx` — expected: FAIL.

- [ ] **Step 7: Implement** `src/photos/PhotoSlots.tsx`

```tsx
import { useRef } from 'react'
import { IconCamera, IconX } from '../ui/icons'
import type { DraftPhoto } from './photoDraft'
import { PHOTO_ANGLES, PHOTO_LABEL, type PhotoAngle } from './projectPhotos'

interface Props {
  layout: 'one' | 'angles'
  photos: readonly DraftPhoto[]
  onAdd(files: File[], angle: PhotoAngle): void
  onRemove(id: string): void
  error?: string | null
}

const slotClass = 'relative flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line-strong bg-inset text-[13px] font-medium text-ink-muted hover:border-accent hover:text-ink'

function EmptySlot({ angle, onAdd }: { angle: PhotoAngle; onAdd(files: File[], angle: PhotoAngle): void }) {
  const input = useRef<HTMLInputElement>(null)
  const label = angle === 'photo' ? 'Add photo' : `Add ${PHOTO_LABEL[angle].toLowerCase()} photo`
  return (
    <>
      <button type="button" className={slotClass} aria-label={label} onClick={() => input.current?.click()}>
        <IconCamera className="pc-i" aria-hidden="true" />
        {angle === 'photo' ? 'Add a photo' : PHOTO_LABEL[angle]}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        multiple={angle === 'photo' || angle === 'other'}
        className="sr-only"
        aria-label={label}
        onChange={(e) => {
          onAdd([...(e.target.files ?? [])], angle)
          e.target.value = ''
        }}
      />
    </>
  )
}

function FilledSlot({ photo, onRemove }: { photo: DraftPhoto; onRemove(id: string): void }) {
  const label = PHOTO_LABEL[photo.angle]
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-md border border-line bg-inset">
      <img src={photo.url} alt={`${label} photo`} className="absolute inset-0 size-full object-cover" />
      <span className="absolute top-1.5 left-1.5 rounded-sm bg-panel px-1.5 text-[11px] leading-5 font-semibold">{label}</span>
      <button type="button" className="pc-btn is-icon is-sm is-ghost absolute top-1 right-1 bg-panel" aria-label={`Remove ${label.toLowerCase()} photo`} onClick={() => onRemove(photo.id)}>
        <IconX className="pc-i" aria-hidden="true" />
      </button>
    </div>
  )
}

/** The photo picker shared by the new project and Photos dialogs (spec P2). */
export function PhotoSlots({ layout, photos, onAdd, onRemove, error = null }: Props) {
  if (layout === 'one') {
    const photo = photos[0]
    return (
      <div className="pc-stack">
        {photo ? <FilledSlot photo={photo} onRemove={onRemove} /> : <EmptySlot angle="photo" onAdd={onAdd} />}
        {error && <span role="alert" className="pc-hint is-error">{error}</span>}
      </div>
    )
  }
  const byAngle = new Map<PhotoAngle, DraftPhoto[]>()
  for (const p of photos) byAngle.set(p.angle, [...(byAngle.get(p.angle) ?? []), p])
  return (
    <div className="pc-stack">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PHOTO_ANGLES.flatMap((angle) => {
          const filled = byAngle.get(angle) ?? []
          const slots = filled.map((p) => <FilledSlot key={p.id} photo={p} onRemove={onRemove} />)
          if (angle === 'other' || filled.length === 0) slots.push(<EmptySlot key={`add-${angle}`} angle={angle} onAdd={onAdd} />)
          return slots
        })}
      </div>
      {error && <span role="alert" className="pc-hint is-error">{error}</span>}
    </div>
  )
}
```

`IconCamera` comes from lucide's `Camera`; add `Camera as IconCamera,` to the export list in `src/ui/icons.ts`. The "other" slot always keeps an add button so several untagged angles fit; the tagged slots take one photo each.

- [ ] **Step 8: Run** `npx vitest run src/photos` — expected: PASS.

- [ ] **Step 9: Write the failing dialog tests** (append to `src/workbench/NewProjectDialog.test.tsx`; change `setup` to accept props: `function setup(props: Partial<Parameters<typeof NewProjectDialog>[0]> = {})` and spread them, defaulting `vision` to `true`)

```tsx
it('offers Photos only when the active model takes images', () => {
  setup({ vision: false })
  const photos = screen.getByRole('radio', { name: 'Photos' })
  expect(photos).toHaveAttribute('aria-disabled', 'true')
  fireEvent.click(photos)
  expect(screen.queryByLabelText('Describe it')).toBeNull()
  expect(screen.getByText(/Images need a model with vision/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open AI providers' })).toBeInTheDocument()
})

it('switches between one photo and several angles, and collapses the libraries to one line', () => {
  setup()
  fireEvent.click(screen.getByRole('radio', { name: 'Photos' }))
  expect(screen.getByRole('radio', { name: 'Several angles' })).toBeChecked()
  expect(screen.getByRole('button', { name: 'Add front photo' })).toBeInTheDocument()
  expect(screen.getByText('BOSL2')).toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: 'Use BOSL2 in this project' })).toBeNull()
  fireEvent.click(screen.getByRole('radio', { name: 'One photo' }))
  expect(screen.getByRole('button', { name: 'Add photo' })).toBeInTheDocument()
  expect(screen.getByText(/Put a coin, card or ruler next to it/)).toBeInTheDocument()
})

it('creates a photo project with the photos, the description and the scale', async () => {
  const prepare = async (b: Blob) => ({ blob: b, mediaType: 'image/jpeg' as const, width: 1, height: 1 })
  const { onCreate } = setup({ prepare })
  fireEvent.click(screen.getByRole('radio', { name: 'Photos' }))
  const file = new File(['x'], 'front.jpg', { type: 'image/jpeg' })
  fireEvent.change(screen.getByLabelText('Add front photo'), { target: { files: [file] } })
  await screen.findByRole('img', { name: 'Front photo' })
  fireEvent.change(screen.getByLabelText('Describe it'), { target: { value: 'A bracket, about 50 mm tall' } })
  fireEvent.change(screen.getByLabelText('Scale'), { target: { value: 'description' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create and build' }))
  expect(onCreate).toHaveBeenCalledWith({
    name: 'Untitled project',
    enabledLibraries: ['BOSL2'],
    photos: { photos: [expect.objectContaining({ angle: 'front', name: 'front.jpg' })], brief: 'A bracket, about 50 mm tall', scale: 'description' },
  })
})

it('needs at least one photo and a description to create a photo project', () => {
  setup()
  fireEvent.click(screen.getByRole('radio', { name: 'Photos' }))
  expect(screen.getByRole('button', { name: 'Create and build' })).toBeDisabled()
})
```

The dialog takes an optional `prepare` prop (`(b: Blob) => Promise<PreparedImage>`) for tests; it defaults to `preparePhoto`. jsdom has no `URL.createObjectURL`: pass `objectUrl` the same way, or define `URL.createObjectURL = () => 'blob:test'` in the test's `beforeAll` (check what `src/images/AttachButton.test.tsx` does and copy it).

- [ ] **Step 10: Run** `npx vitest run src/workbench/NewProjectDialog.test.tsx` — expected: FAIL.

- [ ] **Step 11: Implement the dialog.** Rewrite `src/workbench/NewProjectDialog.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { UNTITLED } from '../history/projectStore'
import type { PreparedImage } from '../images/prepareImage'
import { addDraftPhotos, layoutFor, removeDraftPhoto, type DraftPhoto, type DraftState } from '../photos/photoDraft'
import { PhotoSlots } from '../photos/PhotoSlots'
import { NO_VISION_EXPLANATION } from '../images/attachments'
import { MAX_BRIEF_CHARS, type PhotoScale } from '../photos/projectPhotos'
import { useVisionSupport } from '../refine/useVisionSupport'
import { LIBRARY_NAMES, type LibraryName } from '../render/libraries'
import { useAppStore } from '../state/store'
import { IconCamera, IconCheck, IconFile, IconInfo, IconWarning, IconX } from '../ui/icons'
import { LibraryCard, RECOMMENDED_LIBRARY } from '../ui/LibraryCard'
import { Modal } from '../ui/Modal'

const DEFAULT_LIBRARIES: LibraryName[] = [RECOMMENDED_LIBRARY]

export interface NewProjectResult {
  name: string
  enabledLibraries: LibraryName[]
  photos?: { photos: DraftPhoto[]; brief: string; scale: PhotoScale }
}

interface Props {
  onCreate(result: NewProjectResult): void
  onClose(): void
  /** Whether the active model takes images; read from the providers by default. */
  vision?: boolean
  prepare?(blob: Blob): Promise<PreparedImage>
  objectUrl?(blob: Blob): string
}

type Start = 'blank' | 'photos'
type Layout = 'one' | 'angles'
```

Body: state for `name`, `enabled`, `start`, `layout` (`'angles'`), `draft: DraftState`, `brief`, `scale` (`'reference'`). `const visionFromStore = useVisionSupport(); const vision = props.vision ?? visionFromStore`. On unmount revoke every draft url (`useEffect` cleanup). Header copy: "Start blank, or from photos of a real object. Photos are a starting point; describe the rest in words."

Markup, in order:
1. Name field (as today) and a **Start from** radiogroup (`pc-tabs`, two `role="radio"` buttons with `aria-checked`; Photos gets `aria-disabled={!vision}` and does nothing when disabled; label with `IconFile` / `IconCamera`).
2. When `!vision`: a `pc-callout is-warn` with `<strong>Photos need a model with vision</strong>`, the text `NO_VISION_EXPLANATION` and a `pc-btn is-sm` "Open AI providers" that calls `useAppStore.getState().setView('settings')` then `onClose()`.
3. When `start === 'photos'`: a two-column grid (`grid gap-6 md:grid-cols-2`). Left: a `pc-row` with the label "Photos" and a radiogroup "One photo" / "Several angles" (changing it sets `layout` and `draft.photos = layoutFor(layout, draft.photos)`), then `<PhotoSlots layout photos onAdd onRemove error />`, then for `one` a three-item tip list (`ul` of `pc-caption` lines with `IconCheck`): "Shoot straight at the side that shows the shape best.", "Put a coin, card or ruler next to it for scale.", "What one photo cannot show is guessed. Add angles later from the project."; for `angles` the caption "Fill the angles you have. One is enough to start. Drop photos here, or click a slot to choose or take one." Right: `pc-field` "Describe it" with a `<textarea id="np-desc" maxLength={MAX_BRIEF_CHARS}>` (placeholder "What it is, sizes you know, what it attaches to", hint "Sizes you know, what it fits or holds, and anything the photos cannot show, such as the back or the depth of a hole."), and `pc-field` "Scale" with a `<select id="np-scale" className="pc-select">` whose options are `reference` "Find a coin, card or ruler in the photos" and `description` "Only the sizes in the description", hint "With neither, every size is a guess and the first reply says so." Below both: the library line, a `flex items-center gap-2 rounded-md border border-line px-3 py-2` with `pc-label` "Libraries", a `pc-chip is-accent` per enabled library (or "None"), and a `pc-btn is-sm is-ghost` "Change" that toggles `showLibraries` to render the cards underneath.
4. When `start === 'blank'`: the library cards and summary callout exactly as today.
5. Footer: a `pc-caption` (`flex-1`) with "The agent plans checks from your description and photos, then builds v1." or "Opens an empty project. Describe a part, write code, or start from an example."; Cancel; submit reading "Create and build" or "Create project". Disabled when the name is blank, or for photos when `draft.photos.length === 0 || brief.trim() === ''`.

`onAdd = (files, angle) => void addDraftPhotos(draft, files, angle, props.prepare, props.objectUrl).then(setDraft)`; `onRemove = (id) => setDraft(removeDraftPhoto(draft, id))`. Submit builds `{ name, enabledLibraries, ...(start === 'photos' ? { photos: { photos: layoutFor(layout, draft.photos), brief: brief.trim(), scale } } : {}) }`.

Dialog class: `pc-dialog max-w-[600px] gap-0 p-0` for blank, `max-w-[920px]` for photos. The Modal already scrolls on small screens (`overflow-y-auto p-3`), which is the phone layout from `PhotoPhone.dc.html`.

- [ ] **Step 12: Run** `npx vitest run src/workbench/NewProjectDialog.test.tsx` — expected: PASS. Fix the existing tests for the changed `onCreate` shape (they still receive `{ name, enabledLibraries }` with no `photos` key, so `toHaveBeenCalledWith` keeps passing).

- [ ] **Step 13: Wire the menu.** In `src/workbench/ProjectMenu.tsx`:

```tsx
import { useAgentStore } from '../agent/agentStore'
import { saveImage } from '../db/images'
import type { ProjectPhoto } from '../photos/projectPhotos'
…
        <NewProjectDialog
          onClose={() => setCreating(false)}
          onCreate={async ({ name, enabledLibraries, photos }) => {
            setCreating(false)
            if (!photos) {
              await store().newProject({ name, code: '', origin: 'blank', enabledLibraries })
              toWorkbench()
              return
            }
            const saved: ProjectPhoto[] = []
            for (const p of photos.photos) {
              saved.push({ id: p.id, blobId: await saveImage(p.blob), angle: p.angle, addedAt: Date.now() })
              URL.revokeObjectURL(p.url)
            }
            await store().newProject({ name, code: '', origin: 'photos', enabledLibraries, photos: saved, brief: photos.brief, scale: photos.scale })
            toWorkbench()
            void useAgentStore.getState().submit(photos.brief, undefined, { mode: 'agent', showPhotos: true })
          }}
        />
```

- [ ] **Step 14: Run** `npm run typecheck && npm test` — expected: PASS.

- [ ] **Step 15: Commit.**

```bash
git add src/photos src/workbench/NewProjectDialog.tsx src/workbench/NewProjectDialog.test.tsx src/workbench/ProjectMenu.tsx src/ui/icons.ts
git commit -m "feat: new projects can start from photos and a description"
```

---

### Task 7: The Sizes card

**Files:**
- Create: `src/agent/sizes.ts`, `src/agent/sizes.test.ts`, `src/agent/ui/SizesCardView.tsx`, `src/agent/ui/SizesCardView.test.tsx`, `src/photos/photosDialogStore.ts`
- Modify: `src/agent/agentStore.ts` (`SizesCard`, `addSizesCard` after a build in a photo project, `acceptSizes`), `src/agent/ui/AgentCardView.tsx`, `src/agent/runSteps.ts` (a sizes card is not a step: skip it)
- Screens: `design/screens/PhotoFirstBuild.dc.html`

**Interfaces:**
- Produces:
  ```ts
  // sizes.ts
  export interface SizeRow { name: string; value: ParamValue; unit: string; source: ParamSource }
  export function sizeRows(code: string, params: Record<string, ParamValue>): SizeRow[]   // guessed first, then photo, description, none; stable within a group
  export function sizesSummary(rows: SizeRow[], versionLabel: string | null): string      // "Sizes in v1 · 7 · 2 guessed"
  // agentStore.ts
  export interface SizesCard { kind: 'sizes'; id: string; noteId: string; versionLabel: string | null; rows: SizeRow[]; status: 'ready' | 'accepted' | 'superseded' }
  // AgentCard = PlanCard | ReviewCard | SizesCard; store action acceptSizes(cardId: string): void
  // photosDialogStore.ts
  export const usePhotosDialog = create<{ open: boolean; setOpen(open: boolean): void }>()
  ```
- Consumes: `parseCustomizer`, `effectiveValues`, `SOURCE_LABEL`, `ParamSource` (Task 2); `unitFor` from `src/customizer/units.ts`.

- [ ] **Step 1: Write the failing tests** (`src/agent/sizes.test.ts`)

```ts
import { sizeRows, sizesSummary } from './sizes'

const CODE = ['rod_d = 25; // [15:0.5:40] from description', 'plate_w = 22; // [14:1:40] from photo', 'wall = 3; // [1.2:0.2:6] guessed', 'shape = "round"; // [round, square]', 'cup_depth = 24; // [10:1:40] guessed'].join('\n')

it('lists every parameter with its value, unit and source, guessed first', () => {
  const rows = sizeRows(CODE, { wall: 3.4 })
  expect(rows.map((r) => r.name)).toEqual(['wall', 'cup_depth', 'plate_w', 'rod_d', 'shape'])
  expect(rows[0]).toEqual({ name: 'wall', value: 3.4, unit: 'mm', source: 'guess' })
  expect(rows[4]).toEqual({ name: 'shape', value: 'round', unit: '', source: null })
})

it('summarises the card for the chat note', () => {
  expect(sizesSummary(sizeRows(CODE, {}), 'v1')).toBe('Sizes in v1 · 5 · 2 guessed')
  expect(sizesSummary(sizeRows('a = 1;', {}), null)).toBe('Sizes · 1 · source not given')
})
```

- [ ] **Step 2: Run** `npx vitest run src/agent/sizes.test.ts` — expected: FAIL.

- [ ] **Step 3: Implement** `src/agent/sizes.ts`

```ts
import { unitFor } from '../customizer/units'
import type { ParamValue } from '../render/types'
import { effectiveValues, parseCustomizer, type ParamSource } from '../scad/customizer'

export interface SizeRow {
  name: string
  value: ParamValue
  unit: string
  source: ParamSource
}

const ORDER: Record<string, number> = { guess: 0, photo: 1, description: 2, none: 3 }

/** Every top-level parameter with its current value and source; guesses first, so the user checks them first (spec P8). */
export function sizeRows(code: string, params: Record<string, ParamValue>): SizeRow[] {
  const values = effectiveValues(code, params)
  return parseCustomizer(code)
    .map((p) => ({ name: p.name, value: values[p.name] ?? p.defaultValue, unit: typeof p.defaultValue === 'number' ? unitFor(p) : '', source: p.source }))
    .sort((a, b) => ORDER[a.source ?? 'none']! - ORDER[b.source ?? 'none']!)
}

export function sizesSummary(rows: SizeRow[], versionLabel: string | null): string {
  const head = versionLabel ? `Sizes in ${versionLabel}` : 'Sizes'
  const guessed = rows.filter((r) => r.source === 'guess').length
  const given = rows.some((r) => r.source !== null)
  return `${head} · ${rows.length} · ${given ? `${guessed} guessed` : 'source not given'}`
}
```

Check `unitFor`'s signature in `src/customizer/units.ts` (it takes a `CustomizerParam`); if it needs the whole param, pass `p`. `Array.prototype.sort` is stable, so rows keep code order within a group.

- [ ] **Step 4: Run** `npx vitest run src/agent/sizes.test.ts` — expected: PASS.

- [ ] **Step 5: Write the failing store test** (append to `src/agent/agentStore.test.ts`)

```ts
it('adds a Sizes card after a successful build in a photo project, and supersedes it on the next build', async () => {
  useProjectStore.setState({ project: { …photoProject, photos: [{ id: 'a', blobId: 'blob-a', angle: 'front', addedAt: 1 }] }, head: { …someVersion, label: 'v1' } })
  useAppStore.setState({ code: 'wall = 3; // [1:6] guessed\ncube(wall);', params: {} })
  const deps = fakeDeps({ send: async () => ({ sent: true, startedEmpty: true, rendered: okRender, stopped: false }) })
  await useAgentStore.getState().submit('Make it', deps, { mode: 'edit' })
  const cards = Object.values(useAgentStore.getState().cards)
  const sizes = cards.find((c) => c.kind === 'sizes')
  expect(sizes).toMatchObject({ kind: 'sizes', status: 'ready', versionLabel: 'v1' })
  expect(useChatStore.getState().messages.at(-1)).toMatchObject({ role: 'note', text: 'Sizes in v1 · 1 · 1 guessed', cardId: sizes!.id })
  await useAgentStore.getState().submit('Taller', deps, { mode: 'edit' })
  expect(useAgentStore.getState().cards[sizes!.id]!.status).toBe('superseded')
  expect(Object.values(useAgentStore.getState().cards).filter((c) => c.kind === 'sizes')).toHaveLength(2)
})

it('adds no Sizes card in a project without photos', async () => {
  useProjectStore.setState({ project: blankProject })
  const deps = fakeDeps({ send: async () => ({ sent: true, startedEmpty: true, rendered: okRender, stopped: false }) })
  await useAgentStore.getState().submit('Make it', deps, { mode: 'edit' })
  expect(Object.values(useAgentStore.getState().cards).some((c) => c.kind === 'sizes')).toBe(false)
})
```

Use the file's existing project and version fixtures for `photoProject`, `blankProject` and `someVersion`.

- [ ] **Step 6: Run** `npx vitest run src/agent/agentStore.test.ts` — expected: FAIL.

- [ ] **Step 7: Implement in `agentStore.ts`.**

```ts
import { sizeRows, sizesSummary, type SizeRow } from './sizes'

export interface SizesCard {
  kind: 'sizes'
  id: string
  noteId: string
  versionLabel: string | null
  rows: SizeRow[]
  status: 'ready' | 'accepted' | 'superseded'
}

export type AgentCard = PlanCard | ReviewCard | SizesCard
```

- `patch`'s summary line becomes a `switch` on `next.kind`: `plan` → `planSummary`, `review` → `reviewSummary`, `sizes` → `sizesSummary(next.rows, next.versionLabel)`. Same in `addCard`.
- `supersedeOpenCards()` already flips every `status === 'ready'` card; a sizes card has that status, so it is superseded by the next build with no extra code.
- In `build(...)`, after `const outcome = await deps.send(...)`:

```ts
    if (outcome?.sent && !outcome.stopped && outcome.rendered?.ok && (useProjectStore.getState().project?.photos?.length ?? 0) > 0) {
      const app = useAppStore.getState()
      addCard({ kind: 'sizes', id: crypto.randomUUID(), versionLabel: useProjectStore.getState().head?.label ?? null, rows: sizeRows(app.code, app.params), status: 'ready' })
    }
```

placed before the `if (!review …) return` line so Edit turns get the card too.
- New action `acceptSizes(cardId)`: `if (card?.kind === 'sizes' && card.status === 'ready') patch<SizesCard>(cardId, { status: 'accepted' })`. Add it to `AgentState`.
- `runSteps.ts` `cardStep`: a `sizes` card returns `null` and the caller skips it (change the `if (card)` branch to `const step = cardStep(m.id, card); if (step) steps.push(step)`; the function's return type becomes `RunStep | null`).
- `reset()` unchanged.

- [ ] **Step 8: Run** `npm run typecheck && npx vitest run src/agent` — expected: PASS (fix the `switch` exhaustiveness in `runSteps.ts` and anything else that narrowed on two kinds).

- [ ] **Step 9: Write the failing view test** (`src/agent/ui/SizesCardView.test.tsx`)

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { useAppStore } from '../../state/store'
import { useAgentStore, type SizesCard } from '../agentStore'
import { usePhotosDialog } from '../../photos/photosDialogStore'
import { SizesCardView } from './SizesCardView'

const card: SizesCard = {
  kind: 'sizes', id: 's1', noteId: 'n1', versionLabel: 'v1', status: 'ready',
  rows: [
    { name: 'wall', value: 3, unit: 'mm', source: 'guess' },
    { name: 'rod_d', value: 25, unit: 'mm', source: 'description' },
    { name: 'plate_w', value: 22, unit: 'mm', source: 'photo' },
  ],
}

beforeEach(() => {
  useAgentStore.setState({ cards: { s1: card } })
  useAppStore.setState({ code: 'wall = 3; // [1:6] guessed\nrod_d = 25;\nplate_w = 22;', params: {} })
})

it('lists the sizes with their sources and the guessed count', () => {
  render(<SizesCardView card={card} />)
  expect(screen.getByText('Sizes in v1 · 3')).toBeInTheDocument()
  expect(screen.getByText('1 guessed')).toBeInTheDocument()
  expect(screen.getByText('Guessed')).toBeInTheDocument()
  expect(screen.getByText('From description')).toBeInTheDocument()
  expect(screen.getByText('From photo')).toBeInTheDocument()
})

it('writes an edited size as a parameter override, accepts, and opens the Photos dialog', () => {
  render(<SizesCardView card={card} />)
  const input = screen.getByRole('spinbutton', { name: 'wall in mm' })
  fireEvent.change(input, { target: { value: '3.4' } })
  fireEvent.blur(input)
  expect(useAppStore.getState().params).toEqual({ wall: 3.4 })
  fireEvent.click(screen.getByRole('button', { name: 'Add a photo' }))
  expect(usePhotosDialog.getState().open).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Sizes look right' }))
  expect(useAgentStore.getState().cards.s1!.status).toBe('accepted')
})
```

- [ ] **Step 10: Run** `npx vitest run src/agent/ui/SizesCardView.test.tsx` — expected: FAIL.

- [ ] **Step 11: Implement.** `src/photos/photosDialogStore.ts`:

```ts
import { create } from 'zustand'

/** Whether the project Photos dialog is open; the Agent header button and the Sizes card both open it. */
export const usePhotosDialog = create<{ open: boolean; setOpen(open: boolean): void }>()((set) => ({ open: false, setOpen: (open) => set({ open }) }))
```

`src/agent/ui/SizesCardView.tsx`:

```tsx
import { useState } from 'react'
import { usePhotosDialog } from '../../photos/photosDialogStore'
import type { ParamValue } from '../../render/types'
import { SOURCE_LABEL } from '../../scad/customizer'
import { useAppStore } from '../../state/store'
import { IconCamera, IconCheck, IconRuler } from '../../ui/icons'
import { useAgentStore, type SizesCard } from '../agentStore'
import type { SizeRow } from '../sizes'

const sourceClass = { guess: 'bg-warn-soft text-warn', photo: 'bg-accent-soft text-ink', description: 'bg-ok-soft text-ok' } as const

function SourceTag({ source }: { source: SizeRow['source'] }) {
  if (!source) return <span className="pc-caption">Source not given</span>
  return <span className={`inline-flex h-5 items-center rounded-sm px-1.5 text-[11px] font-medium ${sourceClass[source]}`}>{SOURCE_LABEL[source]}</span>
}

function SizeField({ row, onCommit }: { row: SizeRow; onCommit(value: ParamValue): void }) {
  const [text, setText] = useState(String(row.value))
  if (typeof row.value !== 'number') return <span className="pc-mono text-[13px]">{String(row.value)}</span>
  const commit = () => {
    const n = Number(text)
    if (Number.isFinite(n) && n !== row.value) onCommit(n)
    else setText(String(row.value))
  }
  return (
    <div className="pc-input is-mono" style={{ height: 26, padding: '0 6px' }}>
      <input type="number" aria-label={`${row.name}${row.unit ? ` in ${row.unit}` : ''}`} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      {row.unit && <span className="pc-unit">{row.unit}</span>}
    </div>
  )
}

/** Every size of the latest build and where it came from (spec P8). */
export function SizesCardView({ card }: { card: SizesCard }) {
  const accept = useAgentStore((s) => s.acceptSizes)
  const openPhotos = usePhotosDialog((s) => s.setOpen)
  const guessed = card.rows.filter((r) => r.source === 'guess').length
  const given = card.rows.some((r) => r.source !== null)
  const setSize = (name: string, value: ParamValue) => {
    const app = useAppStore.getState()
    app.setParams({ ...app.params, [name]: value })
  }
  const open = card.status === 'ready'
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-line bg-panel-raised p-3" data-testid="sizes-card">
      <div className="flex items-center gap-2">
        <IconRuler className="pc-i text-ink-muted" aria-hidden="true" />
        <span className="font-semibold">{card.versionLabel ? `Sizes in ${card.versionLabel}` : 'Sizes'} · {card.rows.length}</span>
        <span className="flex-1" />
        {given ? <span className={`inline-flex h-5 items-center rounded-sm px-1.5 text-[11px] font-medium ${guessed > 0 ? sourceClass.guess : sourceClass.description}`}>{guessed} guessed</span> : <span className="pc-caption">Source not given</span>}
        {card.status === 'accepted' && <span className="pc-status is-ok">Checked</span>}
        {card.status === 'superseded' && <span className="pc-status">Out of date</span>}
      </div>
      {open && <span className="pc-caption">{guessed > 0 ? 'Check the guessed sizes first. Photo estimates are within about 1 mm.' : 'Every size came from the description or the photos.'}</span>}
      <div>
        {card.rows.map((row) => (
          <div key={row.name} className="grid items-center gap-2 border-b border-line py-1 text-[13px] last:border-b-0" style={{ gridTemplateColumns: 'minmax(0, 1fr) 96px 128px' }}>
            <span className="pc-mono truncate">{row.name}</span>
            {open ? <SizeField row={row} onCommit={(v) => setSize(row.name, v)} /> : <span className="pc-mono">{String(row.value)}{row.unit ? ` ${row.unit}` : ''}</span>}
            <SourceTag source={row.source} />
          </div>
        ))}
      </div>
      {open && (
        <>
          <div className="pc-row">
            <button type="button" className="pc-btn is-sm is-primary" onClick={() => accept(card.id)}>
              <IconCheck className="pc-i" aria-hidden="true" />
              Sizes look right
            </button>
            <button type="button" className="pc-btn is-sm" onClick={() => openPhotos(true)}>
              <IconCamera className="pc-i" aria-hidden="true" />
              Add a photo
            </button>
          </div>
          <span className="pc-caption">Changing a size here re-renders at once. Later builds keep it.</span>
        </>
      )}
    </div>
  )
}
```

Add `Ruler as IconRuler,` to `src/ui/icons.ts` if missing. `bg-warn-soft`, `bg-ok-soft`, `bg-accent-soft`, `text-warn`, `text-ok` are token utilities; confirm they exist in `src/styles/tokens.css`/the Tailwind theme (grep `warn-soft` in `src/index.css`); if a utility is missing, use `style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}`.

`AgentCardView.tsx`:

```tsx
  if (card.kind === 'plan') return <PlanCardView card={card} />
  if (card.kind === 'review') return <ReviewCardView card={card} />
  return <SizesCardView card={card} />
```

- [ ] **Step 12: Run** `npm run typecheck && npx vitest run src/agent` — expected: PASS.

- [ ] **Step 13: Commit.**

```bash
git add src/agent/sizes.ts src/agent/sizes.test.ts src/agent/ui/SizesCardView.tsx src/agent/ui/SizesCardView.test.tsx src/agent/ui/AgentCardView.tsx src/agent/agentStore.ts src/agent/agentStore.test.ts src/agent/runSteps.ts src/photos/photosDialogStore.ts src/ui/icons.ts
git commit -m "feat: a Sizes card lists every size of a photo build with its source"
```

---

### Task 8: The Photos dialog and refine

**Files:**
- Create: `src/photos/PhotosDialog.tsx`, `src/photos/PhotosDialog.test.tsx`, `src/photos/PhotosButton.tsx`, `src/photos/PhotosButton.test.tsx`
- Modify: `src/agent/agentStore.ts` (`refineWithPhotos`), `src/chat/ChatPanel.tsx:95-101` (button in the header, dialog mounted), `src/agent/agentStore.test.ts`
- Screens: `design/screens/PhotoAddAngle.dc.html`

**Interfaces:**
- Consumes: `usePhotosDialog` (Task 7), `PhotoSlots`, `addDraftPhotos`, `removeDraftPhoto` (Task 6), `refineText` (Task 3), `setPhotos`, `setBrief` (Task 1).
- Produces: `useAgentStore.refineWithPhotos(newAngles: PhotoAngle[], deps?: AgentDeps): Promise<void>`; `PhotosButton()` (reads "Photos · N", opens the dialog; hidden when the project has no photos and did not start from photos); `PhotosDialog({ onClose })`.

- [ ] **Step 1: Write the failing store test** (append to `src/agent/agentStore.test.ts`)

```ts
it('refines with the photos: one agent build whose request names the new angles and the user’s sizes', async () => {
  useProjectStore.setState({ project: { …photoProject, photos: [{ id: 'a', blobId: 'blob-a', angle: 'front', addedAt: 1 }], checks: [{ id: 'c', kind: 'size', text: 'About 50 mm tall' }] } })
  useAppStore.setState({ code: 'wall = 3;\ncube(wall);', params: { wall: 3.2 } })
  const sends: unknown[] = []
  const deps = fakeDeps({ send: async (text, opts) => (sends.push([text, opts]), { sent: true, startedEmpty: false, rendered: okRender, stopped: false }) })
  await useAgentStore.getState().refineWithPhotos(['side'], deps)
  expect(sends[0]).toEqual([
    'Compare the model with the reference photos and fix what differs. New photos: side. The user set these sizes; keep them: wall = 3.2.',
    { display: 'Refine with 1 photo', transcript: undefined, showPhotos: false },
  ])
})
```

The display text counts the project's photos (here one). With two photos it reads "Refine with 2 photos".

- [ ] **Step 2: Run** `npx vitest run src/agent/agentStore.test.ts` — expected: FAIL.

- [ ] **Step 3: Implement** in `agentStore.ts`:

```ts
import { refineText } from '../photos/photoPrompt'
import type { PhotoAngle } from '../photos/projectPhotos'
…
    /** Spec P10: rebuild against all photos, keeping the user's sizes; reviewed like any agent build. */
    async refineWithPhotos(newAngles, deps = browserDeps) {
      if (isBusy()) return
      const project = useProjectStore.getState().project
      const count = project?.photos?.length ?? 0
      if (count === 0) return
      const text = refineText(newAngles, useAppStore.getState().params)
      set({ latest: text })
      startRun()
      await build(text, `Refine with ${plural(count, 'photo')}`, currentReviewer() !== null && (project?.checks?.length ?? 0) > 0, 1, deps)
    },
```

Add `refineWithPhotos(newAngles: PhotoAngle[], deps?: AgentDeps): Promise<void>` to `AgentState`. `build` passes `{ display, transcript, showPhotos }` to `deps.send`, which gives the exact options object the test expects.

- [ ] **Step 4: Run** `npx vitest run src/agent/agentStore.test.ts` — expected: PASS.

- [ ] **Step 5: Write the failing dialog and button tests.** `src/photos/PhotosDialog.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useAgentStore } from '../agent/agentStore'
import { useProjectStore } from '../history/projectStore'
import { PhotosDialog } from './PhotosDialog'

const project = {
  id: 'p', name: 'P', createdAt: 1, updatedAt: 1, headVersionId: null, providerProfileId: null, enabledLibraries: [], origin: 'photos' as const,
  photos: [{ id: 'a', blobId: 'blob-a', angle: 'front' as const, addedAt: 1 }], brief: 'A bracket', scale: 'reference' as const,
}

beforeEach(() => {
  useProjectStore.setState({ project })
})

it('shows the project photos and the description, and saves without refining', async () => {
  const setPhotos = vi.fn(async () => {})
  const setBrief = vi.fn(async () => {})
  useProjectStore.setState({ setPhotos, setBrief } as never)
  const onClose = vi.fn()
  render(<PhotosDialog onClose={onClose} load={async () => new Blob(['f'], { type: 'image/jpeg' })} objectUrl={() => 'blob:a'} />)
  expect(await screen.findByRole('img', { name: 'Front photo' })).toBeInTheDocument()
  expect(screen.getByText('1 of 5 photos')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'A bracket, 50 mm tall' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save photos only' }))
  await waitFor(() => expect(setBrief).toHaveBeenCalledWith('A bracket, 50 mm tall'))
  expect(setPhotos).toHaveBeenCalledWith(project.photos)
  expect(onClose).toHaveBeenCalled()
})

it('adds a photo, saves its blob and refines with the new angle', async () => {
  const setPhotos = vi.fn(async () => {})
  const setBrief = vi.fn(async () => {})
  useProjectStore.setState({ setPhotos, setBrief } as never)
  const refine = vi.fn(async () => {})
  useAgentStore.setState({ refineWithPhotos: refine } as never)
  render(<PhotosDialog onClose={() => {}} load={async () => new Blob(['f'], { type: 'image/jpeg' })} objectUrl={() => 'blob:a'} prepare={async (b) => ({ blob: b, mediaType: 'image/jpeg' as const, width: 1, height: 1 })} saveImage={async () => 'blob-side'} />)
  await screen.findByRole('img', { name: 'Front photo' })
  fireEvent.change(screen.getByLabelText('Add side photo'), { target: { files: [new File(['s'], 'side.jpg', { type: 'image/jpeg' })] } })
  await screen.findByRole('img', { name: 'Side photo' })
  expect(screen.getByRole('button', { name: 'Refine with 2 photos' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Refine with 2 photos' }))
  await waitFor(() => expect(refine).toHaveBeenCalledWith(['side']))
  expect(setPhotos).toHaveBeenCalledWith([project.photos[0], expect.objectContaining({ blobId: 'blob-side', angle: 'side' })])
})
```

`src/photos/PhotosButton.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { useProjectStore } from '../history/projectStore'
import { PhotosButton } from './PhotosButton'
import { usePhotosDialog } from './photosDialogStore'

const base = { id: 'p', name: 'P', createdAt: 1, updatedAt: 1, headVersionId: null, providerProfileId: null, enabledLibraries: [] }

it('counts the photos and opens the dialog', () => {
  useProjectStore.setState({ project: { ...base, origin: 'photos', photos: [{ id: 'a', blobId: 'b', angle: 'front', addedAt: 1 }, { id: 'c', blobId: 'd', angle: 'top', addedAt: 2 }] } })
  render(<PhotosButton />)
  fireEvent.click(screen.getByRole('button', { name: 'Photos · 2' }))
  expect(usePhotosDialog.getState().open).toBe(true)
})

it('is absent on a project that did not start from photos', () => {
  useProjectStore.setState({ project: { ...base, origin: 'blank' } })
  render(<PhotosButton />)
  expect(screen.queryByRole('button', { name: /^Photos/ })).toBeNull()
})
```

- [ ] **Step 6: Run** `npx vitest run src/photos/PhotosDialog.test.tsx src/photos/PhotosButton.test.tsx` — expected: FAIL.

- [ ] **Step 7: Implement.** `src/photos/PhotosButton.tsx`:

```tsx
import { useProjectStore } from '../history/projectStore'
import { IconCamera } from '../ui/icons'
import { usePhotosDialog } from './photosDialogStore'

/** "Photos · N" in the Agent header; opens the project Photos dialog (spec P10). */
export function PhotosButton() {
  const project = useProjectStore((s) => s.project)
  const setOpen = usePhotosDialog((s) => s.setOpen)
  if (!project || (project.origin !== 'photos' && (project.photos?.length ?? 0) === 0)) return null
  const n = project.photos?.length ?? 0
  return (
    <button type="button" className="pc-btn is-sm is-ghost" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <IconCamera className="pc-i text-ink-muted" aria-hidden="true" />
      Photos · {n}
    </button>
  )
}
```

`src/photos/PhotosDialog.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useAgentStore } from '../agent/agentStore'
import { loadImage } from '../db/images'
import { saveImage as defaultSaveImage } from '../db/images'
import { useProjectStore } from '../history/projectStore'
import type { PreparedImage } from '../images/prepareImage'
import { Modal } from '../ui/Modal'
import { IconInfo, IconX } from '../ui/icons'
import { addDraftPhotos, removeDraftPhoto, type DraftPhoto, type DraftState } from './photoDraft'
import { PhotoSlots } from './PhotoSlots'
import { MAX_BRIEF_CHARS, MAX_PROJECT_PHOTOS, type PhotoAngle, type ProjectPhoto } from './projectPhotos'

interface Props {
  onClose(): void
  load?(id: string): Promise<Blob | null>
  objectUrl?(blob: Blob): string
  prepare?(blob: Blob): Promise<PreparedImage>
  saveImage?(blob: Blob): Promise<string>
}

/** A photo already on the project, shown like a draft; `blobId` tells it apart from a new one. */
type Slot = DraftPhoto & { blobId?: string }
```

Body:
- `const project = useProjectStore((s) => s.project)`; `const [draft, setDraft] = useState<DraftState & { photos: Slot[] }>({ photos: [], error: null })`; `const [brief, setBrief] = useState(project?.brief ?? '')`; `const [busy, setBusy] = useState(false)`.
- On mount: for each `project.photos`, `load(blobId)`; skip nulls; push `{ id: photo.id, angle: photo.angle, blob, mediaType, url: objectUrl(blob), name: photo.angle, blobId: photo.blobId }`. Cleanup revokes urls.
- `newAngles = draft.photos.filter((p) => !p.blobId).map((p) => p.angle)`.
- `save = async () => { const photos: ProjectPhoto[] = []; for (const p of draft.photos) photos.push({ id: p.id, blobId: p.blobId ?? await save(p.blob), angle: p.angle, addedAt: project.photos?.find((x) => x.id === p.id)?.addedAt ?? Date.now() }); await store.setPhotos(photos); await store.setBrief(brief.trim()); return photos }` where `store = useProjectStore.getState()`.
- "Save photos only": `setBusy(true); await save(); onClose()`.
- "Refine with N photos" (N = `draft.photos.length`; disabled when 0 or `busy`): `await save(); onClose(); void useAgentStore.getState().refineWithPhotos(newAngles)`.
- Markup follows `PhotoAddAngle.dc.html`: `Modal` with `pc-dialog max-w-[760px] gap-0 p-0`; header "Photos", muted "Every build and review in this project sees these photos and the description."; a row with `{draft.photos.length} of {MAX_PROJECT_PHOTOS} photos` and the caption "Sent with every request in this project"; `<PhotoSlots layout="angles" …/>` (a stored `'photo'`-angle photo shows under "Other angle"; `PhotoSlots` groups by angle, so add `'photo'` to the `'other'` group there: in Task 6's `PhotoSlots`, treat `p.angle === 'photo'` as `'other'` when grouping); `pc-field` "Description" with a `<textarea id="ph-desc" maxLength={MAX_BRIEF_CHARS}>`; a `pc-callout is-info` "Refining builds v{n+1} from v{n}" with the text "The agent compares the model with all N photos and fixes what differs. Sizes you set keep their values. Guessed sizes may change." (n from `useProjectStore((s) => s.head?.label)`); footer caption "{head label} stays in History.", Cancel, "Save photos only", "Refine with N photos" (primary).

- [ ] **Step 8: Mount them.** In `src/chat/ChatPanel.tsx` header, after `<ChecksButton />`: `<PhotosButton />`. At the end of the section, `{photosOpen && <PhotosDialog onClose={() => setPhotosOpen(false)} />}` with `const photosOpen = usePhotosDialog((s) => s.open)` and `setPhotosOpen = usePhotosDialog((s) => s.setOpen)`.

- [ ] **Step 9: Run** `npm run typecheck && npm test` — expected: PASS.

- [ ] **Step 10: Commit.**

```bash
git add src/photos src/agent/agentStore.ts src/agent/agentStore.test.ts src/chat/ChatPanel.tsx
git commit -m "feat: Photos dialog adds angles and refines the model against them"
```

---

### Task 9: Reference photo over the viewer

**Files:**
- Create: `src/photos/referenceCamera.ts`, `src/photos/referenceCamera.test.ts`, `src/photos/ReferencePhoto.tsx`, `src/photos/ReferencePhoto.test.tsx`, `src/viewer/poseRequest.ts`
- Modify: `src/viewer/Viewer.tsx` (a `PoseApplier` inside the canvas; the overlay in the top-left stack)
- Screens: `design/screens/PhotoFirstBuild.dc.html` (top-left corner)

**Interfaces:**
- Produces:
  ```ts
  // referenceCamera.ts
  export type ReferenceView = 'front' | 'top' | 'right' | 'back' | 'bottom'
  export function referenceView(angle: PhotoAngle): ReferenceView | null      // side → right; photo, other → null
  export function referencePose(bounds: Bounds, view: ReferenceView, aspect?: number): CameraPose
  // poseRequest.ts
  export const usePoseRequest = create<{ pose: CameraPose | null; token: number; request(pose: CameraPose): void }>()
  // ReferencePhoto.tsx
  export function ReferencePhoto(props: { bounds: Bounds | null; load?(id: string): Promise<Blob | null>; objectUrl?(b: Blob): string })
  ```

- [ ] **Step 1: Write the failing camera tests** (`src/photos/referenceCamera.test.ts`)

```ts
import { presetPose } from '../export/frames'
import { referencePose, referenceView } from './referenceCamera'

const bounds = { min: [0, 0, 0] as [number, number, number], max: [10, 20, 30] as [number, number, number] }

it('maps photo angles to camera views', () => {
  expect(referenceView('front')).toBe('front')
  expect(referenceView('side')).toBe('right')
  expect(referenceView('bottom')).toBe('bottom')
  expect(referenceView('other')).toBeNull()
  expect(referenceView('photo')).toBeNull()
})

it('reuses the export presets and mirrors them for back and bottom', () => {
  expect(referencePose(bounds, 'front')).toEqual(presetPose(bounds, 'front'))
  const front = presetPose(bounds, 'front')
  const back = referencePose(bounds, 'back')
  expect(back.target).toEqual(front.target)
  expect(back.position[1]).toBeCloseTo(2 * front.target[1] - front.position[1])
  const top = presetPose(bounds, 'top')
  const bottom = referencePose(bounds, 'bottom')
  expect(bottom.position[2]).toBeCloseTo(2 * top.target[2] - top.position[2])
  expect(bottom.up).toEqual([0, 1, 0])
})
```

- [ ] **Step 2: Run** `npx vitest run src/photos/referenceCamera.test.ts` — expected: FAIL.

- [ ] **Step 3: Implement** `src/photos/referenceCamera.ts`

```ts
import { presetPose, type CameraPose } from '../export/frames'
import type { Bounds } from '../render/types'
import type { PhotoAngle } from './projectPhotos'

export type ReferenceView = 'front' | 'top' | 'right' | 'back' | 'bottom'

/** The camera that matches a photo's angle; null for an untagged photo (spec P12). */
export function referenceView(angle: PhotoAngle): ReferenceView | null {
  switch (angle) {
    case 'front':
    case 'top':
    case 'back':
    case 'bottom':
      return angle
    case 'side':
      return 'right'
    default:
      return null
  }
}

export function referencePose(bounds: Bounds, view: ReferenceView, aspect = 1): CameraPose {
  if (view === 'back') {
    const front = presetPose(bounds, 'front', aspect)
    const [px, py, pz] = front.position
    const [, ty] = front.target
    return { ...front, position: [px, 2 * ty - py, pz] }
  }
  if (view === 'bottom') {
    const top = presetPose(bounds, 'top', aspect)
    const [px, py, pz] = top.position
    const [, , tz] = top.target
    return { ...top, position: [px, py, 2 * tz - pz], up: [0, 1, 0] }
  }
  return presetPose(bounds, view, aspect)
}
```

`src/viewer/poseRequest.ts`:

```ts
import { create } from 'zustand'
import type { CameraPose } from '../export/frames'

/** A camera pose the viewer should move to once; `token` changes on every request so the same pose can be asked for twice. */
export const usePoseRequest = create<{ pose: CameraPose | null; token: number; request(pose: CameraPose): void }>()((set) => ({
  pose: null,
  token: 0,
  request: (pose) => set((s) => ({ pose, token: s.token + 1 })),
}))
```

- [ ] **Step 4: Run** `npx vitest run src/photos/referenceCamera.test.ts` — expected: PASS.

- [ ] **Step 5: Write the failing overlay test** (`src/photos/ReferencePhoto.test.tsx`)

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { useProjectStore } from '../history/projectStore'
import { usePoseRequest } from '../viewer/poseRequest'
import { ReferencePhoto } from './ReferencePhoto'

const bounds = { min: [0, 0, 0] as [number, number, number], max: [10, 10, 10] as [number, number, number] }
const photos = [{ id: 'a', blobId: 'ba', angle: 'front' as const, addedAt: 1 }, { id: 'b', blobId: 'bb', angle: 'other' as const, addedAt: 2 }]

beforeEach(() => {
  useProjectStore.setState({ project: { id: 'p', name: 'P', createdAt: 1, updatedAt: 1, headVersionId: null, providerProfileId: null, enabledLibraries: [], origin: 'photos', photos } })
  usePoseRequest.setState({ pose: null, token: 0 })
})

it('shows the first photo, switches with the tabs, moves the camera for tagged angles only, and hides', async () => {
  render(<ReferencePhoto bounds={bounds} load={async (id) => new Blob([id], { type: 'image/jpeg' })} objectUrl={() => 'blob:x'} />)
  expect(await screen.findByRole('img', { name: 'Reference photo, front' })).toBeInTheDocument()
  expect(screen.getByText("The camera matches the photo's angle.")).toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: 'Front' }))
  expect(usePoseRequest.getState().token).toBe(1)
  fireEvent.click(screen.getByRole('radio', { name: 'Other angle' }))
  expect(usePoseRequest.getState().token).toBe(1)
  expect(screen.queryByText("The camera matches the photo's angle.")).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Hide reference photo' }))
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.getByRole('button', { name: 'Show reference photo' })).toBeInTheDocument()
})

it('renders nothing for a project without photos', () => {
  useProjectStore.setState({ project: { id: 'p', name: 'P', createdAt: 1, updatedAt: 1, headVersionId: null, providerProfileId: null, enabledLibraries: [], origin: 'blank' } })
  const { container } = render(<ReferencePhoto bounds={bounds} />)
  expect(container).toBeEmptyDOMElement()
})
```

- [ ] **Step 6: Run** `npx vitest run src/photos/ReferencePhoto.test.tsx` — expected: FAIL.

- [ ] **Step 7: Implement** `src/photos/ReferencePhoto.tsx`

```tsx
import { useEffect, useState } from 'react'
import { loadImage } from '../db/images'
import { useProjectStore } from '../history/projectStore'
import type { Bounds } from '../render/types'
import { IconCamera, IconX } from '../ui/icons'
import { usePoseRequest } from '../viewer/poseRequest'
import { PHOTO_LABEL, type ProjectPhoto } from './projectPhotos'
import { referencePose, referenceView } from './referenceCamera'

interface Props {
  bounds: Bounds | null
  load?(id: string): Promise<Blob | null>
  objectUrl?(blob: Blob): string
}

/** A small reference photo in the viewer's corner, with a tab per angle (spec P12). Hidden state is per session. */
export function ReferencePhoto({ bounds, load = loadImage, objectUrl = (b) => URL.createObjectURL(b) }: Props) {
  const photos = useProjectStore((s) => s.project?.photos)
  const request = usePoseRequest((s) => s.request)
  const [hidden, setHidden] = useState(false)
  const [current, setCurrent] = useState(0)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const key = (photos ?? []).map((p) => p.blobId).join(',')

  useEffect(() => {
    let live = true
    const made: string[] = []
    void Promise.all((photos ?? []).map(async (p) => [p.id, await load(p.blobId)] as const)).then((pairs) => {
      if (!live) return
      const next: Record<string, string> = {}
      for (const [id, blob] of pairs) if (blob) next[id] = made[made.push(objectUrl(blob)) - 1]!
      setUrls(next)
    })
    return () => {
      live = false
      for (const u of made) URL.revokeObjectURL?.(u)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the set of blobs changes
  }, [key])

  if (!photos || photos.length === 0) return null
  const photo: ProjectPhoto | undefined = photos[Math.min(current, photos.length - 1)]
  if (!photo) return null
  const view = referenceView(photo.angle)

  const pick = (i: number) => {
    setCurrent(i)
    const v = referenceView(photos[i]!.angle)
    if (v && bounds) request(referencePose(bounds, v))
  }

  if (hidden) {
    return (
      <button type="button" className="pc-btn is-sm" aria-label="Show reference photo" title="Show reference photo" onClick={() => setHidden(false)}>
        <IconCamera className="pc-i" aria-hidden="true" />
      </button>
    )
  }
  return (
    <div className="flex flex-col items-start gap-1.5" data-testid="reference-photo">
      <div className="relative aspect-[4/3] w-[168px] overflow-hidden rounded-md border border-line bg-inset">
        {urls[photo.id] && <img src={urls[photo.id]} alt={`Reference photo, ${PHOTO_LABEL[photo.angle].toLowerCase()}`} className="absolute inset-0 size-full object-cover" />}
        <span className="absolute top-1.5 left-1.5 rounded-sm bg-panel px-1.5 text-[11px] leading-5 font-semibold">{PHOTO_LABEL[photo.angle]}</span>
      </div>
      <div className="pc-tabs" role="radiogroup" aria-label="Reference photo">
        {photos.map((p, i) => (
          <button key={p.id} type="button" role="radio" className="pc-tab" aria-checked={i === current} onClick={() => pick(i)}>
            {PHOTO_LABEL[p.angle]}
          </button>
        ))}
        <button type="button" className="pc-tab" aria-label="Hide reference photo" onClick={() => setHidden(true)}>
          <IconX className="pc-i" aria-hidden="true" />
        </button>
      </div>
      {view && <span className="pc-caption">The camera matches the photo&apos;s angle.</span>}
    </div>
  )
}
```

In the test, `screen.getByRole('radio', { name: 'Front' })` matches the tab because `pc-tab` buttons with `role="radio"` take their name from their text.

In `src/viewer/Viewer.tsx`:
- Add inside the `<Canvas>` a `PoseApplier` next to `CameraFitter`:

```tsx
function PoseApplier() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null
  const invalidate = useThree((s) => s.invalidate)
  const pose = usePoseRequest((s) => s.pose)
  const token = usePoseRequest((s) => s.token)
  useEffect(() => {
    if (!pose || !controls || token === 0) return
    camera.up.set(...(pose.up ?? [0, 0, 1]))
    camera.position.set(...pose.position)
    controls.target.set(...pose.target)
    controls.update()
    camera.updateMatrixWorld()
    invalidate()
  }, [pose, token, controls, camera, invalidate])
  return null
}
```

- In the top-left overlay `div` (the one with the stale pill and `DimsReadout`), change it to a column: `className="absolute top-3 left-3 flex flex-col items-start gap-2"` and add `<ReferencePhoto bounds={mesh?.bounds ?? null} />` after the existing status element. Check `e2e/layout.spec.ts` and `phone.spec.ts` for assertions on that corner; the status pill keeps its place as the first child.

- [ ] **Step 8: Run** `npm run typecheck && npx vitest run src/photos src/viewer` — expected: PASS.

- [ ] **Step 9: Commit.**

```bash
git add src/photos/referenceCamera.ts src/photos/referenceCamera.test.ts src/photos/ReferencePhoto.tsx src/photos/ReferencePhoto.test.tsx src/viewer/poseRequest.ts src/viewer/Viewer.tsx
git commit -m "feat: show a reference photo over the viewer and match its camera angle"
```

---

### Task 10: End to end, docs and design notes

**Files:**
- Create: `e2e/photos.spec.ts`, `e2e/fixtures/photo-front.png`, `e2e/fixtures/photo-top.png`, `e2e/fixtures/photo-side.png` (tiny valid PNGs, 8 × 6 px, made with the snippet below)
- Modify: `docs/SPEC.md` (Editing modes: a "Start from photos" paragraph; Projects table: `photos`, `brief`, `scale`), `design/README.md` (the `Photo*` boards), `README.md` if it lists features

- [ ] **Step 1: Make the fixtures.** Run once (node, in the scratchpad, then copy the files into `e2e/fixtures/`):

```js
// make-png.mjs: a solid-colour 8 × 6 PNG per angle
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
function png(name, [r, g, b]) {
  const w = 8, h = 6
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill([r, g, b]).flat())])))
  writeFileSync(name, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}
png('photo-front.png', [200, 120, 40]); png('photo-top.png', [40, 120, 200]); png('photo-side.png', [60, 160, 90])
```

- [ ] **Step 2: Write the end-to-end spec** (`e2e/photos.spec.ts`)

```ts
import { expect, test, type Page, type Route } from '@playwright/test'
import { FAKE_BASE, RENDER_TIMEOUT, waitForAppReady, watchCspViolations } from './support'

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' }
const FENCE = '`'.repeat(3)
const BRACKET = [
  '// Curtain rod bracket, from 2 photos',
  'rod_d = 25; // [15:0.5:40] from description',
  'height = 50; // [30:1:90] from description',
  'wall = 3; // [1.2:0.2:6] guessed',
  'module wall_plate() cube([wall * 2, 22, height]);',
  'module cup() translate([wall * 2, 0, 0]) difference() { cube([rod_d + 2 * wall, 22, rod_d]); translate([wall, -1, wall]) cube([rod_d, 24, rod_d]); }',
  'wall_plate();',
  'cup();',
  '',
].join('\n')
const PLAN = { checks: [{ kind: 'size', text: 'About 50 mm tall' }, { kind: 'part', text: 'An open cup for a 25 mm rod' }], parts: ['wall_plate', 'cup'] }
const PASSES = { summary: 'Matches the photos.', checks: [{ n: 1, status: 'pass', evidence: 'height = 50 in the code.' }, { n: 2, status: 'pass', evidence: 'Front view shows the cup.' }], issues: [], newChecks: [] }

type Part = { type: string; text?: string; image_url?: { url: string } }
type Body = { messages: Array<{ role: string; content: string | Part[] }> }
const sse = (text: string) =>
  [{ choices: [{ index: 0, delta: { content: text } }] }, { choices: [], usage: { prompt_tokens: 200, completion_tokens: 50 } }].map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
const images = (body: Body) => (body.messages.at(-1)!.content as Part[]).filter((p) => p.type === 'image_url')
const texts = (body: Body) => (body.messages.at(-1)!.content as Part[]).filter((p) => p.type === 'text').map((p) => p.text ?? '')

async function fakeVision(page: Page) {
  const seen = { plan: [] as Body[], build: [] as Body[], review: [] as Body[] }
  await page.route(`${FAKE_BASE}/**`, async (route: Route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (req.url().endsWith('/models')) return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'fake-vision' }] }) })
    const body = req.postDataJSON() as Body
    const system = String(body.messages[0]?.content ?? '')
    let text: string
    if (system.startsWith('You plan')) (seen.plan.push(body), (text = JSON.stringify(PLAN)))
    else if (system.startsWith('You review')) (seen.review.push(body), (text = JSON.stringify(PASSES)))
    else (seen.build.push(body), (text = `Built it.\n\n${FENCE}openscad\n${BRACKET}${FENCE}\n`))
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse(text) })
  })
  return seen
}
```

Copy `seedVisionProvider` from `e2e/agent.spec.ts` into `e2e/support.ts` as an export (and import it in both specs) so it is not duplicated. Then the test:

```ts
test('starts a project from two photos, builds with sizes and their sources, adds an angle and refines', async ({ page }) => {
  const seen = await fakeVision(page)
  const csp = watchCspViolations(page)
  await seedVisionProvider(page)

  // New project › Photos: two angles, a description, scale from a coin.
  await page.getByRole('button', { name: /project$/ }).first().click()
  await page.getByRole('button', { name: 'New project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByRole('radio', { name: 'Photos' }).click()
  await dialog.getByLabelText('Add front photo').setInputFiles('e2e/fixtures/photo-front.png')
  await dialog.getByLabelText('Add top photo').setInputFiles('e2e/fixtures/photo-top.png')
  await expect(dialog.getByRole('img', { name: 'Top photo' })).toBeVisible()
  await dialog.getByLabelText('Describe it').fill('A wall bracket for a 25 mm curtain rod, about 50 mm tall.')
  await dialog.getByRole('button', { name: 'Create and build' }).click()

  // The planner and the builder each got both photos with their tags.
  const agent = page.getByRole('region', { name: 'Agent', exact: true })
  await agent.getByTestId('plan-card').getByRole('button', { name: 'Approve and build' }).click()
  await expect(page.getByTestId('dims')).toHaveText('37 × 22 × 50 mm', { timeout: RENDER_TIMEOUT })
  expect(images(seen.plan[0]!)).toHaveLength(2)
  expect(texts(seen.plan[0]!).join('\n')).toContain('Reference photo (front)')
  expect(images(seen.build[0]!)).toHaveLength(2)
  expect(String(seen.build[0]!.messages[0]!.content)).toContain('End every Customizer annotation with its source')
  await expect(agent.getByRole('img', { name: /Attached image/ })).toHaveCount(2)

  // The review got the photos too; the Sizes card shows the guess and lets the user change it.
  await expect(agent.getByTestId('review-card')).toContainText('All 2 pass', { timeout: RENDER_TIMEOUT })
  expect(images(seen.review[0]!)).toHaveLength(6) // four frames plus two photos
  const sizes = agent.getByTestId('sizes-card')
  await expect(sizes).toContainText('Sizes in v1 · 3')
  await expect(sizes).toContainText('1 guessed')
  await sizes.getByRole('spinbutton', { name: 'wall in mm' }).fill('4')
  await sizes.getByRole('spinbutton', { name: 'wall in mm' }).blur()
  await expect(page.getByTestId('dims')).toHaveText('41 × 22 × 50 mm', { timeout: RENDER_TIMEOUT })
  await expect(page.getByTestId('param-wall')).toContainText('Guessed')

  // The viewer shows the reference photo; the top tab moves the camera.
  await expect(page.getByTestId('reference-photo').getByRole('img')).toBeVisible()
  await page.getByTestId('reference-photo').getByRole('radio', { name: 'Top' }).click()

  // Add a side photo and refine: three photos go with the request, the user's size is kept.
  await agent.getByRole('button', { name: 'Photos · 2' }).click()
  const photos = page.getByRole('dialog', { name: 'Photos' })
  await photos.getByLabelText('Add side photo').setInputFiles('e2e/fixtures/photo-side.png')
  await photos.getByRole('button', { name: 'Refine with 3 photos' }).click()
  await expect(agent.getByText('Refine with 3 photos')).toBeVisible()
  await expect(agent.getByTestId('review-card')).toHaveCount(2, { timeout: RENDER_TIMEOUT })
  expect(images(seen.build[1]!)).toHaveLength(3)
  expect(texts(seen.build[1]!).join('\n')).toContain('New photos: side.')
  expect(texts(seen.build[1]!).join('\n')).toContain('The user set these sizes; keep them: wall = 4.')
  await expect(agent.getByRole('button', { name: 'Photos · 3' })).toBeVisible()

  // Reload: the photos, the brief and the button survive.
  await page.reload()
  await waitForAppReady(page)
  await expect(agent.getByRole('button', { name: 'Photos · 3' })).toBeVisible()
  expect(csp).toEqual([])
})

test('Photos is disabled without a vision model', async ({ page }) => {
  const { seedFakeProvider } = await import('./support')
  await seedFakeProvider(page)
  await page.getByRole('button', { name: /project$/ }).first().click()
  await page.getByRole('button', { name: 'New project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await expect(dialog.getByRole('radio', { name: 'Photos' })).toHaveAttribute('aria-disabled', 'true')
  await expect(dialog.getByText(/Images need a model with vision/)).toBeVisible()
})
```

Check how `e2e/history.spec.ts` or `smoke.spec.ts` opens the project menu and the "New project" item, and use the same locators. The dims assertions follow from `BRACKET`: X = `wall * 2 + rod_d + 2 * wall` = 6 + 25 + 6 = 37 (41 with `wall = 4`), Y = 22, Z = `height` = 50. Verify with a local OpenSCAD run (`npm run dev` and paste the code) before relying on them.

- [ ] **Step 3: Run** `npm run e2e` — expected: the new spec passes with the rest; fix any locator that the real markup does not match.

- [ ] **Step 4: Docs.** In `docs/SPEC.md`, under "Editing modes", add after "Image and sketch input":

> **Start from photos.** A new project can start from one photo or several tagged angles (front, top, side, back, bottom, other) of a real object, plus a description and a scale choice (a coin, card or ruler in the photos, or only the sizes in the description). The photos belong to the project (at most 5, 1024 px) and go with every builder, planner and reviewer request. The builder marks every Customizer annotation with its source (`from description`, `from photo`, `guessed`); the Customizer and a Sizes card after each build show it, guesses first. A Photos dialog adds angles later and refines the model against all photos, keeping the sizes the user set. The viewer can show a reference photo and match its camera angle.

In the "Projects and version history" table add `photos`, `brief`, `scale` to the project row. In `design/README.md` add a sentence to the Screens section: "The `Photo*` boards (screens version `1791893611-8012`, 2026-10-13) show starting a project from photos: the dialog, the first build with the Sizes card, adding an angle, and the phone. `screens.css` gains the photo placeholder colours; they are mockup-only." If `README.md` lists features, add one line.

- [ ] **Step 5: Run the full checks** `npm run typecheck && npm test && npm run e2e` — expected: all PASS.

- [ ] **Step 6: Commit and push.**

```bash
git add e2e/photos.spec.ts e2e/fixtures e2e/support.ts e2e/agent.spec.ts docs/SPEC.md design/README.md README.md
git commit -m "test: end-to-end start from photos; docs: photos in the spec and design notes"
git push origin main
```

---

## Self-review notes

- Spec coverage: P1, P2, P15 → Task 6; P3 → Task 1; P4 → Tasks 4 and 6 (`showPhotos`, `submit(brief)`); P5 → Tasks 3 and 6; P6 → Tasks 3 and 4; P7 → Task 2; P8 → Task 7; P9 → Tasks 3, 4 and 8; P10 → Task 8; P11 → Task 4; P12 → Task 9; P13 → Task 6 (dialog) and the existing agent fallback; P14 → Task 5 (share links untouched, so they carry no photos). Error handling: decode failures and the limit → Task 6; missing blobs → Task 4; no sources → Task 7 ("Source not given").
- Type names used across tasks: `ProjectPhoto`, `PhotoAngle`, `PhotoScale`, `LoadedPhoto` (Task 1); `ParamSource`, `SOURCE_LABEL` (Task 2); `PhotoContext` (Task 3); `SendOptions`, `projectPhotoParts` (Task 4); `FilePhoto` (Task 5); `DraftPhoto`, `DraftState`, `NewProjectResult` (Task 6); `SizeRow`, `SizesCard`, `usePhotosDialog` (Task 7); `refineWithPhotos` (Task 8); `ReferenceView`, `usePoseRequest` (Task 9).
- Not in scope, on purpose: cropping, perspective correction, detecting the scale object, photos in share links, per-turn choice of sending photos.
