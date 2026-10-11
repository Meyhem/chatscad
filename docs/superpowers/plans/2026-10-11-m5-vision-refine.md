# PromptCAD M5 — Vision and Click-to-Refine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tap a part of the rendered model, see it highlighted in 3D and in the editor, and ask the AI to change only that part; attach photos, drawings and dimensioned sketches to prompts for vision models; optionally let a vision model check each AI result.

**Architecture:** After each successful normal render, the same `RenderController` runs a quiet follow-up render of the editor code with every top-level statement (and each child of a top-level `union`/`difference`/`intersection`) wrapped in a `color()` that encodes a tag id; the worker exports that preview as coloured OFF and returns `MeshData.faceTags`, while the displayed STL and Export STL keep coming from the untagged render. A ray hit gives a face index, the face index gives a tag, the tag gives a `StatementRange` (or a bounding-box region when tags are missing); the pick drives a 3D overlay, a CodeMirror line decoration, a popover and a composer chip, and its line range becomes `PromptContext.selection`, enforced after the reply with one retry. Images (files, paste, drop, sketches, viewport captures) are downscaled in the browser, stored as `blobs` of kind `image`, and sent as `ContentPart` image parts that each adapter serialises in its own format.

**Tech Stack:** Existing stack only (React 19, TypeScript strict, Zustand, Dexie, CodeMirror 6, three.js via react-three-fiber, Comlink, OpenSCAD WASM with Manifold, Vitest + Testing Library, Playwright). No new dependencies; the alternate 3MF path in Task 5 would move `fflate` from devDependencies to dependencies.

**Spec:** [`docs/SPEC.md`](../../SPEC.md) ("Editing modes › Click-to-refine", "Image and sketch input", "Rendering pipeline", "Risks and open questions") and the M2–M5 design [`docs/superpowers/specs/2026-10-11-m2-m5-design.md`](../specs/2026-10-11-m2-m5-design.md) (decision D12, "M5 — Vision and click-to-refine", "Shared contracts").

**Prerequisite:** M2, M3 and M4 have been executed exactly as the design doc's **Shared contracts** describe. This plan uses only contract names from those milestones: `src/ai/types.ts` (`ContentPart`, `LlmMessage`, `ChatRequest`, `Usage`, `LlmProvider`, `ProviderError`), `src/ai/createProvider.ts`, the adapters (OpenAI-compatible and Anthropic), `src/ai/prompt.ts` (`PromptContext.selection`, `buildSystemPrompt`, `buildMessages`), `src/ai/runTurn.ts` (`generateCode`, `GenerateResult`, `runTurn`, `TurnEvent`), `src/ai/edits.ts` (`parseReply`, `applyEdits`), `src/ai/cost.ts` (`computeCost`), `src/chat/chatStore.ts` (`ChatMessage.imageBlobIds`), `src/db/db.ts` (`PromptCadDb`, `db`, `DEFAULT_SETTINGS`, `Settings`, `ProviderProfile`, `UsageRecord`, the `blobs` table, `StoredMessage.imageBlobIds`), `src/scad/lexer.ts` (`lex`, `Token`), and `src/export/frames.ts` (`renderFrames`, `presetPose`). Where a task changes one of those files it shows the full new code of the pieces it changes; files and names outside the contracts (the composer component, the chat column, the settings page) are located with the `grep` commands given in the step. Before starting, run `npm run typecheck && npm test` on the branch and confirm both pass.

**Design sources:** [`design/screens/`](../../../design/screens/): `Refine.dc.html` (3D highlight in the `pick` token, popover with **Ask AI** and **Show code** (the screen's "Ask Claude" becomes "Ask AI" because providers are generic), editor lines styled like `.cl.is-pick`, composer pick chip "bores · lines 15–17" with "Only this part will change", "Tap empty space to clear · Esc"), `PhoneSketch.dc.html` (sketch canvas, Pen / Line / Size / Erase, undo, note, "Attach to prompt"), `PhoneChat.dc.html` (`pc-msg-img` thumbnail above a user bubble), `Main.dc.html` (attach button in the composer bar). Deviations, each deliberate: the popover's summary line shows triangle count and bounding size ("1,024 triangles · 19 × 19 × 22 mm") instead of the screen's semantic sentence ("4 cylinders, d = 19 mm, subtracted from body()"), which would need geometry understanding; the sketch's "Note for Claude" field is labelled "Note"; picking reaches top-level statements and main-assembly children, so the screen's example (a `for` loop inside `module body()`) resolves to the `body` part and its module definition (see "Contract issues" and "Deferred beyond v1").

## Global Constraints

From the spec and the design doc:

- Click-to-refine: "wraps each top-level statement (and each module call inside the main assembly) in a `color()` that encodes a tag id, keeping a map from tag id to source range."
- "The user taps a part, it is highlighted in 3D and in the editor, and the chat box is scoped: 'make this hole 2 mm wider' edits only that range."
- Fallback: "if tags are lost (e.g. inside `hull()`), use the bounding box and a viewport screenshot with the selection outlined for a vision model."
- "The user's own `color()` calls are restored in the final export." Design doc: "Final STL export always renders the untagged code." The editor code is never modified by tagging.
- D12: the spike decides OFF (with colours) or 3MF; later tasks are written for OFF.
- Images: "Sent as image parts to vision-capable models only; the button is disabled with an explanation for profiles without vision. Images are downscaled client-side (max ~1568 px long edge) and stored with the version that used them."
- Image storage: `blobs` rows with `kind: 'image'`, referenced from `messages.imageBlobIds` (`ChatMessage.imageBlobIds` in the chat store).
- Adapters: OpenAI-compatible `{ type: 'image_url', image_url: { url: 'data:<mt>;base64,<data>' } }`; Anthropic `{ type: 'image', source: { type: 'base64', media_type, data } }`.
- Visual check: setting `visualCheck`, **off by default**; "screenshot to a vision model asking whether it matches the request"; never loops automatically.
- `RenderController` is the only path to the worker; it owns the 600 ms debounce, cancel-on-newer-request and the 60 s timeout, for tagged previews too.
- `RenderRequest.preview?: { tagged: true }`; `MeshData.faceTags?: Uint32Array` (one tag id per triangle, `0` = untagged). Tag ids are `1..16,777,214`.
- New dependencies: none (the alternate 3MF path moves `fflate` to dependencies).
- E2E tests never call real providers: a fake OpenAI-compatible endpoint with Playwright `page.route` on an `https://` URL.
- IDs are `crypto.randomUUID()`; timestamps `Date.now()`.

From CLAUDE.md:

- **TDD.** Write the failing test first and watch it fail. Tests that read the filesystem start with `// @vitest-environment node`.
- **Tokens only.** No hex colours and no Tailwind palette classes in `src/` (`src/styles/noHardcodedColors.test.ts` enforces it). WebGL and canvas colours come from tokens via `useTokens` / `readToken`.
- **Copy voice.** Sentence case, units on every number ("19 × 19 × 22 mm", "1,024 triangles"), the `×` sign, the en dash in line ranges ("lines 15–17"), errors that say what failed and what to do, no exclamation marks or emoji; never "head", "blob" or "AST" in the UI.
- **CSP stays strict.** `script-src 'self' 'wasm-unsafe-eval'`; thumbnails use `blob:` URLs (already in `img-src`); no CDNs.
- **Model output is untrusted.** Statement labels, file names, AI answers and visual-check notes render as React text nodes only.
- **OpenSCAD WASM is pinned** by URL and SHA-256 in `scripts/fetch-openscad.ts`; the spike runs that pinned build and never downloads another.
- **Base path.** No hard-coded leading `/` in asset URLs.
- **Git.** One logical change per commit, conventional message ending with the `Co-Authored-By` line; `npm run typecheck && npm test && npm run e2e` green before the push in Task 19; never force-push.

From the design system (`design/tokens.json`, `design/components.css`, `design/screens/screens.css`):

- "`accent` marks … the active selection, the picked part"; `pick` (alias of `accent`) colours the 3D highlight, the `pc-chip is-pick` chip and the region box. Highlight fill opacity 0.22 (`screens.css` `.pick-fill`).
- Editor pick lines: `background: var(--accent-soft); box-shadow: inset 2px 0 0 var(--accent)` (`screens.css` `.cl.is-pick`).
- Popovers are `panel-raised` with a `line` border, `shadow-pop` and `radius-lg` ("`panel-raised` surfaces that float: menus, popovers, dialogs").
- Sketch: ground `inset`, grid `grid-minor`, strokes `ink` 2.5 px round, dimensions `accent` 1.5 px with mono 600 15 px labels (`PhoneSketch` `.sk-*`).
- Thumbnails: `pc-msg-img` (96 × 72 px, `radius-sm`, `line` border, `inset` ground) above the user bubble.
- Icons: Lucide, 16 px, `pc-i` class, `aria-hidden` when next to text.
- Controls at least `touch-target` (44 px) on coarse pointers via the `pc-*` classes.

## Review Focus

1. **The user's own `color()` calls and Export STL.** Code such as `color("red") plate(); color("blue") peg();`. Expected: the viewer still shows the model in `filament`; picking works because the outer tag colour overrides inner colours in the preview only; the editor code never changes; Export STL saves the untagged render, byte for byte what M1 produced; a tagged preview never replaces `mesh`, `stl`, `status` or `lastRender` in the app store. *Pinned in Task 1 (outer colour wins over inner), Task 5 (tagged results carry an empty STL and the untagged path is unchanged) and Task 7 (tagged results leave the app store untouched, status pill never flips).*
2. **The model ignores the scope.** A scoped request whose reply edits a line outside the selection, or returns a full file that changes other lines. Expected: the reply is not applied, one automatic retry asks again with the line range spelled out, and if that also strays the chat shows "The reply changed lines outside lines 15–17, so it was not applied…" and the editor is unchanged. SEARCH blocks that quote unchanged context lines outside the range are accepted. Auto-fix replies are not restricted (the selection's line numbers are stale after the first edit). *Pinned in Task 11.*
3. **Out-of-date picks and gestures.** The user edits code while a part is picked, a slider changes the geometry, or an orbit drag ends over a part. Expected: the pick, popover, chip and editor highlight clear on any code or mesh change; picking is ignored while the editor code differs from the rendered code, while the model is stale, and while the tagged preview for the current mesh is still running ("finding parts…"); a pointer that moved 4 px or more never picks and never clears. *Pinned in Task 7 (tags belong to one base mesh), Task 6 (`isTap`) and Task 9 (`useRefineSync`).*
4. **Tags lost or never produced** (children inside `hull()`/`minkowski()`, a `!` root modifier, a failed or timed-out tagged render). Expected: the tap selects the connected region of untagged triangles and shows "Selected region · Not matched to code" with its size; the request carries the region's coordinates, plus an outlined viewport capture when the profile has vision, and a callout explains the text-only fallback otherwise; a wrong statement is never selected. *Pinned in Task 1 (hull children lose colours), Task 6 (box fallback and connectivity), Task 8 (callout) and Task 16 (turn input for region picks).*
5. **Images that are huge, unreadable or unwanted.** An 8000 × 6000 phone photo, a HEIC file the browser cannot decode, a pasted text file, a fifth image, a profile without vision. Expected: images are re-encoded at most 1568 px on the long edge (which also drops EXIF location data); unreadable files say "Could not read photo.heic. Attach a PNG, JPEG or WebP image."; non-images say "notes.txt is not an image…"; more than 4 images say "Up to 4 images per message…"; without vision the attach button is disabled with the explanation as its tooltip, and paste or drop shows the same explanation instead of attaching. *Pinned in Task 13 and Task 14.*

## Design fidelity checks

| Rule (source) | Where it is enforced |
| --- | --- |
| Picked part in `pick` at 0.22 fill plus edges; region as a `pick` box (Refine `.pick-fill`/`.pick-ring`, tokens.json `pick`) | Task 9: `PickHighlight` takes the `pick` token from `useTokens`; `PICK_FILL_OPACITY = 0.22` is asserted in `src/viewer/PickHighlight.test.ts` |
| Editor pick lines use `accent-soft` and a 2 px `accent` rule (screens.css `.cl.is-pick`) | Task 10: `src/editor/pickExtension.test.ts` asserts `cm-pick-line` on exactly the picked lines; the theme entry uses the two tokens |
| Popover is `panel-raised`, `line` border, `shadow-pop`, `radius-lg` (tokens.json `panel-raised`, `shadow-pop`) | Task 8: `PickPopover.test.tsx` asserts the classes |
| Popover shows label, "kind · lines a–b", summary, **Ask AI**, **Show code** (Refine) | Task 8: `PickPopover.test.tsx` |
| "Tap empty space to clear · Esc" replaces the triangle caption while a part is picked (Refine `.viewer-bl`) | Task 9 Viewer; asserted end to end in Task 18 |
| Composer chip `pc-chip is-pick` "label · lines a–b" with "Only this part will change" and a "Clear selected part" button (Refine) | Task 16: `PickChip.test.tsx` |
| Attach button: ghost icon button "Attach image or sketch", disabled with the reason when the profile has no vision (Main, spec) | Task 14: `AttachButton.test.tsx` |
| User images as `pc-msg-img` thumbnails above the bubble (PhoneChat) | Task 14: `MessageImages.test.tsx` |
| Sketch ground `inset`, grid `grid-minor`, ink strokes, `accent` dimensions with "40 mm" labels (PhoneSketch) | Task 15: `drawSketch` test records stroke and fill colours |
| Line ranges with the en dash and units on every number (README voice) | Task 2 `formatLines`, Task 6 `pickSummary` tests |
| No hex colours in `src/` (README "Colour") | The existing `noHardcodedColors` test covers every new file |

---

## File Structure

```
src/test/realOpenSCAD.ts          node-only loader for the pinned public/openscad build (wasmBinary from disk)
src/render/colourSurvival.test.ts D12 spike, kept as a regression test of the pinned build
src/scad/statements.ts            listTaggableStatements, listModuleDefinitions, resolveEditScope, statementKind, formatLines
src/scad/statements.test.ts
src/scad/tagging.ts               MAX_TAG, encodeTag, decodeTag, tagColor, tagCode
src/scad/tagging.test.ts
src/render/types.ts               MODIFY: RenderRequest.preview, MeshData.faceTags
src/render/stl.ts                 MODIFY: export meshFromPositions (was the private finalize)
src/render/off.ts                 parseOff(buffer, maxTag): MeshData with faceTags
src/render/off.test.ts
src/test/meshes.ts                meshOf() fixture builder
src/render/args.ts                MODIFY: PREVIEW_OUTPUT_PATH, toPreviewArgs
src/render/taggedPreview.ts       prepareTaggedSource(code)
src/render/runOpenSCAD.ts         MODIFY: tagged preview branch (tagged code, OFF, faceTags, empty STL)
src/render/runOpenSCAD.test.ts    MODIFY: append tagged-preview tests
src/render/taggedPreview.real.test.ts  real-WASM check of faceTags
src/render/render.worker.ts       MODIFY: transfer the faceTags buffer
src/render/threeMf.ts             ONLY IF the spike picks 3MF (alternate block in Task 5)
src/render/controller.ts          MODIFY: onStart(req)
src/render/controller.test.ts     MODIFY: append onStart test
src/render/useRenderLoop.ts       MODIFY: route tagged previews, request the follow-up
src/render/useRenderLoop.test.ts  MODIFY: count normal requests only
src/refine/refineStore.ts         Zustand: tags, pendingBase, pick, capture; partTagsState
src/refine/refineStore.test.ts
src/refine/taggedFollowUp.test.ts useRenderLoop + refine store integration
src/refine/pick.ts                isTap, resolvePick, connectedTriangles, trianglesBounds, subsetMesh, pickTitle, pickSummary, pickScope
src/refine/pick.test.ts
src/test/picks.ts                 partPickFixture, boxPickFixture
src/db/activeProfile.ts           getActiveProfile(database)
src/db/activeProfile.test.ts
src/refine/useVisionSupport.ts    live vision flag of the active profile
src/refine/focusComposer.ts       focuses the composer textarea
src/refine/useEscapeToClearPick.ts
src/refine/useEscapeToClearPick.test.ts
src/refine/PickPopover.tsx        label, caption, summary, Ask AI, Show code, no-vision callout
src/refine/PickPopover.test.tsx
src/ui/icons.ts                   MODIFY: M5 icons
src/viewer/PickHighlight.tsx      overlay mesh + edges, or region box
src/viewer/PickHighlight.test.ts
src/viewer/ViewportCapture.tsx    registers a PNG capture of the live viewport
src/viewer/Viewer.tsx             MODIFY: picking, highlight, popover, hint, data-part-tags
src/refine/useRefineSync.ts       clears the pick on code or mesh change
src/refine/useRefineSync.test.ts
src/editor/pickExtension.ts       setPickLines effect + cm-pick-line decorations
src/editor/pickExtension.test.ts
src/editor/theme.ts               MODIFY: .cm-pick-line style
src/editor/CodeEditor.tsx         MODIFY: pick prop
src/App.tsx                       MODIFY: useRefineSync, CodeEditor pick
src/App.test.tsx                  MODIFY: append pick highlight test
src/ai/scope.ts                   scopeInstruction, changedOutsideRange, scopeCorrection, scopeRejected, withCorrection, addUsage
src/ai/scopedEdits.test.ts
src/ai/prompt.ts                  MODIFY: buildSystemPrompt appends the scope rule
src/ai/runTurn.ts                 MODIFY: generateCode enforces the scope with one retry
src/ai/contentParts.ts            toOpenAiContent, toAnthropicContent
src/ai/contentParts.test.ts
src/ai/imageParts.test.ts         adapters send image parts (via createProvider)
src/ai/<openai-compatible adapter>.ts, src/ai/<anthropic adapter>.ts   MODIFY: map message content
src/images/prepareImage.ts        fitWithin, outputTypeFor, prepareImage, browserCodec
src/images/prepareImage.test.ts
src/images/base64.ts              blobToBase64, dataUrlToBlob
src/images/base64.test.ts
src/images/imageData.ts           imageDataToPng
src/db/images.ts                  saveImage, loadImage
src/db/images.test.ts
src/images/attachments.ts         Zustand: pending images, errors, limits
src/images/attachments.test.ts
src/images/AttachButton.tsx       attach menu (Image from device, Sketch) + hidden file input
src/images/AttachButton.test.tsx
src/images/AttachmentTray.tsx     pending thumbnails + error callout
src/images/AttachmentTray.test.tsx
src/images/useImageDropAndPaste.ts
src/images/useImageDropAndPaste.test.tsx
src/images/MessageImages.tsx      stored thumbnails in a chat message
src/images/MessageImages.test.tsx
src/sketch/sketchModel.ts         items, reducer, hit test, dimLabel, drawSketch
src/sketch/sketchModel.test.ts
src/sketch/exportSketch.ts        sketchColors, exportSketchPng, attachSketch
src/sketch/exportSketch.test.ts
src/sketch/SketchDialog.tsx       PhoneSketch screen
src/sketch/SketchDialog.test.tsx
src/refine/turnInput.ts           prepareTurnInput (text, images, pick → userText, selection, imageBlobIds)
src/refine/turnInput.test.ts
src/refine/PickChip.tsx           composer chip
src/refine/PickChip.test.tsx
src/chat/Composer.tsx             MODIFY (M2 file): pick chip, attachment tray, attach button, sketch dialog
src/chat/ChatPanel.tsx            MODIFY (M2 file): paste and drop onto the chat, message thumbnails
src/chat/sendPrompt.ts            MODIFY (M2 file): prepareTurnInput, selection, imageBlobIds, visual check
<settings page, Rendering section> MODIFY (M3 file): VisualCheckSetting
src/db/db.ts                      MODIFY: Settings.visualCheck, DEFAULT_SETTINGS.visualCheck = false
src/db/visualCheck.ts             getVisualCheck, setVisualCheck, recordVisualCheckUsage
src/db/visualCheck.test.ts
src/refine/visualCheck.ts         runVisualCheck, maybeVisualCheck, renderIsoImage
src/refine/visualCheck.test.ts
src/settings/VisualCheckSetting.tsx
src/settings/VisualCheckSetting.test.tsx
e2e/refine.spec.ts                fake LLM: pick, scoped edit, image part
```

---
### Task 1: Spike — colour survival through Manifold CSG in the pinned build (D12)

**Files:**
- Create: `src/test/realOpenSCAD.ts`
- Test: `src/render/colourSurvival.test.ts`

**Interfaces:**
- Consumes: `OpenSCADFactory`, `OpenSCADFactoryOptions`, `OpenSCADInstance` from `src/render/runOpenSCAD.ts` (M1); `public/openscad/openscad.js` and `openscad.wasm` installed by `npm run fetch:openscad` (pinned URL and SHA-256 in `scripts/fetch-openscad.ts`); `fflate` (devDependency).
- Produces:
  - `REAL_OPENSCAD_AVAILABLE: boolean`
  - `loadRealOpenSCAD(): Promise<OpenSCADFactory>` (node only; passes the WASM bytes as `wasmBinary`, so nothing is fetched)
  - The D12 decision, recorded in the test file's header comment and enforced by its assertions.

This task is a measurement, not a feature: the test states what the pinned build does, and stays in the suite so a deliberate WASM bump that breaks colour survival fails loudly. The cases were run once while writing this plan against `OpenSCAD-2026.10.08-WebAssembly-web.zip` and the expectations below are those results: OFF writes per-face colours as integer `r g b` bytes; colours survive `difference` (subtracted faces keep the subtrahend's colour), `union`, `intersection`, `translate`/`rotate`, `for`, `linear_extrude`, and `hull`/`minkowski` when the colour is applied outside them; colours applied to children *inside* `hull`/`minkowski` are lost (the default colour comes out); an outer `color()` overrides inner ones; untagged geometry keeps OpenSCAD's default colour, which is not one of our tags. 3MF keeps the same colours through `<basematerials>`.

**Decision rule.** Use OFF if colours survive `difference`, `union`, `translate` and `for` in OFF. Otherwise use 3MF if they survive there (follow the alternate block in Task 5). `hull`/`minkowski` children losing colour is expected and handled by the bounding-box fallback (Task 6). If both formats lose colours through `difference`/`union`, stop and report: click-to-refine then needs a different design.

- [ ] **Step 1: Write the node loader for the pinned build**

`src/test/realOpenSCAD.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { OpenSCADFactory, OpenSCADFactoryOptions, OpenSCADInstance } from '../render/runOpenSCAD'

const DIR = fileURLToPath(new URL('../../public/openscad/', import.meta.url))

/** True when `npm run fetch:openscad` has installed the pinned build. CI installs it before `npm test`. */
export const REAL_OPENSCAD_AVAILABLE = existsSync(`${DIR}openscad.js`) && existsSync(`${DIR}openscad.wasm`)

type EmscriptenFactory = (opts: OpenSCADFactoryOptions & { wasmBinary: Uint8Array }) => Promise<OpenSCADInstance>

let cached: Promise<OpenSCADFactory> | null = null

/** Node-only: loads public/openscad/openscad.js and hands it the WASM bytes, so it never fetches. */
export function loadRealOpenSCAD(): Promise<OpenSCADFactory> {
  cached ??= (async () => {
    if (!REAL_OPENSCAD_AVAILABLE) throw new Error('public/openscad/ is missing: run npm run fetch:openscad')
    const mod = (await import(/* @vite-ignore */ pathToFileURL(`${DIR}openscad.js`).href)) as { default: EmscriptenFactory }
    const wasmBinary = new Uint8Array(readFileSync(`${DIR}openscad.wasm`))
    return (opts: OpenSCADFactoryOptions) => mod.default({ ...opts, wasmBinary })
  })()
  return cached
}
```

- [ ] **Step 2: Write the spike test**

`src/render/colourSurvival.test.ts`:

```ts
// @vitest-environment node
/**
 * D12 spike: which export format keeps per-face colour through Manifold CSG in the pinned OpenSCAD build?
 *
 * Decision rule: use OFF when colours survive difference, union, translate and for in OFF; otherwise 3MF.
 * Colours on children inside hull() and minkowski() are expected to be lost (bounding-box fallback).
 *
 * Recorded 2026-10-11 against OpenSCAD-2026.10.08-WebAssembly-web.zip: OFF keeps colours. Decision: OFF.
 * The test stays in the suite so a deliberate WASM bump that breaks colour survival fails here first.
 */
import { unzipSync } from 'fflate'
import { loadRealOpenSCAD, REAL_OPENSCAD_AVAILABLE } from '../test/realOpenSCAD'

type Format = 'off' | '3mf'

/** Tag n as the colour [0, 0, n / 255], the same encoding Task 3 uses for small ids. */
const T = (n: number, body: string) => `color([0, 0, ${n} / 255]) ${body}`

async function faceColours(code: string, format: Format): Promise<Map<string, number>> {
  const factory = await loadRealOpenSCAD()
  const logs: string[] = []
  const inst = await factory({ noInitialRun: true, print: (t) => logs.push(t), printErr: (t) => logs.push(t) })
  inst.FS.writeFile('/main.scad', code)
  const out = `/out.${format}`
  let exitCode: number
  try {
    exitCode = inst.callMain(['/main.scad', '-o', out, '--backend=manifold', `--export-format=${format}`])
  } catch (e) {
    exitCode = (e as { status?: number }).status ?? -1
  }
  if (exitCode !== 0) throw new Error(`OpenSCAD exited with ${exitCode}:\n${logs.join('\n')}`)
  const bytes = inst.FS.readFile(out)
  return format === 'off' ? offColours(bytes) : threeMfColours(bytes)
}

/** Face colour histogram of an OFF file, keyed "r g b" in 0–255 ("none" for faces without a colour). */
function offColours(bytes: Uint8Array): Map<string, number> {
  const lines = new TextDecoder()
    .decode(bytes)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
  const [nv, nf] = lines[1].split(/\s+/).map(Number)
  const counts = new Map<string, number>()
  for (const line of lines.slice(2 + nv, 2 + nv + nf)) {
    const parts = line.split(/\s+/)
    const n = Number(parts[0])
    const rgb = parts.slice(1 + n, 4 + n)
    const key =
      rgb.length === 3 ? rgb.map((c) => String(Math.round(c.includes('.') ? Number(c) * 255 : Number(c)))).join(' ') : 'none'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** Face colour histogram of a 3MF file (one basematerials group, triangle p1 or the object's pindex). */
function threeMfColours(bytes: Uint8Array): Map<string, number> {
  const xml = new TextDecoder().decode(unzipSync(bytes)['3D/3dmodel.model'])
  const bases = [...xml.matchAll(/<base\b[^>]*displaycolor="#([0-9A-Fa-f]{6})/g)].map((m) => {
    const v = parseInt(m[1], 16)
    return `${(v >> 16) & 255} ${(v >> 8) & 255} ${v & 255}`
  })
  const objectDefault = Number(/<object\b[^>]*\bpindex="(\d+)"/.exec(xml)?.[1] ?? 0)
  const counts = new Map<string, number>()
  for (const m of xml.matchAll(/<triangle\b([^>]*)\/>/g)) {
    const p1 = /\bp1="(\d+)"/.exec(m[1])?.[1]
    const key = bases[p1 === undefined ? objectDefault : Number(p1)] ?? 'none'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** The small tag ids (colour 0 0 n) present in a histogram, sorted. */
function tagsIn(colours: Map<string, number>): number[] {
  return [...colours.keys()]
    .map((k) => k.split(' ').map(Number))
    .filter(([r, g, b]) => r === 0 && g === 0 && b >= 1 && b <= 9)
    .map(([, , b]) => b)
    .sort((a, b) => a - b)
}

const SURVIVES: Record<string, string> = {
  'difference (children tagged)': `difference() { ${T(1, 'cube(20);')} ${T(2, 'translate([10, 10, -1]) cylinder(h = 30, r = 4, $fn = 16);')} }`,
  'union (implicit, top level)': `${T(1, 'cube(10);')} ${T(2, 'translate([5, 5, 5]) cube(10);')}`,
  'union (explicit)': `union() { ${T(1, 'cube(10);')} ${T(2, 'translate([5, 5, 5]) cube(10);')} }`,
  intersection: `intersection() { ${T(1, 'cube(10);')} ${T(2, 'translate([5, 5, 5]) cube(10);')} }`,
  'translate and rotate': `${T(1, 'translate([5, 0, 0]) rotate([0, 0, 45]) cube(10);')} ${T(2, 'translate([30, 0, 0]) sphere(3, $fn = 12);')}`,
  'for loop': `${T(1, 'for (i = [0 : 3]) translate([i * 12, 0, 0]) cube(5);')} ${T(2, 'translate([0, 20, 0]) cube(3);')}`,
  linear_extrude: `${T(1, 'linear_extrude(5) square(10);')} ${T(2, 'translate([20, 0, 0]) cube(3);')}`,
  'hull (tagged from outside)': `${T(1, 'hull() { cube(5); translate([10, 0, 0]) sphere(2, $fn = 8); }')} ${T(2, 'translate([30, 0, 0]) cube(3);')}`,
  'minkowski (tagged from outside)': `${T(1, 'minkowski() { cube(5); sphere(1, $fn = 8); }')} ${T(2, 'translate([30, 0, 0]) cube(3);')}`,
}

const LOST: Record<string, string> = {
  'hull (children tagged)': `hull() { ${T(1, 'cube(5);')} ${T(2, 'translate([10, 0, 0]) sphere(2, $fn = 8);')} }`,
  'minkowski (children tagged)': `minkowski() { ${T(1, 'cube(5);')} ${T(2, 'sphere(1, $fn = 8);')} }`,
}

describe.runIf(REAL_OPENSCAD_AVAILABLE || Boolean(process.env.CI))('D12: face colours in the pinned OpenSCAD build', () => {
  it.each(Object.entries(SURVIVES))('OFF keeps both tags through %s', async (_name, code) => {
    expect(tagsIn(await faceColours(code, 'off'))).toEqual([1, 2])
  }, 60_000)

  it.each(Object.entries(LOST))('OFF loses tags on children inside %s (bounding-box fallback)', async (_name, code) => {
    expect(tagsIn(await faceColours(code, 'off'))).toEqual([])
  }, 60_000)

  it('an outer tag overrides the user\'s own colour inside it', async () => {
    const colours = await faceColours(T(1, 'color("red") cube(5);'), 'off')
    expect([...colours.keys()]).toEqual(['0 0 1'])
  }, 60_000)

  it('an outer tag on a boolean overrides tags on its children, so tags must never nest', async () => {
    const code = T(1, `difference() { cube(20); ${T(2, 'translate([10, 10, -1]) cylinder(h = 30, r = 4, $fn = 16);')} }`)
    expect(tagsIn(await faceColours(code, 'off'))).toEqual([1])
  }, 60_000)

  it('untagged geometry keeps a colour that is not one of our tags', async () => {
    const colours = await faceColours(`${T(1, 'cube(10);')} translate([20, 0, 0]) cube(3);`, 'off')
    expect(tagsIn(colours)).toEqual([1])
    expect(colours.size).toBe(2)
    expect(colours.has('none')).toBe(false)
  }, 60_000)

  it('3MF keeps both tags through difference (fallback format)', async () => {
    expect(tagsIn(await faceColours(SURVIVES['difference (children tagged)'], '3mf'))).toEqual([1, 2])
  }, 60_000)
})
```

- [ ] **Step 3: Run the spike**

Run: `npm run fetch:openscad -- --if-missing && npx vitest run src/render/colourSurvival.test.ts`
Expected: PASS (15 tests). This is a measurement, so it passes on the first run when the pinned build behaves as recorded. If the import of `openscad.js` fails inside Vitest, check the path printed in the error; the module is plain ESM and loads in Node 24 (it was run with `node` while writing this plan).

If any `OFF keeps both tags` case fails for `difference`, `union`, `translate and rotate` or `for loop`: change the header comment's last line to the observed result, switch the decision to 3MF per the decision rule, and use the alternate block in Task 5. Other failures (for example `linear_extrude`) only change the header comment and the "Deferred beyond v1" notes; keep OFF.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/test/realOpenSCAD.ts src/render/colourSurvival.test.ts
git commit -m "test(render): D12 spike, face colours survive Manifold CSG in OFF" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Taggable statements and edit scopes

**Files:**
- Create: `src/scad/statements.ts`
- Test: `src/scad/statements.test.ts`

**Interfaces:**
- Consumes: `lex(code): Token[]`, `Token { kind; text; start; end; line }` from `src/scad/lexer.ts` (M3).
- Produces (the first two are the shared contract):
  - `interface StatementRange { tag: number; label: string; startLine: number; endLine: number; start: number; end: number }`
  - `listTaggableStatements(code: string): StatementRange[]`: top-level statements, except that a top-level `union`/`difference`/`intersection` with a braced body contributes its children instead (an outer tag would override inner tags, Task 1). Skips module and function definitions, assignments (including `$fn = …`), `include`/`use`, `echo`/`assert`, disabled (`*`) statements and empty `;`. A `for` loop is one statement; `if … else …` is one statement. Tags are `1..N` in source order. `start` includes leading modifiers (`#`, `%`, `!`); `end` is the offset after the closing `;` or `}`.
  - `interface LineRange { startLine: number; endLine: number }`
  - `interface ModuleDefinition extends LineRange { name: string; start: number; end: number }`, `listModuleDefinitions(code): ModuleDefinition[]`
  - `resolveEditScope(code: string, statement: StatementRange): LineRange`: the module definition's lines when the statement's label is a module defined in this file and called exactly once; otherwise the statement's own lines.
  - `statementKind(code, statement): string`: `"module call"` for a call to a module defined in this file, else the label.
  - `formatLines(range: LineRange): string`: `"line 2"` or `"lines 15–17"` (en dash).

Labels: the last call in the statement that names a module defined in this file; otherwise the first call that is not a transform (`translate`, `rotate`, `scale`, `mirror`, `multmatrix`, `color`, `resize`, `offset`, `render`); `for`/`intersection_for` become "for loop", `if` becomes "if block", a bare `{ … }` becomes "block". The scanner counts brackets character by character inside `punct` tokens, so it works whether the M3 lexer emits `);` as one token or two; block children are scanned between the brace tokens, which assumes `{` and `}` are their own tokens (see "Contract issues").

- [ ] **Step 1: Write the failing test**

`src/scad/statements.test.ts`:

```ts
import {
  formatLines,
  listModuleDefinitions,
  listTaggableStatements,
  resolveEditScope,
  statementKind,
} from './statements'

const HOLDER = [
  '/* [Size] */', //                         1
  'slots = 4; // [1:8]', //                  2
  '$fn = 48;', //                            3
  'include <lib/parts.scad>', //             4
  'use <other.scad>', //                     5
  '', //                                     6
  'module body() {', //                      7
  '  difference() {', //                     8
  '    cube([40, 20, 10]);', //              9
  '    for (i = [0 : slots - 1])', //        10
  '      translate([5 + i * 10, 10, 2])', // 11
  '        cylinder(h = 10, d = 6);', //     12
  '  }', //                                  13
  '}', //                                    14
  '', //                                     15
  'function pitch(n) = n * 10;', //          16
  'echo("pitch", pitch(2));', //             17
  '*sphere(50);', //                         18
  'body();', //                              19
  'translate([0, -5, 0])', //                20
  '  cube([40, 2, 2]); // rail', //          21
].join('\n')

const ASSEMBLY = [
  'module plate() { cube([40, 40, 10]); }', //                         1
  'module peg() { translate([15, 15, 10]) cube([10, 10, 10]); }', //   2
  'difference() {', //                                                 3
  '  plate();', //                                                     4
  '  // the bores }', //                                               5
  '  for (i = [0 : 3])', //                                            6
  '    translate([5 + i * 10, 5, -1])', //                             7
  '      cylinder(h = 12, d = 3);', //                                 8
  '  #peg();', //                                                      9
  '}', //                                                              10
].join('\n')

describe('listTaggableStatements', () => {
  it('lists top-level geometry and skips definitions, assignments, includes, echo and disabled statements', () => {
    const railStart = HOLDER.indexOf('translate([0, -5')
    const railEnd = HOLDER.indexOf('2]); // rail') + 4
    expect(listTaggableStatements(HOLDER)).toEqual([
      { tag: 1, label: 'body', startLine: 19, endLine: 19, start: HOLDER.indexOf('body();'), end: HOLDER.indexOf('body();') + 7 },
      { tag: 2, label: 'cube', startLine: 20, endLine: 21, start: railStart, end: railEnd },
    ])
  })

  it('lists the children of a top-level boolean instead of the boolean, with modifiers inside the range', () => {
    const statements = listTaggableStatements(ASSEMBLY)
    expect(statements.map(({ tag, label, startLine, endLine }) => ({ tag, label, startLine, endLine }))).toEqual([
      { tag: 1, label: 'plate', startLine: 4, endLine: 4 },
      { tag: 2, label: 'for loop', startLine: 6, endLine: 8 },
      { tag: 3, label: 'peg', startLine: 9, endLine: 9 },
    ])
    expect(ASSEMBLY.slice(statements[2].start, statements[2].end)).toBe('#peg();')
  })

  it('keeps an empty boolean as one statement', () => {
    expect(listTaggableStatements('difference() {}\n').map((s) => s.label)).toEqual(['difference'])
  })

  it('does not expand booleans below the top level', () => {
    const code = 'difference() {\n  union() { cube(5); sphere(3); }\n  cylinder(h = 9, r = 1);\n}\n'
    expect(listTaggableStatements(code).map((s) => [s.label, s.startLine])).toEqual([
      ['union', 2],
      ['cylinder', 3],
    ])
  })

  it('treats if/else as one statement and labels it', () => {
    expect(listTaggableStatements('if (big) cube(10); else sphere(2);\n')).toMatchObject([
      { tag: 1, label: 'if block', startLine: 1, endLine: 1 },
    ])
  })

  it('ignores brackets and semicolons inside strings and comments', () => {
    const code = 'text("a;b}{", size = 5); // ) ; {\ncube(1);\n'
    expect(listTaggableStatements(code).map((s) => s.label)).toEqual(['text', 'cube'])
  })

  it('labels by the user module, else the first non-transform call', () => {
    const code = 'module part() cube(1);\ncolor("red") translate([1, 0, 0]) part();\nrotate([0, 0, 45]) linear_extrude(3) square(4);\n'
    expect(listTaggableStatements(code).map((s) => s.label)).toEqual(['part', 'linear_extrude'])
  })

  it('still lists a final statement without a semicolon', () => {
    expect(listTaggableStatements('cube(1);\nsphere(2)').map((s) => s.label)).toEqual(['cube', 'sphere'])
  })

  it('returns nothing for code without geometry', () => {
    expect(listTaggableStatements('// nothing\nw = 3;\necho(w);\n')).toEqual([])
  })
})

describe('module definitions and edit scopes', () => {
  it('lists module definitions with their lines', () => {
    expect(listModuleDefinitions(HOLDER).map(({ name, startLine, endLine }) => ({ name, startLine, endLine }))).toEqual([
      { name: 'body', startLine: 7, endLine: 14 },
    ])
  })

  it('scopes a call to a module used once to the module definition', () => {
    const [plate, loop, peg] = listTaggableStatements(ASSEMBLY)
    expect(resolveEditScope(ASSEMBLY, plate)).toEqual({ startLine: 1, endLine: 1 })
    expect(resolveEditScope(ASSEMBLY, peg)).toEqual({ startLine: 2, endLine: 2 })
    expect(resolveEditScope(ASSEMBLY, loop)).toEqual({ startLine: 6, endLine: 8 })
    expect(resolveEditScope(HOLDER, listTaggableStatements(HOLDER)[0])).toEqual({ startLine: 7, endLine: 14 })
  })

  it('scopes a call to a module used more than once to the call itself', () => {
    const code = 'module m() cube(1);\nm();\ntranslate([5, 0, 0]) m();\n'
    const [first, second] = listTaggableStatements(code)
    expect(resolveEditScope(code, first)).toEqual({ startLine: 2, endLine: 2 })
    expect(resolveEditScope(code, second)).toEqual({ startLine: 3, endLine: 3 })
  })

  it('names the kind of a statement for the popover', () => {
    const [plate, loop] = listTaggableStatements(ASSEMBLY)
    expect(statementKind(ASSEMBLY, plate)).toBe('module call')
    expect(statementKind(ASSEMBLY, loop)).toBe('for loop')
    expect(statementKind('cylinder(h = 2, r = 1);', listTaggableStatements('cylinder(h = 2, r = 1);')[0])).toBe('cylinder')
  })
})

describe('formatLines', () => {
  it('uses the singular for one line and an en dash for a range', () => {
    expect(formatLines({ startLine: 2, endLine: 2 })).toBe('line 2')
    expect(formatLines({ startLine: 15, endLine: 17 })).toBe('lines 15–17')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/scad/statements.test.ts`
Expected: FAIL, because `./statements` cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

`src/scad/statements.ts`:

```ts
import { lex, type Token } from './lexer'

export interface StatementRange {
  tag: number
  label: string
  startLine: number
  endLine: number
  start: number
  end: number
}

export interface LineRange {
  startLine: number
  endLine: number
}

export interface ModuleDefinition extends LineRange {
  name: string
  start: number
  end: number
}

const BOOLEANS = new Set(['union', 'difference', 'intersection'])
const TRANSFORMS = new Set(['translate', 'rotate', 'scale', 'mirror', 'multmatrix', 'color', 'resize', 'offset', 'render'])
const NO_GEOMETRY = new Set(['echo', 'assert'])
const OPENERS = '([{'
const CLOSERS = ')]}'

type Kind = 'object' | 'module' | 'function' | 'include' | 'assignment'

interface Scanned {
  kind: Kind
  /** Index of the first and last significant token. */
  first: number
  last: number
  /** Call names at bracket depth 0, in order: `translate([..]) cube(..)` → ['translate', 'cube']. */
  names: string[]
  /** Index of the first `{` at depth 0, if any. */
  blockOpen: number | null
  disabled: boolean
  defName: string | null
}

interface Parsed {
  toks: Token[]
  top: Scanned[]
  modules: Set<string>
  lineAt(offset: number): number
}

function significant(code: string): Token[] {
  return lex(code).filter((t) => t.kind !== 'comment' && t.kind !== 'whitespace' && t.kind !== 'eof')
}

function isPunct(t: Token | undefined, text: string): boolean {
  return t?.kind === 'punct' && t.text === text
}

function lineLocator(code: string): (offset: number) => number {
  const starts = [0]
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1)
  return (offset) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

/** The token ending the statement that starts at `i`: a `;` or the `}` that closes its block at depth 0. `else` continues it. */
function statementEnd(toks: Token[], i: number, limit: number): number {
  let depth = 0
  for (let j = i; j < limit; j++) {
    const t = toks[j]
    if (t.kind !== 'punct') continue
    let ended = false
    for (const ch of t.text) {
      if (OPENERS.includes(ch)) depth++
      else if (CLOSERS.includes(ch)) {
        depth--
        if (ch === '}' && depth === 0) ended = true
      } else if (ch === ';' && depth === 0) ended = true
    }
    const next = toks[j + 1]
    if (ended && !(next?.kind === 'ident' && next.text === 'else')) return j
  }
  return limit - 1
}

function matchingClose(toks: Token[], open: number, limit: number): number {
  let depth = 0
  for (let j = open; j < limit; j++) {
    const t = toks[j]
    if (t.kind !== 'punct') continue
    for (const ch of t.text) {
      if (OPENERS.includes(ch)) depth++
      else if (CLOSERS.includes(ch)) depth--
    }
    if (depth === 0) return j
  }
  return limit
}

function classify(toks: Token[], first: number, last: number): Scanned {
  const empty = { first, last, names: [], blockOpen: null, disabled: false, defName: null }
  const head = toks[first]
  if (head.kind === 'ident' && head.text === 'module') return { ...empty, kind: 'module', defName: toks[first + 1]?.text ?? null }
  if (head.kind === 'ident' && head.text === 'function') return { ...empty, kind: 'function', defName: toks[first + 1]?.text ?? null }

  let i = first
  let disabled = false
  while (i <= last && toks[i].kind === 'punct' && /^[!#%*]+$/.test(toks[i].text)) {
    if (toks[i].text.includes('*')) disabled = true
    i++
  }

  const names: string[] = []
  let blockOpen: number | null = null
  let depth = 0
  for (let j = i; j <= last; j++) {
    const t = toks[j]
    if (t.kind === 'punct') {
      const isAssign = t.text.startsWith('=') && t.text !== '==' && !isPunct(toks[j + 1], '=')
      if (depth === 0 && names.length === 0 && isAssign) return { ...empty, kind: 'assignment' }
      if (depth === 0 && blockOpen === null && t.text.startsWith('{')) blockOpen = j
      for (const ch of t.text) {
        if (OPENERS.includes(ch)) depth++
        else if (CLOSERS.includes(ch)) depth--
      }
    } else if (t.kind === 'ident' && depth === 0) {
      const next = toks[j + 1]
      if (next?.kind === 'punct' && next.text.startsWith('(')) names.push(t.text)
    }
  }
  return { ...empty, kind: 'object', names, blockOpen, disabled }
}

function scanStatements(toks: Token[], from: number, to: number): Scanned[] {
  const out: Scanned[] = []
  let i = from
  while (i < to) {
    const t = toks[i]
    if (isPunct(t, ';')) {
      i++
      continue
    }
    if (t.kind === 'ident' && (t.text === 'include' || t.text === 'use') && toks[i + 1]?.text.startsWith('<')) {
      let j = i
      while (j + 1 < to && toks[j + 1].line === t.line) j++
      out.push({ kind: 'include', first: i, last: j, names: [], blockOpen: null, disabled: false, defName: null })
      i = j + 1
      continue
    }
    const last = statementEnd(toks, i, to)
    out.push(classify(toks, i, last))
    i = last + 1
  }
  return out
}

function parse(code: string): Parsed {
  const toks = significant(code)
  const top = scanStatements(toks, 0, toks.length)
  const modules = new Set(top.flatMap((s) => (s.kind === 'module' && s.defName ? [s.defName] : [])))
  return { toks, top, modules, lineAt: lineLocator(code) }
}

function isGeometry(s: Scanned): boolean {
  if (s.kind !== 'object' || s.disabled) return false
  return !(s.names.length > 0 && s.names.every((n) => NO_GEOMETRY.has(n)))
}

function labelFor(names: string[], modules: ReadonlySet<string>): string {
  const userModule = [...names].reverse().find((n) => modules.has(n))
  if (userModule) return userModule
  const first = names.find((n) => !TRANSFORMS.has(n)) ?? names[0]
  if (first === undefined) return 'block'
  if (first === 'for' || first === 'intersection_for') return 'for loop'
  if (first === 'if') return 'if block'
  return first
}

export function listTaggableStatements(code: string): StatementRange[] {
  const { toks, top, modules, lineAt } = parse(code)
  const chosen: Scanned[] = []
  for (const s of top) {
    if (!isGeometry(s)) continue
    const lastName = s.names.at(-1)
    if (lastName !== undefined && BOOLEANS.has(lastName) && s.blockOpen !== null) {
      const close = matchingClose(toks, s.blockOpen, s.last + 1)
      const children = scanStatements(toks, s.blockOpen + 1, close).filter(isGeometry)
      if (children.length > 0) {
        chosen.push(...children)
        continue
      }
    }
    chosen.push(s)
  }
  return chosen.map((s, i) => {
    const start = toks[s.first].start
    const end = toks[s.last].end
    return {
      tag: i + 1,
      label: labelFor(s.names, modules),
      startLine: lineAt(start),
      endLine: lineAt(Math.max(start, end - 1)),
      start,
      end,
    }
  })
}

export function listModuleDefinitions(code: string): ModuleDefinition[] {
  const { toks, top, lineAt } = parse(code)
  return top.flatMap((s) => {
    if (s.kind !== 'module' || s.defName === null) return []
    const start = toks[s.first].start
    const end = toks[s.last].end
    return [{ name: s.defName, start, end, startLine: lineAt(start), endLine: lineAt(Math.max(start, end - 1)) }]
  })
}

function countModuleCalls(code: string, name: string): number {
  const toks = significant(code)
  let calls = 0
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    const next = toks[i + 1]
    const prev = toks[i - 1]
    const isDefinition = prev?.kind === 'ident' && prev.text === 'module'
    if (t.kind === 'ident' && t.text === name && next?.kind === 'punct' && next.text.startsWith('(') && !isDefinition) calls++
  }
  return calls
}

export function resolveEditScope(code: string, statement: StatementRange): LineRange {
  const definition = listModuleDefinitions(code).find((d) => d.name === statement.label)
  if (definition && countModuleCalls(code, definition.name) === 1) {
    return { startLine: definition.startLine, endLine: definition.endLine }
  }
  return { startLine: statement.startLine, endLine: statement.endLine }
}

export function statementKind(code: string, statement: StatementRange): string {
  return listModuleDefinitions(code).some((d) => d.name === statement.label) ? 'module call' : statement.label
}

export function formatLines({ startLine, endLine }: LineRange): string {
  return startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/scad/statements.test.ts && npm run typecheck`
Expected: PASS (14 tests), no type errors. If a case fails only because the M3 lexer classifies something differently from the assumptions above (for example `$fn` split into `$` and `fn`, or `<lib/parts.scad>` lexed as a string), fix the scanner, not the expectation.

- [ ] **Step 5: Commit**

```bash
git add src/scad/statements.ts src/scad/statements.test.ts
git commit -m "feat(scad): list taggable statements and resolve edit scopes for click-to-refine" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Tag colour encoding and tagged code

**Files:**
- Create: `src/scad/tagging.ts`
- Test: `src/scad/tagging.test.ts`

**Interfaces:**
- Consumes: `StatementRange`, `listTaggableStatements` (Task 2).
- Produces:
  - `MAX_TAG = 16_777_214` (white, 16,777,215, is never a tag)
  - `encodeTag(tag: number): [number, number, number]`: the three bytes of `tag`, red most significant; throws `RangeError` outside `1..MAX_TAG` or for non-integers.
  - `decodeTag(r: number, g: number, b: number, maxTag: number): number`: rounds and clamps each channel to 0–255, packs them, and returns the tag when it is in `1..maxTag`, else `0` (default colour, user colours, anything not ours).
  - `tagColor(tag: number): string`: `color([r / 255, g / 255, b / 255])`.
  - `tagCode(code: string, statements: readonly StatementRange[]): string`: inserts `tagColor(tag) + ' '` at each statement's `start`; never adds or removes a newline, so error line numbers in the preview match the editor.

- [ ] **Step 1: Write the failing test**

`src/scad/tagging.test.ts`:

```ts
import { listTaggableStatements } from './statements'
import { decodeTag, encodeTag, MAX_TAG, tagCode, tagColor } from './tagging'

describe('encodeTag', () => {
  it('packs tag ids into the three colour bytes, red first', () => {
    expect(encodeTag(1)).toEqual([0, 0, 1])
    expect(encodeTag(70_000)).toEqual([1, 17, 112])
    expect(encodeTag(MAX_TAG)).toEqual([255, 255, 254])
  })

  it('rejects ids that do not fit or are not integers', () => {
    expect(() => encodeTag(0)).toThrow(RangeError)
    expect(() => encodeTag(MAX_TAG + 1)).toThrow(RangeError)
    expect(() => encodeTag(1.5)).toThrow(RangeError)
  })
})

describe('decodeTag', () => {
  it('reverses encodeTag', () => {
    expect(decodeTag(1, 17, 112, 70_000)).toBe(70_000)
  })

  it('tolerates float rounding in each channel', () => {
    expect(decodeTag(0.0004, 16.9996, 112.4, 70_000)).toBe(70_000)
    expect(decodeTag(-0.2, 0, 255.3, 255)).toBe(255)
  })

  it('returns 0 for colours that are not one of the known tags', () => {
    expect(decodeTag(249, 215, 44, 3)).toBe(0) // OpenSCAD's default colour
    expect(decodeTag(0, 0, 0, 3)).toBe(0)
    expect(decodeTag(0, 0, 4, 3)).toBe(0)
  })
})

describe('tagCode', () => {
  it('formats a colour OpenSCAD evaluates exactly', () => {
    expect(tagColor(258)).toBe('color([0 / 255, 1 / 255, 2 / 255])')
  })

  it('wraps each statement on its own line, before any modifier, without moving lines', () => {
    const code = 'w = 3;\ncube(w);\n#sphere(2);\n'
    const tagged = tagCode(code, listTaggableStatements(code))
    expect(tagged).toBe('w = 3;\ncolor([0 / 255, 0 / 255, 1 / 255]) cube(w);\ncolor([0 / 255, 0 / 255, 2 / 255]) #sphere(2);\n')
    expect(tagged.split('\n')).toHaveLength(code.split('\n').length)
  })

  it('wraps the children of a top-level boolean, not the boolean', () => {
    const code = 'difference() {\n  cube(10);\n  cylinder(h = 12, r = 2);\n}\n'
    expect(tagCode(code, listTaggableStatements(code))).toBe(
      'difference() {\n  color([0 / 255, 0 / 255, 1 / 255]) cube(10);\n  color([0 / 255, 0 / 255, 2 / 255]) cylinder(h = 12, r = 2);\n}\n',
    )
  })

  it('returns the code unchanged when nothing is taggable', () => {
    expect(tagCode('w = 1;\n', [])).toBe('w = 1;\n')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/scad/tagging.test.ts`
Expected: FAIL, because `./tagging` cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

`src/scad/tagging.ts`:

```ts
import type { StatementRange } from './statements'

/** 24-bit colours, minus 0 (untagged) and white. */
export const MAX_TAG = 16_777_214

export function encodeTag(tag: number): [number, number, number] {
  if (!Number.isInteger(tag) || tag < 1 || tag > MAX_TAG) throw new RangeError(`Tag ${tag} is outside 1–${MAX_TAG}`)
  return [(tag >> 16) & 255, (tag >> 8) & 255, tag & 255]
}

const channel = (v: number) => Math.min(255, Math.max(0, Math.round(v)))

export function decodeTag(r: number, g: number, b: number, maxTag: number): number {
  const packed = (channel(r) << 16) | (channel(g) << 8) | channel(b)
  return packed >= 1 && packed <= maxTag ? packed : 0
}

export function tagColor(tag: number): string {
  const [r, g, b] = encodeTag(tag)
  return `color([${r} / 255, ${g} / 255, ${b} / 255])`
}

/** Preview-only: the editor code is never changed. Insertions never add a newline, so line numbers stay put. */
export function tagCode(code: string, statements: readonly StatementRange[]): string {
  let out = code
  for (const s of [...statements].sort((a, b) => b.start - a.start)) {
    out = `${out.slice(0, s.start)}${tagColor(s.tag)} ${out.slice(s.start)}`
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/scad && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/scad/tagging.ts src/scad/tagging.test.ts
git commit -m "feat(scad): encode statement tags as colours and build the tagged preview code" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Render types and the coloured OFF parser

**Files:**
- Modify: `src/render/types.ts`, `src/render/stl.ts`
- Create: `src/render/off.ts`, `src/test/meshes.ts`
- Test: `src/render/off.test.ts`

**Interfaces:**
- Consumes: `decodeTag` (Task 3); `MeshData`, `Vec3` (M1).
- Produces:
  - Contract additions in `src/render/types.ts`: `RenderRequest.preview?: { tagged: true }`, `MeshData.faceTags?: Uint32Array`.
  - `meshFromPositions(positions: Float32Array): MeshData` exported from `src/render/stl.ts` (M1's private `finalize`, renamed): flat normals and bounds for a triangle soup.
  - `parseOff(buffer: ArrayBuffer, maxTag: number): MeshData`: accepts `OFF`/`COFF` headers with the counts on the header line or the next line, `#` comments, polygon faces (fan-triangulated), face colours as integers 0–255 or floats 0–1 (a `.` in any channel means floats), faces without a colour; every triangle gets `decodeTag(...)` or 0. Throws `'Unrecognised OFF data'`, `'Malformed OFF header'`, `'Malformed OFF vertex'`, `'Malformed OFF face'`.
  - Test helper `meshOf(triangles: number[][], faceTags?: number[]): MeshData` (each inner array is 9 numbers).

- [ ] **Step 1: Write the failing test**

`src/render/off.test.ts`:

```ts
import { parseOff } from './off'

const encode = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer

const OFF = [
  'OFF',
  '# written by a test',
  '5 3 0',
  '0 0 0',
  '10 0 0',
  '10 10 0',
  '0 10 0',
  '0 0 5',
  '3 0 1 2 0 0 1',
  '4 0 2 3 4 0 0 2',
  '3 0 1 4 249 215 44',
].join('\n')

it('reads vertices and fan-triangulates faces into a triangle soup', () => {
  const mesh = parseOff(encode(OFF), 2)
  expect(mesh.triangleCount).toBe(4)
  expect(Array.from(mesh.positions.slice(0, 9))).toEqual([0, 0, 0, 10, 0, 0, 10, 10, 0])
  expect(Array.from(mesh.positions.slice(9, 27))).toEqual([0, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 0, 0, 10, 0, 0, 0, 5])
  expect(mesh.bounds).toEqual({ min: [0, 0, 0], max: [10, 10, 5] })
  expect(mesh.normals).toHaveLength(mesh.positions.length)
})

it('decodes one tag per triangle, with 0 for colours that are not tags', () => {
  expect(Array.from(parseOff(encode(OFF), 2).faceTags ?? [])).toEqual([1, 2, 2, 0])
})

it('accepts float colours and counts on the header line', () => {
  const text = 'OFF 3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2 0 0 0.00392156862745098\n'
  expect(Array.from(parseOff(encode(text), 1).faceTags ?? [])).toEqual([1])
})

it('gives faces without a colour tag 0', () => {
  const text = 'OFF\n3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n'
  expect(Array.from(parseOff(encode(text), 5).faceTags ?? [])).toEqual([0])
})

it('rejects data that is not OFF', () => {
  expect(() => parseOff(encode('ply\nformat ascii 1.0\n'), 1)).toThrow('Unrecognised OFF data')
})

it('rejects a missing vertex and an out-of-range face index', () => {
  expect(() => parseOff(encode('OFF\n3 1 0\n0 0 0\n1 0 0\n'), 1)).toThrow('Malformed OFF vertex')
  expect(() => parseOff(encode('OFF\n3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 7\n'), 1)).toThrow('Malformed OFF face')
  expect(() => parseOff(encode('OFF\nx y z\n'), 1)).toThrow('Malformed OFF header')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/render/off.test.ts`
Expected: FAIL, because `./off` cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

In `src/render/types.ts`, replace the `RenderRequest` and `MeshData` interfaces with (keep any fields M3/M4 added, such as `libraries`):

```ts
export interface RenderRequest {
  code: string
  params?: Record<string, ParamValue>
  /** M5: render the click-to-refine preview: tagged code, coloured OFF export, `mesh.faceTags`, no STL. */
  preview?: { tagged: true }
}

export interface MeshData {
  /** Non-indexed triangle soup: 9 floats per triangle. */
  positions: Float32Array
  /** Flat per-face normals, same layout as positions. */
  normals: Float32Array
  triangleCount: number
  bounds: Bounds
  /** M5: one tag id per triangle, 0 = untagged. Only on tagged previews. */
  faceTags?: Uint32Array
}
```

In `src/render/stl.ts`, rename the private `function finalize(positions: Float32Array): MeshData` to `export function meshFromPositions(positions: Float32Array): MeshData` and update its two callers in `parseBinary` and `parseAscii` (`return meshFromPositions(positions)` and `return meshFromPositions(new Float32Array(nums))`). The body does not change.

`src/render/off.ts`:

```ts
import { decodeTag } from '../scad/tagging'
import { meshFromPositions } from './stl'
import type { MeshData } from './types'

function faceTag(colour: string[], maxTag: number): number {
  if (colour.length < 3) return 0
  const channels = colour.slice(0, 3)
  const values = channels.map(Number)
  if (values.some((v) => !Number.isFinite(v))) return 0
  const scale = channels.some((c) => c.includes('.')) ? 255 : 1
  return decodeTag(values[0] * scale, values[1] * scale, values[2] * scale, maxTag)
}

/** OpenSCAD's OFF export with per-face colours (the click-to-refine preview format, D12). */
export function parseOff(buffer: ArrayBuffer, maxTag: number): MeshData {
  const lines = new TextDecoder()
    .decode(buffer)
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter((l) => l !== '')
  const header = /^C?N?OFF\b/.exec(lines[0] ?? '')
  if (!header) throw new Error('Unrecognised OFF data')

  let cursor = 1
  const rest = lines[0].slice(header[0].length).trim()
  const counts = (rest !== '' ? rest : (lines[cursor++] ?? '')).split(/\s+/).map(Number)
  const [nv, nf] = counts
  if (!Number.isInteger(nv) || !Number.isInteger(nf) || nv < 0 || nf < 0) throw new Error('Malformed OFF header')

  const vertices = new Float64Array(nv * 3)
  for (let v = 0; v < nv; v++) {
    const p = (lines[cursor++] ?? '').split(/\s+/).slice(0, 3).map(Number)
    if (p.length < 3 || p.some((n) => !Number.isFinite(n))) throw new Error('Malformed OFF vertex')
    vertices.set(p, v * 3)
  }

  const positions: number[] = []
  const tags: number[] = []
  for (let f = 0; f < nf; f++) {
    const parts = (lines[cursor++] ?? '').split(/\s+/)
    const n = Number(parts[0])
    const index = parts.slice(1, 1 + n).map(Number)
    if (!Number.isInteger(n) || n < 3 || index.length !== n || index.some((i) => !Number.isInteger(i) || i < 0 || i >= nv)) {
      throw new Error('Malformed OFF face')
    }
    const tag = faceTag(parts.slice(1 + n), maxTag)
    for (let k = 1; k + 1 < n; k++) {
      for (const vi of [index[0], index[k], index[k + 1]]) positions.push(vertices[vi * 3], vertices[vi * 3 + 1], vertices[vi * 3 + 2])
      tags.push(tag)
    }
  }
  return { ...meshFromPositions(new Float32Array(positions)), faceTags: Uint32Array.from(tags) }
}
```

`src/test/meshes.ts`:

```ts
import { meshFromPositions } from '../render/stl'
import type { MeshData } from '../render/types'

/** A mesh from triangles of 9 numbers each, optionally with one tag per triangle. */
export function meshOf(triangles: number[][], faceTags?: number[]): MeshData {
  const mesh = meshFromPositions(Float32Array.from(triangles.flat()))
  return faceTags ? { ...mesh, faceTags: Uint32Array.from(faceTags) } : mesh
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/render && npm run typecheck`
Expected: PASS (6 new tests; the M1 STL tests still pass), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/render/types.ts src/render/stl.ts src/render/off.ts src/render/off.test.ts src/test/meshes.ts
git commit -m "feat(render): parse coloured OFF into a triangle soup with one tag per face" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Tagged preview in `runOpenSCAD` and the worker

**Files:**
- Modify: `src/render/args.ts`, `src/render/runOpenSCAD.ts`, `src/render/render.worker.ts`, `src/render/runOpenSCAD.test.ts`
- Create: `src/render/taggedPreview.ts`
- Test: `src/render/runOpenSCAD.test.ts` (appended), `src/render/taggedPreview.real.test.ts`

**Interfaces:**
- Consumes: `listTaggableStatements` (Task 2), `tagCode` (Task 3), `parseOff` (Task 4), `loadRealOpenSCAD` (Task 1), M1's `buildArgs`, `INPUT_PATH`, `OUTPUT_PATH`.
- Produces:
  - `PREVIEW_OUTPUT_PATH = '/out.off'`; `toPreviewArgs(args: string[]): string[]` (swaps the `-o` target for `PREVIEW_OUTPUT_PATH` and any `--export-format=…` for `--export-format=off`; every other argument, including `-D` overrides and M3's library arguments, is kept).
  - `prepareTaggedSource(code: string): { code: string; maxTag: number }`.
  - `runOpenSCAD(factory, req)` with `req.preview?.tagged`: writes the tagged code, exports OFF, returns `{ ok: true, mesh /* with faceTags */, stl: new ArrayBuffer(0), … }`. Untagged requests behave exactly as before.
  - The worker transfers `mesh.faceTags.buffer` along with the other buffers.

- [ ] **Step 1: Write the failing tests**

Append to `src/render/runOpenSCAD.test.ts` (it already defines `fakeFactory`, `writesBox` and imports `INPUT_PATH`; add `PREVIEW_OUTPUT_PATH` and `toPreviewArgs` to the `./args` import):

```ts
describe('tagged preview', () => {
  const TWO_PARTS = 'cube(10);\ntranslate([20, 0, 0]) cube(5);\n'
  const OFF_TWO = ['OFF', '4 2 0', '0 0 0', '10 0 0', '0 10 0', '20 0 0', '3 0 1 2 0 0 1', '3 1 3 2 0 0 2'].join('\n')

  it('renders tagged code to OFF and returns one tag per triangle and no STL', async () => {
    let seenArgs: string[] = []
    const { factory, created } = fakeFactory((inst, args) => {
      seenArgs = args
      inst.files.set(PREVIEW_OUTPUT_PATH, OFF_TWO)
      return 0
    })
    const result = await runOpenSCAD(factory, { code: TWO_PARTS, params: { w: 5 }, preview: { tagged: true } })

    expect(created[0].files.get(INPUT_PATH)).toBe(
      'color([0 / 255, 0 / 255, 1 / 255]) cube(10);\ncolor([0 / 255, 0 / 255, 2 / 255]) translate([20, 0, 0]) cube(5);\n',
    )
    expect(seenArgs).toEqual(expect.arrayContaining(['-o', PREVIEW_OUTPUT_PATH, '--export-format=off', '--backend=manifold', 'w=5']))
    expect(seenArgs).not.toContain('--export-format=binstl')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Array.from(result.mesh.faceTags ?? [])).toEqual([1, 2])
    expect(result.stl.byteLength).toBe(0)
  })

  it('reports unreadable preview output as a failed render', async () => {
    const { factory } = fakeFactory((inst) => {
      inst.files.set(PREVIEW_OUTPUT_PATH, 'ply')
      return 0
    })
    expect(await runOpenSCAD(factory, { code: TWO_PARTS, preview: { tagged: true } })).toMatchObject({
      ok: false,
      error: 'Unrecognised OFF data',
    })
  })

  it('leaves normal renders untouched: untagged code, binary STL, no tags', async () => {
    const { factory, created } = fakeFactory(writesBox)
    const result = await runOpenSCAD(factory, { code: TWO_PARTS })
    expect(created[0].files.get(INPUT_PATH)).toBe(TWO_PARTS)
    expect(result.ok && result.mesh.faceTags).toBeUndefined()
    expect(result.ok && result.stl.byteLength).toBe(134)
  })
})

describe('toPreviewArgs', () => {
  it('swaps only the output path and the export format', () => {
    expect(toPreviewArgs(['/main.scad', '-o', '/out.stl', '--backend=manifold', '--export-format=binstl', '-D', 'w=5'])).toEqual([
      '/main.scad', '-o', PREVIEW_OUTPUT_PATH, '--backend=manifold', '--export-format=off', '-D', 'w=5',
    ])
  })
})
```

`src/render/taggedPreview.real.test.ts`:

```ts
// @vitest-environment node
import { loadRealOpenSCAD, REAL_OPENSCAD_AVAILABLE } from '../test/realOpenSCAD'
import { runOpenSCAD } from './runOpenSCAD'

const BORED = [
  'module plate() { cube([40, 40, 10]); }',
  'module peg() { translate([15, 15, 10]) cube([10, 10, 10]); }',
  'difference() {',
  '  union() { plate(); peg(); }',
  '  for (i = [0 : 1]) translate([5 + i * 30, 5, -1]) cylinder(h = 12, d = 3, $fn = 16);',
  '}',
  '',
].join('\n')

describe.runIf(REAL_OPENSCAD_AVAILABLE || Boolean(process.env.CI))('tagged preview in the pinned OpenSCAD build', () => {
  it('tags every triangle of the main assembly, including the walls of subtracted bores', async () => {
    const result = await runOpenSCAD(await loadRealOpenSCAD(), { code: BORED, preview: { tagged: true } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(new Set(result.mesh.faceTags)).toEqual(new Set([1, 2]))
  }, 60_000)

  it('has the same bounds as the untagged render', async () => {
    const factory = await loadRealOpenSCAD()
    const [tagged, plain] = await Promise.all([
      runOpenSCAD(factory, { code: BORED, preview: { tagged: true } }),
      runOpenSCAD(factory, { code: BORED }),
    ])
    expect(tagged.ok && plain.ok).toBe(true)
    if (!tagged.ok || !plain.ok) return
    expect(tagged.mesh.bounds).toEqual(plain.mesh.bounds)
  }, 60_000)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/render/runOpenSCAD.test.ts src/render/taggedPreview.real.test.ts`
Expected: FAIL: `PREVIEW_OUTPUT_PATH` and `toPreviewArgs` are not exported from `./args`, and the tagged requests write the untagged code.

- [ ] **Step 3: Write minimal implementation**

Append to `src/render/args.ts`:

```ts
/** M5: the click-to-refine preview is exported as coloured OFF (decision D12, Task 1). */
export const PREVIEW_OUTPUT_PATH = '/out.off'

export function toPreviewArgs(args: string[]): string[] {
  return args.map((arg, i) => {
    if (args[i - 1] === '-o') return PREVIEW_OUTPUT_PATH
    if (arg.startsWith('--export-format=')) return '--export-format=off'
    return arg
  })
}
```

`src/render/taggedPreview.ts`:

```ts
import { listTaggableStatements } from '../scad/statements'
import { tagCode } from '../scad/tagging'

/** The preview source for click-to-refine: the editor code with one colour tag per part. */
export function prepareTaggedSource(code: string): { code: string; maxTag: number } {
  const statements = listTaggableStatements(code)
  return { code: tagCode(code, statements), maxTag: statements.length }
}
```

In `src/render/runOpenSCAD.ts` make four edits; everything else (including M3's library writes) stays as it is:

1. Imports: add `PREVIEW_OUTPUT_PATH` and `toPreviewArgs` to the `./args` import, and add
   ```ts
   import { parseOff } from './off'
   import { prepareTaggedSource } from './taggedPreview'
   ```
2. At the top of `runOpenSCAD`, after `const fail = …`, add:
   ```ts
   const tagged = req.preview?.tagged ? prepareTaggedSource(req.code) : null
   ```
   and directly after the statement that assigns `args` (inside its `try`), add:
   ```ts
   if (tagged) args = toPreviewArgs(args)
   ```
3. Replace `instance.FS.writeFile(INPUT_PATH, req.code)` with:
   ```ts
   instance.FS.writeFile(INPUT_PATH, tagged ? tagged.code : req.code)
   ```
4. Replace everything from `let bytes: Uint8Array` to the end of the function with:
   ```ts
     let bytes: Uint8Array
     try {
       bytes = instance.FS.readFile(tagged ? PREVIEW_OUTPUT_PATH : OUTPUT_PATH)
     } catch {
       return fail('OpenSCAD produced no output (is the model empty?)')
     }

     const output = new Uint8Array(bytes).buffer
     let mesh: MeshData
     try {
       mesh = tagged ? parseOff(output, tagged.maxTag) : parseStl(output)
     } catch (e) {
       return fail(errorMessage(e))
     }
     if (mesh.triangleCount === 0) return fail('Model is empty')

     // A tagged preview never carries an STL: Export STL always uses the untagged render.
     const stl = tagged ? new ArrayBuffer(0) : output
     return { ok: true, mesh, stl, logs, diagnostics: parseDiagnostics(logs), renderMs: performance.now() - startedAt }
   }
   ```

In `src/render/render.worker.ts`, replace the `api` object with:

```ts
const api = {
  async render(req: RenderRequest): Promise<RenderResult> {
    const result = await runOpenSCAD(await loadFactory(), req)
    if (!result.ok) return result
    const transfer = [result.mesh.positions.buffer, result.mesh.normals.buffer, result.stl]
    if (result.mesh.faceTags) transfer.push(result.mesh.faceTags.buffer)
    return Comlink.transfer(result, transfer)
  },
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/render && npm run typecheck`
Expected: PASS (all M1 `runOpenSCAD` tests unchanged, 4 new ones, 2 real-WASM ones), no type errors.

**Alternate block: only if Task 1 chose 3MF.** Do these instead of the OFF-specific parts above, then run the same tests with `/out.3mf` and `'Unrecognised 3MF data'` in place of `/out.off` and `'Unrecognised OFF data'`, and a 3MF fixture built with `zipSync` from `fflate` in place of `OFF_TWO`:

1. `npm i fflate` (moves it from devDependencies to dependencies; the worker unzips at runtime).
2. In `src/render/args.ts`: `PREVIEW_OUTPUT_PATH = '/out.3mf'` and `'--export-format=3mf'` in `toPreviewArgs`.
3. Create `src/render/threeMf.ts`. Web Workers have no `DOMParser`, so the model XML (which OpenSCAD writes in a regular, attribute-per-element form) is read with a small attribute scanner:
   ```ts
   import { unzipSync } from 'fflate'
   import { decodeTag } from '../scad/tagging'
   import { meshFromPositions } from './stl'
   import type { MeshData } from './types'

   const attrs = (tag: string): Record<string, string> =>
     Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))

   /** OpenSCAD's 3MF export: <basematerials> colours referenced by triangle pid/p1 or the object's pid/pindex. */
   export function parse3mf(buffer: ArrayBuffer, maxTag: number): MeshData {
     let xml: string
     try {
       const files = unzipSync(new Uint8Array(buffer))
       const entry = files['3D/3dmodel.model']
       if (!entry) throw new Error('no model')
       xml = new TextDecoder().decode(entry)
     } catch {
       throw new Error('Unrecognised 3MF data')
     }
     const materials = new Map<string, number[]>()
     for (const group of xml.matchAll(/<basematerials\b([^>]*)>([\s\S]*?)<\/basematerials>/g)) {
       const id = attrs(group[1]).id
       const tags = [...group[2].matchAll(/<base\b([^>]*)\/>/g)].map((b) => {
         const hex = /^.([0-9A-Fa-f]{6})/.exec(attrs(b[1]).displaycolor ?? '')?.[1]
         if (!hex) return 0
         const v = parseInt(hex, 16)
         return decodeTag((v >> 16) & 255, (v >> 8) & 255, v & 255, maxTag)
       })
       materials.set(id, tags)
     }
     const positions: number[] = []
     const faceTags: number[] = []
     for (const object of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
       const o = attrs(object[1])
       const vertices = [...object[2].matchAll(/<vertex\b([^>]*)\/>/g)].map((v) => {
         const a = attrs(v[1])
         return [Number(a.x), Number(a.y), Number(a.z)]
       })
       for (const t of object[2].matchAll(/<triangle\b([^>]*)\/>/g)) {
         const a = attrs(t[1])
         const corners = [a.v1, a.v2, a.v3].map((i) => vertices[Number(i)])
         if (corners.some((c) => c === undefined || c.some((n) => !Number.isFinite(n)))) throw new Error('Malformed 3MF triangle')
         for (const c of corners) positions.push(c[0], c[1], c[2])
         const group = materials.get(a.pid ?? o.pid ?? '')
         faceTags.push(group?.[Number(a.p1 ?? o.pindex ?? 0)] ?? 0)
       }
     }
     return { ...meshFromPositions(new Float32Array(positions)), faceTags: Uint32Array.from(faceTags) }
   }
   ```
4. In `runOpenSCAD.ts` import `parse3mf` instead of `parseOff` and call `parse3mf(output, tagged.maxTag)`.
5. The 3MF fixture for the unit test:
   ```ts
   import { strToU8, zipSync } from 'fflate'
   const MODEL = `<?xml version="1.0"?><model><resources><basematerials id="1"><base name="Default" displaycolor="#F9D72CFF"/><base name="t1" displaycolor="#000001FF"/><base name="t2" displaycolor="#000002FF"/></basematerials><object id="2" pid="1" pindex="0"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="20" y="0" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2" pid="1" p1="1"/><triangle v1="1" v2="3" v3="2" pid="1" p1="2"/></triangles></mesh></object></resources></model>`
   const THREE_MF_TWO = zipSync({ '3D/3dmodel.model': strToU8(MODEL) })
   ```
   (The fixture lives in a test file, which the hex-colour check skips.)

- [ ] **Step 5: Commit**

```bash
git add src/render/args.ts src/render/taggedPreview.ts src/render/runOpenSCAD.ts src/render/render.worker.ts src/render/runOpenSCAD.test.ts src/render/taggedPreview.real.test.ts
git commit -m "feat(render): tagged click-to-refine preview exported as coloured OFF with face tags" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Resolving a tap into a part or a region

**Files:**
- Create: `src/refine/pick.ts`, `src/test/picks.ts`
- Test: `src/refine/pick.test.ts`

**Interfaces:**
- Consumes: `MeshData`, `Bounds` (M1), `meshFromPositions` (Task 4), `formatDims` (M1), `formatLines`, `resolveEditScope`, `statementKind`, `StatementRange`, `LineRange` (Task 2).
- Produces:
  - `TAP_SLOP_PX = 4`; `interface ScreenPoint { x: number; y: number }`; `isTap(down: ScreenPoint | null, up: ScreenPoint): boolean` (moved less than 4 px).
  - `interface PartPick { kind: 'part'; statement: StatementRange; scope: LineRange; caption: string; triangles: Uint32Array; bounds: Bounds }`
  - `interface BoxPick { kind: 'box'; triangles: Uint32Array; bounds: Bounds }`; `type PickResult = PartPick | BoxPick`
  - `resolvePick(opts: { mesh: MeshData; faceIndex: number; statements: readonly StatementRange[]; code: string }): PickResult`: a known non-zero tag gives every triangle with that tag; otherwise (tag 0, unknown tag, or no `faceTags`) the connected region of triangles with the same tag value around the hit face.
  - `connectedTriangles(mesh, start, include): Uint32Array`, `trianglesBounds(mesh, triangles): Bounds`, `subsetMesh(mesh, triangles): MeshData`
  - `pickTitle(pick): string` (label, or "Selected region"), `pickSummary(pick): string` ("1,024 triangles · 19 × 19 × 22 mm"), `pickScope(pick | null): LineRange | null`.
  - Test fixtures `partPickFixture(): PartPick`, `boxPickFixture(): BoxPick`.

- [ ] **Step 1: Write the failing test**

`src/refine/pick.test.ts`:

```ts
import { listTaggableStatements } from '../scad/statements'
import { meshOf } from '../test/meshes'
import { boxPickFixture, partPickFixture } from '../test/picks'
import { connectedTriangles, isTap, pickScope, pickSummary, pickTitle, resolvePick } from './pick'

// Line 1 defines peg (called once), lines 2–5 are the main assembly.
const CODE = 'module peg() { cube(1); }\nunion() {\n  cube([2, 2, 1]);\n  translate([0, 0, 1]) peg();\n}\n'
const statements = listTaggableStatements(CODE) // cube (tag 1, line 3), peg (tag 2, line 4)

const MESH = meshOf(
  [
    [0, 0, 0, 2, 0, 0, 2, 2, 0], //       0: tag 1
    [0, 0, 0, 2, 2, 0, 0, 2, 0], //       1: tag 1
    [0, 0, 1, 1, 0, 1, 1, 1, 2], //       2: tag 2
    [5, 5, 5, 6, 5, 5, 6, 6, 5], //       3: tag 0
    [6, 6, 5, 7, 6, 5, 7, 7, 6], //       4: tag 0, shares (6, 6, 5) with 3
    [20, 20, 20, 21, 20, 20, 21, 21, 20], // 5: tag 0, separate
  ],
  [1, 1, 2, 0, 0, 0],
)

describe('isTap', () => {
  it('counts a pointer that moved less than 4 px as a tap', () => {
    expect(isTap({ x: 10, y: 10 }, { x: 13, y: 10 })).toBe(true)
    expect(isTap({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(false)
    expect(isTap({ x: 10, y: 10 }, { x: 13, y: 13 })).toBe(false)
    expect(isTap(null, { x: 0, y: 0 })).toBe(false)
  })
})

describe('resolvePick', () => {
  it('maps a tagged face to its statement, every triangle of that tag, and the edit scope', () => {
    const pick = resolvePick({ mesh: MESH, faceIndex: 0, statements, code: CODE })
    expect(pick).toMatchObject({ kind: 'part', statement: { label: 'cube', tag: 1 }, scope: { startLine: 3, endLine: 3 }, caption: 'line 3' })
    expect(Array.from(pick.triangles)).toEqual([0, 1])
    expect(pick.bounds).toEqual({ min: [0, 0, 0], max: [2, 2, 0] })
  })

  it('scopes a module called once to its definition and says so in the caption', () => {
    const pick = resolvePick({ mesh: MESH, faceIndex: 2, statements, code: CODE })
    expect(pick).toMatchObject({ kind: 'part', statement: { label: 'peg' }, scope: { startLine: 1, endLine: 1 }, caption: 'module call · line 1' })
  })

  it('falls back to the connected untagged region when tags were lost', () => {
    const pick = resolvePick({ mesh: MESH, faceIndex: 3, statements, code: CODE })
    expect(pick.kind).toBe('box')
    expect(Array.from(pick.triangles)).toEqual([3, 4])
    expect(pick.bounds).toEqual({ min: [5, 5, 5], max: [7, 7, 6] })
  })

  it('falls back to a region when the mesh has no tags at all', () => {
    const plain = meshOf([
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
      [1, 0, 0, 1, 1, 0, 0, 1, 0],
      [9, 9, 9, 10, 9, 9, 9, 10, 9],
    ])
    const pick = resolvePick({ mesh: plain, faceIndex: 1, statements: [], code: '' })
    expect(pick.kind).toBe('box')
    expect(Array.from(pick.triangles)).toEqual([0, 1])
  })

  it('never selects a statement for a tag it does not know', () => {
    const odd = meshOf([[0, 0, 0, 1, 0, 0, 0, 1, 0]], [7])
    expect(resolvePick({ mesh: odd, faceIndex: 0, statements, code: CODE }).kind).toBe('box')
  })
})

describe('connectedTriangles', () => {
  it('walks shared vertices only through included triangles', () => {
    expect(Array.from(connectedTriangles(MESH, 3, (t) => t >= 3))).toEqual([3, 4])
  })
})

describe('copy', () => {
  it('titles, summarises and scopes picks', () => {
    expect(pickTitle(partPickFixture())).toBe('bores')
    expect(pickTitle(boxPickFixture())).toBe('Selected region')
    expect(pickSummary(partPickFixture())).toBe('2 triangles · 10 × 10 × 0 mm')
    expect(pickSummary({ ...boxPickFixture(), triangles: Uint32Array.from([0]) })).toBe('1 triangle · 10 × 10 × 0 mm')
    expect(pickScope(partPickFixture())).toEqual({ startLine: 15, endLine: 17 })
    expect(pickScope(boxPickFixture())).toBeNull()
    expect(pickScope(null)).toBeNull()
  })

  it('formats large counts with separators', () => {
    expect(pickSummary({ ...boxPickFixture(), triangles: new Uint32Array(18_432) })).toBe('18,432 triangles · 10 × 10 × 0 mm')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/refine/pick.test.ts`
Expected: FAIL, because `./pick` and `../test/picks` cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

`src/refine/pick.ts`:

```ts
import { formatDims } from '../render/dims'
import { meshFromPositions } from '../render/stl'
import type { Bounds, MeshData, Vec3 } from '../render/types'
import { formatLines, resolveEditScope, statementKind, type LineRange, type StatementRange } from '../scad/statements'

/** A pointer that moved this far between down and up was an orbit drag, not a tap. */
export const TAP_SLOP_PX = 4

export interface ScreenPoint {
  x: number
  y: number
}

export function isTap(down: ScreenPoint | null, up: ScreenPoint): boolean {
  return down !== null && Math.hypot(up.x - down.x, up.y - down.y) < TAP_SLOP_PX
}

export interface PartPick {
  kind: 'part'
  statement: StatementRange
  /** The lines a scoped edit may change (the module definition for a module called once). */
  scope: LineRange
  caption: string
  triangles: Uint32Array
  bounds: Bounds
}

export interface BoxPick {
  kind: 'box'
  triangles: Uint32Array
  bounds: Bounds
}

export type PickResult = PartPick | BoxPick

function collect(count: number, keep: (t: number) => boolean): Uint32Array {
  const out: number[] = []
  for (let t = 0; t < count; t++) if (keep(t)) out.push(t)
  return Uint32Array.from(out)
}

const vertexKey = (p: Float32Array, i: number) => `${p[i]},${p[i + 1]},${p[i + 2]}`

/** Triangles reachable from `start` through shared vertices, visiting only triangles that `include` accepts. */
export function connectedTriangles(mesh: MeshData, start: number, include: (t: number) => boolean): Uint32Array {
  const byVertex = new Map<string, number[]>()
  for (let t = 0; t < mesh.triangleCount; t++) {
    if (!include(t)) continue
    for (let v = 0; v < 3; v++) {
      const key = vertexKey(mesh.positions, t * 9 + v * 3)
      const list = byVertex.get(key)
      if (list) list.push(t)
      else byVertex.set(key, [t])
    }
  }
  const seen = new Set<number>([start])
  const queue = [start]
  while (queue.length > 0) {
    const t = queue.pop()!
    for (let v = 0; v < 3; v++) {
      for (const n of byVertex.get(vertexKey(mesh.positions, t * 9 + v * 3)) ?? []) {
        if (!seen.has(n)) {
          seen.add(n)
          queue.push(n)
        }
      }
    }
  }
  return Uint32Array.from([...seen].sort((a, b) => a - b))
}

export function trianglesBounds(mesh: MeshData, triangles: Uint32Array): Bounds {
  if (triangles.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] }
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const t of triangles) {
    for (let v = 0; v < 3; v++) {
      for (let a = 0; a < 3; a++) {
        const c = mesh.positions[t * 9 + v * 3 + a]
        if (c < min[a]) min[a] = c
        if (c > max[a]) max[a] = c
      }
    }
  }
  return { min, max }
}

export function subsetMesh(mesh: MeshData, triangles: Uint32Array): MeshData {
  const positions = new Float32Array(triangles.length * 9)
  triangles.forEach((t, i) => positions.set(mesh.positions.subarray(t * 9, t * 9 + 9), i * 9))
  return meshFromPositions(positions)
}

export function resolvePick(opts: {
  mesh: MeshData
  faceIndex: number
  statements: readonly StatementRange[]
  code: string
}): PickResult {
  const { mesh, faceIndex, statements, code } = opts
  const tags = mesh.faceTags
  const tag = tags?.[faceIndex] ?? 0
  const statement = tag === 0 ? undefined : statements.find((s) => s.tag === tag)
  if (tags && statement) {
    const triangles = collect(mesh.triangleCount, (t) => tags[t] === tag)
    const scope = resolveEditScope(code, statement)
    const kind = statementKind(code, statement)
    const caption = kind === statement.label ? formatLines(scope) : `${kind} · ${formatLines(scope)}`
    return { kind: 'part', statement, scope, caption, triangles, bounds: trianglesBounds(mesh, triangles) }
  }
  const triangles = connectedTriangles(mesh, faceIndex, (t) => (tags?.[t] ?? 0) === tag)
  return { kind: 'box', triangles, bounds: trianglesBounds(mesh, triangles) }
}

export function pickTitle(pick: PickResult): string {
  return pick.kind === 'part' ? pick.statement.label : 'Selected region'
}

export function pickSummary(pick: PickResult): string {
  const n = pick.triangles.length
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'triangle' : 'triangles'} · ${formatDims(pick.bounds)}`
}

export function pickScope(pick: PickResult | null): LineRange | null {
  return pick?.kind === 'part' ? pick.scope : null
}
```

`src/test/picks.ts`:

```ts
import type { BoxPick, PartPick } from '../refine/pick'

const BOUNDS = { min: [0, 0, 0], max: [10, 10, 0] } as PartPick['bounds']

/** The Refine screen's pick: "bores", a for loop on lines 15–17. */
export function partPickFixture(): PartPick {
  return {
    kind: 'part',
    statement: { tag: 2, label: 'bores', startLine: 15, endLine: 17, start: 300, end: 420 },
    scope: { startLine: 15, endLine: 17 },
    caption: 'for loop · lines 15–17',
    triangles: Uint32Array.from([0, 1]),
    bounds: BOUNDS,
  }
}

export function boxPickFixture(): BoxPick {
  return { kind: 'box', triangles: Uint32Array.from([0, 1]), bounds: BOUNDS }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/refine && npm run typecheck`
Expected: PASS (10 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/refine/pick.ts src/refine/pick.test.ts src/test/picks.ts
git commit -m "feat(refine): resolve a tapped face into a part with its edit scope, or a connected region" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Quiet tagged follow-up through the `RenderController`, and the refine store

**Files:**
- Modify: `src/render/controller.ts`, `src/render/controller.test.ts`, `src/render/useRenderLoop.ts`, `src/render/useRenderLoop.test.ts`
- Create: `src/refine/refineStore.ts`
- Test: `src/refine/refineStore.test.ts`, `src/refine/taggedFollowUp.test.ts`

**Interfaces:**
- Consumes: `RenderController` (M1), `useAppStore` (`mesh`, `renderFinished`, `renderStarted`), `listTaggableStatements` (Task 2), `StatementRange`, `PickResult` (Task 6), `meshOf` (Task 4).
- Produces:
  - `RenderControllerOptions.onStart?(req: RenderRequest): void` (was `onStart?(): void`; existing callers that ignore the argument still type-check).
  - `interface PartTags { baseMesh: MeshData; code: string; mesh: MeshData; statements: StatementRange[] }`
  - `type PartTagsState = 'ready' | 'pending' | 'none'`
  - `useRefineStore` (Zustand) with `tags`, `pendingBase`, `pick: PickResult | null` (Task 6), `capture: (() => string) | null`, and actions `baseRendered(code, mesh): boolean`, `taggedFinished(result, code): void`, `setPick(pick)`, `setCapture(capture)`.
  - `partTagsState(mesh, tags, pendingBase): PartTagsState`.

**Why a follow-up and not a replacement.** The cheaper option overall would be to render only the tagged code and synthesise the STL from it, but the spec and the design doc require Export STL to render the untagged code, and `RenderResult` requires an `stl` for every success. Replacing the normal render would therefore cost a second compile on every Export STL and change M1–M4's export path. The follow-up keeps that path untouched and costs one extra compile per successful edit, paid after the normal result is already on screen, so the visible render time does not change. It is skipped when it adds nothing: with no taggable statement there is nothing to pick, and with exactly one every triangle belongs to it, so the tags are filled in without a render. A newer edit cancels an in-flight follow-up exactly like any other request, and it shares the 60 s timeout. The status pill never shows it.

- [ ] **Step 1: Write the failing tests**

Append to `src/render/controller.test.ts`:

```ts
it('passes the request that is starting to onStart', async () => {
  vi.useFakeTimers()
  const onStart = vi.fn()
  const controller = new RenderController({
    createWorker: () => ({ render: () => new Promise<RenderResult>(() => {}), terminate: () => {} }),
    onResult: () => {},
    onStart,
    debounceMs: 10,
  })
  controller.request({ code: 'cube(1);', preview: { tagged: true } }, { immediate: true })
  await vi.advanceTimersByTimeAsync(0)
  expect(onStart).toHaveBeenCalledWith({ code: 'cube(1);', preview: { tagged: true } })
  controller.dispose()
  vi.useRealTimers()
})
```

`src/refine/refineStore.test.ts`:

```ts
import { useAppStore } from '../state/store'
import { meshOf } from '../test/meshes'
import { okResult } from '../test/results'
import { partTagsState, useRefineStore } from './refineStore'

const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0]
const TWO_PARTS = 'cube(10);\ntranslate([20, 0, 0]) cube(5);\n'

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  useRefineStore.setState(useRefineStore.getInitialState(), true)
})

it('asks for a tagged render when the code has two or more parts', () => {
  const mesh = meshOf([TRI, TRI])
  expect(useRefineStore.getState().baseRendered(TWO_PARTS, mesh)).toBe(true)
  expect(useRefineStore.getState().pendingBase).toBe(mesh)
  expect(useRefineStore.getState().tags).toBeNull()
})

it('fills in the tags without a render when the code has exactly one part', () => {
  const mesh = meshOf([TRI, TRI])
  expect(useRefineStore.getState().baseRendered('cube(10);\n', mesh)).toBe(false)
  const tags = useRefineStore.getState().tags
  expect(tags?.baseMesh).toBe(mesh)
  expect(Array.from(tags?.mesh.faceTags ?? [])).toEqual([1, 1])
  expect(tags?.statements.map((s) => s.label)).toEqual(['cube'])
})

it('has nothing to pick when the code has no parts', () => {
  expect(useRefineStore.getState().baseRendered('w = 1;\n', meshOf([TRI]))).toBe(false)
  expect(useRefineStore.getState().tags).toBeNull()
  expect(useRefineStore.getState().pendingBase).toBeNull()
})

it('clears the pick whenever a new normal render arrives', () => {
  useRefineStore.setState({ pick: { kind: 'box', triangles: Uint32Array.from([0]), bounds: { min: [0, 0, 0], max: [1, 1, 0] } } })
  useRefineStore.getState().baseRendered(TWO_PARTS, meshOf([TRI]))
  expect(useRefineStore.getState().pick).toBeNull()
})

it('accepts a tagged result only while its base mesh is still on screen', () => {
  const base = okResult()
  if (!base.ok) throw new Error('fixture')
  useAppStore.getState().renderFinished(base, TWO_PARTS)
  useRefineStore.getState().baseRendered(TWO_PARTS, base.mesh)
  const tagged = { ...base, stl: new ArrayBuffer(0), mesh: { ...base.mesh, faceTags: Uint32Array.from([2]) } }
  useRefineStore.getState().taggedFinished(tagged, TWO_PARTS)
  expect(useRefineStore.getState().tags?.mesh).toBe(tagged.mesh)
  expect(useRefineStore.getState().pendingBase).toBeNull()

  useRefineStore.setState({ tags: null })
  useRefineStore.getState().baseRendered(TWO_PARTS, base.mesh)
  const newer = okResult()
  useAppStore.getState().renderFinished(newer, TWO_PARTS)
  useRefineStore.getState().taggedFinished(tagged, TWO_PARTS)
  expect(useRefineStore.getState().tags).toBeNull()
})

it('ignores failed tagged renders and results without tags', () => {
  const base = okResult()
  if (!base.ok) throw new Error('fixture')
  useAppStore.getState().renderFinished(base, TWO_PARTS)
  useRefineStore.getState().baseRendered(TWO_PARTS, base.mesh)
  useRefineStore.getState().taggedFinished(base, TWO_PARTS)
  expect(useRefineStore.getState().tags).toBeNull()
})

it('reports whether the tags for a mesh are ready, pending or absent', () => {
  const mesh = meshOf([TRI])
  const tags = { baseMesh: mesh, code: '', mesh, statements: [] }
  expect(partTagsState(null, null, null)).toBe('none')
  expect(partTagsState(mesh, tags, null)).toBe('ready')
  expect(partTagsState(mesh, null, mesh)).toBe('pending')
  expect(partTagsState(mesh, null, null)).toBe('none')
  expect(partTagsState(meshOf([TRI]), tags, null)).toBe('none')
})
```

`src/refine/taggedFollowUp.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react'
import type { RenderWorkerHandle } from '../render/createRenderWorker'
import type { RenderRequest, RenderResult } from '../render/types'
import { useRenderLoop } from '../render/useRenderLoop'
import { useAppStore } from '../state/store'
import { okResult } from '../test/results'
import { useRefineStore } from './refineStore'

const TWO_PARTS = 'cube(10);\ntranslate([20, 0, 0]) cube(5);\n'

function taggedResult(): RenderResult {
  const base = okResult()
  if (!base.ok) throw new Error('fixture')
  return { ...base, stl: new ArrayBuffer(0), mesh: { ...base.mesh, faceTags: Uint32Array.from([2]) } }
}

function scriptedWorker(tagged: () => Promise<RenderResult> = async () => taggedResult()) {
  const requests: RenderRequest[] = []
  const handle: RenderWorkerHandle = {
    render: async (req) => {
      requests.push(req)
      return req.preview ? tagged() : okResult()
    },
    terminate: vi.fn(),
  }
  return { requests, handle, createWorker: () => handle }
}

beforeEach(() => {
  useAppStore.setState({ ...useAppStore.getInitialState(), code: TWO_PARTS }, true)
  useRefineStore.setState(useRefineStore.getInitialState(), true)
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

it('follows a successful render with a quiet tagged preview of the same request', async () => {
  const { requests, createWorker } = scriptedWorker()
  const statuses: string[] = []
  const unsubscribe = useAppStore.subscribe((s, prev) => {
    if (s.status !== prev.status) statuses.push(s.status)
  })
  renderHook(() => useRenderLoop(createWorker, 600, 60_000))
  await act(() => vi.advanceTimersByTimeAsync(10))
  unsubscribe()

  expect(requests).toMatchObject([{ code: TWO_PARTS }, { code: TWO_PARTS, preview: { tagged: true } }])
  expect(requests[0].preview).toBeUndefined()
  const app = useAppStore.getState()
  expect(statuses).toEqual(['rendering', 'ok'])
  expect(app.stl?.byteLength).toBe(134)
  const tags = useRefineStore.getState().tags
  expect(tags?.baseMesh).toBe(app.mesh)
  expect(Array.from(tags?.mesh.faceTags ?? [])).toEqual([2])
})

it('skips the follow-up for a single-part model', async () => {
  useAppStore.setState({ code: 'cube(10);\n' })
  const { requests, createWorker } = scriptedWorker()
  renderHook(() => useRenderLoop(createWorker, 600, 60_000))
  await act(() => vi.advanceTimersByTimeAsync(10))
  expect(requests).toHaveLength(1)
  expect(useRefineStore.getState().tags?.statements).toHaveLength(1)
})

it('an edit cancels an in-flight tagged preview', async () => {
  const { handle, createWorker } = scriptedWorker(() => new Promise<RenderResult>(() => {}))
  renderHook(() => useRenderLoop(createWorker, 600, 60_000))
  await act(() => vi.advanceTimersByTimeAsync(10))
  expect(useRefineStore.getState().pendingBase).not.toBeNull()

  act(() => useAppStore.getState().setCode('cube(3);\n'))
  expect(handle.terminate).toHaveBeenCalled()
  expect(useRefineStore.getState().tags).toBeNull()
})

it('a failed tagged preview leaves the app as it was and no tags', async () => {
  const { createWorker } = scriptedWorker(async () => ({ ...okResult(), ok: false, error: 'boom' }) as RenderResult)
  renderHook(() => useRenderLoop(createWorker, 600, 60_000))
  await act(() => vi.advanceTimersByTimeAsync(10))
  expect(useAppStore.getState().status).toBe('ok')
  expect(useAppStore.getState().error).toBeNull()
  expect(useRefineStore.getState().tags).toBeNull()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/render/controller.test.ts src/refine`
Expected: FAIL: `./refineStore` cannot be resolved, and `onStart` is called without the request.

- [ ] **Step 3: Write minimal implementation**

In `src/render/controller.ts`:

```ts
// in RenderControllerOptions
  /** `req` is the request that is starting (M5: tagged previews start quietly). */
  onStart?(req: RenderRequest): void

// the field
  private readonly onStart: (req: RenderRequest) => void

// in start(req), replace `this.onStart()` with
    this.onStart(req)
```

`src/refine/refineStore.ts`:

```ts
import { create } from 'zustand'
import type { MeshData, RenderResult } from '../render/types'
import { listTaggableStatements, type StatementRange } from '../scad/statements'
import { useAppStore } from '../state/store'
import type { PickResult } from './pick'

export interface PartTags {
  /** The normal render these tags belong to; they are valid only while it is the app store's mesh. */
  baseMesh: MeshData
  code: string
  /** Same geometry as baseMesh, from the tagged render, with faceTags. */
  mesh: MeshData
  statements: StatementRange[]
}

export type PartTagsState = 'ready' | 'pending' | 'none'

export interface RefineState {
  tags: PartTags | null
  /** The base mesh a tagged render is running for. */
  pendingBase: MeshData | null
  pick: PickResult | null
  /** Returns a PNG data URL of the live viewport (registered by the viewer). */
  capture: (() => string) | null
  /** Called after each successful normal render; true means "request a tagged render now". */
  baseRendered(code: string, mesh: MeshData): boolean
  taggedFinished(result: RenderResult, code: string): void
  setPick(pick: PickResult | null): void
  setCapture(capture: (() => string) | null): void
}

export const useRefineStore = create<RefineState>()((set, get) => ({
  tags: null,
  pendingBase: null,
  pick: null,
  capture: null,
  baseRendered: (code, mesh) => {
    const statements = listTaggableStatements(code)
    if (statements.length === 1) {
      const faceTags = new Uint32Array(mesh.triangleCount).fill(statements[0].tag)
      set({ pick: null, pendingBase: null, tags: { baseMesh: mesh, code, statements, mesh: { ...mesh, faceTags } } })
      return false
    }
    const wanted = statements.length > 1
    set({ pick: null, tags: null, pendingBase: wanted ? mesh : null })
    return wanted
  },
  taggedFinished: (result, code) => {
    const base = get().pendingBase
    set({ pendingBase: null })
    if (!result.ok || !result.mesh.faceTags || base === null || useAppStore.getState().mesh !== base) return
    set({ tags: { baseMesh: base, code, mesh: result.mesh, statements: listTaggableStatements(code) } })
  },
  setPick: (pick) => set({ pick }),
  setCapture: (capture) => set({ capture }),
}))

export function partTagsState(mesh: MeshData | null, tags: PartTags | null, pendingBase: MeshData | null): PartTagsState {
  if (mesh === null) return 'none'
  if (tags?.baseMesh === mesh) return 'ready'
  return pendingBase === mesh ? 'pending' : 'none'
}
```

In `src/render/useRenderLoop.ts` change only the controller construction. The listing below is M3's version of that statement with the M5 edits; keep everything else in the hook (M3's `paramsOf`, `send`, the subscription, and anything M4 added) as it is, and add `import { useRefineStore } from '../refine/refineStore'`:

```ts
    const controller: RenderController = new RenderController({
      createWorker,
      debounceMs,
      timeoutMs,
      // M5: a tagged preview runs quietly; the status pill follows the normal render only.
      onStart: (req) => {
        if (!req.preview) renderStarted()
      },
      onResult: (result, req) => {
        // M5: a tagged preview only feeds picking; it never touches mesh, stl, status or lastRender.
        if (req.preview) {
          useRefineStore.getState().taggedFinished(result, req.code)
          return
        }
        renderFinished(result, req.code, paramsOf.get(req) ?? {})
        if (result.ok && useRefineStore.getState().baseRendered(req.code, result.mesh)) {
          controller.request({ ...req, preview: { tagged: true } }, { immediate: true })
        }
      },
    })
```

(The explicit `RenderController` annotation is needed because the callbacks refer to `controller`.)

In `src/render/useRenderLoop.test.ts`, the follow-up adds requests with `preview` set. Make every assertion about `requests` look at normal requests only, by adding this helper at the top of the file and wrapping each `requests` in an assertion with it (for example `expect(normal(requests)).toEqual([{ code: DEFAULT_CODE }])`, `expect(normal(requests)).toHaveLength(1)`, `expect(normal(requests)[1]).toEqual(…)`):

```ts
const normal = (rs: RenderRequest[]) => rs.filter((r) => !r.preview)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/render src/refine src/state && npm run typecheck`
Expected: PASS (1 new controller test, 7 store tests, 4 follow-up tests; the existing render-loop tests pass with `normal(...)`), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/render/controller.ts src/render/controller.test.ts src/render/useRenderLoop.ts src/render/useRenderLoop.test.ts src/refine/refineStore.ts src/refine/refineStore.test.ts src/refine/taggedFollowUp.test.ts
git commit -m "feat(refine): quiet tagged follow-up render through the RenderController" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Pick popover, Esc to clear, and the active profile's vision flag

**Files:**
- Modify: `src/ui/icons.ts`
- Create: `src/db/activeProfile.ts`, `src/refine/useVisionSupport.ts`, `src/refine/focusComposer.ts`, `src/refine/useEscapeToClearPick.ts`, `src/refine/PickPopover.tsx`
- Test: `src/db/activeProfile.test.ts`, `src/refine/useEscapeToClearPick.test.ts`, `src/refine/PickPopover.test.tsx`

**Interfaces:**
- Consumes: `PromptCadDb`, `db`, `DEFAULT_SETTINGS`, `ProviderProfile` (M2 contract); `useRefineStore` (Task 7); `PickResult`, `pickTitle`, `pickSummary` (Task 6); `partPickFixture`, `boxPickFixture` (Task 6).
- Produces:
  - `getActiveProfile(database?: PromptCadDb): Promise<ProviderProfile | null>`
  - `useVisionSupport(): boolean`: the active profile's `capabilities.vision`, live (Dexie `liveQuery`), `false` while loading or without a profile.
  - `focusComposer(): boolean`: focuses `.pc-composer textarea`; returns whether one was found.
  - `useEscapeToClearPick(): void`: Esc clears the pick, except when the key comes from inside the code editor (`.cm-editor`), where Esc belongs to CodeMirror.
  - `NO_VISION_REGION: string`; `<PickPopover pick vision onAskAi onShowCode />`
  - Icons: `IconAskAi` (Sparkles), `IconCode` (Code), `IconInfo` (Info), `IconPart` (Box), `IconAttach` (ImagePlus), `IconPen` (Pen), `IconLine` (Slash), `IconSize` (Ruler), `IconErase` (Eraser), `IconUndo` (Undo2), `IconClear` (Trash2).

- [ ] **Step 1: Write the failing tests**

`src/db/activeProfile.test.ts`:

```ts
// @vitest-environment node
import 'fake-indexeddb/auto'
import { getActiveProfile } from './activeProfile'
import { DEFAULT_SETTINGS, PromptCadDb, type ProviderProfile } from './db'

const profile = (id: string, vision: boolean): ProviderProfile => ({
  id,
  name: id,
  adapter: 'openai-compatible',
  baseUrl: 'https://example.test/v1',
  apiKey: 'test-key',
  defaultModel: 'm',
  cachedModels: [],
  capabilities: { streaming: true, vision, audio: false },
  priceTable: {},
  createdAt: 0,
  updatedAt: 0,
})

let database: PromptCadDb
beforeEach(() => {
  database = new PromptCadDb(`active-profile-${crypto.randomUUID()}`)
})
afterEach(async () => {
  await database.delete()
})

it('returns null without settings or without an active profile', async () => {
  expect(await getActiveProfile(database)).toBeNull()
  await database.settings.put({ ...DEFAULT_SETTINGS })
  expect(await getActiveProfile(database)).toBeNull()
})

it('returns the active profile', async () => {
  await database.providerProfiles.bulkPut([profile('a', false), profile('b', true)])
  await database.settings.put({ ...DEFAULT_SETTINGS, activeProfileId: 'b' })
  expect((await getActiveProfile(database))?.capabilities.vision).toBe(true)
})

it('returns null when the active profile no longer exists', async () => {
  await database.settings.put({ ...DEFAULT_SETTINGS, activeProfileId: 'gone' })
  expect(await getActiveProfile(database)).toBeNull()
})
```

`src/refine/useEscapeToClearPick.test.ts`:

```ts
import { fireEvent, renderHook } from '@testing-library/react'
import { partPickFixture } from '../test/picks'
import { useRefineStore } from './refineStore'
import { useEscapeToClearPick } from './useEscapeToClearPick'

beforeEach(() => useRefineStore.setState(useRefineStore.getInitialState(), true))

it('Esc clears the pick', () => {
  renderHook(() => useEscapeToClearPick())
  useRefineStore.setState({ pick: partPickFixture() })
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(useRefineStore.getState().pick).toBeNull()
})

it('Esc inside the code editor is left to the editor', () => {
  renderHook(() => useEscapeToClearPick())
  const editor = document.createElement('div')
  editor.className = 'cm-editor'
  const input = document.createElement('div')
  editor.append(input)
  document.body.append(editor)
  useRefineStore.setState({ pick: partPickFixture() })
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(useRefineStore.getState().pick).not.toBeNull()
  editor.remove()
})

it('other keys do nothing', () => {
  renderHook(() => useEscapeToClearPick())
  useRefineStore.setState({ pick: partPickFixture() })
  fireEvent.keyDown(window, { key: 'Enter' })
  expect(useRefineStore.getState().pick).not.toBeNull()
})
```

`src/refine/PickPopover.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { boxPickFixture, partPickFixture } from '../test/picks'
import { NO_VISION_REGION, PickPopover } from './PickPopover'

it('shows the part, its kind and lines, its size, and the two actions', async () => {
  const onAskAi = vi.fn()
  const onShowCode = vi.fn()
  render(<PickPopover pick={partPickFixture()} vision onAskAi={onAskAi} onShowCode={onShowCode} />)
  const popover = screen.getByRole('region', { name: 'Selected part' })
  expect(popover).toHaveClass('bg-panel-raised', 'border-line', 'shadow-pop', 'rounded-lg')
  expect(popover).toHaveTextContent('bores')
  expect(popover).toHaveTextContent('for loop · lines 15–17')
  expect(screen.getByTestId('pick-summary')).toHaveTextContent('2 triangles · 10 × 10 × 0 mm')

  await userEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  expect(onAskAi).toHaveBeenCalledOnce()
  await userEvent.click(screen.getByRole('button', { name: 'Show code' }))
  expect(onShowCode).toHaveBeenCalledWith(15)
})

it('a region on a profile without vision explains the text-only fallback and has no Show code', () => {
  render(<PickPopover pick={boxPickFixture()} vision={false} onAskAi={() => {}} onShowCode={() => {}} />)
  expect(screen.getByRole('region', { name: 'Selected part' })).toHaveTextContent('Selected region')
  expect(screen.getByText('Not matched to code')).toBeInTheDocument()
  expect(screen.getByRole('note')).toHaveTextContent(NO_VISION_REGION)
  expect(screen.queryByRole('button', { name: 'Show code' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Ask AI' })).toBeEnabled()
})

it('a region on a vision profile needs no callout', () => {
  render(<PickPopover pick={boxPickFixture()} vision onAskAi={() => {}} onShowCode={() => {}} />)
  expect(screen.queryByRole('note')).toBeNull()
})

it('renders labels from the code as text only', () => {
  const pick = partPickFixture()
  const evil = { ...pick, statement: { ...pick.statement, label: '<img src=x onerror=alert(1)>' } }
  const { container } = render(<PickPopover pick={evil} vision onAskAi={() => {}} onShowCode={() => {}} />)
  expect(container.querySelector('img')).toBeNull()
  expect(screen.getByRole('region', { name: 'Selected part' })).toHaveTextContent('<img src=x onerror=alert(1)>')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/db/activeProfile.test.ts src/refine/useEscapeToClearPick.test.ts src/refine/PickPopover.test.tsx`
Expected: FAIL, because `./activeProfile`, `./useEscapeToClearPick` and `./PickPopover` cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

`src/ui/icons.ts`: add these to the existing `lucide-react` export list (keep M1–M4's entries):

```ts
  Box as IconPart,
  Code as IconCode,
  Eraser as IconErase,
  ImagePlus as IconAttach,
  Info as IconInfo,
  Pen as IconPen,
  Ruler as IconSize,
  Slash as IconLine,
  Sparkles as IconAskAi,
  Trash2 as IconClear,
  Undo2 as IconUndo,
```

(If an earlier milestone already exports one of these Lucide icons under another name, keep both names; duplicates of the same icon under two names are fine.)

`src/db/activeProfile.ts`:

```ts
import { db, type PromptCadDb, type ProviderProfile } from './db'

export async function getActiveProfile(database: PromptCadDb = db): Promise<ProviderProfile | null> {
  const settings = await database.settings.get('app')
  if (!settings?.activeProfileId) return null
  return (await database.providerProfiles.get(settings.activeProfileId)) ?? null
}
```

`src/refine/useVisionSupport.ts`:

```ts
import { liveQuery } from 'dexie'
import { useEffect, useState } from 'react'
import { getActiveProfile } from '../db/activeProfile'

/** Whether the active provider profile can take images; follows profile and settings changes. */
export function useVisionSupport(): boolean {
  const [vision, setVision] = useState(false)
  useEffect(() => {
    const subscription = liveQuery(() => getActiveProfile()).subscribe({
      next: (profile) => setVision(profile?.capabilities.vision ?? false),
      error: () => setVision(false),
    })
    return () => subscription.unsubscribe()
  }, [])
  return vision
}
```

`src/refine/focusComposer.ts`:

```ts
/** "Ask AI": put the cursor in the chat composer, where the pick chip already shows. */
export function focusComposer(): boolean {
  const textarea = document.querySelector<HTMLTextAreaElement>('.pc-composer textarea')
  textarea?.focus()
  return textarea !== null
}
```

`src/refine/useEscapeToClearPick.ts`:

```ts
import { useEffect } from 'react'
import { useRefineStore } from './refineStore'

export function useEscapeToClearPick(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || useRefineStore.getState().pick === null) return
      if (e.target instanceof Element && e.target.closest('.cm-editor')) return
      useRefineStore.getState().setPick(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
```

`src/refine/PickPopover.tsx`:

```tsx
import { IconAskAi, IconCode, IconInfo } from '../ui/icons'
import { pickSummary, pickTitle, type PickResult } from './pick'

export const NO_VISION_REGION =
  'This region is not matched to code, and this provider is not set up for images, so its position is sent as text. Turn on Vision for the provider in Settings › AI providers if its model can read images.'

interface Props {
  pick: PickResult
  vision: boolean
  onAskAi(): void
  onShowCode(line: number): void
}

export function PickPopover({ pick, vision, onAskAi, onShowCode }: Props) {
  return (
    <section
      aria-label="Selected part"
      className="flex w-[260px] flex-col gap-2 rounded-lg border border-line bg-panel-raised p-3 text-ink shadow-pop"
    >
      <div className="pc-row">
        <span className="font-semibold">{pickTitle(pick)}</span>
        <span className="pc-caption pc-mono">{pick.kind === 'part' ? pick.caption : 'Not matched to code'}</span>
      </div>
      <div className="pc-caption" data-testid="pick-summary">
        {pickSummary(pick)}
      </div>
      {pick.kind === 'box' && !vision && (
        <div className="pc-callout is-info" role="note">
          <IconInfo className="pc-i" aria-hidden="true" />
          <div className="pc-callout-body pc-caption">{NO_VISION_REGION}</div>
        </div>
      )}
      <div className="pc-row">
        <button type="button" className="pc-btn is-sm is-primary" onClick={onAskAi}>
          <IconAskAi className="pc-i" aria-hidden="true" />
          Ask AI
        </button>
        {pick.kind === 'part' && (
          <button type="button" className="pc-btn is-sm" onClick={() => onShowCode(pick.scope.startLine)}>
            <IconCode className="pc-i" aria-hidden="true" />
            Show code
          </button>
        )}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/db/activeProfile.test.ts src/refine && npm test && npm run typecheck`
Expected: PASS (10 new tests; the token test still passes), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/icons.ts src/db/activeProfile.ts src/db/activeProfile.test.ts src/refine/useVisionSupport.ts src/refine/focusComposer.ts src/refine/useEscapeToClearPick.ts src/refine/useEscapeToClearPick.test.ts src/refine/PickPopover.tsx src/refine/PickPopover.test.tsx
git commit -m "feat(refine): pick popover with Ask AI and Show code, Esc to clear, live vision flag" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Picking in the viewer: tap, highlight, popover, capture

**Files:**
- Modify: `src/viewer/Viewer.tsx`
- Create: `src/viewer/PickHighlight.tsx`, `src/viewer/ViewportCapture.tsx`, `src/refine/useRefineSync.ts`
- Test: `src/viewer/PickHighlight.test.ts`, `src/refine/useRefineSync.test.ts`

**Interfaces:**
- Consumes: `useRefineStore`, `partTagsState` (Task 7); `isTap`, `resolvePick`, `subsetMesh`, `ScreenPoint`, `PickResult` (Task 6); `PickPopover`, `useVisionSupport`, `useEscapeToClearPick`, `focusComposer` (Task 8); `useAppStore` (`status`, `code`, `renderedCode`, `mesh`, `goToLine`); `meshToGeometry` (M1).
- Produces:
  - `PICK_FILL_OPACITY = 0.22`; `boxFor(bounds): { center: Vec3; size: Vec3 }`; `<PickHighlight pick mesh color />`: for a part, the picked triangles as a translucent `pick` overlay (`depthWrite: false`, polygon offset so it never z-fights the model) plus their feature edges (30°); for a region, a translucent box with its edges.
  - `<ViewportCapture />`: registers `capture()` in the refine store, which renders the scene once and returns `canvas.toDataURL('image/png')` synchronously (so no `preserveDrawingBuffer` is needed).
  - `useRefineSync(): void`: clears the pick whenever the app store's `code` or `mesh` changes.
  - Viewer: `data-part-tags="ready" | "pending" | "none"` on the `data-testid="viewer"` element (Task 18 waits on it); taps on the model resolve a pick; a tap on empty space clears it; drags (4 px or more) do neither; the popover sits top-centre; "Tap empty space to clear · Esc" replaces the triangle caption while a part is picked; "· finding parts…" follows the triangle count while the tagged preview runs.

**Why an overlay mesh and not vertex colours.** Vertex colours would add a colour attribute to the whole model and re-upload it on every pick (O(all triangles)), and would make the translucent 0.22 fill from the screen impossible without a second material. The overlay only builds geometry for the picked triangles, leaves the model material (including the stale 55 % opacity) untouched, and draws the screen's fill-plus-outline look directly.

- [ ] **Step 1: Write the failing tests**

`src/viewer/PickHighlight.test.ts`:

```ts
import { boxFor, PICK_FILL_OPACITY } from './PickHighlight'

it('fills picked parts at the screen opacity', () => {
  expect(PICK_FILL_OPACITY).toBe(0.22)
})

it('centres the region box on the bounds and never makes a side zero', () => {
  expect(boxFor({ min: [0, 0, 0], max: [10, 4, 0] })).toEqual({ center: [5, 2, 0], size: [10, 4, 0.01] })
})
```

`src/refine/useRefineSync.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react'
import { useAppStore } from '../state/store'
import { partPickFixture } from '../test/picks'
import { okResult } from '../test/results'
import { useRefineStore } from './refineStore'
import { useRefineSync } from './useRefineSync'

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  useRefineStore.setState(useRefineStore.getInitialState(), true)
})

it('clears the pick when the code changes', () => {
  renderHook(() => useRefineSync())
  useRefineStore.setState({ pick: partPickFixture() })
  act(() => useAppStore.getState().setCode('cube(2);'))
  expect(useRefineStore.getState().pick).toBeNull()
})

it('clears the pick when a new mesh arrives (for example after a slider change)', () => {
  renderHook(() => useRefineSync())
  useRefineStore.setState({ pick: partPickFixture() })
  act(() => useAppStore.getState().renderFinished(okResult(), useAppStore.getState().code))
  expect(useRefineStore.getState().pick).toBeNull()
})

it('keeps the pick for unrelated changes', () => {
  renderHook(() => useRefineSync())
  useRefineStore.setState({ pick: partPickFixture() })
  act(() => useAppStore.getState().goToLine(3))
  expect(useRefineStore.getState().pick).not.toBeNull()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/viewer/PickHighlight.test.ts src/refine/useRefineSync.test.ts`
Expected: FAIL, because `./PickHighlight` and `./useRefineSync` cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

`src/refine/useRefineSync.ts`:

```ts
import { useEffect } from 'react'
import { useAppStore } from '../state/store'
import { useRefineStore } from './refineStore'

/** A pick belongs to one code and one mesh; any change to either clears it (and with it the chip and highlights). */
export function useRefineSync(): void {
  useEffect(
    () =>
      useAppStore.subscribe((state, prev) => {
        if (state.code !== prev.code || state.mesh !== prev.mesh) useRefineStore.getState().setPick(null)
      }),
    [],
  )
}
```

`src/viewer/PickHighlight.tsx`:

```tsx
import { useEffect, useMemo } from 'react'
import { BoxGeometry, EdgesGeometry } from 'three'
import { subsetMesh, type PickResult } from '../refine/pick'
import type { Bounds, MeshData, Vec3 } from '../render/types'
import { meshToGeometry } from './geometry'

/** Refine screen: `.pick-fill { opacity: 0.22 }`. */
export const PICK_FILL_OPACITY = 0.22
const REGION_FILL_OPACITY = 0.12
const EDGE_THRESHOLD_DEG = 30
const MIN_SIDE = 0.01

export function boxFor(bounds: Bounds): { center: Vec3; size: Vec3 } {
  const axes = [0, 1, 2] as const
  return {
    center: axes.map((a) => (bounds.min[a] + bounds.max[a]) / 2) as Vec3,
    size: axes.map((a) => Math.max(bounds.max[a] - bounds.min[a], MIN_SIDE)) as Vec3,
  }
}

export function PickHighlight({ pick, mesh, color }: { pick: PickResult; mesh: MeshData; color: string }) {
  const part = useMemo(() => (pick.kind === 'part' ? meshToGeometry(subsetMesh(mesh, pick.triangles)) : null), [pick, mesh])
  const box = useMemo(() => (pick.kind === 'box' ? boxFor(pick.bounds) : null), [pick])
  const boxGeometry = useMemo(() => (box ? new BoxGeometry(...box.size) : null), [box])
  const solid = part ?? boxGeometry
  const edges = useMemo(() => (solid ? new EdgesGeometry(solid, EDGE_THRESHOLD_DEG) : null), [solid])
  useEffect(
    () => () => {
      part?.dispose()
      boxGeometry?.dispose()
      edges?.dispose()
    },
    [part, boxGeometry, edges],
  )

  if (!solid || !edges) return null
  return (
    <group position={box ? box.center : [0, 0, 0]}>
      <mesh geometry={solid} renderOrder={1}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={part ? PICK_FILL_OPACITY : REGION_FILL_OPACITY}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>
      <lineSegments geometry={edges} renderOrder={2}>
        <lineBasicMaterial color={color} />
      </lineSegments>
    </group>
  )
}
```

`src/viewer/ViewportCapture.tsx`:

```tsx
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { useRefineStore } from '../refine/refineStore'

/** Lets the chat send "a viewport screenshot with the selection outlined" (spec, click-to-refine fallback). */
export function ViewportCapture() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const setCapture = useRefineStore((s) => s.setCapture)
  useEffect(() => {
    // Render and read back in the same task, so the drawing buffer is still intact.
    setCapture(() => {
      gl.render(scene, camera)
      return gl.domElement.toDataURL('image/png')
    })
    return () => setCapture(null)
  }, [gl, scene, camera, setCapture])
  return null
}
```

`src/viewer/Viewer.tsx`: below is M1's Viewer with the M5 additions marked `// M5`. If M4 changed this file (44 px viewer buttons, render-loop pause, triangle warning), keep those changes and merge the marked lines into them; `Axes` and `CameraFitter` are unchanged and omitted here.

```tsx
import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from '@react-three/drei'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AxesHelper, Color, Object3D, type PerspectiveCamera, type Vector3 } from 'three'
import { focusComposer } from '../refine/focusComposer' // M5
import { isTap, resolvePick, type ScreenPoint } from '../refine/pick' // M5
import { PickPopover } from '../refine/PickPopover' // M5
import { partTagsState, useRefineStore } from '../refine/refineStore' // M5
import { useEscapeToClearPick } from '../refine/useEscapeToClearPick' // M5
import { useVisionSupport } from '../refine/useVisionSupport' // M5
import type { Bounds, MeshData } from '../render/types'
import { useAppStore } from '../state/store' // M5
import { useTokens } from '../theme/tokens'
import { DimsReadout } from '../ui/DimsReadout'
import { IconFit, IconWarning } from '../ui/icons'
import { computeCameraFit } from './cameraFit'
import { meshToGeometry } from './geometry'
import { PickHighlight } from './PickHighlight' // M5
import { ViewportCapture } from './ViewportCapture' // M5

// OpenSCAD is Z-up. This must run before any camera or controls are created.
Object3D.DEFAULT_UP.set(0, 0, 1)

const TOKENS = ['viewport', 'filament', 'grid-minor', 'grid-major', 'axis-x', 'axis-y', 'axis-z', 'ink', 'pick'] as const // M5: 'pick'

/** The screens dim the last good model to 55 % while the current code fails (`scene.is-stale`). */
const STALE_OPACITY = 0.55

function Model({
  mesh,
  color,
  stale,
  onTap,
}: {
  mesh: MeshData
  color: string
  stale: boolean
  onTap?(faceIndex: number, at: ScreenPoint): void // M5
}) {
  const geometry = useMemo(() => meshToGeometry(mesh), [mesh])
  useEffect(() => () => geometry.dispose(), [geometry])
  // M5: R3F raycasts click-only meshes on click, never on pointer moves.
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!onTap || typeof e.faceIndex !== 'number') return
    e.stopPropagation()
    onTap(e.faceIndex, { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
  }
  return (
    <mesh geometry={geometry} onClick={handleClick}>
      <meshStandardMaterial color={color} roughness={0.6} metalness={0.1} transparent={stale} opacity={stale ? STALE_OPACITY : 1} />
    </mesh>
  )
}

// Axes and CameraFitter: unchanged from M1.

export function Viewer({ mesh, stale }: { mesh: MeshData | null; stale: boolean }) {
  const t = useTokens(TOKENS)
  const [fitToken, setFitToken] = useState(0)
  const axisColors = [t['axis-x'], t['axis-y'], t['axis-z']] as const

  // M5: click-to-refine
  const pointerDown = useRef<ScreenPoint | null>(null)
  const tags = useRefineStore((s) => s.tags)
  const pendingBase = useRefineStore((s) => s.pendingBase)
  const pick = useRefineStore((s) => s.pick)
  const setPick = useRefineStore((s) => s.setPick)
  const current = useAppStore((s) => s.status === 'ok' && s.renderedCode === s.code)
  const goToLine = useAppStore((s) => s.goToLine)
  const vision = useVisionSupport()
  useEscapeToClearPick()
  const tagState = partTagsState(mesh, tags, pendingBase)
  const shown = tags && tagState === 'ready' ? tags.mesh : mesh
  const canPick = shown !== null && !stale && current && tagState !== 'pending'

  const onTap = (faceIndex: number, at: ScreenPoint) => {
    if (!canPick || !shown || !isTap(pointerDown.current, at)) return
    const statements = tags && tagState === 'ready' ? tags.statements : []
    setPick(resolvePick({ mesh: shown, faceIndex, statements, code: useAppStore.getState().code }))
  }
  const onMissed = (e: MouseEvent) => {
    if (isTap(pointerDown.current, { x: e.clientX, y: e.clientY })) setPick(null)
  }

  return (
    <div
      className="relative h-full w-full bg-viewport"
      data-testid="viewer"
      data-part-tags={tagState}
      onPointerDown={(e) => {
        pointerDown.current = { x: e.clientX, y: e.clientY }
      }}
    >
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ fov: 45, near: 0.1, far: 10_000, position: [60, -80, 60] }}
        onPointerMissed={onMissed}
      >
        <color attach="background" args={[t.viewport]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[50, -80, 100]} intensity={1.4} />
        <directionalLight position={[-60, 40, -30]} intensity={0.4} />
        <Grid
          rotation={[Math.PI / 2, 0, 0]}
          infiniteGrid
          cellSize={1}
          sectionSize={10}
          cellColor={t['grid-minor']}
          sectionColor={t['grid-major']}
          fadeDistance={400}
        />
        <Axes colors={axisColors} />
        {shown && <Model mesh={shown} color={t.filament} stale={stale} onTap={onTap} />}
        {pick && shown && <PickHighlight pick={pick} mesh={shown} color={t.pick} />}
        <ViewportCapture />
        <OrbitControls makeDefault />
        <GizmoHelper alignment="bottom-right" margin={[48, 48]}>
          <GizmoViewport axisColors={[...axisColors]} labelColor={t.ink} />
        </GizmoHelper>
        <CameraFitter bounds={mesh?.bounds ?? null} fitToken={fitToken} />
      </Canvas>

      <div className="absolute top-3 left-3">
        {stale ? (
          <span className="pc-status is-warn">
            <IconWarning className="pc-i" aria-hidden="true" />
            Showing the last model that compiled
          </span>
        ) : (
          mesh && <DimsReadout bounds={mesh.bounds} axes />
        )}
      </div>

      <div className="absolute top-3 right-3">
        <button
          type="button"
          aria-label="Fit view"
          title="Fit view"
          className="grid size-(--control-sm) place-items-center rounded-sm border border-line bg-panel text-ink-muted hover:text-ink disabled:text-ink-disabled"
          onClick={() => setFitToken((n) => n + 1)}
          disabled={!mesh}
        >
          <IconFit className="pc-i" aria-hidden="true" />
        </button>
      </div>

      {pick && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2">
          <PickPopover pick={pick} vision={vision} onAskAi={() => void focusComposer()} onShowCode={goToLine} />
        </div>
      )}

      {pick ? (
        <div className="pc-caption absolute bottom-3 left-3">Tap empty space to clear · Esc</div>
      ) : (
        mesh && (
          <div className="pc-caption pc-mono absolute bottom-3 left-3">
            {mesh.triangleCount.toLocaleString('en-US')} triangles
            {tagState === 'pending' && ' · finding parts…'}
          </div>
        )
      )}
    </div>
  )
}
```

In `src/App.tsx`, call the sync hook next to `useRenderLoop` (Task 10 adds the editor wiring):

```tsx
import { useRefineSync } from './refine/useRefineSync'
// inside App, after useRenderLoop(createWorker):
  useRefineSync()
```

- [ ] **Step 4: Run tests to verify they pass, then try it**

Run: `npx vitest run src/viewer src/refine && npm test && npm run typecheck`
Expected: PASS (5 new tests; `App.test.tsx` mocks the Viewer and still passes), no type errors.

Then `npm run dev`, paste a two-part model (for example the one in Task 18), and check by hand: the caption shows "· finding parts…" briefly; a tap on a part shows the overlay in the accent colour and the popover; an orbit drag that ends over a part picks nothing; a tap on empty space and Esc clear the pick; editing the code clears it.

- [ ] **Step 5: Commit**

```bash
git add src/viewer/Viewer.tsx src/viewer/PickHighlight.tsx src/viewer/PickHighlight.test.ts src/viewer/ViewportCapture.tsx src/refine/useRefineSync.ts src/refine/useRefineSync.test.ts src/App.tsx
git commit -m "feat(viewer): tap a part to pick it, pick-colour highlight, popover and viewport capture" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Highlight the picked lines in the editor

**Files:**
- Create: `src/editor/pickExtension.ts`
- Modify: `src/editor/theme.ts`, `src/editor/CodeEditor.tsx`, `src/App.tsx`, `src/App.test.tsx`
- Test: `src/editor/pickExtension.test.ts`, `src/App.test.tsx` (appended)

**Interfaces:**
- Consumes: `LineRange` (Task 2), `pickScope` (Task 6), `useRefineStore` (Task 7), `goToLine` (M1, used by "Show code" in Task 9).
- Produces:
  - `setPickLines: StateEffectType<LineRange | null>`; `pickExtension: Extension` (lines `startLine..endLine`, clamped to the document, get the `cm-pick-line` line decoration).
  - `CodeEditor` prop `pick?: LineRange | null` (default `null`).
  - Theme: `.cm-pick-line { background: var(--accent-soft); box-shadow: inset 2px 0 0 var(--accent) }`.

- [ ] **Step 1: Write the failing tests**

`src/editor/pickExtension.test.ts`:

```ts
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { pickExtension, setPickLines } from './pickExtension'

function viewWith(doc: string) {
  const parent = document.createElement('div')
  document.body.append(parent)
  return new EditorView({ parent, state: EditorState.create({ doc, extensions: [pickExtension] }) })
}

const DOC = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6'].join('\n')

it('marks exactly the picked lines', () => {
  const view = viewWith(DOC)
  view.dispatch({ effects: setPickLines.of({ startLine: 3, endLine: 5 }) })
  const marked = [...view.dom.querySelectorAll('.cm-pick-line')].map((el) => el.textContent)
  expect(marked).toEqual(['line 3', 'line 4', 'line 5'])
  view.destroy()
})

it('clears the marks', () => {
  const view = viewWith(DOC)
  view.dispatch({ effects: setPickLines.of({ startLine: 2, endLine: 2 }) })
  view.dispatch({ effects: setPickLines.of(null) })
  expect(view.dom.querySelectorAll('.cm-pick-line')).toHaveLength(0)
  view.destroy()
})

it('clamps a range that runs past the end of the document', () => {
  const view = viewWith('a\nb')
  view.dispatch({ effects: setPickLines.of({ startLine: 2, endLine: 40 }) })
  expect([...view.dom.querySelectorAll('.cm-pick-line')].map((el) => el.textContent)).toEqual(['b'])
  view.destroy()
})
```

Append to `src/App.test.tsx` (add the imports at the top of the file):

```tsx
import { useRefineStore } from './refine/refineStore'
import { partPickFixture } from './test/picks'

it('highlights the picked part in the editor and clears it when the code changes', async () => {
  useRefineStore.setState(useRefineStore.getInitialState(), true)
  const { container } = render(<App createWorker={scriptedWorker(() => okResult())} />)
  await waitFor(() => expect(screen.getByTestId('dims')).toBeInTheDocument())
  const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'a();\nb();\nc();\n' } }))

  act(() => useRefineStore.setState({ pick: { ...partPickFixture(), scope: { startLine: 2, endLine: 2 } } }))
  expect([...container.querySelectorAll('.cm-pick-line')].map((el) => el.textContent)).toEqual(['b();'])

  act(() => view.dispatch({ changes: { from: 0, insert: '// edited\n' } }))
  await waitFor(() => expect(container.querySelectorAll('.cm-pick-line')).toHaveLength(0))
  expect(useRefineStore.getState().pick).toBeNull()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/editor/pickExtension.test.ts src/App.test.tsx`
Expected: FAIL: `./pickExtension` cannot be resolved; the App test finds no `.cm-pick-line`.

- [ ] **Step 3: Write minimal implementation**

`src/editor/pickExtension.ts`:

```ts
import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import type { LineRange } from '../scad/statements'

export const setPickLines = StateEffect.define<LineRange | null>()

const pickField = StateField.define<LineRange | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPickLines)) return e.value
    return value
  },
})

const pickDecorations = EditorView.decorations.compute(['doc', pickField], (state) => {
  const builder = new RangeSetBuilder<Decoration>()
  const range = state.field(pickField)
  if (range) {
    const first = Math.max(1, Math.min(range.startLine, state.doc.lines))
    const last = Math.max(first, Math.min(range.endLine, state.doc.lines))
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n)
      builder.add(line.from, line.from, Decoration.line({ class: 'cm-pick-line' }))
    }
  }
  return builder.finish()
})

/** The picked part's lines, styled like the Refine screen's `.cl.is-pick`. */
export const pickExtension: Extension = [pickField, pickDecorations]
```

In `src/editor/theme.ts`, add to the `chrome` theme object, after the diagnostics entries:

```ts
  // pickExtension (M5): screens.css `.cl.is-pick`
  '.cm-pick-line': { backgroundColor: 'var(--accent-soft)', boxShadow: 'inset 2px 0 0 var(--accent)' },
```

In `src/editor/CodeEditor.tsx`:

```tsx
// imports
import type { LineRange } from '../scad/statements'
import { pickExtension, setPickLines } from './pickExtension'

// Props gains
  pick?: LineRange | null

// signature
export function CodeEditor({ value, onChange, diagnostics, reveal = null, pick = null }: Props) {

// in the extensions array, after diagnosticsExtension
          pickExtension,

// a new effect, after the reveal effect
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setPickLines.of(pick) })
  }, [pick])
```

In `src/App.tsx`:

```tsx
import { pickScope } from './refine/pick'
import { useRefineStore } from './refine/refineStore'

// inside App
  const pick = useRefineStore((s) => s.pick)

// the CodeEditor element gains one prop
<CodeEditor value={code} onChange={setCode} diagnostics={diagnostics} reveal={reveal} pick={pickScope(pick)} />
```

(`pickScope` returns the pick's own `scope` object, so the prop keeps its identity between renders and the effect only runs when the pick changes.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/editor src/App.test.tsx && npm run typecheck`
Expected: PASS (3 new editor tests, 1 new App test), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/editor/pickExtension.ts src/editor/pickExtension.test.ts src/editor/theme.ts src/editor/CodeEditor.tsx src/App.tsx src/App.test.tsx
git commit -m "feat(editor): highlight the picked part's lines like the Refine screen" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Scoped edits: the prompt rule and enforcement with one retry

**Files:**
- Create: `src/ai/scope.ts`
- Modify: `src/ai/prompt.ts`, `src/ai/runTurn.ts`
- Test: `src/ai/scopedEdits.test.ts`

**Interfaces:**
- Consumes: `PromptContext` (with `selection`), `buildSystemPrompt` (M2); `generateCode`, `GenerateResult` (M2); `ContentPart`, `Usage`, `LlmProvider`, `ChatRequest`, `ChatEvent` (M2); `formatLines`, `LineRange` (Task 2).
- Produces:
  - `type ScopedSelection = NonNullable<PromptContext['selection']>`
  - `scopeInstruction(selection, code): string`: names the part and the lines ("Edit only lines 15–17. …") and quotes those lines.
  - `changedOutsideRange(before: string, after: string, range: LineRange): boolean`: true when any line before `startLine` or after `endLine` differs (the range itself may grow or shrink).
  - `scopeCorrection(selection): string`, `scopeRejected(selection): string`, `withCorrection(userText, correction)`, `addUsage(a, b): Usage`.
  - `buildSystemPrompt(ctx)` appends `scopeInstruction` when `ctx.selection` is set and `ctx.errors` is not.
  - `generateCode(opts)` (same contract signature): when `ctx.selection` is set and `ctx.errors` is not, a result whose code changes lines outside the selection is rejected, retried once with a correction appended to the request, and, if the retry strays too, returned as `{ code: null, prose: scopeRejected(…) }`; usage of both attempts is summed.

The check runs on the applied result rather than on the SEARCH text, so it covers SEARCH/REPLACE blocks and full-file replies the same way, and it accepts blocks that quote unchanged context lines outside the range. Auto-fix requests (`ctx.errors` set) are not restricted: after the first edit the selection's line numbers no longer match the code, and the compiler error may be elsewhere; each auto-fix is still its own version.

- [ ] **Step 1: Write the failing test**

`src/ai/scopedEdits.test.ts`:

```ts
import { buildSystemPrompt } from './prompt'
import { generateCode } from './runTurn'
import { changedOutsideRange, scopeInstruction } from './scope'
import type { ChatEvent, ChatRequest, LlmProvider } from './types'

const CODE = ['a = 1;', 'module peg() { cube(10); }', 'plate();', 'peg();', ''].join('\n')
const SELECTION = { startLine: 2, endLine: 2, label: 'peg' }

const block = (search: string, replace: string) => `Done.\n\n<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE\n`
const INSIDE = block('module peg() { cube(10); }', 'module peg() { cube(12); }')
const OUTSIDE = block('a = 1;', 'a = 2;')

function scriptedProvider(replies: string[]): LlmProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = []
  return {
    requests,
    listModels: async () => [],
    async *streamChat(req: ChatRequest): AsyncIterable<ChatEvent> {
      requests.push(req)
      yield { type: 'text', delta: replies.shift() ?? '' }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
    },
  }
}

const run = (provider: LlmProvider, ctx: Parameters<typeof generateCode>[0]['ctx'] = { code: CODE, selection: SELECTION }) =>
  generateCode({ provider, model: 'm', history: [], userText: 'Make the peg taller', ctx, signal: new AbortController().signal })

describe('generateCode with a selection', () => {
  it('applies an edit inside the selection in one request', async () => {
    const provider = scriptedProvider([INSIDE])
    const result = await run(provider)
    expect(result.code).toBe(CODE.replace('cube(10)', 'cube(12)'))
    expect(provider.requests).toHaveLength(1)
  })

  it('rejects an edit outside the selection and retries once with the line range spelled out', async () => {
    const provider = scriptedProvider([OUTSIDE, INSIDE])
    const result = await run(provider)
    expect(result.code).toBe(CODE.replace('cube(10)', 'cube(12)'))
    expect(provider.requests).toHaveLength(2)
    expect(JSON.stringify(provider.requests[1].messages)).toContain('Your previous reply changed lines outside line 2')
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10 })
  })

  it('gives up after the retry also strays, and leaves the code alone', async () => {
    const provider = scriptedProvider([OUTSIDE, OUTSIDE])
    const result = await run(provider)
    expect(result.code).toBeNull()
    expect(result.prose).toBe(
      'The reply changed lines outside line 2, so it was not applied. Ask again, or clear the selected part to allow changes anywhere.',
    )
  })

  it('accepts SEARCH text that quotes unchanged lines around the selection', async () => {
    const provider = scriptedProvider([block('a = 1;\nmodule peg() { cube(10); }', 'a = 1;\nmodule peg() { cube(12); }')])
    expect((await run(provider)).code).toBe(CODE.replace('cube(10)', 'cube(12)'))
    expect(provider.requests).toHaveLength(1)
  })

  it('checks full-file replies the same way', async () => {
    const full = `Here.\n\n\`\`\`openscad\n${CODE.replace('a = 1;', 'a = 9;')}\`\`\`\n`
    const provider = scriptedProvider([full, INSIDE])
    expect((await run(provider)).code).toBe(CODE.replace('cube(10)', 'cube(12)'))
    expect(provider.requests).toHaveLength(2)
  })

  it('does not restrict auto-fix replies', async () => {
    const provider = scriptedProvider([OUTSIDE])
    const result = await run(provider, { code: CODE, selection: SELECTION, errors: 'ERROR: something' })
    expect(result.code).toBe(CODE.replace('a = 1;', 'a = 2;'))
    expect(provider.requests).toHaveLength(1)
  })
})

describe('the scope rule in the system prompt', () => {
  it('names the lines and quotes them', () => {
    const system = buildSystemPrompt({ code: CODE, selection: SELECTION })
    expect(system).toContain('Edit only line 2.')
    expect(system).toContain('module peg() { cube(10); }')
    expect(scopeInstruction({ startLine: 15, endLine: 17, label: 'bores' }, CODE)).toContain('Edit only lines 15–17.')
  })

  it('is left out without a selection and for auto-fix requests', () => {
    expect(buildSystemPrompt({ code: CODE })).not.toContain('Edit only')
    expect(buildSystemPrompt({ code: CODE, selection: SELECTION, errors: 'ERROR: x' })).not.toContain('Edit only')
  })
})

describe('changedOutsideRange', () => {
  const before = 'a\nb\nc\nd\n'
  it('allows the range to change, grow and shrink', () => {
    expect(changedOutsideRange(before, 'a\nB\nc\nd\n', { startLine: 2, endLine: 3 })).toBe(false)
    expect(changedOutsideRange(before, 'a\nb\nx\ny\nc\nd\n', { startLine: 2, endLine: 3 })).toBe(false)
    expect(changedOutsideRange(before, 'a\nd\n', { startLine: 2, endLine: 3 })).toBe(false)
  })

  it('flags changes before or after the range', () => {
    expect(changedOutsideRange(before, 'A\nb\nc\nd\n', { startLine: 2, endLine: 3 })).toBe(true)
    expect(changedOutsideRange(before, 'a\nb\nc\nD\n', { startLine: 2, endLine: 3 })).toBe(true)
    expect(changedOutsideRange(before, 'a\n', { startLine: 2, endLine: 3 })).toBe(true)
  })

  it('ignores CRLF and a missing final newline', () => {
    expect(changedOutsideRange('a\r\nb\r\n', 'a\nB\n', { startLine: 2, endLine: 2 })).toBe(false)
    expect(changedOutsideRange('a\nb\nc\n', 'A\nb\nc', { startLine: 1, endLine: 1 })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ai/scopedEdits.test.ts`
Expected: FAIL, because `./scope` cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

`src/ai/scope.ts`:

```ts
import { formatLines, type LineRange } from '../scad/statements'
import type { PromptContext } from './prompt'
import type { ContentPart, Usage } from './types'

export type ScopedSelection = NonNullable<PromptContext['selection']>

/** Lines without CRLF and without trailing blank lines, so a reply that drops the final newline still compares equal. */
const lines = (text: string) => text.replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n')

export function scopeInstruction(selection: ScopedSelection, code: string): string {
  const where = formatLines(selection)
  const quoted = lines(code).slice(selection.startLine - 1, selection.endLine).join('\n')
  return [
    `The user selected one part of the model, "${selection.label}", at ${where} of the current file.`,
    `Edit only ${where}. Keep every other line exactly as it is.`,
    `Every SEARCH block must change only ${where}. If the request cannot be done there, change nothing and say why.`,
    `The selected ${selection.startLine === selection.endLine ? 'line is' : 'lines are'}:`,
    '```openscad',
    quoted,
    '```',
  ].join('\n')
}

export function changedOutsideRange(before: string, after: string, { startLine, endLine }: LineRange): boolean {
  const b = lines(before)
  const a = lines(after)
  const head = Math.max(0, startLine - 1)
  const tail = Math.max(0, b.length - endLine)
  if (a.length < head + tail) return true
  for (let i = 0; i < head; i++) if (a[i] !== b[i]) return true
  for (let i = 1; i <= tail; i++) if (a[a.length - i] !== b[b.length - i]) return true
  return false
}

export function scopeCorrection(selection: ScopedSelection): string {
  const where = formatLines(selection)
  return `Your previous reply changed lines outside ${where}. Reply again and change only ${where}; keep every other line exactly as it is.`
}

export function scopeRejected(selection: ScopedSelection): string {
  return `The reply changed lines outside ${formatLines(selection)}, so it was not applied. Ask again, or clear the selected part to allow changes anywhere.`
}

export function withCorrection(userText: string | ContentPart[], correction: string): string | ContentPart[] {
  return typeof userText === 'string' ? `${userText}\n\n${correction}` : [...userText, { type: 'text', text: correction }]
}

export function addUsage(a: Usage, b: Usage): Usage {
  const reported = a.costUsd !== undefined || b.costUsd !== undefined
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    ...(reported ? { costUsd: (a.costUsd ?? 0) + (b.costUsd ?? 0) } : {}),
  }
}
```

In `src/ai/prompt.ts`: rename the existing `export function buildSystemPrompt(ctx: PromptContext): string {` to `function buildBaseSystemPrompt(ctx: PromptContext): string {` (body unchanged), add `import { scopeInstruction } from './scope'`, and add:

```ts
export function buildSystemPrompt(ctx: PromptContext): string {
  const base = buildBaseSystemPrompt(ctx)
  // M5: a scoped edit names its lines. Auto-fix requests (ctx.errors) are not scoped: the line numbers are stale by then.
  return ctx.selection && !ctx.errors ? `${base}\n\n${scopeInstruction(ctx.selection, ctx.code)}` : base
}
```

In `src/ai/runTurn.ts`: rename the existing `export async function generateCode(` to `async function generateUnscoped(` (signature and body unchanged; `runTurn` keeps calling `generateCode`, which now resolves to the wrapper), add `import { addUsage, changedOutsideRange, scopeCorrection, scopeRejected, withCorrection } from './scope'`, and add:

```ts
type GenerateOptions = Parameters<typeof generateUnscoped>[0]

/** Streams one reply, applies it to baseCode (full file or edits, with one full-file retry when an edit fails). M5: with a selection, a reply that changes other lines is retried once, then rejected. */
export async function generateCode(opts: GenerateOptions): Promise<GenerateResult> {
  const selection = opts.ctx.selection
  const first = await generateUnscoped(opts)
  if (!selection || opts.ctx.errors || first.code === null || !changedOutsideRange(opts.ctx.code, first.code, selection)) {
    return first
  }
  const retry = await generateUnscoped({ ...opts, userText: withCorrection(opts.userText, scopeCorrection(selection)) })
  const usage = addUsage(first.usage, retry.usage)
  if (retry.code !== null && !changedOutsideRange(opts.ctx.code, retry.code, selection)) return { ...retry, usage }
  return { code: null, prose: scopeRejected(selection), usage, model: retry.model }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ai && npm run typecheck`
Expected: PASS (11 new tests; M2's prompt and runTurn tests still pass, because nothing changes without a selection), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/ai/scope.ts src/ai/scopedEdits.test.ts src/ai/prompt.ts src/ai/runTurn.ts
git commit -m "feat(ai): scoped edits name their lines and are enforced with one retry" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Image parts reach both adapters

**Files:**
- Test: `src/ai/imageParts.test.ts`
- Create (only if Step 2 fails): `src/ai/contentParts.ts`, `src/ai/contentParts.test.ts`
- Modify (only if Step 2 fails): the OpenAI-compatible and Anthropic adapters (`ls src/ai`; M2's plan names them `src/ai/openaiCompatible.ts` and `src/ai/anthropic.ts`)

**Interfaces:**
- Consumes: `createProvider(profile)` (M2 contract), `ProviderProfile` (M2), `ChatRequest`, `ContentPart` (M2).
- Produces: a test that pins the wire format of image parts for both adapters through the public `createProvider` path:
  - OpenAI-compatible: `{ type: 'image_url', image_url: { url: 'data:<mediaType>;base64,<data>' } }` next to `{ type: 'text', text }`.
  - Anthropic: `{ type: 'image', source: { type: 'base64', media_type: <mediaType>, data } }`.
  - If needed: `toOpenAiContent(content)`, `toAnthropicContent(content)`.

The design doc gives this to M5 ("Adapters send image parts"), while M2's plan already maps image parts in both adapters. This task therefore starts with a test that goes through `createProvider` and only writes the mapping if the test fails.

- [ ] **Step 1: Write the test**

`src/ai/imageParts.test.ts`:

```ts
import type { AdapterKind, ProviderProfile } from '../db/db'
import { createProvider } from './createProvider'
import type { ChatRequest } from './types'

const profile = (adapter: AdapterKind, baseUrl: string): ProviderProfile => ({
  id: 'p1',
  name: 'Test',
  adapter,
  baseUrl,
  apiKey: 'test-key',
  defaultModel: 'm',
  cachedModels: [],
  capabilities: { streaming: true, vision: true, audio: false },
  priceTable: {},
  createdAt: 0,
  updatedAt: 0,
})

const REQUEST: ChatRequest = {
  model: 'm',
  system: 'sys',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Like this' }, { type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=' }] }],
}

/** Records request bodies and answers 400, so the stream ends right after the request is sent. */
function captureBodies(): unknown[] {
  const bodies: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = init?.body ?? (input instanceof Request ? await input.text() : null)
      if (typeof raw === 'string') bodies.push(JSON.parse(raw))
      return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'stop here' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
  return bodies
}

async function drain(events: AsyncIterable<unknown>): Promise<void> {
  const it = events[Symbol.asyncIterator]()
  try {
    while (!(await it.next()).done) {
      // keep reading until the stream ends or throws
    }
  } catch {
    // the 400 ends the stream; only the request body matters here
  }
}

afterEach(() => vi.unstubAllGlobals())

it('the OpenAI-compatible adapter sends images as image_url data URLs', async () => {
  const bodies = captureBodies()
  await drain(createProvider(profile('openai-compatible', 'https://example.test/v1')).streamChat(REQUEST))
  const body = bodies[0] as { messages: Array<{ role: string; content: unknown }> }
  expect(body.messages.at(-1)?.content).toEqual([
    { type: 'text', text: 'Like this' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
  ])
})

it('the Anthropic adapter sends images as base64 image blocks', async () => {
  const bodies = captureBodies()
  await drain(createProvider(profile('anthropic', 'https://example.test')).streamChat(REQUEST))
  const body = bodies[0] as { messages: Array<{ role: string; content: unknown }> }
  expect(body.messages[0].content).toEqual([
    { type: 'text', text: 'Like this' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
  ])
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/ai/imageParts.test.ts`
Expected: PASS if M2 already maps image parts (its plan does); then skip Step 3. FAIL otherwise, with the internal `{ type: 'image', mediaType, data }` part (or `[object Object]`) in the request body; then do Step 3.

- [ ] **Step 3 (only if Step 2 failed): Map content parts in the adapters**

`src/ai/contentParts.ts`:

```ts
import type { ContentPart } from './types'

export type OpenAiPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
export type AnthropicPart =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg' | 'image/webp'; data: string } }

export function toOpenAiContent(content: string | ContentPart[]): string | OpenAiPart[] {
  if (typeof content === 'string') return content
  return content.map((p) =>
    p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.data}` } },
  )
}

export function toAnthropicContent(content: string | ContentPart[]): string | AnthropicPart[] {
  if (typeof content === 'string') return content
  return content.map((p) =>
    p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } },
  )
}
```

`src/ai/contentParts.test.ts`:

```ts
import { toAnthropicContent, toOpenAiContent } from './contentParts'

const PARTS = [
  { type: 'text', text: 'Hi' },
  { type: 'image', mediaType: 'image/jpeg', data: 'AAAA' },
] as const

it('passes plain strings through', () => {
  expect(toOpenAiContent('Hi')).toBe('Hi')
  expect(toAnthropicContent('Hi')).toBe('Hi')
})

it('maps image parts per provider', () => {
  expect(toOpenAiContent([...PARTS])[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } })
  expect(toAnthropicContent([...PARTS])[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } })
})
```

In the OpenAI-compatible adapter, where the request body's `messages` are built, map each message's content:

```ts
messages: [{ role: 'system', content: req.system }, ...req.messages.map((m) => ({ role: m.role, content: toOpenAiContent(m.content) }))],
```

In the Anthropic adapter, where `messages.create`/`messages.stream` receives its parameters:

```ts
system: req.system,
messages: req.messages.map((m) => ({ role: m.role, content: toAnthropicContent(m.content) })),
```

Run: `npx vitest run src/ai && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 4: Run the AI tests**

Run: `npx vitest run src/ai && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/ai/imageParts.test.ts
# only if Step 3 ran: git add src/ai/contentParts.ts src/ai/contentParts.test.ts and the two adapter files
git commit -m "test(ai): pin the image part wire format of both adapters" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(If Step 3 ran, use `feat(ai): send image parts in each provider's own format` as the message instead.)

---

### Task 13: Image pipeline: downscale, encode, store, and the attachment list

**Files:**
- Create: `src/images/prepareImage.ts`, `src/images/base64.ts`, `src/images/imageData.ts`, `src/db/images.ts`, `src/images/attachments.ts`
- Test: `src/images/prepareImage.test.ts`, `src/images/base64.test.ts`, `src/db/images.test.ts`, `src/images/attachments.test.ts`

**Interfaces:**
- Consumes: `db`, `PromptCadDb`, `StoredBlob` and the `blobs` table (M3 contract).
- Produces:
  - `MAX_IMAGE_EDGE = 1568`, `JPEG_QUALITY = 0.85`; `type OutputType = 'image/png' | 'image/jpeg'`
  - `fitWithin(width, height, max = MAX_IMAGE_EDGE): { width; height }`
  - `outputTypeFor(inputType: string): OutputType`: PNG for `image/png`, `image/webp`, `image/gif`, `image/svg+xml` (may carry transparency or line art), JPEG otherwise (photos, HEIC).
  - `interface PreparedImage { blob: Blob; mediaType: OutputType; width: number; height: number }`
  - `interface ImageCodec { decode(blob): Promise<DecodedImage>; encode(image, width, height, type, quality): Promise<Blob> }`, `browserCodec` (`createImageBitmap` + canvas `toBlob`)
  - `prepareImage(blob: Blob, type: OutputType, codec = browserCodec): Promise<PreparedImage>`: always re-encodes, which also drops EXIF metadata such as GPS location.
  - `blobToBase64(blob): Promise<string>`, `dataUrlToBlob(url): Blob`, `imageDataToPng(image: ImageData): Promise<Blob>`
  - `saveImage(blob, database = db): Promise<string>` (a `blobs` row with `kind: 'image'`), `loadImage(id, database = db): Promise<Blob | null>`
  - `MAX_ATTACHMENTS = 4`, `NO_VISION_EXPLANATION: string`
  - `interface Attachment { id: string; blob: Blob; mediaType: OutputType; name: string; note: string; url: string }`
  - `useAttachments` (Zustand): `items`, `error`, `addFiles(files, prepare?)`, `addPrepared(image, name, note?)`, `remove(id)`, `clear()`, `setError(error)`. Object URLs are revoked on remove and clear.

- [ ] **Step 1: Write the failing tests**

`src/images/prepareImage.test.ts`:

```ts
// @vitest-environment node
import { fitWithin, JPEG_QUALITY, MAX_IMAGE_EDGE, outputTypeFor, prepareImage, type ImageCodec } from './prepareImage'

describe('fitWithin', () => {
  it('scales the long edge down to 1568 px and keeps the aspect ratio', () => {
    expect(MAX_IMAGE_EDGE).toBe(1568)
    expect(fitWithin(8000, 6000)).toEqual({ width: 1568, height: 1176 })
    expect(fitWithin(3000, 4000)).toEqual({ width: 1176, height: 1568 })
  })

  it('never scales up, and never returns zero', () => {
    expect(fitWithin(1000, 800)).toEqual({ width: 1000, height: 800 })
    expect(fitWithin(10_000, 2)).toEqual({ width: 1568, height: 1 })
  })
})

it('keeps line art and transparency as PNG and sends photos as JPEG', () => {
  expect(outputTypeFor('image/png')).toBe('image/png')
  expect(outputTypeFor('image/webp')).toBe('image/png')
  expect(outputTypeFor('image/gif')).toBe('image/png')
  expect(outputTypeFor('image/jpeg')).toBe('image/jpeg')
  expect(outputTypeFor('image/heic')).toBe('image/jpeg')
})

describe('prepareImage', () => {
  function fakeCodec(width: number, height: number) {
    const close = vi.fn()
    const encode = vi.fn(async () => new Blob(['encoded'], { type: 'image/jpeg' }))
    const codec: ImageCodec = { decode: async () => ({ width, height, close }), encode }
    return { codec, encode, close }
  }

  it('re-encodes at the fitted size with the requested type and quality', async () => {
    const { codec, encode, close } = fakeCodec(8000, 6000)
    const result = await prepareImage(new Blob(['raw']), 'image/jpeg', codec)
    expect(encode).toHaveBeenCalledWith(expect.anything(), 1568, 1176, 'image/jpeg', JPEG_QUALITY)
    expect(result).toMatchObject({ mediaType: 'image/jpeg', width: 1568, height: 1176 })
    expect(close).toHaveBeenCalled()
  })

  it('passes decode failures through, so the caller can name the file', async () => {
    const codec: ImageCodec = { decode: () => Promise.reject(new Error('unsupported')), encode: vi.fn() }
    await expect(prepareImage(new Blob(['x']), 'image/png', codec)).rejects.toThrow('unsupported')
  })
})
```

`src/images/base64.test.ts`:

```ts
// @vitest-environment node
import { blobToBase64, dataUrlToBlob } from './base64'

it('encodes a blob as base64 without a data: prefix', async () => {
  expect(await blobToBase64(new Blob(['hello']))).toBe('aGVsbG8=')
})

it('encodes large blobs in chunks', async () => {
  const bytes = new Uint8Array(200_000).fill(65)
  const encoded = await blobToBase64(new Blob([bytes]))
  expect(atob(encoded)).toHaveLength(200_000)
})

it('turns a base64 data URL back into a typed blob', async () => {
  const blob = dataUrlToBlob('data:image/png;base64,aGVsbG8=')
  expect(blob.type).toBe('image/png')
  expect(await blob.text()).toBe('hello')
})

it('rejects anything that is not a base64 data URL', () => {
  expect(() => dataUrlToBlob('https://example.test/a.png')).toThrow('Not a base64 data URL')
})
```

`src/db/images.test.ts`:

```ts
// @vitest-environment node
import 'fake-indexeddb/auto'
import { PromptCadDb } from './db'
import { loadImage, saveImage } from './images'

let database: PromptCadDb
beforeEach(() => {
  database = new PromptCadDb(`images-${crypto.randomUUID()}`)
})
afterEach(async () => {
  await database.delete()
})

it('stores images as blobs of kind image and reads them back', async () => {
  const id = await saveImage(new Blob(['png bytes'], { type: 'image/png' }), database)
  expect((await database.blobs.get(id))?.kind).toBe('image')
  const blob = await loadImage(id, database)
  expect(blob?.type).toBe('image/png')
  expect(await blob?.text()).toBe('png bytes')
})

it('returns null for unknown ids and for blobs that are not images', async () => {
  await database.blobs.put({ id: 'thumb', kind: 'thumbnail', data: new Blob(['t']) })
  expect(await loadImage('missing', database)).toBeNull()
  expect(await loadImage('thumb', database)).toBeNull()
})
```

`src/images/attachments.test.ts`:

```ts
import type { PreparedImage } from './prepareImage'
import { MAX_ATTACHMENTS, useAttachments } from './attachments'

const prepared = (type: PreparedImage['mediaType'] = 'image/jpeg'): PreparedImage => ({
  blob: new Blob(['x'], { type }),
  mediaType: type,
  width: 10,
  height: 10,
})
const okPrepare = vi.fn(async (_blob: Blob, type: PreparedImage['mediaType']) => prepared(type))
const file = (name: string, type: string) => new File(['x'], name, { type })

beforeEach(() => {
  useAttachments.setState(useAttachments.getInitialState(), true)
  okPrepare.mockClear()
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:thumb'), revokeObjectURL: vi.fn() })
})

it('adds images with a thumbnail URL, as JPEG for photos and PNG for PNGs', async () => {
  await useAttachments.getState().addFiles([file('photo.jpg', 'image/jpeg'), file('plan.png', 'image/png')], okPrepare)
  const items = useAttachments.getState().items
  expect(items.map((i) => [i.name, i.mediaType, i.url])).toEqual([
    ['photo.jpg', 'image/jpeg', 'blob:thumb'],
    ['plan.png', 'image/png', 'blob:thumb'],
  ])
  expect(useAttachments.getState().error).toBeNull()
})

it('names a file that is not an image', async () => {
  await useAttachments.getState().addFiles([file('notes.txt', 'text/plain')], okPrepare)
  expect(useAttachments.getState().items).toHaveLength(0)
  expect(useAttachments.getState().error).toBe('notes.txt is not an image. Attach a PNG, JPEG or WebP image.')
})

it('names a file the browser cannot read', async () => {
  const failing = vi.fn(() => Promise.reject(new Error('decode')))
  await useAttachments.getState().addFiles([file('photo.heic', 'image/heic')], failing)
  expect(useAttachments.getState().error).toBe('Could not read photo.heic. Attach a PNG, JPEG or WebP image.')
})

it('stops at four images per message', async () => {
  const files = ['1', '2', '3', '4', '5'].map((n) => file(`${n}.jpg`, 'image/jpeg'))
  await useAttachments.getState().addFiles(files, okPrepare)
  expect(useAttachments.getState().items).toHaveLength(MAX_ATTACHMENTS)
  expect(useAttachments.getState().error).toBe('Up to 4 images per message. 5.jpg was not added.')
})

it('revokes thumbnail URLs on remove and clear', async () => {
  await useAttachments.getState().addFiles([file('a.jpg', 'image/jpeg'), file('b.jpg', 'image/jpeg')], okPrepare)
  const [a] = useAttachments.getState().items
  useAttachments.getState().remove(a.id)
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  useAttachments.getState().clear()
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  expect(useAttachments.getState().items).toHaveLength(0)
})

it('keeps a note with prepared images such as sketches', () => {
  useAttachments.getState().addPrepared(prepared('image/png'), 'Sketch', 'two M4 holes')
  expect(useAttachments.getState().items[0]).toMatchObject({ name: 'Sketch', note: 'two M4 holes', mediaType: 'image/png' })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/images src/db/images.test.ts`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

`src/images/prepareImage.ts`:

```ts
export const MAX_IMAGE_EDGE = 1568
export const JPEG_QUALITY = 0.85

export type OutputType = 'image/png' | 'image/jpeg'

export interface PreparedImage {
  blob: Blob
  mediaType: OutputType
  width: number
  height: number
}

export interface DecodedImage {
  width: number
  height: number
  close?(): void
}

export interface ImageCodec {
  decode(blob: Blob): Promise<DecodedImage>
  encode(image: DecodedImage, width: number, height: number, type: OutputType, quality: number): Promise<Blob>
}

export function fitWithin(width: number, height: number, max = MAX_IMAGE_EDGE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

const LOSSLESS = new Set(['image/png', 'image/webp', 'image/gif', 'image/svg+xml'])

export function outputTypeFor(inputType: string): OutputType {
  return LOSSLESS.has(inputType) ? 'image/png' : 'image/jpeg'
}

export const browserCodec: ImageCodec = {
  decode: (blob) => createImageBitmap(blob),
  encode(image, width, height, type, quality) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return Promise.reject(new Error('Canvas 2D is not available'))
    ctx.drawImage(image as ImageBitmap, 0, 0, width, height)
    return new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image'))), type, quality),
    )
  },
}

/** Downscales to at most 1568 px on the long edge and re-encodes (which also drops EXIF data such as location). */
export async function prepareImage(blob: Blob, type: OutputType, codec: ImageCodec = browserCodec): Promise<PreparedImage> {
  const image = await codec.decode(blob)
  try {
    const { width, height } = fitWithin(image.width, image.height)
    return { blob: await codec.encode(image, width, height, type, JPEG_QUALITY), mediaType: type, width, height }
  } finally {
    image.close?.()
  }
}
```

`src/images/base64.ts`:

```ts
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
```

`src/images/imageData.ts`:

```ts
export function imageDataToPng(image: ImageData): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas 2D is not available'))
  ctx.putImageData(image, 0, 0)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image'))), 'image/png'),
  )
}
```

`src/db/images.ts`:

```ts
import { db, type PromptCadDb } from './db'

/** Images attached to prompts, stored with the message (and so the version) that used them. */
export async function saveImage(blob: Blob, database: PromptCadDb = db): Promise<string> {
  const id = crypto.randomUUID()
  await database.blobs.put({ id, kind: 'image', data: blob })
  return id
}

export async function loadImage(id: string, database: PromptCadDb = db): Promise<Blob | null> {
  const row = await database.blobs.get(id)
  return row?.kind === 'image' ? row.data : null
}
```

`src/images/attachments.ts`:

```ts
import { create } from 'zustand'
import { outputTypeFor, prepareImage, type OutputType, type PreparedImage } from './prepareImage'

export const MAX_ATTACHMENTS = 4

export const NO_VISION_EXPLANATION =
  'Images need a model with vision. Turn on Vision for this provider in Settings › AI providers if its model can read images.'

export interface Attachment {
  id: string
  blob: Blob
  mediaType: OutputType
  name: string
  /** Sketch note, sent as text right after the image. */
  note: string
  /** Object URL for the thumbnail; revoked on remove and clear. */
  url: string
}

type Prepare = (blob: Blob, type: OutputType) => Promise<PreparedImage>

interface AttachmentsState {
  items: Attachment[]
  error: string | null
  addFiles(files: readonly File[], prepare?: Prepare): Promise<void>
  addPrepared(image: PreparedImage, name: string, note?: string): void
  remove(id: string): void
  clear(): void
  setError(error: string | null): void
}

const tooMany = (name: string) => `Up to ${MAX_ATTACHMENTS} images per message. ${name} was not added.`

export const useAttachments = create<AttachmentsState>()((set, get) => ({
  items: [],
  error: null,
  async addFiles(files, prepare = prepareImage) {
    set({ error: null })
    for (const file of files) {
      if (get().items.length >= MAX_ATTACHMENTS) {
        set({ error: tooMany(file.name) })
        return
      }
      if (!file.type.startsWith('image/')) {
        set({ error: `${file.name} is not an image. Attach a PNG, JPEG or WebP image.` })
        continue
      }
      try {
        get().addPrepared(await prepare(file, outputTypeFor(file.type)), file.name)
      } catch {
        set({ error: `Could not read ${file.name}. Attach a PNG, JPEG or WebP image.` })
      }
    }
  },
  addPrepared(image, name, note = '') {
    if (get().items.length >= MAX_ATTACHMENTS) {
      set({ error: tooMany(name) })
      return
    }
    const item: Attachment = {
      id: crypto.randomUUID(),
      blob: image.blob,
      mediaType: image.mediaType,
      name,
      note,
      url: URL.createObjectURL(image.blob),
    }
    set((s) => ({ items: [...s.items, item] }))
  },
  remove(id) {
    const item = get().items.find((i) => i.id === id)
    if (item) URL.revokeObjectURL(item.url)
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
  },
  clear() {
    for (const item of get().items) URL.revokeObjectURL(item.url)
    set({ items: [], error: null })
  },
  setError: (error) => set({ error }),
}))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/images src/db/images.test.ts && npm run typecheck`
Expected: PASS (17 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/images/prepareImage.ts src/images/prepareImage.test.ts src/images/base64.ts src/images/base64.test.ts src/images/imageData.ts src/db/images.ts src/db/images.test.ts src/images/attachments.ts src/images/attachments.test.ts
git commit -m "feat(images): downscale to 1568 px, store as image blobs, pending attachments with limits" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Attach, paste, drop, and thumbnails

**Files:**
- Create: `src/images/AttachButton.tsx`, `src/images/AttachmentTray.tsx`, `src/images/useImageDropAndPaste.ts`, `src/images/MessageImages.tsx`
- Test: `src/images/AttachButton.test.tsx`, `src/images/AttachmentTray.test.tsx`, `src/images/useImageDropAndPaste.test.tsx`, `src/images/MessageImages.test.tsx`

**Interfaces:**
- Consumes: `useAttachments`, `NO_VISION_EXPLANATION` (Task 13), `loadImage` (Task 13), icons (Task 8, M1 `IconX`, `IconWarning`).
- Produces:
  - `<AttachButton vision onSketch />`: ghost icon button "Attach image or sketch"; disabled with `NO_VISION_EXPLANATION` as its `title` when `vision` is false; otherwise opens a menu with **Image from device** (a hidden `<input type="file" accept="image/*" multiple>`) and **Sketch** (`onSketch()`).
  - `<AttachmentTray />`: pending thumbnails (`pc-msg-img`, `alt` = file name) with "Remove <name>" buttons, and the attachment error as a `pc-callout is-error` with `role="alert"`.
  - `useImageDropAndPaste(ref, vision)`: image files pasted into or dropped onto `ref` are attached (or, without vision, the explanation is shown); text pastes are left alone.
  - `<MessageImages ids load? />`: stored images of a chat message as `pc-msg-img` thumbnails, `alt` "Attached image 1 of 2"; missing ids are skipped; object URLs are revoked on unmount.

- [ ] **Step 1: Write the failing tests**

`src/images/AttachButton.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AttachButton } from './AttachButton'
import { NO_VISION_EXPLANATION, useAttachments } from './attachments'

beforeEach(() => useAttachments.setState(useAttachments.getInitialState(), true))

it('is disabled with the reason when the profile has no vision', () => {
  render(<AttachButton vision={false} onSketch={() => {}} />)
  const button = screen.getByRole('button', { name: 'Attach image or sketch' })
  expect(button).toBeDisabled()
  expect(button).toHaveAttribute('title', NO_VISION_EXPLANATION)
})

it('offers an image from the device or a sketch', async () => {
  const onSketch = vi.fn()
  render(<AttachButton vision onSketch={onSketch} />)
  await userEvent.click(screen.getByRole('button', { name: 'Attach image or sketch' }))
  expect(screen.getByRole('menuitem', { name: 'Image from device' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('menuitem', { name: 'Sketch' }))
  expect(onSketch).toHaveBeenCalledOnce()
  expect(screen.queryByRole('menu')).toBeNull()
})

it('hands chosen files to the attachment list', () => {
  const addFiles = vi.fn(async () => {})
  useAttachments.setState({ addFiles })
  render(<AttachButton vision onSketch={() => {}} />)
  const input = screen.getByLabelText('Image file') as HTMLInputElement
  const photo = new File(['x'], 'photo.jpg', { type: 'image/jpeg' })
  fireEvent.change(input, { target: { files: [photo] } })
  expect(addFiles).toHaveBeenCalledWith([photo])
  expect(input).toHaveAttribute('accept', 'image/*')
})
```

`src/images/AttachmentTray.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AttachmentTray } from './AttachmentTray'
import { useAttachments } from './attachments'

beforeEach(() => {
  useAttachments.setState(useAttachments.getInitialState(), true)
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:thumb'), revokeObjectURL: vi.fn() })
})

it('renders nothing when there is nothing to show', () => {
  const { container } = render(<AttachmentTray />)
  expect(container).toBeEmptyDOMElement()
})

it('shows thumbnails that can be removed', async () => {
  useAttachments.getState().addPrepared({ blob: new Blob(['x']), mediaType: 'image/jpeg', width: 1, height: 1 }, 'photo.jpg')
  render(<AttachmentTray />)
  const thumb = screen.getByRole('img', { name: 'photo.jpg' })
  expect(thumb).toHaveClass('pc-msg-img')
  expect(thumb).toHaveAttribute('src', 'blob:thumb')
  await userEvent.click(screen.getByRole('button', { name: 'Remove photo.jpg' }))
  expect(screen.queryByRole('img')).toBeNull()
})

it('shows the error as a callout, as text', () => {
  useAttachments.setState({ error: '<b>x</b>.txt is not an image. Attach a PNG, JPEG or WebP image.' })
  const { container } = render(<AttachmentTray />)
  expect(screen.getByRole('alert')).toHaveTextContent('<b>x</b>.txt is not an image.')
  expect(container.querySelector('b')).toBeNull()
})
```

`src/images/useImageDropAndPaste.test.tsx`:

```tsx
import { fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { NO_VISION_EXPLANATION, useAttachments } from './attachments'
import { useImageDropAndPaste } from './useImageDropAndPaste'

function Target({ vision }: { vision: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useImageDropAndPaste(ref, vision)
  return <div ref={ref} data-testid="target" />
}

const image = new File(['x'], 'pasted.png', { type: 'image/png' })
const text = new File(['x'], 'notes.txt', { type: 'text/plain' })
const addFiles = vi.fn(async () => {})

beforeEach(() => {
  useAttachments.setState({ ...useAttachments.getInitialState(), addFiles }, true)
  addFiles.mockClear()
})

it('attaches pasted images', () => {
  const { getByTestId } = render(<Target vision />)
  fireEvent.paste(getByTestId('target'), { clipboardData: { files: [image, text], types: ['Files'] } })
  expect(addFiles).toHaveBeenCalledWith([image])
})

it('attaches dropped images', () => {
  const { getByTestId } = render(<Target vision />)
  fireEvent.drop(getByTestId('target'), { dataTransfer: { files: [image], types: ['Files'] } })
  expect(addFiles).toHaveBeenCalledWith([image])
})

it('leaves text pastes alone', () => {
  const { getByTestId } = render(<Target vision />)
  fireEvent.paste(getByTestId('target'), { clipboardData: { files: [], types: ['text/plain'] } })
  expect(addFiles).not.toHaveBeenCalled()
})

it('explains instead of attaching when the profile has no vision', () => {
  const { getByTestId } = render(<Target vision={false} />)
  fireEvent.drop(getByTestId('target'), { dataTransfer: { files: [image], types: ['Files'] } })
  expect(addFiles).not.toHaveBeenCalled()
  expect(useAttachments.getState().error).toBe(NO_VISION_EXPLANATION)
})
```

`src/images/MessageImages.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { MessageImages } from './MessageImages'

const store = new Map([
  ['a', new Blob(['a'], { type: 'image/jpeg' })],
  ['b', new Blob(['b'], { type: 'image/png' })],
])
const load = async (id: string) => store.get(id) ?? null

beforeEach(() => {
  let n = 0
  Object.assign(URL, { createObjectURL: vi.fn(() => `blob:${++n}`), revokeObjectURL: vi.fn() })
})

it('shows stored images as thumbnails above the message, skipping missing ones', async () => {
  render(<MessageImages ids={['a', 'gone', 'b']} load={load} />)
  const thumbs = await screen.findAllByRole('img')
  expect(thumbs.map((t) => t.getAttribute('alt'))).toEqual(['Attached image 1 of 2', 'Attached image 2 of 2'])
  expect(thumbs[0]).toHaveClass('pc-msg-img')
})

it('revokes its object URLs on unmount', async () => {
  const { unmount } = render(<MessageImages ids={['a']} load={load} />)
  await screen.findByRole('img')
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1')
})

it('renders nothing without images', () => {
  const { container } = render(<MessageImages ids={[]} load={load} />)
  expect(container).toBeEmptyDOMElement()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/images`
Expected: FAIL, because the four components cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

`src/images/AttachButton.tsx`:

```tsx
import { useRef, useState } from 'react'
import { IconAttach } from '../ui/icons'
import { NO_VISION_EXPLANATION, useAttachments } from './attachments'

export function AttachButton({ vision, onSketch }: { vision: boolean; onSketch(): void }) {
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const addFiles = useAttachments((s) => s.addFiles)

  return (
    <span className="relative">
      <button
        type="button"
        className="pc-btn is-icon is-sm is-ghost"
        aria-label="Attach image or sketch"
        aria-haspopup="menu"
        aria-expanded={open}
        title={vision ? 'Attach image or sketch' : NO_VISION_EXPLANATION}
        disabled={!vision}
        onClick={() => setOpen((o) => !o)}
      >
        <IconAttach className="pc-i" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Attach"
          className="absolute bottom-full left-0 z-10 mb-1 flex min-w-44 flex-col rounded-md border border-line bg-panel-raised p-1 shadow-pop"
        >
          <button
            type="button"
            role="menuitem"
            className="pc-btn is-sm is-ghost justify-start"
            onClick={() => {
              setOpen(false)
              input.current?.click()
            }}
          >
            Image from device
          </button>
          <button
            type="button"
            role="menuitem"
            className="pc-btn is-sm is-ghost justify-start"
            onClick={() => {
              setOpen(false)
              onSketch()
            }}
          >
            Sketch
          </button>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-label="Image file"
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? [])
          e.currentTarget.value = ''
          if (files.length > 0) void addFiles(files)
        }}
      />
    </span>
  )
}
```

`src/images/AttachmentTray.tsx`:

```tsx
import { IconWarning, IconX } from '../ui/icons'
import { useAttachments } from './attachments'

export function AttachmentTray() {
  const items = useAttachments((s) => s.items)
  const error = useAttachments((s) => s.error)
  const remove = useAttachments((s) => s.remove)
  if (items.length === 0 && error === null) return null

  return (
    <div className="flex flex-col gap-2">
      {items.length > 0 && (
        <div className="pc-row">
          {items.map((item) => (
            <span key={item.id} className="relative">
              <img src={item.url} alt={item.name} className="pc-msg-img object-cover" />
              <button
                type="button"
                className="pc-btn is-icon is-sm is-ghost absolute top-0 right-0"
                aria-label={`Remove ${item.name}`}
                onClick={() => remove(item.id)}
              >
                <IconX className="pc-i" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      {error !== null && (
        <div className="pc-callout is-error" role="alert">
          <IconWarning className="pc-i" aria-hidden="true" />
          <div className="pc-callout-body">{error}</div>
        </div>
      )}
    </div>
  )
}
```

`src/images/useImageDropAndPaste.ts`:

```ts
import { useEffect, type RefObject } from 'react'
import { NO_VISION_EXPLANATION, useAttachments } from './attachments'

export function useImageDropAndPaste(ref: RefObject<HTMLElement | null>, vision: boolean): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const take = (files: ArrayLike<File> | null | undefined): boolean => {
      const images = Array.from(files ?? []).filter((f) => f.type.startsWith('image/'))
      if (images.length === 0) return false
      if (vision) void useAttachments.getState().addFiles(images)
      else useAttachments.getState().setError(NO_VISION_EXPLANATION)
      return true
    }
    const onPaste = (e: ClipboardEvent) => {
      if (take(e.clipboardData?.files)) e.preventDefault()
    }
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      if (take(e.dataTransfer?.files)) e.preventDefault()
    }
    el.addEventListener('paste', onPaste)
    el.addEventListener('dragover', onDragOver)
    el.addEventListener('drop', onDrop)
    return () => {
      el.removeEventListener('paste', onPaste)
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('drop', onDrop)
    }
  }, [ref, vision])
}
```

`src/images/MessageImages.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { loadImage } from '../db/images'

/** `load` must be a stable function (the default, or a module-level one), or the images reload on every render. */
export function MessageImages({ ids, load = loadImage }: { ids: readonly string[]; load?: (id: string) => Promise<Blob | null> }) {
  const [urls, setUrls] = useState<string[]>([])
  const key = ids.join(',')

  useEffect(() => {
    let cancelled = false
    const created: string[] = []
    const wanted = key === '' ? [] : key.split(',')
    void Promise.all(wanted.map((id) => load(id))).then((blobs) => {
      if (cancelled) return
      for (const blob of blobs) if (blob) created.push(URL.createObjectURL(blob))
      setUrls([...created])
    })
    return () => {
      cancelled = true
      for (const url of created) URL.revokeObjectURL(url)
    }
  }, [key, load])

  if (urls.length === 0) return null
  return (
    <div className="pc-row justify-end">
      {urls.map((url, i) => (
        <img key={url} src={url} alt={`Attached image ${i + 1} of ${urls.length}`} className="pc-msg-img object-cover" />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/images && npm test && npm run typecheck`
Expected: PASS (13 new tests; the token test still passes), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/images/AttachButton.tsx src/images/AttachButton.test.tsx src/images/AttachmentTray.tsx src/images/AttachmentTray.test.tsx src/images/useImageDropAndPaste.ts src/images/useImageDropAndPaste.test.tsx src/images/MessageImages.tsx src/images/MessageImages.test.tsx
git commit -m "feat(images): attach button and menu, paste and drop, thumbnails in the composer and the chat" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Sketch canvas with dimensions

**Files:**
- Create: `src/sketch/sketchModel.ts`, `src/sketch/exportSketch.ts`, `src/sketch/SketchDialog.tsx`
- Test: `src/sketch/sketchModel.test.ts`, `src/sketch/exportSketch.test.ts`, `src/sketch/SketchDialog.test.tsx`

**Interfaces:**
- Consumes: `useTokens`, `readToken` (M1); `useAttachments` (Task 13); icons (Task 8).
- Produces:
  - `type Point = { x: number; y: number }`; `type SketchItem = { kind: 'stroke'; points: Point[] } | { kind: 'line'; a: Point; b: Point } | { kind: 'dim'; a: Point; b: Point; mm: number }`; `type SketchTool = 'pen' | 'line' | 'size' | 'erase'`
  - `SKETCH_SIZE = { width: 600, height: 800 }` (logical canvas pixels, the screen's 3 : 4), `GRID_STEP = 40`, `ERASE_TOLERANCE = 12`
  - `interface SketchState { items; undo }`, `emptySketch`, `sketchReducer(state, action)` with `add`, `erase`, `undo`, `clear` (all undoable)
  - `hitItem(item, p, tolerance?)`, `formatMm(mm)` ("40 mm"), `dimLabel(a, b, mm)` (label 14 px off the line, rotated to read upright)
  - `interface SketchColors { ground; grid; ink; accent }`, `type Ctx2D`, `drawSketch(ctx, items, colors, size?)`
  - `interface SketchResult { items: SketchItem[]; note: string }`
  - `sketchColors()`, `exportSketchPng(items, colors?)`, `attachSketch(result)` (adds a PNG attachment named "Sketch" with the note)
  - `<SketchDialog onCancel onAttach />` (screen `PhoneSketch`: Cancel, "Sketch", Clear, Undo; canvas; Pen / Line / Size / Erase; Note; **Attach to prompt**; caption)

- [ ] **Step 1: Write the failing tests**

`src/sketch/sketchModel.test.ts`:

```ts
import {
  dimLabel,
  drawSketch,
  emptySketch,
  formatMm,
  hitItem,
  SKETCH_SIZE,
  sketchReducer,
  type Ctx2D,
  type SketchItem,
} from './sketchModel'

const line: SketchItem = { kind: 'line', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }
const stroke: SketchItem = { kind: 'stroke', points: [{ x: 0, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 100 }] }

describe('sketchReducer', () => {
  it('adds, undoes and clears, and a clear can be undone', () => {
    let s = sketchReducer(emptySketch, { type: 'add', item: line })
    s = sketchReducer(s, { type: 'add', item: stroke })
    expect(s.items).toEqual([line, stroke])
    s = sketchReducer(s, { type: 'undo' })
    expect(s.items).toEqual([line])
    s = sketchReducer(s, { type: 'clear' })
    expect(s.items).toEqual([])
    s = sketchReducer(s, { type: 'undo' })
    expect(s.items).toEqual([line])
  })

  it('erases the item under the pointer, undoably', () => {
    let s = sketchReducer(sketchReducer(emptySketch, { type: 'add', item: line }), { type: 'add', item: stroke })
    s = sketchReducer(s, { type: 'erase', at: { x: 50, y: 4 } })
    expect(s.items).toEqual([stroke])
    expect(sketchReducer(s, { type: 'undo' }).items).toEqual([line, stroke])
  })

  it('ignores erasing empty space and undoing nothing', () => {
    const s = sketchReducer(emptySketch, { type: 'add', item: line })
    expect(sketchReducer(s, { type: 'erase', at: { x: 300, y: 300 } })).toBe(s)
    expect(sketchReducer(emptySketch, { type: 'undo' })).toBe(emptySketch)
  })
})

it('hit-tests strokes along their segments', () => {
  expect(hitItem(stroke, { x: 50, y: 75 })).toBe(true)
  expect(hitItem(stroke, { x: 80, y: 75 })).toBe(false)
})

describe('dimension labels', () => {
  it('formats millimetres with the unit', () => {
    expect(formatMm(40)).toBe('40 mm')
    expect(formatMm(2.5)).toBe('2.5 mm')
    expect(formatMm(1 / 3)).toBe('0.33 mm')
  })

  it('sits above a horizontal dimension, whichever way it was drawn', () => {
    expect(dimLabel({ x: 0, y: 0 }, { x: 100, y: 0 }, 40)).toEqual({ x: 50, y: -14, angle: 0, text: '40 mm' })
    expect(dimLabel({ x: 100, y: 0 }, { x: 0, y: 0 }, 40)).toMatchObject({ x: 50, y: -14, text: '40 mm' })
  })

  it('turns with a vertical dimension so it still reads upright', () => {
    const label = dimLabel({ x: 0, y: 0 }, { x: 0, y: 100 }, 25)
    expect(label.angle).toBeCloseTo(Math.PI / 2)
    expect(label.x).toBeCloseTo(14)
    expect(label.y).toBeCloseTo(50)
  })
})

type Op = { op: string; style?: string; args?: unknown[] }

function recordingCtx(): { ctx: Ctx2D; ops: Op[] } {
  const ops: Op[] = []
  const ctx: Record<string, unknown> = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  }
  const noop = () => {}
  Object.assign(ctx, {
    fillRect: (...args: unknown[]) => ops.push({ op: 'fillRect', style: String(ctx.fillStyle), args }),
    stroke: () => ops.push({ op: 'stroke', style: String(ctx.strokeStyle) }),
    fillText: (...args: unknown[]) => ops.push({ op: 'fillText', style: String(ctx.fillStyle), args }),
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
  })
  return { ctx: ctx as unknown as Ctx2D, ops }
}

it('draws the ground, the grid, ink strokes and accent dimensions from the given tokens', () => {
  const { ctx, ops } = recordingCtx()
  const dim: SketchItem = { kind: 'dim', a: { x: 0, y: 200 }, b: { x: 100, y: 200 }, mm: 40 }
  drawSketch(ctx, [line, dim], { ground: 'GROUND', grid: 'GRID', ink: 'INK', accent: 'ACCENT' })
  expect(ops[0]).toEqual({ op: 'fillRect', style: 'GROUND', args: [0, 0, SKETCH_SIZE.width, SKETCH_SIZE.height] })
  expect(ops.filter((o) => o.op === 'stroke').map((o) => o.style)).toEqual(['GRID', 'INK', 'ACCENT'])
  expect(ops.find((o) => o.op === 'fillText')).toEqual({ op: 'fillText', style: 'ACCENT', args: ['40 mm', 0, 0] })
})
```

`src/sketch/exportSketch.test.ts`:

```ts
import { useAttachments } from '../images/attachments'
import { attachSketch } from './exportSketch'

beforeEach(() => {
  useAttachments.setState(useAttachments.getInitialState(), true)
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:sketch'), revokeObjectURL: vi.fn() })
})
afterEach(() => vi.restoreAllMocks())

it('draws the sketch into a PNG and attaches it with its note', async () => {
  const fillRect = vi.fn()
  const noop = () => {}
  const ctx = { fillRect, beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop, save: noop, restore: noop, translate: noop, rotate: noop, fillText: noop }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' })))

  await attachSketch({ items: [{ kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 10 } }], note: 'Two M4 holes' })

  expect(fillRect).toHaveBeenCalledWith(0, 0, 600, 800)
  expect(useAttachments.getState().items).toMatchObject([{ name: 'Sketch', mediaType: 'image/png', note: 'Two M4 holes' }])
})

it('says so when the sketch cannot be saved', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  await attachSketch({ items: [], note: '' })
  expect(useAttachments.getState().error).toBe('Could not save the sketch. Try again, or attach a photo of a drawing instead.')
})
```

`src/sketch/SketchDialog.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SketchDialog } from './SketchDialog'

// jsdom may lack PointerEvent; a MouseEvent subclass carries clientX/clientY and pointerId.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventShim extends MouseEvent {
    pointerId: number
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 1
    }
  }
  Object.assign(window, { PointerEvent: PointerEventShim })
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, width: 600, height: 800, right: 600, bottom: 800, toJSON: () => ({}),
  } as DOMRect)
})
afterEach(() => vi.restoreAllMocks())

function drag(canvas: HTMLElement, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(canvas, { clientX: from[0], clientY: from[1], pointerId: 1 })
  fireEvent.pointerMove(canvas, { clientX: to[0], clientY: to[1], pointerId: 1 })
  fireEvent.pointerUp(canvas, { clientX: to[0], clientY: to[1], pointerId: 1 })
}

it('is a dialog with the screen\'s tools, with Pen selected and nothing to attach yet', () => {
  render(<SketchDialog onCancel={() => {}} onAttach={() => {}} />)
  expect(screen.getByRole('dialog', { name: 'Sketch' })).toBeInTheDocument()
  const tools = screen.getByRole('toolbar', { name: 'Sketch tools' })
  expect(within(tools).getAllByRole('button').map((b) => b.textContent)).toEqual(['Pen', 'Line', 'Size', 'Erase'])
  expect(screen.getByRole('button', { name: 'Pen' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Attach to prompt' })).toBeDisabled()
})

it('Size asks for the length in mm and attaches the dimension with the note', async () => {
  const onAttach = vi.fn()
  render(<SketchDialog onCancel={() => {}} onAttach={onAttach} />)
  await userEvent.click(screen.getByRole('button', { name: 'Size' }))
  drag(screen.getByLabelText('Sketch canvas'), [100, 400], [300, 400])
  await userEvent.type(screen.getByLabelText('Length in mm'), '40')
  await userEvent.click(screen.getByRole('button', { name: 'Add size' }))
  await userEvent.type(screen.getByLabelText('Note'), 'Two M4 holes')
  await userEvent.click(screen.getByRole('button', { name: 'Attach to prompt' }))
  expect(onAttach).toHaveBeenCalledWith({
    items: [{ kind: 'dim', a: { x: 100, y: 400 }, b: { x: 300, y: 400 }, mm: 40 }],
    note: 'Two M4 holes',
  })
})

it('undo and clear remove what was drawn', async () => {
  render(<SketchDialog onCancel={() => {}} onAttach={() => {}} />)
  const canvas = screen.getByLabelText('Sketch canvas')
  const attach = screen.getByRole('button', { name: 'Attach to prompt' })
  await userEvent.click(screen.getByRole('button', { name: 'Line' }))
  drag(canvas, [0, 0], [100, 100])
  expect(attach).toBeEnabled()
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(attach).toBeDisabled()
  drag(canvas, [0, 0], [100, 100])
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
  expect(attach).toBeDisabled()
})

it('Cancel and Esc close without attaching', async () => {
  const onCancel = vi.fn()
  const onAttach = vi.fn()
  render(<SketchDialog onCancel={onCancel} onAttach={onAttach} />)
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await userEvent.click(screen.getByLabelText('Note'))
  await userEvent.keyboard('{Escape}')
  expect(onCancel).toHaveBeenCalledTimes(2)
  expect(onAttach).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/sketch`
Expected: FAIL, because the sketch modules cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

`src/sketch/sketchModel.ts`:

```ts
export interface Point {
  x: number
  y: number
}

export type SketchItem =
  | { kind: 'stroke'; points: Point[] }
  | { kind: 'line'; a: Point; b: Point }
  | { kind: 'dim'; a: Point; b: Point; mm: number }

export type SketchTool = 'pen' | 'line' | 'size' | 'erase'

export interface SketchResult {
  items: SketchItem[]
  note: string
}

/** Logical canvas size: the PhoneSketch screen's 3 : 4 drawing area. */
export const SKETCH_SIZE = { width: 600, height: 800 } as const
export const GRID_STEP = 40
export const ERASE_TOLERANCE = 12
export const SKETCH_FONT = '600 15px "JetBrains Mono", monospace'
const LABEL_OFFSET = 14
const TICK = 8

export interface SketchState {
  items: SketchItem[]
  undo: SketchItem[][]
}

export type SketchAction =
  | { type: 'add'; item: SketchItem }
  | { type: 'erase'; at: Point }
  | { type: 'undo' }
  | { type: 'clear' }

export const emptySketch: SketchState = { items: [], undo: [] }

export function sketchReducer(state: SketchState, action: SketchAction): SketchState {
  switch (action.type) {
    case 'add':
      return { items: [...state.items, action.item], undo: [...state.undo, state.items] }
    case 'erase': {
      const items = state.items.filter((item) => !hitItem(item, action.at))
      return items.length === state.items.length ? state : { items, undo: [...state.undo, state.items] }
    }
    case 'clear':
      return state.items.length === 0 ? state : { items: [], undo: [...state.undo, state.items] }
    case 'undo':
      return state.undo.length === 0 ? state : { items: state.undo[state.undo.length - 1], undo: state.undo.slice(0, -1) }
  }
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export function hitItem(item: SketchItem, p: Point, tolerance = ERASE_TOLERANCE): boolean {
  if (item.kind === 'stroke') {
    return item.points.some((q, i) => distanceToSegment(p, q, item.points[i + 1] ?? q) <= tolerance)
  }
  return distanceToSegment(p, item.a, item.b) <= tolerance
}

export function formatMm(mm: number): string {
  return `${Number(mm.toFixed(2))} mm`
}

/** Where a dimension's label goes: beside the middle of the line, rotated so it never reads upside down. */
export function dimLabel(a: Point, b: Point, mm: number): { x: number; y: number; angle: number; text: string } {
  let angle = Math.atan2(b.y - a.y, b.x - a.x)
  if (angle > Math.PI / 2) angle -= Math.PI
  if (angle <= -Math.PI / 2) angle += Math.PI
  return {
    x: (a.x + b.x) / 2 + Math.sin(angle) * LABEL_OFFSET,
    y: (a.y + b.y) / 2 - Math.cos(angle) * LABEL_OFFSET,
    angle,
    text: formatMm(mm),
  }
}

export interface SketchColors {
  ground: string
  grid: string
  ink: string
  accent: string
}

export type Ctx2D = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'lineCap'
  | 'lineJoin'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'fillRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'stroke'
  | 'save'
  | 'restore'
  | 'translate'
  | 'rotate'
  | 'fillText'
>

function drawDimension(ctx: Ctx2D, item: Extract<SketchItem, { kind: 'dim' }>, color: string): void {
  const { a, b, mm } = item
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const nx = (-(b.y - a.y) / len) * TICK
  const ny = ((b.x - a.x) / len) * TICK
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.moveTo(a.x - nx, a.y - ny)
  ctx.lineTo(a.x + nx, a.y + ny)
  ctx.moveTo(b.x - nx, b.y - ny)
  ctx.lineTo(b.x + nx, b.y + ny)
  ctx.stroke()
  const label = dimLabel(a, b, mm)
  ctx.save()
  ctx.translate(label.x, label.y)
  ctx.rotate(label.angle)
  ctx.fillStyle = color
  ctx.font = SKETCH_FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label.text, 0, 0)
  ctx.restore()
}

export function drawSketch(
  ctx: Ctx2D,
  items: readonly SketchItem[],
  colors: SketchColors,
  size: { width: number; height: number } = SKETCH_SIZE,
): void {
  ctx.fillStyle = colors.ground
  ctx.fillRect(0, 0, size.width, size.height)
  ctx.strokeStyle = colors.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = GRID_STEP; x < size.width; x += GRID_STEP) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, size.height)
  }
  for (let y = GRID_STEP; y < size.height; y += GRID_STEP) {
    ctx.moveTo(0, y)
    ctx.lineTo(size.width, y)
  }
  ctx.stroke()

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const item of items) {
    if (item.kind === 'dim') {
      drawDimension(ctx, item, colors.accent)
      continue
    }
    const points = item.kind === 'stroke' ? item.points : [item.a, item.b]
    ctx.strokeStyle = colors.ink
    ctx.lineWidth = 2.5
    ctx.beginPath()
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    if (points.length === 1) ctx.lineTo(points[0].x + 0.01, points[0].y)
    ctx.stroke()
  }
}
```

`src/sketch/exportSketch.ts`:

```ts
import { useAttachments } from '../images/attachments'
import { readToken } from '../theme/tokens'
import { drawSketch, SKETCH_SIZE, type SketchColors, type SketchItem, type SketchResult } from './sketchModel'

export function sketchColors(): SketchColors {
  return { ground: readToken('inset'), grid: readToken('grid-minor'), ink: readToken('ink'), accent: readToken('accent') }
}

export function exportSketchPng(items: readonly SketchItem[], colors: SketchColors = sketchColors()): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = SKETCH_SIZE.width
  canvas.height = SKETCH_SIZE.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas 2D is not available'))
  drawSketch(ctx, items, colors)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the sketch'))), 'image/png'),
  )
}

/** Sketches go out as PNG (sharp lines), already within the 1568 px limit. */
export async function attachSketch({ items, note }: SketchResult): Promise<void> {
  try {
    const blob = await exportSketchPng(items)
    useAttachments
      .getState()
      .addPrepared({ blob, mediaType: 'image/png', width: SKETCH_SIZE.width, height: SKETCH_SIZE.height }, 'Sketch', note)
  } catch {
    useAttachments.getState().setError('Could not save the sketch. Try again, or attach a photo of a drawing instead.')
  }
}
```

`src/sketch/SketchDialog.tsx`:

```tsx
import { useEffect, useReducer, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useTokens } from '../theme/tokens'
import { IconClear, IconErase, IconLine, IconPen, IconSize, IconUndo } from '../ui/icons'
import {
  drawSketch,
  emptySketch,
  SKETCH_SIZE,
  sketchReducer,
  type Point,
  type SketchItem,
  type SketchResult,
  type SketchTool,
} from './sketchModel'

const TOOLS = [
  { tool: 'pen', label: 'Pen', Icon: IconPen },
  { tool: 'line', label: 'Line', Icon: IconLine },
  { tool: 'size', label: 'Size', Icon: IconSize },
  { tool: 'erase', label: 'Erase', Icon: IconErase },
] as const

const SKETCH_TOKENS = ['inset', 'grid-minor', 'ink', 'accent'] as const
const MIN_DIMENSION_PX = 4

export function SketchDialog({ onCancel, onAttach }: { onCancel(): void; onAttach(result: SketchResult): void }) {
  const t = useTokens(SKETCH_TOKENS)
  const [state, dispatch] = useReducer(sketchReducer, emptySketch)
  const [tool, setTool] = useState<SketchTool>('pen')
  const [draft, setDraft] = useState<SketchItem | null>(null)
  const [pendingDim, setPendingDim] = useState<{ a: Point; b: Point } | null>(null)
  const [mm, setMm] = useState('')
  const [note, setNote] = useState('')
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const items = draft ? [...state.items, draft] : state.items
    drawSketch(ctx, items, { ground: t.inset, grid: t['grid-minor'], ink: t.ink, accent: t.accent })
  }, [state.items, draft, t])

  const toPoint = (e: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / (rect.width || 1)) * SKETCH_SIZE.width,
      y: ((e.clientY - rect.top) / (rect.height || 1)) * SKETCH_SIZE.height,
    }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (pendingDim) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const p = toPoint(e)
    if (tool === 'erase') {
      dispatch({ type: 'erase', at: p })
      return
    }
    setDraft(tool === 'pen' ? { kind: 'stroke', points: [p] } : { kind: 'line', a: p, b: p })
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!draft) return
    const p = toPoint(e)
    if (draft.kind === 'stroke') setDraft({ ...draft, points: [...draft.points, p] })
    else if (draft.kind === 'line') setDraft({ ...draft, b: p })
  }

  const onPointerUp = () => {
    if (!draft) return
    setDraft(null)
    if (tool === 'size' && draft.kind === 'line') {
      if (Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y) >= MIN_DIMENSION_PX) setPendingDim({ a: draft.a, b: draft.b })
      return
    }
    dispatch({ type: 'add', item: draft })
  }

  const addSize = (e: FormEvent) => {
    e.preventDefault()
    const value = Number(mm.replace(',', '.'))
    if (!pendingDim || !(value > 0)) return
    dispatch({ type: 'add', item: { kind: 'dim', a: pendingDim.a, b: pendingDim.b, mm: value } })
    setPendingDim(null)
    setMm('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sketch"
        className="flex h-full w-full flex-col bg-panel text-ink md:h-auto md:max-h-[92vh] md:w-[480px] md:rounded-lg md:border md:border-line md:shadow-pop"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
        }}
      >
        <header className="flex items-center gap-2 border-b border-line p-2">
          <button type="button" className="pc-btn is-ghost" onClick={onCancel}>
            Cancel
          </button>
          <span className="flex-1 text-center font-semibold">Sketch</span>
          <button
            type="button"
            className="pc-btn is-icon is-ghost"
            aria-label="Clear"
            title="Clear"
            disabled={state.items.length === 0}
            onClick={() => dispatch({ type: 'clear' })}
          >
            <IconClear className="pc-i" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="pc-btn is-icon is-ghost"
            aria-label="Undo"
            title="Undo"
            disabled={state.undo.length === 0}
            onClick={() => dispatch({ type: 'undo' })}
          >
            <IconUndo className="pc-i" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 bg-inset">
          <canvas
            ref={canvas}
            width={SKETCH_SIZE.width}
            height={SKETCH_SIZE.height}
            aria-label="Sketch canvas"
            className="mx-auto block aspect-[3/4] max-h-full w-full max-w-full touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDraft(null)}
          />
        </div>

        <div className="flex flex-col gap-3 border-t border-line bg-panel px-4 py-3">
          {pendingDim && (
            <form className="pc-row" onSubmit={addSize}>
              <label className="pc-input is-mono">
                <input inputMode="decimal" aria-label="Length in mm" autoFocus value={mm} onChange={(e) => setMm(e.target.value)} />
                <span className="pc-unit">mm</span>
              </label>
              <button type="submit" className="pc-btn is-sm is-primary">
                Add size
              </button>
              <button type="button" className="pc-btn is-sm is-ghost" onClick={() => setPendingDim(null)}>
                Cancel size
              </button>
            </form>
          )}
          <div className="pc-tabs grid grid-cols-4" role="toolbar" aria-label="Sketch tools">
            {TOOLS.map(({ tool: id, label, Icon }) => (
              <button
                key={id}
                type="button"
                className={`pc-tab justify-center ${tool === id ? 'bg-accent-soft text-ink' : ''}`}
                aria-pressed={tool === id}
                onClick={() => setTool(id)}
              >
                <Icon className="pc-i" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <label className="pc-input">
            <input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button
            type="button"
            className="pc-btn is-primary"
            disabled={state.items.length === 0}
            onClick={() => onAttach({ items: state.items, note: note.trim() })}
          >
            Attach to prompt
          </button>
          <span className="pc-caption">
            Choose Size and drag between two points to add a dimension in mm. Sent as an image to vision models only.
          </span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sketch && npm test && npm run typecheck`
Expected: PASS (14 new tests; the token test still passes), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/sketch
git commit -m "feat(sketch): sketch canvas with pen, line, size and erase, exported as a PNG attachment" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Send images, sketches and the picked part with the prompt

**Files:**
- Create: `src/refine/turnInput.ts`, `src/refine/PickChip.tsx`
- Modify (M2 files, located below): the composer, the chat column, the send path
- Test: `src/refine/turnInput.test.ts`, `src/refine/PickChip.test.tsx`

**Interfaces:**
- Consumes: `ContentPart` (M2), `PromptContext` (M2), `ChatMessage.imageBlobIds` (M2), `runTurn` (M2); `Attachment`, `useAttachments`, `NO_VISION_EXPLANATION` (Task 13); `saveImage`, `blobToBase64`, `dataUrlToBlob`, `prepareImage` (Task 13); `PickResult` (Task 6); `useRefineStore` (Task 7); `formatLines` (Task 2); `formatDims` (M1); `AttachButton`, `AttachmentTray`, `useImageDropAndPaste`, `MessageImages` (Task 14); `SketchDialog`, `attachSketch` (Task 15); `useVisionSupport` (Task 8).
- Produces:
  - `interface TurnInput { userText: string | ContentPart[]; selection?: PromptContext['selection']; imageBlobIds: string[] }`
  - `interface TurnInputDeps { saveImage(blob): Promise<string>; toBase64(blob): Promise<string>; captureViewport(): Promise<{ blob: Blob; mediaType: 'image/png' | 'image/jpeg'; note: string } | null> }`
  - `describeRegion(bounds): string` ("the box from [0, 0, 0] to [10, 10, 0] mm (10 × 10 × 0 mm)")
  - `prepareTurnInput(opts: { text; attachments; pick; vision }, deps?): Promise<TurnInput>`:
    - a part pick becomes `selection: { startLine, endLine, label }` (its edit scope);
    - a region pick appends "The part I mean is inside <region>" to the text, plus ", outlined in the attached view of the model" and a viewport capture when `vision` is true and a capture is available;
    - each image becomes an image part (and its note a text part right after it) and is saved as a `blobs` row; with no images `userText` stays a string;
    - attachments without vision reject with `NO_VISION_EXPLANATION`.
  - `<PickChip />`: `pc-chip is-pick` "bores · lines 15–17" (or "Selected region · 10 × 10 × 0 mm"), "Clear selected part", and "Only this part will change" (or "Its position is sent with your message").

- [ ] **Step 1: Write the failing tests**

`src/refine/turnInput.test.ts`:

```ts
// @vitest-environment node
import { NO_VISION_EXPLANATION, type Attachment } from '../images/attachments'
import { boxPickFixture, partPickFixture } from '../test/picks'
import { describeRegion, prepareTurnInput, type TurnInputDeps } from './turnInput'

function fakeDeps(view: Blob | null = null) {
  const saved: Blob[] = []
  const captureViewport = vi.fn(async () => (view ? { blob: view, mediaType: 'image/png' as const, note: '' } : null))
  const deps: TurnInputDeps = {
    saveImage: async (blob) => {
      saved.push(blob)
      return `id-${saved.length}`
    },
    toBase64: async (blob) => `b64:${await blob.text()}`,
    captureViewport,
  }
  return { deps, saved, captureViewport }
}

const attachment = (name: string, note = ''): Attachment => ({
  id: name,
  blob: new Blob([name], { type: 'image/jpeg' }),
  mediaType: 'image/jpeg',
  name: `${name}.jpg`,
  note,
  url: 'blob:x',
})

it('sends plain text as a string', async () => {
  const { deps } = fakeDeps()
  expect(await prepareTurnInput({ text: 'Make it taller', attachments: [], pick: null, vision: false }, deps)).toEqual({
    userText: 'Make it taller',
    selection: undefined,
    imageBlobIds: [],
  })
})

it('turns a picked part into the selection', async () => {
  const { deps } = fakeDeps()
  const input = await prepareTurnInput({ text: 'Wider', attachments: [], pick: partPickFixture(), vision: false }, deps)
  expect(input.selection).toEqual({ startLine: 15, endLine: 17, label: 'bores' })
  expect(input.userText).toBe('Wider')
})

it('sends images as parts, notes right after their image, and stores each image', async () => {
  const { deps, saved } = fakeDeps()
  const input = await prepareTurnInput(
    { text: 'Like this', attachments: [attachment('photo'), attachment('sketch', 'two M4 holes')], pick: null, vision: true },
    deps,
  )
  expect(input.userText).toEqual([
    { type: 'text', text: 'Like this' },
    { type: 'image', mediaType: 'image/jpeg', data: 'b64:photo' },
    { type: 'image', mediaType: 'image/jpeg', data: 'b64:sketch' },
    { type: 'text', text: 'Note for the image above: two M4 holes' },
  ])
  expect(input.imageBlobIds).toEqual(['id-1', 'id-2'])
  expect(saved).toHaveLength(2)
})

it('a region on a vision profile sends the outlined view and the coordinates', async () => {
  const { deps, captureViewport } = fakeDeps(new Blob(['view'], { type: 'image/png' }))
  const input = await prepareTurnInput({ text: 'Round this off', attachments: [], pick: boxPickFixture(), vision: true }, deps)
  expect(captureViewport).toHaveBeenCalledOnce()
  expect(input.selection).toBeUndefined()
  expect(input.userText).toEqual([
    {
      type: 'text',
      text: `Round this off\n\nThe part I mean is inside ${describeRegion(boxPickFixture().bounds)}, outlined in the attached view of the model.`,
    },
    { type: 'image', mediaType: 'image/png', data: 'b64:view' },
  ])
  expect(input.imageBlobIds).toEqual(['id-1'])
})

it('a region without vision sends the coordinates as text only', async () => {
  const { deps, captureViewport } = fakeDeps(new Blob(['view']))
  const input = await prepareTurnInput({ text: 'Round this off', attachments: [], pick: boxPickFixture(), vision: false }, deps)
  expect(captureViewport).not.toHaveBeenCalled()
  expect(input.userText).toBe('Round this off\n\nThe part I mean is inside the box from [0, 0, 0] to [10, 10, 0] mm (10 × 10 × 0 mm).')
})

it('a region without a capture still sends the coordinates', async () => {
  const { deps } = fakeDeps(null)
  const input = await prepareTurnInput({ text: 'Round this off', attachments: [], pick: boxPickFixture(), vision: true }, deps)
  expect(typeof input.userText).toBe('string')
})

it('refuses images on a profile without vision', async () => {
  const { deps } = fakeDeps()
  await expect(prepareTurnInput({ text: 'x', attachments: [attachment('photo')], pick: null, vision: false }, deps)).rejects.toThrow(
    NO_VISION_EXPLANATION,
  )
})
```

`src/refine/PickChip.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { boxPickFixture, partPickFixture } from '../test/picks'
import { PickChip } from './PickChip'
import { useRefineStore } from './refineStore'

beforeEach(() => useRefineStore.setState(useRefineStore.getInitialState(), true))

it('renders nothing without a pick', () => {
  const { container } = render(<PickChip />)
  expect(container).toBeEmptyDOMElement()
})

it('names the part and its lines, says only it will change, and clears', async () => {
  useRefineStore.setState({ pick: partPickFixture() })
  render(<PickChip />)
  const chip = screen.getByText('bores · lines 15–17')
  expect(chip).toHaveClass('pc-chip', 'is-pick')
  expect(screen.getByText('Only this part will change')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Clear selected part' }))
  expect(useRefineStore.getState().pick).toBeNull()
})

it('describes a region by its size', () => {
  useRefineStore.setState({ pick: boxPickFixture() })
  render(<PickChip />)
  expect(screen.getByText('Selected region · 10 × 10 × 0 mm')).toBeInTheDocument()
  expect(screen.getByText('Its position is sent with your message')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/refine/turnInput.test.ts src/refine/PickChip.test.tsx`
Expected: FAIL, because `./turnInput` and `./PickChip` cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

`src/refine/turnInput.ts`:

```ts
import type { PromptContext } from '../ai/prompt'
import type { ContentPart } from '../ai/types'
import { saveImage } from '../db/images'
import { NO_VISION_EXPLANATION, type Attachment } from '../images/attachments'
import { blobToBase64, dataUrlToBlob } from '../images/base64'
import { prepareImage } from '../images/prepareImage'
import { formatDims } from '../render/dims'
import type { Bounds, Vec3 } from '../render/types'
import type { PickResult } from './pick'
import { useRefineStore } from './refineStore'

export interface TurnInput {
  userText: string | ContentPart[]
  selection?: PromptContext['selection']
  imageBlobIds: string[]
}

interface OutgoingImage {
  blob: Blob
  mediaType: 'image/png' | 'image/jpeg'
  note: string
}

export interface TurnInputDeps {
  saveImage(blob: Blob): Promise<string>
  toBase64(blob: Blob): Promise<string>
  captureViewport(): Promise<OutgoingImage | null>
}

const browserDeps: TurnInputDeps = {
  saveImage: (blob) => saveImage(blob),
  toBase64: blobToBase64,
  async captureViewport() {
    const capture = useRefineStore.getState().capture
    if (!capture) return null
    const png = await prepareImage(dataUrlToBlob(capture()), 'image/png')
    return { blob: png.blob, mediaType: png.mediaType, note: '' }
  },
}

const point = (v: Vec3) => `[${v.map((n) => Number(n.toFixed(2))).join(', ')}]`

export function describeRegion(bounds: Bounds): string {
  return `the box from ${point(bounds.min)} to ${point(bounds.max)} mm (${formatDims(bounds)})`
}

export async function prepareTurnInput(
  opts: { text: string; attachments: readonly Attachment[]; pick: PickResult | null; vision: boolean },
  deps: TurnInputDeps = browserDeps,
): Promise<TurnInput> {
  const { text, attachments, pick, vision } = opts
  if (attachments.length > 0 && !vision) throw new Error(NO_VISION_EXPLANATION)

  const images: OutgoingImage[] = attachments.map((a) => ({ blob: a.blob, mediaType: a.mediaType, note: a.note }))
  let prompt = text
  if (pick?.kind === 'box') {
    const view = vision ? await deps.captureViewport() : null
    if (view) images.push(view)
    prompt = `${text}\n\nThe part I mean is inside ${describeRegion(pick.bounds)}${view ? ', outlined in the attached view of the model' : ''}.`
  }
  const selection =
    pick?.kind === 'part' ? { startLine: pick.scope.startLine, endLine: pick.scope.endLine, label: pick.statement.label } : undefined

  if (images.length === 0) return { userText: prompt, selection, imageBlobIds: [] }

  const parts: ContentPart[] = [{ type: 'text', text: prompt }]
  const imageBlobIds: string[] = []
  for (const image of images) {
    parts.push({ type: 'image', mediaType: image.mediaType, data: await deps.toBase64(image.blob) })
    if (image.note.trim() !== '') parts.push({ type: 'text', text: `Note for the image above: ${image.note.trim()}` })
    imageBlobIds.push(await deps.saveImage(image.blob))
  }
  return { userText: parts, selection, imageBlobIds }
}
```

`src/refine/PickChip.tsx`:

```tsx
import { formatDims } from '../render/dims'
import { formatLines } from '../scad/statements'
import { IconPart, IconX } from '../ui/icons'
import { useRefineStore } from './refineStore'

/** Refine screen: the composer's scope chip. */
export function PickChip() {
  const pick = useRefineStore((s) => s.pick)
  const setPick = useRefineStore((s) => s.setPick)
  if (!pick) return null
  const label =
    pick.kind === 'part' ? `${pick.statement.label} · ${formatLines(pick.scope)}` : `Selected region · ${formatDims(pick.bounds)}`
  return (
    <div className="pc-row">
      <span className="pc-chip is-pick">
        <IconPart className="pc-i" aria-hidden="true" />
        {label}
      </span>
      <button type="button" className="pc-btn is-icon is-sm is-ghost" aria-label="Clear selected part" onClick={() => setPick(null)}>
        <IconX className="pc-i" aria-hidden="true" />
      </button>
      <span className="pc-caption">{pick.kind === 'part' ? 'Only this part will change' : 'Its position is sent with your message'}</span>
    </div>
  )
}
```

(`getByText('bores · lines 15–17')` matches the chip because the icon is an empty SVG.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/refine && npm run typecheck`
Expected: PASS (10 new tests), no type errors.

- [ ] **Step 5: Wire it into M2's chat**

These files are outside the shared contracts. M2's plan creates them as `src/chat/Composer.tsx`, `src/chat/ChatPanel.tsx` and `src/chat/sendPrompt.ts` (`sendPrompt(text, deps)`); confirm with `grep -rln "pc-composer" src --include=*.tsx | grep -v test`, `grep -rln "pc-msg-body" src --include=*.tsx | grep -v test` and `grep -rln "runTurn(" src --include=*.ts | grep -v test`, and apply the same edits wherever they are.

Composer (the component that renders `.pc-composer`):

```tsx
import { useState } from 'react'
import { AttachButton } from '../images/AttachButton'
import { AttachmentTray } from '../images/AttachmentTray'
import { PickChip } from '../refine/PickChip'
import { useVisionSupport } from '../refine/useVisionSupport'
import { attachSketch } from '../sketch/exportSketch'
import { SketchDialog } from '../sketch/SketchDialog'

// inside the component
  const vision = useVisionSupport()
  const [sketching, setSketching] = useState(false)

// first children of the .pc-composer element, before the textarea
      <PickChip />
      <AttachmentTray />

// first child of .pc-composer-bar, before the model picker (and before M4's mic button)
        <AttachButton vision={vision} onSketch={() => setSketching(true)} />

// last child of the .pc-composer element
      {sketching && (
        <SketchDialog
          onCancel={() => setSketching(false)}
          onAttach={(result) => {
            setSketching(false)
            void attachSketch(result)
          }}
        />
      )}
```

Chat column (the component that renders the messages and the composer):

```tsx
import { useRef } from 'react'
import { MessageImages } from '../images/MessageImages'
import { useImageDropAndPaste } from '../images/useImageDropAndPaste'
import { useVisionSupport } from '../refine/useVisionSupport'

// inside the component; put `ref={column}` on the column's root element
  const column = useRef<HTMLElement>(null)
  useImageDropAndPaste(column, useVisionSupport())

// in a user message, directly before its .pc-msg-body element
  {m.imageBlobIds && m.imageBlobIds.length > 0 && <MessageImages ids={m.imageBlobIds} />}
```

(If the root element is a `div`, type the ref as `useRef<HTMLDivElement>(null)`.)

Send path (`sendPrompt`):

```ts
import { useAttachments } from '../images/attachments'
import { useRefineStore } from '../refine/refineStore'
import { prepareTurnInput, type TurnInput, type TurnInputDeps } from '../refine/turnInput'
import { errorMessage } from '../render/result'

// SendDeps gains
  turnInput?: TurnInputDeps

// directly after the early `return` guard (text, busy, profile, model):
  // M5: images, sketches and the picked part travel with the prompt.
  useChatStore.setState({ busy: true })
  let input: TurnInput
  try {
    input = await prepareTurnInput(
      { text: userText, attachments: useAttachments.getState().items, pick: useRefineStore.getState().pick, vision: profile.capabilities.vision },
      deps.turnInput,
    )
  } catch (err) {
    useAttachments.getState().setError(errorMessage(err))
    useChatStore.setState({ busy: false })
    return
  }
  useAttachments.getState().clear()

// the user message gains the stored images
  chat.addMessage({ role: 'user', text: userText, turnLabel: null, model: null, usage: null, status: 'done', imageBlobIds: input.imageBlobIds })

// in the runTurn call, replace the userText and ctx arguments
      userText: input.userText,
      ctx: { code: startCode === DEFAULT_CODE && !input.selection ? '' : startCode, selection: input.selection },
```

The `history` entry M2 records for the turn keeps using the plain `userText` string, so earlier images are not sent again on later turns. A selection always sends the real code, even when it equals `DEFAULT_CODE`, because the selection's line numbers refer to it. M3's version of the send path may build `ctx` with more fields (libraries); keep them and add `selection`.

- [ ] **Step 6: Run the whole suite**

Run: `npm test && npm run typecheck`
Expected: PASS (M2's composer, chat and send tests still pass: with no attachments and no pick, `prepareTurnInput` returns the same string and no selection), no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/refine/turnInput.ts src/refine/turnInput.test.ts src/refine/PickChip.tsx src/refine/PickChip.test.tsx src/chat
git commit -m "feat(chat): send images, sketches and the picked part with the prompt; pick chip in the composer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Optional visual check after an AI change

**Files:**
- Modify: `src/db/db.ts` (`Settings`, `DEFAULT_SETTINGS`), the send path (`sendPrompt`), the settings page's Rendering section
- Create: `src/db/visualCheck.ts`, `src/refine/visualCheck.ts`, `src/settings/VisualCheckSetting.tsx`
- Test: `src/db/visualCheck.test.ts`, `src/refine/visualCheck.test.ts`, `src/settings/VisualCheckSetting.test.tsx`

**Interfaces:**
- Consumes: `Settings`, `DEFAULT_SETTINGS`, `PromptCadDb`, `db`, `ProviderProfile`, `UsageRecord` (M2/M3 contract); `computeCost` (M2); `LlmProvider`, `ContentPart`, `Usage`, `ModelPrice`, `ProviderError` (M2); `ChatMessage` (M2); `renderFrames`, `presetPose` (M4 contract); `blobToBase64`, `imageDataToPng` (Task 13); `readToken` (M1); `errorMessage` (M1).
- Produces:
  - Contract field `Settings.visualCheck: boolean`, `DEFAULT_SETTINGS.visualCheck = false`.
  - `getVisualCheck(database?)`, `setVisualCheck(on, database?)`, `recordVisualCheckUsage({ profile, model, usage, projectId? }, database?)`.
  - `VISUAL_CHECK_QUESTION = 'Does this match the request? Answer yes or no and one sentence.'`
  - `renderIsoImage(mesh): Promise<ImagePart>` (one 768 × 768 iso frame from `renderFrames` on the `viewport` token, as PNG).
  - `runVisualCheck({ provider, model, request, mesh, signal?, renderImage? }): Promise<{ answer: string; usage: Usage }>` (one request, `maxTokens: 200`, answer whitespace-collapsed and capped at 400 characters).
  - `maybeVisualCheck({ enabled, vision, provider, model, request, mesh, price?, signal?, renderImage?, addNote, onUsage? }): Promise<void>`: does nothing unless enabled and the profile has vision; adds one `note` message "Visual check: …" (or "Visual check failed: …"); never sends anything back to the model and never starts another turn.
  - `<VisualCheckSetting />`: `pc-switch` "Visual check after each AI change" with an explanatory caption.

- [ ] **Step 1: Write the failing tests**

`src/db/visualCheck.test.ts`:

```ts
// @vitest-environment node
import 'fake-indexeddb/auto'
import { DEFAULT_SETTINGS, PromptCadDb, type ProviderProfile } from './db'
import { getVisualCheck, recordVisualCheckUsage, setVisualCheck } from './visualCheck'

let database: PromptCadDb
beforeEach(() => {
  database = new PromptCadDb(`visual-check-${crypto.randomUUID()}`)
})
afterEach(async () => {
  await database.delete()
})

it('is off by default, including for settings saved before M5', async () => {
  expect(DEFAULT_SETTINGS.visualCheck).toBe(false)
  expect(await getVisualCheck(database)).toBe(false)
  const older = Object.fromEntries(Object.entries(DEFAULT_SETTINGS).filter(([key]) => key !== 'visualCheck'))
  await database.settings.put(older as typeof DEFAULT_SETTINGS)
  expect(await getVisualCheck(database)).toBe(false)
})

it('turns on and off without touching other settings', async () => {
  await database.settings.put({ ...DEFAULT_SETTINGS, activeProfileId: 'p1' })
  await setVisualCheck(true, database)
  expect(await getVisualCheck(database)).toBe(true)
  expect((await database.settings.get('app'))?.activeProfileId).toBe('p1')
  await setVisualCheck(false, database)
  expect(await getVisualCheck(database)).toBe(false)
})

it('records the check as a usage row priced from the profile', async () => {
  const profile: ProviderProfile = {
    id: 'p1',
    name: 'Test',
    adapter: 'openai-compatible',
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key',
    defaultModel: 'm',
    cachedModels: [],
    capabilities: { streaming: true, vision: true, audio: false },
    priceTable: { m: { inputPerMTok: 1, outputPerMTok: 2 } },
    createdAt: 0,
    updatedAt: 0,
  }
  const row = await recordVisualCheckUsage({ profile, model: 'm', usage: { inputTokens: 1000, outputTokens: 500 } }, database)
  expect(await database.usage.get(row.id)).toMatchObject({ profileId: 'p1', model: 'm', inputTokens: 1000, outputTokens: 500, costSource: 'price-table' })
  expect(row.cost).toBeCloseTo(0.002)
})
```

`src/refine/visualCheck.test.ts`:

```ts
import { ProviderError, type ChatEvent, type ChatRequest, type LlmProvider } from '../ai/types'
import { meshOf } from '../test/meshes'
import { maybeVisualCheck, runVisualCheck, VISUAL_CHECK_QUESTION } from './visualCheck'

const MESH = meshOf([[0, 0, 0, 1, 0, 0, 0, 1, 0]])
const IMAGE = { type: 'image', mediaType: 'image/png', data: 'iso' } as const
const renderImage = async () => IMAGE

function scriptedProvider(reply: string | Error): LlmProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = []
  return {
    requests,
    listModels: async () => [],
    async *streamChat(req: ChatRequest): AsyncIterable<ChatEvent> {
      requests.push(req)
      if (reply instanceof Error) throw reply
      yield { type: 'text', delta: reply }
      yield { type: 'usage', usage: { inputTokens: 900, outputTokens: 20 } }
    },
  }
}

it('asks the vision model the fixed question with the request and an iso image', async () => {
  const provider = scriptedProvider('Yes.\n  It has four   bores.')
  const result = await runVisualCheck({ provider, model: 'm', request: 'A holder for four 18650 cells', mesh: MESH, renderImage })
  const req = provider.requests[0]
  expect(req.maxTokens).toBe(200)
  expect(req.messages).toEqual([
    { role: 'user', content: [{ type: 'text', text: `Request: A holder for four 18650 cells\n\n${VISUAL_CHECK_QUESTION}` }, IMAGE] },
  ])
  expect(result).toEqual({ answer: 'Yes. It has four bores.', usage: { inputTokens: 900, outputTokens: 20 } })
})

describe('maybeVisualCheck', () => {
  const base = { model: 'm', request: 'A block', mesh: MESH, renderImage }

  it('does nothing when the setting is off or the profile has no vision', async () => {
    const provider = scriptedProvider('Yes.')
    const addNote = vi.fn()
    await maybeVisualCheck({ ...base, provider, enabled: false, vision: true, addNote })
    await maybeVisualCheck({ ...base, provider, enabled: true, vision: false, addNote })
    expect(provider.requests).toHaveLength(0)
    expect(addNote).not.toHaveBeenCalled()
  })

  it('shows the answer as a note with its cost, and reports usage once', async () => {
    const addNote = vi.fn()
    const onUsage = vi.fn()
    await maybeVisualCheck({
      ...base,
      provider: scriptedProvider('No. The lid is missing.'),
      enabled: true,
      vision: true,
      price: { inputPerMTok: 1, outputPerMTok: 5 },
      addNote,
      onUsage,
    })
    expect(addNote).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ role: 'note', text: 'Visual check: No. The lid is missing.', status: 'done', model: 'm' }),
    )
    expect(addNote.mock.calls[0][0].usage.cost).toBeCloseTo(0.001)
    expect(onUsage).toHaveBeenCalledExactlyOnceWith({ inputTokens: 900, outputTokens: 20 })
  })

  it('says when the check failed, and stays quiet when it was stopped', async () => {
    const addNote = vi.fn()
    await maybeVisualCheck({ ...base, provider: scriptedProvider(new ProviderError('network', 'Network error')), enabled: true, vision: true, addNote })
    expect(addNote).toHaveBeenCalledWith(expect.objectContaining({ text: 'Visual check failed: Network error' }))
    addNote.mockClear()
    await maybeVisualCheck({ ...base, provider: scriptedProvider(new ProviderError('aborted', 'Stopped')), enabled: true, vision: true, addNote })
    expect(addNote).not.toHaveBeenCalled()
  })
})
```

`src/settings/VisualCheckSetting.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getVisualCheck, setVisualCheck } from '../db/visualCheck'
import { VisualCheckSetting } from './VisualCheckSetting'

vi.mock('../db/visualCheck', () => ({ getVisualCheck: vi.fn(async () => false), setVisualCheck: vi.fn(async () => {}) }))

it('loads the setting, off by default, and saves changes', async () => {
  render(<VisualCheckSetting />)
  const toggle = screen.getByRole('checkbox', { name: 'Visual check after each AI change' })
  await waitFor(() => expect(getVisualCheck).toHaveBeenCalled())
  expect(toggle).not.toBeChecked()
  await userEvent.click(toggle)
  expect(toggle).toBeChecked()
  expect(setVisualCheck).toHaveBeenCalledWith(true)
  expect(screen.getByText(/Uses extra tokens\./)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/db/visualCheck.test.ts src/refine/visualCheck.test.ts src/settings/VisualCheckSetting.test.tsx`
Expected: FAIL, because the modules cannot be resolved (and `DEFAULT_SETTINGS.visualCheck` is undefined).

- [ ] **Step 3: Write minimal implementation**

In `src/db/db.ts`, add the M5 field to `Settings` and its default (keep every M2–M4 field):

```ts
// in interface Settings
  /** M5: after a successful AI render, ask a vision model whether the result matches the request. */
  visualCheck: boolean

// in DEFAULT_SETTINGS
  visualCheck: false,
```

No Dexie version bump is needed: `settings` is a singleton record, the field is not indexed, and every reader below treats a missing value as `false` (M2's `getSettings` also merges `DEFAULT_SETTINGS` over the stored record).

`src/db/visualCheck.ts`:

```ts
import { computeCost } from '../ai/cost'
import type { Usage } from '../ai/types'
import { db, DEFAULT_SETTINGS, type PromptCadDb, type ProviderProfile, type UsageRecord } from './db'

export async function getVisualCheck(database: PromptCadDb = db): Promise<boolean> {
  return (await database.settings.get('app'))?.visualCheck ?? false
}

export async function setVisualCheck(on: boolean, database: PromptCadDb = db): Promise<void> {
  await database.transaction('rw', database.settings, async () => {
    const current = await database.settings.get('app')
    await database.settings.put({ ...DEFAULT_SETTINGS, ...current, id: 'app', visualCheck: on })
  })
}

export async function recordVisualCheckUsage(
  input: { profile: ProviderProfile; model: string; usage: Usage; projectId?: string | null },
  database: PromptCadDb = db,
): Promise<UsageRecord> {
  const { cost, costSource } = computeCost(input.usage, input.profile.priceTable[input.model])
  const record: UsageRecord = {
    id: crypto.randomUUID(),
    profileId: input.profile.id,
    model: input.model,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    cost,
    costSource,
    createdAt: Date.now(),
    projectId: input.projectId ?? null,
    versionId: null,
  }
  await database.usage.add(record)
  return record
}
```

`src/refine/visualCheck.ts`:

```ts
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
    else usage = event.usage
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
```

`src/settings/VisualCheckSetting.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { getVisualCheck, setVisualCheck } from '../db/visualCheck'

export function VisualCheckSetting() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let alive = true
    void getVisualCheck().then((value) => {
      if (alive) setOn(value)
    })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="flex flex-col gap-1">
      <label className="pc-switch">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            const next = e.currentTarget.checked
            setOn(next)
            void setVisualCheck(next)
          }}
        />
        <span className="pc-track" aria-hidden="true" />
        Visual check after each AI change
      </label>
      <span className="pc-caption">
        Sends a picture of the new model to a vision model and shows its yes or no answer in the chat. Needs a provider with Vision
        turned on. Uses extra tokens.
      </span>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/db/visualCheck.test.ts src/refine/visualCheck.test.ts src/settings/VisualCheckSetting.test.tsx && npm run typecheck`
Expected: PASS (8 tests), no type errors.

- [ ] **Step 5: Wire it in**

Settings page: render `<VisualCheckSetting />` in the Rendering section, after the auto-fix attempts control (`grep -rn "Auto-fix attempts" src --include=*.tsx | grep -v test` finds it).

Send path (`sendPrompt`), next to the Task 16 edits:

```ts
import { getVisualCheck, recordVisualCheckUsage } from '../db/visualCheck'
import { maybeVisualCheck } from '../refine/visualCheck'

// after prepareTurnInput: read the setting once per turn, and create the provider once
  const visualCheck = await getVisualCheck()
  const provider = (deps.createProvider ?? defaultCreateProvider)(profile)
  let checked = false

// in the runTurn call, pass the same provider
      provider,

// in onEvent, the 'rendered' case: keep M2's patchMessage line first, then
        if (e.result.ok && !checked) {
          checked = true
          void maybeVisualCheck({
            enabled: visualCheck,
            vision: profile.capabilities.vision,
            provider,
            model,
            request: userText,
            mesh: e.result.mesh,
            price: profile.priceTable[model],
            signal: controller.signal,
            addNote: (n) => useChatStore.getState().addMessage(n),
            onUsage: (usage) => void recordVisualCheckUsage({ profile, model, usage }).catch(() => {}),
          })
        }
        return
```

(`addMessage` is M2's chat store action that takes a message without its id. If the executed M2 names it differently, append the note through that action.)

- [ ] **Step 6: Run the whole suite**

Run: `npm test && npm run typecheck`
Expected: PASS (with the setting off, nothing changes for existing chat tests), no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/db/db.ts src/db/visualCheck.ts src/db/visualCheck.test.ts src/refine/visualCheck.ts src/refine/visualCheck.test.ts src/settings src/chat
git commit -m "feat(refine): optional visual check of AI results by a vision model, off by default" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: End to end: tap a part, scoped edit, image part

**Files:**
- Create: `e2e/refine.spec.ts`
- Test: `e2e/refine.spec.ts`

**Interfaces:**
- Consumes: the whole M5 feature through the UI; the fake OpenAI-compatible endpoint pattern from the design doc (`page.route('https://fake-llm.test/v1/**', …)`); the `promptcad` IndexedDB stores `providerProfiles` and `settings` (M2 contract shapes).
- Produces: two Playwright tests against the production build with the real OpenSCAD WASM and the CSP on.

**Why tapping the canvas centre is deterministic.** "Fit view" points the camera at the centre of the model's bounding box from a fixed direction (`computeCameraFit`, M1), and that centre is the middle of the canvas. The model is a 40 × 40 × 10 mm plate with a 10 × 10 × 10 mm peg standing on its middle, so the box centre (20, 20, 10) lies on the peg's footprint and the line of sight from the iso direction meets the peg's side face first. Tapping the centre therefore always hits the peg, at any canvas size, with no test-only code in the production build. The test waits for `data-part-tags="ready"`, which the viewer sets for users too (it drives "finding parts…"). The provider profile is written straight into IndexedDB, because its shape is a shared contract while the providers page's labels are not; M2's `getSettings` fills in any settings field the seed leaves out.

- [ ] **Step 1: Write the test**

`e2e/refine.spec.ts`:

```ts
import { expect, test, type Page, type Route } from '@playwright/test'

const RENDER_TIMEOUT = 90_000
const BASE = 'https://fake-llm.test/v1'
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}

type ChatBody = { model: string; messages: Array<{ role: string; content: unknown }> }

const PEG = 'module peg() { translate([15, 15, 10]) cube([10, 10, 10]); }'
const TALLER_PEG = 'module peg() { translate([15, 15, 10]) cube([10, 10, 16]); }'
const TWO_PARTS = ['module plate() { cube([40, 40, 10]); }', PEG, 'union() {', '  plate();', '  peg();', '}', ''].join('\n')

/** A 4 × 4 px PNG. */
const PNG_4PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGM4UaEBRwzEcQBTUhaBGaoOzwAAAABJRU5ErkJggg==',
  'base64',
)

function sse(text: string): string {
  const chunks = [
    { choices: [{ index: 0, delta: { content: text } }] },
    { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } },
  ]
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
}

/** A fake OpenAI-compatible API; chat requests get `replies` in order. Returns the recorded chat bodies. */
async function fakeLlm(page: Page, replies: string[]): Promise<ChatBody[]> {
  const bodies: ChatBody[] = []
  await page.route(`${BASE}/**`, async (route: Route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (request.url().endsWith('/models')) {
      return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ data: [{ id: 'fake-vision' }] }) })
    }
    bodies.push(request.postDataJSON() as ChatBody)
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse(replies.shift() ?? 'No more replies.') })
  })
  return bodies
}

/** Writes a vision-capable fake profile into the app's database and makes it active. */
async function seedVisionProfile(page: Page) {
  await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible({ timeout: RENDER_TIMEOUT })
  await page.evaluate(async (baseUrl) => {
    const open = indexedDB.open('promptcad')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    const tx = database.transaction(['providerProfiles', 'settings'], 'readwrite')
    const now = Date.now()
    tx.objectStore('providerProfiles').put({
      id: 'fake-vision',
      name: 'Fake vision',
      adapter: 'openai-compatible',
      baseUrl,
      apiKey: 'test-key',
      defaultModel: 'fake-vision',
      cachedModels: [{ id: 'fake-vision' }],
      capabilities: { streaming: true, vision: true, audio: false },
      priceTable: {},
      createdAt: now,
      updatedAt: now,
    })
    const settings = tx.objectStore('settings')
    const read = settings.get('app')
    read.onsuccess = () => {
      settings.put({ ...(read.result ?? {}), id: 'app', activeProfileId: 'fake-vision', activeModel: 'fake-vision', autoFixAttempts: 0 })
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    database.close()
  }, BASE)
  await page.reload()
  await expect(page.getByTestId('dims')).toBeVisible({ timeout: RENDER_TIMEOUT })
}

async function replaceCode(page: Page, code: string) {
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(code)
}

test('tap a part, ask for a change, and only that part changes', async ({ page }) => {
  const bodies = await fakeLlm(page, [`Made the peg 6 mm taller.\n\n<<<<<<< SEARCH\n${PEG}\n=======\n${TALLER_PEG}\n>>>>>>> REPLACE\n`])
  await page.goto('./')
  await seedVisionProfile(page)
  await replaceCode(page, TWO_PARTS)
  await expect(page.getByTestId('dims')).toHaveText('40 × 40 × 20 mm', { timeout: RENDER_TIMEOUT })
  const viewer = page.getByTestId('viewer')
  await expect(viewer).toHaveAttribute('data-part-tags', 'ready', { timeout: RENDER_TIMEOUT })
  await page.getByRole('button', { name: 'Fit view' }).click()

  const box = (await viewer.locator('canvas').first().boundingBox())!
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const popover = page.getByRole('region', { name: 'Selected part' })

  // Tap the peg.
  await page.mouse.click(centre.x, centre.y)
  await expect(popover).toContainText('peg')
  await expect(popover).toContainText('module call · line 2')
  await expect(page.getByText('Tap empty space to clear · Esc')).toBeVisible()
  await expect(page.locator('.cm-pick-line')).toHaveText([PEG])

  // Esc and a tap on empty space clear it.
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await page.mouse.click(centre.x, centre.y)
  await expect(popover).toBeVisible()
  await page.mouse.click(box.x + 12, centre.y)
  await expect(popover).toHaveCount(0)

  // An orbit drag that ends on the model picks nothing.
  await page.mouse.move(box.x + 60, centre.y)
  await page.mouse.down()
  await page.mouse.move(centre.x, centre.y, { steps: 8 })
  await page.mouse.up()
  await expect(popover).toHaveCount(0)

  // Pick again from the fitted view and ask for a scoped change.
  await page.getByRole('button', { name: 'Fit view' }).click()
  await page.mouse.click(centre.x, centre.y)
  await page.getByRole('button', { name: 'Ask AI' }).click()
  const prompt = page.getByRole('textbox', { name: 'Prompt' })
  await expect(prompt).toBeFocused()
  await expect(page.getByText('peg · line 2')).toBeVisible()
  await expect(page.getByText('Only this part will change')).toBeVisible()

  await prompt.fill('Make the peg 6 mm taller')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByTestId('dims')).toHaveText('40 × 40 × 26 mm', { timeout: RENDER_TIMEOUT })

  const lines = (await page.locator('.cm-line').allInnerTexts()).map((l) => l.trimEnd()).filter((l) => l !== '')
  expect(lines).toEqual(TWO_PARTS.replace(PEG, TALLER_PEG).split('\n').filter((l) => l !== ''))
  expect(bodies).toHaveLength(1)
  expect(JSON.stringify(bodies[0])).toContain('Edit only line 2.')
  await expect(page.getByText('peg · line 2')).toHaveCount(0)
})

test('an attached image goes to the model as an image part', async ({ page }) => {
  const bodies = await fakeLlm(page, ['A 30 × 20 × 10 mm block.\n\n```openscad\ncube([30, 20, 10]);\n```\n'])
  await page.goto('./')
  await seedVisionProfile(page)

  await page.getByRole('button', { name: 'Attach image or sketch' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: 'Image from device' }).click()
  await (await chooser).setFiles({ name: 'part.png', mimeType: 'image/png', buffer: PNG_4PX })
  await expect(page.getByRole('img', { name: 'part.png' })).toBeVisible()

  await page.getByRole('textbox', { name: 'Prompt' }).fill('A block like this, 30 by 20 by 10 mm')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByTestId('dims')).toHaveText('30 × 20 × 10 mm', { timeout: RENDER_TIMEOUT })

  expect(bodies).toHaveLength(1)
  expect(bodies[0].messages.at(-1)?.content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) } }),
    ]),
  )
  await expect(page.getByRole('img', { name: 'Attached image 1 of 1' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'part.png' })).toHaveCount(0)
})
```

- [ ] **Step 2: Run the test to verify it fails before the feature, then passes**

This task runs after Tasks 1–17, so the spec passes on the first run. To watch it fail, run it once with `<PickChip />` removed from the composer (or on the commit before Task 16) and see "getByText('peg · line 2') … element(s) not found"; then restore it.

Run: `npm run e2e -- e2e/refine.spec.ts`
Expected: PASS (2 tests), no CSP violations in the console. If the first tap misses the peg, check that "Fit view" ran after the render (the camera only auto-fits the first mesh) before changing the test.

- [ ] **Step 3: Commit**

```bash
git add e2e/refine.spec.ts
git commit -m "test(e2e): tap a part for a scoped edit, and send an attached image as an image part" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Full verification and push

**Files:** none new.

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Unit and component tests**

Run: `npm test`
Expected: PASS, including `noHardcodedColors` (no hex or palette classes in the new files), `colourSurvival` and `taggedPreview.real` (real WASM; they run because `public/openscad/` is installed).

- [ ] **Step 3: End-to-end tests**

Run: `npm run e2e`
Expected: PASS for M1's smoke tests, M2–M4's specs and `e2e/refine.spec.ts`, with the production build, the CSP on and `BASE_PATH` honoured.

- [ ] **Step 4: Design fidelity pass by hand**

`npm run dev`, then compare with `design/screens/Refine.dc.html`, `PhoneSketch.dc.html`, `PhoneChat.dc.html` and `Main.dc.html` in both themes (toggle the OS colour scheme): the picked part's overlay and edges in the accent colour, the popover floating on `panel-raised` with the shadow, the editor lines with the 2 px accent rule, the composer chip with its pick-colour border, thumbnails at 96 × 72 px, the sketch with ink strokes and accent dimensions on the inset ground, and the attach button disabled with its tooltip on a profile without vision. Fix any mismatch in the owning task's files and rerun Steps 1–3.

- [ ] **Step 5: Push**

```bash
git status --short   # nothing left uncommitted
git push origin HEAD
```

Pushing `main` deploys to GitHub Pages; the workflow reruns typecheck, unit tests and the end-to-end tests first.

---

## Deferred beyond v1

| Item | Why it waits | Hook left in M5 |
| --- | --- | --- |
| Picking parts inside module bodies (the Refine screen's "bores" `for` loop inside `module body()`) | An outer tag overrides inner ones (Task 1), so tagging inside a module means not tagging its callers and recursing through the call graph | `listTaggableStatements` is the single place that chooses what gets tagged; `resolveEditScope` already maps a call to its definition |
| Semantic popover summary ("4 cylinders, d = 19 mm, subtracted from body()") | Needs geometry and code understanding beyond triangle counts | `pickSummary` is the one string the popover shows |
| Long-press part menu on touch (spec PWA "long-press for part menu") | A tap already opens the same popover | `Model`'s `onTap` in the viewer |
| Switching to the Chat tab on phones when **Ask AI** is pressed | M4's phone tab state is not a shared contract | `focusComposer()` is the single entry point |
| Several parts picked at once (shift-tap) | One selection range per prompt in `PromptContext.selection` | `PickResult` and `pickScope` |
| Re-sending earlier images on later turns | Cost; images are stored and shown, but history carries text only | `imageBlobIds` on every user message |
| Cropping or annotating photos before sending | Not in the spec | `prepareImage` is the single encode step |
| Share-target photos straight into a prompt (spec PWA "optional Web Share Target") | PWA manifest work (M4) | `useAttachments.addFiles` accepts any `File[]` |
| "Ask AI about selection" from the code editor (spec, Code editor) | Not in the M5 scope list | It can set `PromptContext.selection` from the editor selection the same way `prepareTurnInput` does |
| A colour preview of the user's own `color()` calls | The viewer draws the model in `filament` by design; the tagged OFF already carries colours | `parseOff` could also return raw colours |
| 3MF export with colours (D9) | Not in v1 | Task 5's alternate `parse3mf` shows the format |

## Contract issues

These are kept as the design doc writes them; the plan works around each one.

1. **`StatementRange` cannot express "this call's definition".** The contract range is the statement that gets tagged, but a scoped edit of `peg();` usually has to change `module peg() { … }`. The plan adds `resolveEditScope(code, statement): LineRange` (module called exactly once → its definition, else the call) and sends that range as `PromptContext.selection`. The chip, the editor highlight and the scope check all use it.
2. **The Refine screen's example is out of the contract's scope.** "bores · lines 15–17" is a `for` loop inside `module body()`; the spec and the design doc tag only top-level statements and main-assembly children, and Task 1 shows an outer tag overrides inner ones, so both cannot be tagged at once. The screen's case resolves to the `body` part and its definition's lines; nested picking is deferred.
3. **`RenderResult` requires an `stl` on success.** Tagged previews return `new ArrayBuffer(0)` and are routed away from the app store in `useRenderLoop`, so they never reach Export STL (pinned in Task 7). A dedicated result type for previews would be cleaner.
4. **D12's 3MF fallback says "DOMParser".** `DOMParser` does not exist in Web Workers, where the mesh is parsed; the alternate block in Task 5 reads the 3MF XML with an attribute scanner instead.
5. **The chat UI is not a shared contract.** The composer, the chat column, the send path (`sendPrompt`), the chat store's `addMessage` action, the providers store, the settings page's sections and M4's phone tab state have no fixed names. Tasks 16 and 17 name M2's planned files (`src/chat/Composer.tsx`, `src/chat/ChatPanel.tsx`, `src/chat/sendPrompt.ts`) and give `grep` commands to find them if they differ. Fixing the send path's shape (`sendPrompt(text, deps)` with `SendDeps`) in the contracts would remove the guesswork.
6. **`generateCode` has no hook for post-checks.** The scope check wraps it by renaming M2's body to `generateUnscoped`; `runTurn` keeps calling `generateCode`. On a scope retry, `onDelta` streams the rejected reply's text before the retry's, so the chat bubble briefly shows both until the `reply` event replaces it with the final prose.
7. **`RenderControllerOptions.onStart` gains a `req` argument.** Needed so tagged previews do not flip the status pill; it is backward compatible for callers that ignore it.
8. **M4's low-`$fn` preview pass.** If M4 sends a low-quality request before the full one, a tagged follow-up may start after the low-quality result and is then cancelled by the full render; harmless, but it costs a worker restart. Marking low-quality requests in `RenderRequest` would let `useRenderLoop` skip the follow-up for them.
9. **`ChatMessage.imageBlobIds` ↔ `StoredMessage.imageBlobIds`.** M3 must copy the field when it persists chat messages (the contract names both but does not say who maps them).
10. **`Settings.visualCheck` needs no schema bump**, but code that reads `Settings` straight from the table (not through M2's `getSettings`) sees `undefined` for records saved before M5; the plan's readers default it to `false`.
11. **M3's lexer token granularity.** `listTaggableStatements` counts brackets per character and so tolerates combined punctuation tokens, but slices block children between the `{` and `}` tokens; M3's plan emits every bracket as its own `punct` token, which this relies on.
