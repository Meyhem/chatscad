# PromptCAD M4 — Variants, Sharing and PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PromptCAD installable and usable on a phone, let the user ask for three variants and pick one, share a model as a self-contained link, and export PNG, turntable GIF and timelapse GIF, so the M4 exit holds: "install on phone, dictate a prompt, pick a variant, share a link".

**Architecture:** A second render worker behind `RenderQueue` (FIFO, same timeout and respawn rules as `RenderController`) compiles everything that must not disturb the main view: variants and timelapse frames. One offscreen three.js frame renderer (`renderFrames`) turns a `MeshData` plus camera poses into `ImageData`, which feeds PNG encoding on the main thread and GIF encoding (`gifenc`) in a module worker; the export dialog's Image, Turntable and Timelapse tabs differ only in the frame list. Share links are `#s=` + lz-string of `{ v: 1, name, code, params }`, validated before a project is created. `vite-plugin-pwa` precaches the shell and the OpenSCAD WASM; the render worker fetches the WASM itself so the status pill can show download progress. Under the `md` breakpoint the workbench becomes a Chat / Code / 3D tab layout.

**Tech Stack:** M1 stack (Vite 8, React 19, TypeScript 7 strict, Tailwind 4, Zustand 5, Comlink, CodeMirror 6, three.js 0.186 + react-three-fiber 9 + drei 10, Vitest 5, Playwright) plus M2/M3 (`dexie`, `fake-indexeddb`, `@anthropic-ai/sdk`, `diff`). New in M4, exactly as the design doc names them: `lz-string` 1.5, `gifenc` 1.0.3, `vite-plugin-pwa` 2.0 (Workbox 7, `generateSW`). The PNG icon generator uses only `node:zlib`.

**Spec:** [`docs/SPEC.md`](../../SPEC.md) ("Variants, gallery, voice and model choice", "Sharing and export", "PWA and mobile UX", "Security", "Rendering pipeline" limits) and the design doc [`docs/superpowers/specs/2026-10-11-m2-m5-design.md`](../specs/2026-10-11-m2-m5-design.md) (M4 scope, decisions D10 and D11, Shared contracts).

**Prerequisite:** M2 (AI loop) and M3 (parametric and history) are executed exactly as the design doc's **Shared contracts** describe: `src/ai/*` (`LlmProvider`, `ProviderError`, `createProvider`, `describeProviderError`, `generateCode`, `runTurn`, `computeCost`, `PromptContext`), `src/db/db.ts` (`PromptCadDb`, `db`, `Settings`, `DEFAULT_SETTINGS`, `ProviderProfile`, `UsageRecord`, `Project`, `Version`, `StoredMessage`), `src/chat/chatStore.ts`, `src/ui/format.ts` (`formatTokens`, `formatCost`), the app store's `view`, `codeSource`, `lastRender`, `params`, `setParams`, `renderedParams`, `src/render/awaitRender.ts`, `src/scad/customizer.ts` (`parseCustomizer`), `src/history/versions.ts` (`createVersion`, `listVersions`, `ancestry`, `nextLabel`) and `src/history/projectStore.ts` (`openProject`, `newProject`, `restore`, `branchFrom`, `undo`, `redo`). This plan references M2/M3 code only through those names. Where a task changes an M2/M3 file, it shows the full new code of the pieces it changes, anchored on contract names rather than line numbers. Names the contracts do not fix are listed once under "Integration points" below and again under "Contract issues" at the end.

**Design sources:** [`design/screens/`](../../../design/screens/) `Variants.dc.html` (picker), `Export.dc.html` (export dialog, Timelapse tab shown), `PhoneChat.dc.html` (tab bar, mic caption), `Phone3D.dc.html` (44 px viewer buttons, parameter sheet), `PhoneCode.dc.html` (symbol key row), `FirstRun.dc.html` ("Loading OpenSCAD 5.2 / 8.4 MB" pill and "Downloading OpenSCAD (8.4 MB, cached for offline use after this)…" console line), `Main.dc.html` (composer "Variants per prompt" button, header **Share**). Classes come from `design/components.css` (`pc-variant`, `pc-dialog`, `pc-scrim`, `pc-tabs`, `pc-tabbar`, `pc-switch`, `pc-callout`, `pc-input`, `pc-select`); the `.sheet`, `.grabber`, `.keyrow`, `.key` and `.overlay` rules in `screens.css` are reference only and are rebuilt with token utilities. Deferred: the Export screen's version thumbnail strip, the Phone3D "Camera presets" viewer button, WebM turntable, Web Share Target (see "Deferred from M4").

### Integration points with M2/M3 (assumed names)

The contracts fix data and functions but not every component name. This plan assumes the following; if M2/M3 used other names, substitute them and nothing else changes:

| Assumed name | Owner | What M4 does with it |
| --- | --- | --- |
| `useProjectStore` (the Zustand hook exported by `src/history/projectStore.ts`) with state `project`, `versions`, `head` and actions `openProject(id)`, `newProject(opts: { name?, code, params?, origin, source?, message? })` | M3 | Reads `project`/`head`; calls `newProject({ name, origin: 'shared-link', code, params, source: 'import', message })` and `openProject(id)` |
| The composer component that renders `.pc-composer` (`src/chat/Composer.tsx`), with local draft state `draft`/`setDraft`, the active `profile`, `provider`, `model`, and a send handler that builds `history` and `ctx` for `runTurn` | M2 | Gains the mic button, the dictation caption, the variant-count button and the variant branch of the send handler |
| `ChatPanel` (`src/chat/ChatPanel.tsx`), `CustomizerDock` (`src/customizer/CustomizerDock.tsx`), `ProjectMenu` (`src/workbench/ProjectMenu.tsx`, header project button and menu) | M2, M3 | Passed as slots to the phone layout |
| The M3 startup code that reads `settings.lastProjectId` and calls `openProject` (`restoreLastProject()`) | M3 | Runs after the share-link check |
| The M3 `.json` import handler in the project menu (`importProjectFile(text)`) | M3 | Tries the share payload first |
| Settings › Rendering and Settings › AI providers sections | M3, M2 | Host the quick-preview switch and the transcription model field |

## Global Constraints

From the spec:

- No backend; static hosting only. "Rendering, storage and AI calls all run in the user's browser."
- Variants: "'Generate 3' sends the same prompt as three parallel requests (optionally to different models or with different temperatures). Results render one by one in the single worker, queued, and appear as a 3-up picker with thumbnails, orbitable previews, compile status, model name and token cost. Picking one makes it the head version. The other two are kept in history as versions with `kind = variant`, sharing a `variantGroupId`, shown collapsed under the chosen one and restorable at any time. Variants of a follow-up edit branch from the current head."
- Share: "Code and parameter values, compressed with lz-string into the URL hash (`#s=…`), so nothing is uploaded. Opening a link imports a new project. No keys, chat or history are included. Links over ~8 KB show a warning and offer a `.json` file instead."
- PNG: "Snapshot of the viewer at chosen resolution, transparent or solid background, from the current camera or a preset (iso, front, top)."
- Turntable: "Render 36–72 frames rotating the camera offscreen, encode with a small GIF encoder (e.g. gifenc) in a worker; options for size, frame count and background."
- Timelapse: "one frame per version along the head's ancestry (variants and failed compiles skipped by default, optional)… fixed camera (auto-fit to the largest bounding box…), optional slow turntable, and an optional caption with the version number and prompt. Options: frame duration, hold on the last frame, size, which versions to include. Renders queue through the same worker; a progress bar shows frames done… long histories (over ~40 versions) sample evenly."
- "All image exports share one export dialog with a live preview and a common frame renderer (offscreen three.js scene), so PNG, turntable and timelapse differ only in the frame list they feed it."
- PWA: "Precache the app shell, OpenSCAD WASM and library zips; editing, sliders, rendering and export work offline. Only AI calls need a network." "fetch it in the background after first paint and show a progress state, not a blank screen." "Prompt 'New version available' instead of silently swapping a running app." "Manifest with icons and `display: standalone`."
- Touch and keyboard: "Sliders at least 44 px tall." "Extra key row above the mobile keyboard for `; { } ( ) [ ]` in the code tab."
- Performance: "Cap pixel ratio at 2, pause the render loop when the 3D tab is hidden, warn when a mesh exceeds ~1M triangles." "Optional low-quality preview pass by overriding `$fn` before the full render."
- Voice: "A mic button in chat uses the Web Speech API for live dictation into the prompt box, editable before sending. Where it is unavailable (Firefox, some PWAs), record with MediaRecorder and send to the provider's `/audio/transcriptions` endpoint if the profile supports it; otherwise hide the button. Note that Chrome's built-in recognition is processed by Google's servers."
- Security: "`script-src 'self' 'wasm-unsafe-eval'`; `connect-src` limited to `https:` plus explicit localhost entries for local models. No analytics, no CDN scripts." "Model output is untrusted… never rendered as HTML." "Project JSON is schema-validated before writing to the database." Keys are never part of a share link or `.json` share file.

From the design doc:

- `RenderQueue`, `renderFrames`, `CameraPose`, `turntablePoses`, `presetPose` exactly as in "Rendering additions". Variants call `createVersion({ kind: 'variant', variantGroupId, … })`; share import calls `newProject({ origin: 'shared-link', … })`; timelapse walks `ancestry(head.id)`.
- `Settings` gains `variantCount (1 | 3)` and `lowQualityPreview (boolean)`. All IDs are `crypto.randomUUID()`, all timestamps `Date.now()` (D13). Money via `formatCost`, tokens via `formatTokens` (D14).
- D11: the install icon is the wordmark's filament square (`brand-dot`) on `bg`, generated as PNG at build time from tokens.
- New dependencies only `lz-string`, `gifenc`, `vite-plugin-pwa`. E2E tests never call real providers; they use `page.route` on `https://fake-llm.test/v1/**`.

From CLAUDE.md:

- **TDD.** Failing test first, watch it fail. Tests that read the filesystem start with `// @vitest-environment node`.
- **Tokens only.** No hex colours and no Tailwind palette classes in `src/` (enforced by `src/styles/noHardcodedColors.test.ts`). WebGL and canvas colours come from `readToken`/`useTokens`. Never edit `src/styles/tokens.css` by hand.
- **Voice.** Sentence case; units on every number ("20 × 20 × 10 mm", "Rendered 412 ms", "1080 × 1080 px", "11.0 MB"); the `×` sign; errors say what failed and where; no exclamation marks, no emoji; never "head", "blob", "AST" in the UI.
- **CSP stays strict.** `script-src 'self' 'wasm-unsafe-eval'`, `worker-src 'self' blob:`, fonts self-hosted, no CDNs, no `data:` fonts, no inline scripts (so `injectRegister` must not be `'inline'`).
- **Model output is untrusted.** Prompts, prose, variant code, share-link names and code render as React text nodes only.
- **OpenSCAD WASM is pinned** by URL and SHA-256 in `scripts/fetch-openscad.ts`. The precache limit is raised to fit it, never by fetching "latest".
- **Base path.** Every URL works under `BASE_PATH` (`/promptcad/`): use `import.meta.env.BASE_URL` or relative URLs, never a leading `/`.
- **Git.** One logical change per commit, conventional messages; `npm run typecheck && npm test && npm run e2e` green before every push; never force-push.

From the design system (as in M1): `accent` marks the one primary action per region; status "always carries an icon and a word"; dialogs use `pc-dialog` (`radius-lg`, `shadow-pop`) over `pc-scrim`; controls reach `touch-target` (44 px) on coarse pointers; every changing number is mono with tabular figures.

## Review Focus

1. **Hostile or broken share links** (`#s=garbage`, a link cut off by a chat app, `"v": 2`, a parameter named `__proto__`, 50 KB of compressed text that would expand to hundreds of MB, or a valid link pasted into the address bar of an already open tab). Expected: no project is created for a bad link; a callout "This link could not be opened" says why in plain words; the hash is cleared so a reload does not retry; the open project stays. A valid link pasted into an open tab imports through `hashchange`. Nothing from the link is rendered as HTML. *Pinned in Task 8 (`decodeShareHash` and `consumeShareHash` tests).*
2. **Variants that fail differently**: one provider error, one compile failure after auto-fix, one success; or the user picks A while C is still rendering. Expected: only a rendered variant can be used; every reply writes a usage row even if the user later discards; the pick becomes the new version (`kind: 'main'`), every other slot that has code is stored as `kind: 'variant'` with the same `variantGroupId` and a `compileStatus` that matches its code (`'pending'` if that code never rendered); slots without code are not stored; **Discard all** writes no versions. *Pinned in Task 12 (`runVariants`, `variantStore` and `commitPick` tests) and Task 13 (picker tests).*
3. **Exporting during the quick preview pass.** Expected: while the `$fn = 12` mesh is on screen, Export STL stays disabled, `lastRender`/`awaitRender` never see the preview result, and a preview never shows for code or parameters the user has already changed. *Pinned in Task 4 (`withPreviewPass` and `selectDisplayMesh` tests).*
4. **OpenSCAD download progress when Content-Length lies** (gzip from GitHub Pages, a service-worker response without a length, a wrong length). Expected: "Loading OpenSCAD 5.2 MB" without a total, never "12.3 / 4.1 MB". *Pinned in Task 3 (`fetchWithProgress` tests).*
5. **Phone keyboard and hidden 3D tab.** Expected: tapping `;` in the key row inserts at the cursor and keeps focus in the editor (the keyboard stays open); the viewer stops drawing while its tab is hidden and redraws when shown; tapping the failed status pill while on Chat switches to Code at the error line. *Pinned in Task 15 (`KeyRow`, `CodeEditor` insert and `PhoneLayout` tests).*

## Design fidelity checks

| Rule (source) | Where it is enforced |
| --- | --- |
| Variant cards are `pc-variant` with `aria-selected` for the accent ring and `is-failed` for the error ground (components.css, Variants screen) | Task 13: `VariantPicker.test.tsx` |
| Status always icon + word, including "Queued", "Rendering…", "Auto-fix 1 of 2", "2 warnings" on variant cards and "Rendering 3 of 3" in the header (README "Status") | Task 13: `describeSlot.test.ts`, `VariantPicker.test.tsx` |
| One primary action per region: **Use variant X**, **Save PNG**, **Save GIF**, **Copy link**, **Reload** (README "Colour") | Tasks 9–14: each dialog/tab test queries the single `.is-primary` button |
| Dialogs are `pc-dialog` over `pc-scrim`, close on Esc, keep focus inside, never used for a render failure (Dialog) | Task 9: `Modal.test.tsx`; M1's "no dialog after a failed render" App test still passes |
| Numbers carry units and `×`: "1080 × 1080 px", "48 frames", "11.0 MB", "9.4 KB", "1,234,567 triangles" (README "Voice") | Tasks 3, 4, 9, 10: `bytes.test.ts`, `TriangleWarning.test.tsx`, tab tests |
| Copy from the screens: "Pick a variant", "Drag to orbit any preview…", "Export and share", "Loading OpenSCAD 5.2 / 8.4 MB", "Listening… tap the mic to stop. Chrome sends speech to Google for recognition.", "New version available" | Tasks 3, 9, 13, 14, 16 tests assert the exact strings |
| Phone: `pc-tabbar` Chat / Code / 3D, 44 px viewer buttons on coarse pointers, key row `; { } ( ) [ ]` plus Indent (Phone screens) | Task 15: `PhoneLayout.test.tsx`, `KeyRow.test.tsx`; Task 17 phone e2e |
| Install icon is the filament square on `bg`, from `design/tokens.json`, no hard-coded colour (D11) | Task 14: `scripts/gen-icons.test.ts`, `build/pwa.test.ts` |
| Light theme stays a full peer: frame renderer and captions read tokens at export time (README "Colour") | Task 5: `frames.test.ts` asserts the filament token is read per call |

---

## File Structure

```
package.json                         + lz-string, gifenc, vite-plugin-pwa; icons script; predev/prebuild run gen-icons
.gitignore                           + public/icons/
vite.config.ts                       + VitePWA(pwaOptions(base)), pwaHeadPlugin(base), test alias for virtual:pwa-register/react
playwright.config.ts                 desktop + phone (Pixel 7) projects, service workers blocked by default
build/pwa.ts                         pwaOptions(), pwaHeadPlugin(), MAX_PRECACHE_BYTES, ICONS, token colour reader
build/pwa.test.ts
scripts/gen-icons.ts                 tsx: tokens → public/icons/icon-192.png, icon-512.png, icon-maskable-512.png
scripts/gen-icons.test.ts
src/types/gifenc.d.ts                type declarations for gifenc (ships none)
src/util/abort.ts                    abortError(), isAbortError()
src/util/abort.test.ts
src/ui/bytes.ts                      formatMegabytes(), formatSize()
src/ui/bytes.test.ts
src/ui/Modal.tsx                     pc-scrim + role="dialog", Esc, focus trap, optional scrim close
src/ui/Modal.test.tsx
src/ui/Callout.tsx                   pc-callout with icon and strong title
src/ui/icons.ts                      (modify) + Share, Layers, Refresh, Mic, Chat, Code, Box, Copy, Clock, Info
src/db/db.ts                         (modify, M2/M3) Settings + variantCount, lowQualityPreview, transcriptionModel
src/db/prefs.ts                      readPrefs(), writePrefs(), prefsFrom()
src/db/prefs.test.ts
src/settings/prefsStore.ts           usePrefs (Zustand mirror of the M4 settings)
src/settings/prefsStore.test.ts
src/settings/LowQualityPreviewSwitch.tsx
src/settings/TranscriptionModelField.tsx
src/settings/settingsControls.test.tsx
src/app/GlobalOverlays.tsx           loads prefs; renders export dialog, variant picker, share notice, update prompt
src/app/GlobalOverlays.test.tsx
src/render/queue.ts                  RenderQueue (contract)
src/render/queue.test.ts
src/render/sharedQueue.ts            getRenderQueue() singleton for variants and timelapse
src/render/loadProgress.ts           LoadProgress, worker message, throttle, emitter, formatLoadProgress()
src/render/loadProgress.test.ts
src/render/fetchWithProgress.ts      streaming fetch with byte progress
src/render/fetchWithProgress.test.ts
src/render/render.worker.ts          (modify) fetch the WASM with progress, pass wasmBinary
src/render/runOpenSCAD.ts            (modify) OpenSCADFactoryOptions.wasmBinary
src/render/createRenderWorker.ts     (modify) forward progress messages
src/render/previewPass.ts            withPreviewPass(): $fn = 12 pass before the full render
src/render/previewPass.test.ts
src/state/store.ts                   (modify) loadProgress, preview, insert; selectDisplayMesh
src/state/store.m4.test.ts
src/ui/StatusPill.tsx                (modify) download progress in the idle pill
src/panels/ConsolePanel.tsx          (modify) download line in the idle console
src/viewer/TriangleWarning.tsx       warn callout over 1,000,000 triangles
src/viewer/TriangleWarning.test.tsx
src/viewer/viewerCamera.ts           last orbit pose of the main viewer (for "Current view" PNG)
src/viewer/viewerCamera.test.ts
src/viewer/Viewer.tsx                (modify) paused, previewing, 44 px buttons, triangle warning, pose reporting
src/export/frames.ts                 CameraPose, renderFrames, turntablePoses, presetPose (contract)
src/export/frames.test.ts
src/export/glFrameRenderer.ts        offscreen WebGLRenderer → ImageData
src/export/pixels.ts                 flipRows()
src/export/pixels.test.ts
src/export/png.ts                    imageDataToPng()
src/export/gif.ts                    GifBuilder over gifenc
src/export/gif.test.ts
src/export/gif.worker.ts             Comlink worker around GifBuilder
src/export/gifClient.ts              createGifEncoder() (main-thread handle)
src/export/turntable.ts              exportTurntable(), clampFrames(), turntableDelayMs(), formatGifProgress()
src/export/turntable.test.ts
src/export/timelapse.ts              planTimelapse(), describePlan(), captionFor(), renderTimelapse(), parseSeconds()
src/export/timelapse.test.ts
src/export/caption.ts                drawCaption() on an OffscreenCanvas
src/export/exportStore.ts            useExportStore: open, tab, openAt(), close()
src/export/ExportDialog.tsx          "Export and share" dialog with tabs
src/export/ExportDialog.test.tsx
src/export/sizes.ts                  IMAGE_SIZES, GIF_SIZES, previewSize()
src/export/FramePreview.tsx          canvas preview of an ImageData
src/export/ProgressBar.tsx           progress label + bar
src/export/tabs/layout.tsx           TabBody, TabFooter, NothingToExport
src/export/tabs/ModelFileTab.tsx
src/export/tabs/LinkTab.tsx
src/export/tabs/ImageTab.tsx
src/export/tabs/TurntableTab.tsx
src/export/tabs/TimelapseTab.tsx
src/export/tabs/ImageTab.test.tsx
src/export/tabs/TurntableTab.test.tsx
src/export/tabs/TimelapseTab.test.tsx
src/export/ExportButtons.tsx         (modify) Share + Export STL
src/export/ExportButtons.test.tsx    (modify)
src/share/link.ts                    SharePayload, encode/decode/validate, createShareLink(), shareLevel()
src/share/link.test.ts
src/share/importShared.ts            consumeShareHash(), importSharedPayload(), noticeFor()
src/share/importShared.test.ts
src/share/shareNotice.ts             useShareNotice store
src/share/ShareNotice.tsx            callout for imported / failed links
src/variants/temperatures.ts         variantTemperatures(), withTemperature()
src/variants/temperatures.test.ts
src/variants/types.ts                VariantRequest, VariantSlot, initialSlots()
src/variants/runVariants.ts          three runTurn calls through the RenderQueue
src/variants/runVariants.test.ts
src/variants/recordUsage.ts          usage row for each variant reply
src/variants/recordUsage.test.ts
src/variants/variantStore.ts         useVariantStore: start, regenerate, discard, select, pick
src/variants/variantStore.test.ts
src/variants/describeSlot.ts         describeSlot(), variantProgressLabel()
src/variants/describeSlot.test.ts
src/variants/commitPick.ts           createVersion for pick and variants, move the project to the pick
src/variants/commitPick.test.ts
src/history/setHead.ts               setHead(projectId, versionId)
src/history/setHead.test.ts
src/variants/VariantPreview.tsx      small orbitable R3F canvas
src/variants/VariantPicker.tsx       "Pick a variant" dialog
src/variants/VariantPicker.test.tsx
src/variants/VariantCountButton.tsx  composer "Variants per prompt" toggle
src/variants/VariantProgressPill.tsx header "Rendering 2 of 3"
src/variants/variantControls.test.tsx
src/pwa/usePwaUpdate.ts              wraps virtual:pwa-register/react
src/pwa/UpdatePrompt.tsx             "New version available" + Reload
src/pwa/UpdatePrompt.test.tsx
src/test/pwaRegisterStub.ts          Vitest stand-in for virtual:pwa-register/react
src/test/versions.ts                 Version fixture builder
src/layout/useIsPhone.ts             matchMedia('(max-width: 767.98px)')
src/layout/PhoneLayout.tsx           header + tab panels + pc-tabbar
src/layout/ParamSheet.tsx            parameter bottom sheet with grabber
src/layout/phoneLayout.test.tsx
src/editor/KeyRow.tsx                ; { } ( ) [ ] and Indent
src/editor/KeyRow.test.tsx
src/editor/CodeEditor.tsx            (modify) insert prop
src/editor/CodeEditor.test.tsx       (modify) insert test
src/voice/support.ts                 getSpeechRecognition(), micMode(), joinDraft(), speechErrorMessage()
src/voice/support.test.ts
src/voice/transcribe.ts              POST {baseUrl}/audio/transcriptions
src/voice/transcribe.test.ts
src/voice/useDictation.ts            speech or recorder session; useComposerDictation()
src/voice/useDictation.test.tsx
src/voice/voiceStore.ts              last transcript for StoredMessage.audioTranscript
src/voice/MicButton.tsx
src/voice/DictationCaption.tsx
src/voice/voiceControls.test.tsx
src/App.tsx                          (modify) header, preview mesh, progress, overlays, phone layout
src/App.test.tsx                     (modify)
src/chat/Composer.tsx                (modify, M2) mic, caption, variant count, variant send branch
e2e/support.ts                       RENDER_TIMEOUT, CSP watcher, fake provider seeding, fake LLM route
e2e/variants.spec.ts
e2e/share.spec.ts
e2e/export.spec.ts
e2e/pwa.spec.ts
e2e/phone.spec.ts
```

---

### Task 1: M4 settings (variant count, quick preview, transcription model) and the overlay host

**Files:**
- Modify: `src/db/db.ts` (M2/M3)
- Create: `src/db/prefs.ts`, `src/settings/prefsStore.ts`, `src/app/GlobalOverlays.tsx`
- Modify: `src/App.tsx`
- Test: `src/db/prefs.test.ts`, `src/settings/prefsStore.test.ts`, `src/app/GlobalOverlays.test.tsx`

**Interfaces:**
- Consumes: `PromptCadDb`, `db`, `Settings`, `DEFAULT_SETTINGS` (M2/M3).
- Produces:
  - `Settings` gains `variantCount: 1 | 3`, `lowQualityPreview: boolean`, `transcriptionModel: string`; `DEFAULT_SETTINGS` gains `variantCount: 1`, `lowQualityPreview: false`, `transcriptionModel: 'whisper-1'`
  - `type Prefs = Pick<Settings, 'variantCount' | 'lowQualityPreview' | 'transcriptionModel'>`
  - `prefsFrom(row: Partial<Settings> | undefined): Prefs`, `readPrefs(database?: PromptCadDb): Promise<Prefs>`, `writePrefs(patch: Partial<Prefs>, database?: PromptCadDb): Promise<Prefs>`
  - `usePrefs` Zustand hook: `Prefs & { loaded: boolean; load(): Promise<void>; update(patch: Partial<Prefs>): Promise<void> }`
  - `<GlobalOverlays />`: mounts once in `App`, loads prefs; later tasks add their overlays to it

The M4 fields are not indexed, so no Dexie version bump is needed: `prefsFrom` fills them from `DEFAULT_SETTINGS` when an older row lacks them.

- [ ] **Step 1: Write the failing tests**

`src/db/prefs.test.ts`:

```ts
import 'fake-indexeddb/auto'
import { DEFAULT_SETTINGS, PromptCadDb, type Settings } from './db'
import { prefsFrom, readPrefs, writePrefs } from './prefs'

let database: PromptCadDb
beforeEach(() => {
  database = new PromptCadDb(`prefs-${crypto.randomUUID()}`)
})
afterEach(() => database.delete())

const DEFAULTS = { variantCount: 1, lowQualityPreview: false, transcriptionModel: 'whisper-1' }

it('defaults to one reply per prompt, full renders only, and whisper-1', async () => {
  expect(DEFAULT_SETTINGS).toMatchObject(DEFAULTS)
  expect(await readPrefs(database)).toEqual(DEFAULTS)
})

it('fills the M4 fields an older settings row lacks and keeps every other field', async () => {
  const older: Record<string, unknown> = { ...DEFAULT_SETTINGS, activeModel: 'gpt-x' }
  delete older.variantCount
  delete older.lowQualityPreview
  delete older.transcriptionModel
  await database.settings.put(older as unknown as Settings)

  expect(await readPrefs(database)).toEqual(DEFAULTS)
  expect(await writePrefs({ variantCount: 3 }, database)).toEqual({ ...DEFAULTS, variantCount: 3 })
  expect(await database.settings.get('app')).toMatchObject({ activeModel: 'gpt-x', variantCount: 3, lowQualityPreview: false })
})

it('creates the settings row when there is none', async () => {
  await writePrefs({ lowQualityPreview: true }, database)
  expect(await database.settings.get('app')).toEqual({ ...DEFAULT_SETTINGS, lowQualityPreview: true })
})

it('ignores values outside the allowed set', () => {
  expect(prefsFrom({ variantCount: 2 as unknown as 1, lowQualityPreview: 'yes' as unknown as boolean, transcriptionModel: '  ' })).toEqual(
    DEFAULTS,
  )
  expect(prefsFrom({ transcriptionModel: ' gpt-4o-transcribe ' }).transcriptionModel).toBe('gpt-4o-transcribe')
})
```

`src/settings/prefsStore.test.ts`:

```ts
import { readPrefs, writePrefs } from '../db/prefs'
import { usePrefs } from './prefsStore'

vi.mock('../db/prefs', () => ({
  readPrefs: vi.fn(async () => ({ variantCount: 3, lowQualityPreview: true, transcriptionModel: 'whisper-large' })),
  writePrefs: vi.fn(async (patch: object) => ({ variantCount: 1, lowQualityPreview: false, transcriptionModel: 'whisper-1', ...patch })),
}))

beforeEach(() => usePrefs.setState(usePrefs.getInitialState(), true))

it('starts from the defaults until loaded', () => {
  expect(usePrefs.getState()).toMatchObject({ variantCount: 1, lowQualityPreview: false, transcriptionModel: 'whisper-1', loaded: false })
})

it('loads the stored prefs', async () => {
  await usePrefs.getState().load()
  expect(readPrefs).toHaveBeenCalled()
  expect(usePrefs.getState()).toMatchObject({ variantCount: 3, lowQualityPreview: true, transcriptionModel: 'whisper-large', loaded: true })
})

it('applies an update at once and persists it', async () => {
  const pending = usePrefs.getState().update({ variantCount: 3 })
  expect(usePrefs.getState().variantCount).toBe(3)
  await pending
  expect(writePrefs).toHaveBeenCalledWith({ variantCount: 3 })
  expect(usePrefs.getState().variantCount).toBe(3)
})
```

`src/app/GlobalOverlays.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import { usePrefs } from '../settings/prefsStore'
import { GlobalOverlays } from './GlobalOverlays'

it('loads the M4 prefs once when mounted', () => {
  const load = vi.fn(async () => {})
  usePrefs.setState({ load })
  const { rerender } = render(<GlobalOverlays />)
  rerender(<GlobalOverlays />)
  expect(load).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/db/prefs.test.ts src/settings/prefsStore.test.ts src/app/GlobalOverlays.test.tsx`
Expected: FAIL, because `./prefs`, `./prefsStore` and `./GlobalOverlays` cannot be resolved (and `DEFAULT_SETTINGS` lacks the M4 fields).

- [ ] **Step 3: Implement**

In `src/db/db.ts`, add the three fields to the `Settings` interface after the M3 fields:

```ts
  // M4
  variantCount: 1 | 3
  lowQualityPreview: boolean
  /** Model for `POST {baseUrl}/audio/transcriptions` when dictation falls back to recording. */
  transcriptionModel: string
```

and to `DEFAULT_SETTINGS` (keep every existing key):

```ts
  variantCount: 1,
  lowQualityPreview: false,
  transcriptionModel: 'whisper-1',
```

If `npm run typecheck` then flags an M2/M3 test or helper that builds a full `Settings` literal, spread `...DEFAULT_SETTINGS` into it; do not make the new fields optional.

`src/db/prefs.ts`:

```ts
import { db as defaultDb, DEFAULT_SETTINGS, type PromptCadDb, type Settings } from './db'

export type Prefs = Pick<Settings, 'variantCount' | 'lowQualityPreview' | 'transcriptionModel'>

/** The M4 settings from a stored row, with defaults for rows written before M4 and for invalid values. */
export function prefsFrom(row: Partial<Settings> | undefined): Prefs {
  const model = typeof row?.transcriptionModel === 'string' ? row.transcriptionModel.trim() : ''
  return {
    variantCount: row?.variantCount === 3 ? 3 : 1,
    lowQualityPreview: row?.lowQualityPreview === true,
    transcriptionModel: model || DEFAULT_SETTINGS.transcriptionModel,
  }
}

export async function readPrefs(database: PromptCadDb = defaultDb): Promise<Prefs> {
  return prefsFrom(await database.settings.get('app'))
}

export async function writePrefs(patch: Partial<Prefs>, database: PromptCadDb = defaultDb): Promise<Prefs> {
  const current = await database.settings.get('app')
  const next = prefsFrom({ ...current, ...patch })
  await database.settings.put({ ...DEFAULT_SETTINGS, ...current, ...next, id: 'app' })
  return next
}
```

`src/settings/prefsStore.ts`:

```ts
import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '../db/db'
import { readPrefs, writePrefs, type Prefs } from '../db/prefs'

export interface PrefsState extends Prefs {
  loaded: boolean
  load(): Promise<void>
  update(patch: Partial<Prefs>): Promise<void>
}

/** In-memory mirror of the M4 settings, so render code can read them synchronously. */
export const usePrefs = create<PrefsState>()((set) => ({
  variantCount: DEFAULT_SETTINGS.variantCount,
  lowQualityPreview: DEFAULT_SETTINGS.lowQualityPreview,
  transcriptionModel: DEFAULT_SETTINGS.transcriptionModel,
  loaded: false,
  load: async () => set({ ...(await readPrefs()), loaded: true }),
  update: async (patch) => {
    set(patch)
    set(await writePrefs(patch))
  },
}))
```

`src/app/GlobalOverlays.tsx`:

```tsx
import { useEffect } from 'react'
import { usePrefs } from '../settings/prefsStore'

/** One mount point for M4's app-wide overlays (dialogs, notices, update prompt) and its startup work. */
export function GlobalOverlays() {
  useEffect(() => {
    void usePrefs.getState().load()
  }, [])
  return null
}
```

In `src/App.tsx`, render it once as the last child of the root `pc-root` element (desktop layout; Task 15 adds it to the phone layout too):

```tsx
import { GlobalOverlays } from './app/GlobalOverlays'
// … last child inside <div className="pc-root …">:
      <GlobalOverlays />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/db/prefs.test.ts src/settings/prefsStore.test.ts src/app/GlobalOverlays.test.tsx && npm run typecheck`
Expected: PASS (8 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/db/db.ts src/db/prefs.ts src/db/prefs.test.ts src/settings src/app src/App.tsx
git commit -m "feat(settings): variant count, quick preview and transcription model settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: RenderQueue (second worker, FIFO, timeout, respawn, abort)

**Files:**
- Create: `src/util/abort.ts`, `src/render/queue.ts`, `src/render/sharedQueue.ts`
- Test: `src/util/abort.test.ts`, `src/render/queue.test.ts`

**Interfaces:**
- Consumes: `WorkerFactory`, `RenderWorkerHandle`, `createRenderWorker` (M1 `src/render/createRenderWorker.ts`); `DEFAULT_TIMEOUT_MS` (M1 `controller.ts`); `failedResult`, `errorMessage` (M1 `result.ts`); `okResult`, `errorResult` (M1 `src/test/results.ts`).
- Produces:
  - `abortError(message?: string): DOMException` (name `AbortError`), `isAbortError(e: unknown): boolean`
  - `class RenderQueue { constructor(opts: { createWorker: WorkerFactory; timeoutMs?: number }); render(req: RenderRequest, signal?: AbortSignal): Promise<RenderResult>; dispose(): void }` (contract). Timeout and crash results use the exact M1 strings `Render timed out after 60 s` and `Render worker crashed: …`. Aborted or disposed jobs reject with an `AbortError`.
  - `getRenderQueue(): RenderQueue` (lazy singleton on `createRenderWorker`)

The queue never debounces (every job matters) and never cancels an older job for a newer one (the opposite of `RenderController`); only an abort signal or `dispose` cancels.

- [ ] **Step 1: Write the failing tests**

`src/util/abort.test.ts`:

```ts
import { abortError, isAbortError } from './abort'

it('makes DOMException AbortErrors and recognises them', () => {
  const e = abortError('Render cancelled')
  expect(e).toBeInstanceOf(DOMException)
  expect(e.name).toBe('AbortError')
  expect(e.message).toBe('Render cancelled')
  expect(isAbortError(e)).toBe(true)
  expect(isAbortError(new Error('AbortError'))).toBe(false)
  const controller = new AbortController()
  controller.abort()
  expect(isAbortError(controller.signal.reason)).toBe(true)
})
```

`src/render/queue.test.ts`:

```ts
import type { Mock } from 'vitest'
import { errorResult, okResult } from '../test/results'
import { RenderQueue } from './queue'
import type { RenderRequest, RenderResult } from './types'

interface Deferred<T> {
  promise: Promise<T>
  resolve(v: T): void
  reject(e: unknown): void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface FakeWorker {
  requests: RenderRequest[]
  pending: Deferred<RenderResult>[]
  render: Mock<(req: RenderRequest) => Promise<RenderResult>>
  terminate: Mock<() => void>
}

function setup(timeoutMs = 60_000) {
  const workers: FakeWorker[] = []
  const createWorker = vi.fn(() => {
    const w: FakeWorker = {
      requests: [],
      pending: [],
      render: vi.fn((req: RenderRequest) => {
        w.requests.push(req)
        const d = deferred<RenderResult>()
        w.pending.push(d)
        return d.promise
      }),
      terminate: vi.fn(),
    }
    workers.push(w)
    return w
  })
  return { workers, createWorker, queue: new RenderQueue({ createWorker, timeoutMs }) }
}

const settled = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('renders jobs one at a time in the order they were queued, on one worker', async () => {
  const { workers, createWorker, queue } = setup()
  const a = queue.render({ code: 'a' })
  const b = queue.render({ code: 'b' })
  await settled()
  expect(workers[0].requests).toEqual([{ code: 'a' }])

  const first = okResult()
  workers[0].pending[0].resolve(first)
  await expect(a).resolves.toBe(first)
  await settled()
  expect(workers[0].requests).toEqual([{ code: 'a' }, { code: 'b' }])

  const second = errorResult()
  workers[0].pending[1].resolve(second)
  await expect(b).resolves.toBe(second)
  expect(createWorker).toHaveBeenCalledTimes(1)
})

it('starts at once without a debounce', async () => {
  const { workers, queue } = setup()
  void queue.render({ code: 'a' })
  await settled()
  expect(workers[0].render).toHaveBeenCalledTimes(1)
})

it('times out a hung job, kills the worker, and runs the next job on a new worker', async () => {
  const { workers, queue } = setup(1_000)
  const hung = queue.render({ code: 'for(i=[0:1e9]) cube(1);' })
  const next = queue.render({ code: 'cube(1);' })
  await vi.advanceTimersByTimeAsync(1_000)

  await expect(hung).resolves.toMatchObject({ ok: false, error: 'Render timed out after 1 s' })
  expect(workers[0].terminate).toHaveBeenCalled()
  await settled()
  expect(workers[1].requests).toEqual([{ code: 'cube(1);' }])

  workers[0].pending[0].resolve(okResult())
  const fresh = okResult()
  workers[1].pending[0].resolve(fresh)
  await expect(next).resolves.toBe(fresh)
})

it('reports a crash as a failed result and replaces the worker', async () => {
  const { workers, queue } = setup()
  const crashed = queue.render({ code: 'a' })
  await settled()
  workers[0].pending[0].reject(new Error('worker died'))
  await expect(crashed).resolves.toMatchObject({ ok: false, error: 'Render worker crashed: worker died' })
  expect(workers[0].terminate).toHaveBeenCalled()
  void queue.render({ code: 'b' })
  await settled()
  expect(workers).toHaveLength(2)
})

it('drops an aborted queued job without sending it to the worker', async () => {
  const { workers, queue } = setup()
  void queue.render({ code: 'a' })
  const controller = new AbortController()
  const b = queue.render({ code: 'b' }, controller.signal)
  controller.abort()
  await expect(b).rejects.toMatchObject({ name: 'AbortError' })
  workers[0].pending[0].resolve(okResult())
  await settled()
  expect(workers[0].requests).toEqual([{ code: 'a' }])
})

it('kills the worker for an aborted in-flight job and moves on', async () => {
  const { workers, queue } = setup()
  const controller = new AbortController()
  const a = queue.render({ code: 'a' }, controller.signal)
  const b = queue.render({ code: 'b' })
  await settled()
  controller.abort()
  await expect(a).rejects.toMatchObject({ name: 'AbortError' })
  expect(workers[0].terminate).toHaveBeenCalled()
  await settled()
  expect(workers[1].requests).toEqual([{ code: 'b' }])
  const result = okResult()
  workers[1].pending[0].resolve(result)
  await expect(b).resolves.toBe(result)
})

it('rejects a job whose signal is already aborted', async () => {
  const { queue, createWorker } = setup()
  await expect(queue.render({ code: 'a' }, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
  expect(createWorker).not.toHaveBeenCalled()
})

it('dispose rejects every job, terminates the worker, and refuses new work', async () => {
  const { workers, queue } = setup()
  const a = queue.render({ code: 'a' })
  const b = queue.render({ code: 'b' })
  await settled()
  queue.dispose()
  await expect(a).rejects.toMatchObject({ name: 'AbortError' })
  await expect(b).rejects.toMatchObject({ name: 'AbortError' })
  expect(workers[0].terminate).toHaveBeenCalled()
  await expect(queue.render({ code: 'c' })).rejects.toMatchObject({ name: 'AbortError' })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/util/abort.test.ts src/render/queue.test.ts`
Expected: FAIL, because `./abort` and `./queue` cannot be resolved.

- [ ] **Step 3: Implement**

`src/util/abort.ts`:

```ts
export function abortError(message = 'The operation was aborted'): DOMException {
  return new DOMException(message, 'AbortError')
}

export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}
```

`src/render/queue.ts`:

```ts
import { abortError } from '../util/abort'
import { DEFAULT_TIMEOUT_MS } from './controller'
import type { RenderWorkerHandle, WorkerFactory } from './createRenderWorker'
import { errorMessage, failedResult } from './result'
import type { RenderRequest, RenderResult } from './types'

interface Job {
  req: RenderRequest
  resolve(result: RenderResult): void
  reject(e: unknown): void
  detach(): void
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * Background renders (variants, timelapse frames) on their own worker, so they never disturb the main view.
 * FIFO, one job at a time, same timeout and respawn rules as RenderController, no debounce, no cancel-on-newer.
 */
export class RenderQueue {
  private readonly createWorker: WorkerFactory
  private readonly timeoutMs: number
  private worker: RenderWorkerHandle | null = null
  private readonly waiting: Job[] = []
  private current: Job | null = null
  private disposed = false

  constructor(opts: { createWorker: WorkerFactory; timeoutMs?: number }) {
    this.createWorker = opts.createWorker
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  render(req: RenderRequest, signal?: AbortSignal): Promise<RenderResult> {
    if (this.disposed) return Promise.reject(abortError('The render queue was closed'))
    if (signal?.aborted) return Promise.reject(abortError('Render cancelled'))
    return new Promise<RenderResult>((resolve, reject) => {
      const job: Job = { req, resolve, reject, detach: () => {}, timer: null }
      if (signal) {
        const onAbort = () => this.abort(job)
        signal.addEventListener('abort', onAbort, { once: true })
        job.detach = () => signal.removeEventListener('abort', onAbort)
      }
      this.waiting.push(job)
      this.pump()
    })
  }

  dispose(): void {
    this.disposed = true
    const jobs = [...(this.current ? [this.current] : []), ...this.waiting]
    this.waiting.length = 0
    this.current = null
    this.killWorker()
    for (const job of jobs) this.fail(job, abortError('The render queue was closed'))
  }

  private abort(job: Job): void {
    const index = this.waiting.indexOf(job)
    if (index >= 0) {
      this.waiting.splice(index, 1)
      this.fail(job, abortError('Render cancelled'))
      return
    }
    if (this.current === job) {
      this.current = null
      this.killWorker()
      this.fail(job, abortError('Render cancelled'))
      this.pump()
    }
  }

  private pump(): void {
    if (this.current || this.disposed) return
    const job = this.waiting.shift()
    if (!job) return
    this.current = job
    const worker = (this.worker ??= this.createWorker())
    const startedAt = performance.now()

    const deliver = (result: RenderResult, kill: boolean) => {
      if (this.current !== job) return
      this.current = null
      if (job.timer !== null) clearTimeout(job.timer)
      if (kill) this.killWorker()
      job.detach()
      job.resolve(result)
      this.pump()
    }

    job.timer = setTimeout(
      () => deliver(failedResult(`Render timed out after ${Math.round(this.timeoutMs / 1000)} s`, { renderMs: this.timeoutMs }), true),
      this.timeoutMs,
    )
    worker.render(job.req).then(
      (result) => deliver(result, false),
      (err: unknown) =>
        deliver(failedResult(`Render worker crashed: ${errorMessage(err)}`, { renderMs: performance.now() - startedAt }), true),
    )
  }

  private fail(job: Job, e: DOMException): void {
    if (job.timer !== null) clearTimeout(job.timer)
    job.detach()
    job.reject(e)
  }

  private killWorker(): void {
    this.worker?.terminate()
    this.worker = null
  }
}
```

`src/render/sharedQueue.ts`:

```ts
import { createRenderWorker } from './createRenderWorker'
import { RenderQueue } from './queue'

let queue: RenderQueue | null = null

/** The app's one background queue; variants and timelapse frames share it so they render one by one. */
export function getRenderQueue(): RenderQueue {
  return (queue ??= new RenderQueue({ createWorker: createRenderWorker }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/util/abort.test.ts src/render/queue.test.ts && npm run typecheck`
Expected: PASS (9 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/util src/render/queue.ts src/render/queue.test.ts src/render/sharedQueue.ts
git commit -m "feat(render): RenderQueue for background renders on a second worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: OpenSCAD download progress ("Loading OpenSCAD 5.2 / 8.4 MB")

**Files:**
- Create: `src/ui/bytes.ts`, `src/render/loadProgress.ts`, `src/render/fetchWithProgress.ts`
- Modify: `src/render/runOpenSCAD.ts`, `src/render/render.worker.ts`, `src/render/createRenderWorker.ts`, `src/state/store.ts`, `src/ui/StatusPill.tsx`, `src/panels/ConsolePanel.tsx`, `src/App.tsx`
- Test: `src/ui/bytes.test.ts`, `src/render/loadProgress.test.ts`, `src/render/fetchWithProgress.test.ts`, `src/state/store.m4.test.ts`, `src/ui/StatusPill.test.tsx` (modify), `src/panels/ConsolePanel.test.tsx` (modify), `src/App.test.tsx` (modify)

**Interfaces:**
- Consumes: `describeStatus`, `StatusPill` (M1, maybe extended by M2), `summaryLine`, `ConsolePanel` (M1, maybe extended by M3), `useAppStore` (M1–M3).
- Produces:
  - `formatMegabytes(bytes: number): string` ("5.2"), `formatSize(bytes: number): string` ("9.4 KB", "1.6 MB"); 1 MB = 1,000,000 bytes
  - `interface LoadProgress { loaded: number; total: number | null }`, `LOAD_PROGRESS_TYPE`, `loadProgressMessage(p)`, `isLoadProgressMessage(data: unknown)`, `throttleProgress(report, stepBytes?)`, `formatLoadProgress(p): string`, `onLoadProgress(listener): () => void`, `emitLoadProgress(p): void`
  - `fetchWithProgress(url: string, onProgress: (p: LoadProgress) => void, fetchImpl?: typeof fetch): Promise<ArrayBuffer>`
  - `OpenSCADFactoryOptions.wasmBinary?: ArrayBuffer`
  - store: `loadProgress: LoadProgress | null`, `setLoadProgress(p: LoadProgress | null): void`
  - `describeStatus(status, renderMs, error, diagnostics, loadProgress?: LoadProgress | null)`; `<StatusPill loadProgress? />`; `summaryLine(status, error, renderMs, logs, loadProgress?: LoadProgress | null)`; `<ConsolePanel loadProgress? />`

The render worker already loads OpenSCAD in the background after first paint (M1). Emscripten's own WASM fetch reports nothing, so the worker now fetches `openscad.wasm` itself with a streaming reader, posts throttled progress messages next to Comlink's (Comlink ignores messages without its `id`), keeps the bytes for every fresh instance, and hands them to Emscripten as `wasmBinary`. Each worker keeps its own copy, so a respawned worker (or the `RenderQueue` worker) reads it again from the HTTP or service-worker cache.

- [ ] **Step 1: Write the failing tests**

`src/ui/bytes.test.ts`:

```ts
import { formatMegabytes, formatSize } from './bytes'

it('formats megabytes with one decimal', () => {
  expect(formatMegabytes(11_000_303)).toBe('11.0')
  expect(formatMegabytes(5_240_000)).toBe('5.2')
})

it('formats sizes in KB below 1 MB and in MB above', () => {
  expect(formatSize(9_400)).toBe('9.4 KB')
  expect(formatSize(940)).toBe('0.9 KB')
  expect(formatSize(1_600_000)).toBe('1.6 MB')
})
```

`src/render/loadProgress.test.ts`:

```ts
import {
  emitLoadProgress,
  formatLoadProgress,
  isLoadProgressMessage,
  LOAD_PROGRESS_TYPE,
  loadProgressMessage,
  onLoadProgress,
  throttleProgress,
} from './loadProgress'

it('formats downloaded and total megabytes, or only the downloaded part when the total is unknown', () => {
  expect(formatLoadProgress({ loaded: 5_200_000, total: 8_400_000 })).toBe('5.2 / 8.4 MB')
  expect(formatLoadProgress({ loaded: 5_200_000, total: null })).toBe('5.2 MB')
})

it('recognises only well-formed progress messages, never Comlink replies', () => {
  expect(isLoadProgressMessage(loadProgressMessage({ loaded: 1, total: 2 }))).toBe(true)
  expect(isLoadProgressMessage(loadProgressMessage({ loaded: 1, total: null }))).toBe(true)
  expect(isLoadProgressMessage({ type: LOAD_PROGRESS_TYPE, loaded: '1', total: 2 })).toBe(false)
  expect(isLoadProgressMessage({ id: 'abc', type: 'RETURN', value: 1 })).toBe(false)
  expect(isLoadProgressMessage(null)).toBe(false)
})

it('throttles to one report per step, always reporting the first and the complete one', () => {
  const seen: number[] = []
  const report = throttleProgress((p) => seen.push(p.loaded), 100)
  for (const loaded of [0, 50, 120, 150, 260, 300]) report({ loaded, total: 300 })
  expect(seen).toEqual([0, 120, 260, 300])
})

it('delivers progress to subscribers until they unsubscribe', () => {
  const listener = vi.fn()
  const off = onLoadProgress(listener)
  emitLoadProgress({ loaded: 1, total: null })
  off()
  emitLoadProgress({ loaded: 2, total: null })
  expect(listener).toHaveBeenCalledExactlyOnceWith({ loaded: 1, total: null })
})
```

`src/render/fetchWithProgress.test.ts`:

```ts
// @vitest-environment node
import { fetchWithProgress } from './fetchWithProgress'
import type { LoadProgress } from './loadProgress'

function streamed(chunks: number[], headers: Record<string, string>, status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const n of chunks) controller.enqueue(new Uint8Array(n).fill(7))
      controller.close()
    },
  })
  return new Response(body, { status, headers })
}

const fakeFetch = (res: Response) => vi.fn(async () => res) as unknown as typeof fetch

async function run(res: Response) {
  const seen: LoadProgress[] = []
  const buf = await fetchWithProgress('/promptcad/openscad/openscad.wasm', (p) => seen.push(p), fakeFetch(res))
  return { buf, seen }
}

it('reports bytes as they arrive against Content-Length and returns all of them', async () => {
  const { buf, seen } = await run(streamed([3, 4], { 'content-length': '7' }))
  expect(buf.byteLength).toBe(7)
  expect(new Uint8Array(buf).every((b) => b === 7)).toBe(true)
  expect(seen).toEqual([
    { loaded: 0, total: 7 },
    { loaded: 3, total: 7 },
    { loaded: 7, total: 7 },
  ])
})

it('drops the total for a compressed transfer, whose length is the compressed size', async () => {
  const { seen } = await run(streamed([3, 4], { 'content-length': '2', 'content-encoding': 'gzip' }))
  expect(seen.map((p) => p.total)).toEqual([null, null, null])
})

it('drops the total when there is no length or more bytes arrive than declared', async () => {
  expect((await run(streamed([3], {}))).seen.map((p) => p.total)).toEqual([null, null])
  expect((await run(streamed([3, 4], { 'content-length': '5' }))).seen).toEqual([
    { loaded: 0, total: 5 },
    { loaded: 3, total: 5 },
    { loaded: 7, total: null },
  ])
})

it('fails with the URL and the HTTP status', async () => {
  await expect(run(streamed([], {}, 404))).rejects.toThrow('Failed to download /promptcad/openscad/openscad.wasm: HTTP 404')
})
```

`src/state/store.m4.test.ts`:

```ts
import { useAppStore } from './store'

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))

it('keeps the OpenSCAD download progress', () => {
  expect(useAppStore.getState().loadProgress).toBeNull()
  useAppStore.getState().setLoadProgress({ loaded: 1_000, total: 11_000_303 })
  expect(useAppStore.getState().loadProgress).toEqual({ loaded: 1_000, total: 11_000_303 })
})
```

Add to `src/ui/StatusPill.test.tsx`:

```tsx
it('shows the OpenSCAD download in mono while it loads', () => {
  render(
    <StatusPill status="idle" renderMs={null} error={null} diagnostics={[]} loadProgress={{ loaded: 5_200_000, total: 8_400_000 }} />,
  )
  const pill = screen.getByTestId('render-status')
  expect(pill).toHaveTextContent('Loading OpenSCAD 5.2 / 8.4 MB')
  expect(pill.querySelector('.pc-mono')).toHaveTextContent('5.2 / 8.4 MB')
  expect(pill).toHaveClass('pc-status', 'is-busy')
  expect(pill.querySelector('svg.pc-i')).not.toBeNull()
})
```

Add to `src/panels/ConsolePanel.test.tsx`:

```tsx
it('names the download size in the idle line, as the first-run screen does', () => {
  expect(summaryLine('idle', null, null, [], { loaded: 1_000, total: 11_000_303 })).toEqual({
    text: 'Downloading OpenSCAD (11.0 MB, cached for offline use after this)…',
    tone: 'is-muted',
  })
  expect(summaryLine('idle', null, null, [], { loaded: 5_200_000, total: null })).toEqual({
    text: 'Downloading OpenSCAD (5.2 MB so far, cached for offline use after this)…',
    tone: 'is-muted',
  })
  expect(summaryLine('idle', null, null, [])).toEqual({ text: 'Loading OpenSCAD…', tone: 'is-muted' })
})
```

(Import `summaryLine` from `./ConsolePanel` at the top of that test file if it is not imported yet.)

Add to `src/App.test.tsx` (import `emitLoadProgress` from `./render/loadProgress`):

```tsx
it('shows the OpenSCAD download progress in the pill before the first render', () => {
  render(<App createWorker={() => ({ render: () => new Promise<RenderResult>(() => {}), terminate: () => {} })} />)
  act(() => emitLoadProgress({ loaded: 5_200_000, total: 8_400_000 }))
  expect(screen.getByTestId('render-status')).toHaveTextContent('Loading OpenSCAD 5.2 / 8.4 MB')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/bytes.test.ts src/render/loadProgress.test.ts src/render/fetchWithProgress.test.ts src/state/store.m4.test.ts src/ui/StatusPill.test.tsx src/panels/ConsolePanel.test.tsx src/App.test.tsx`
Expected: FAIL: the new modules cannot be resolved, `setLoadProgress` is not a function, and the pill and console show "Loading OpenSCAD…" without sizes.

- [ ] **Step 3: Implement**

`src/ui/bytes.ts`:

```ts
/** "5.2" for 5,240,000 bytes. Decimal megabytes, as download sizes are usually quoted. */
export function formatMegabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1)
}

/** "9.4 KB" below 1 MB, "1.6 MB" from 1 MB. */
export function formatSize(bytes: number): string {
  return bytes < 1_000_000 ? `${(bytes / 1000).toFixed(1)} KB` : `${formatMegabytes(bytes)} MB`
}
```

`src/render/loadProgress.ts`:

```ts
import { formatMegabytes } from '../ui/bytes'

export interface LoadProgress {
  loaded: number
  /** null when the server's length is missing or cannot be trusted (compressed transfer). */
  total: number | null
}

export const LOAD_PROGRESS_TYPE = 'promptcad:openscad-load-progress'

export interface LoadProgressMessage extends LoadProgress {
  type: typeof LOAD_PROGRESS_TYPE
}

export function loadProgressMessage(p: LoadProgress): LoadProgressMessage {
  return { type: LOAD_PROGRESS_TYPE, loaded: p.loaded, total: p.total }
}

export function isLoadProgressMessage(data: unknown): data is LoadProgressMessage {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  return d.type === LOAD_PROGRESS_TYPE && typeof d.loaded === 'number' && (d.total === null || typeof d.total === 'number')
}

/** Passes on the first report, then one per `stepBytes`, and the one that completes the download. */
export function throttleProgress(report: (p: LoadProgress) => void, stepBytes = 250_000): (p: LoadProgress) => void {
  let last: number | null = null
  return (p) => {
    const complete = p.total !== null && p.loaded >= p.total
    if (last === null || p.loaded - last >= stepBytes || complete) {
      last = p.loaded
      report(p)
    }
  }
}

/** "5.2 / 8.4 MB", or "5.2 MB" when the total is unknown. */
export function formatLoadProgress({ loaded, total }: LoadProgress): string {
  return total ? `${formatMegabytes(loaded)} / ${formatMegabytes(total)} MB` : `${formatMegabytes(loaded)} MB`
}

type Listener = (p: LoadProgress) => void
const listeners = new Set<Listener>()

export function onLoadProgress(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitLoadProgress(p: LoadProgress): void {
  for (const listener of listeners) listener(p)
}
```

`src/render/fetchWithProgress.ts`:

```ts
import type { LoadProgress } from './loadProgress'

/** GET `url` into memory, reporting bytes as they arrive. Never reports a total it cannot trust. */
export async function fetchWithProgress(
  url: string,
  onProgress: (p: LoadProgress) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<ArrayBuffer> {
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`)
  const declared = Number(res.headers.get('content-length'))
  // A compressed transfer declares the compressed length, but the reader yields decompressed bytes.
  let total: number | null = res.headers.get('content-encoding') || !(declared > 0) ? null : declared

  if (!res.body) {
    const buf = await res.arrayBuffer()
    onProgress({ loaded: buf.byteLength, total: buf.byteLength })
    return buf
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  onProgress({ loaded, total })
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    if (total !== null && loaded > total) total = null
    onProgress({ loaded, total })
  }

  const out = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out.buffer
}
```

`src/render/runOpenSCAD.ts`: extend the options interface (nothing else in the file changes):

```ts
export interface OpenSCADFactoryOptions {
  noInitialRun: true
  print(text: string): void
  printErr(text: string): void
  locateFile?(path: string): string
  /** Pre-fetched openscad.wasm; Emscripten instantiates it instead of fetching the file itself. */
  wasmBinary?: ArrayBuffer
}
```

`src/render/render.worker.ts`: add the imports and the `post` helper, and replace `loadFactory` (keep `api`, its `render` method and any M3 additions to it unchanged):

```ts
import { fetchWithProgress } from './fetchWithProgress'
import { loadProgressMessage, throttleProgress } from './loadProgress'

/** A worker's postMessage takes one argument; the DOM lib types the global as Window's. */
const post = (message: unknown) => (globalThis as unknown as { postMessage(m: unknown): void }).postMessage(message)

let factoryPromise: Promise<OpenSCADFactory> | null = null

function loadFactory(): Promise<OpenSCADFactory> {
  factoryPromise ??= Promise.all([
    import(/* @vite-ignore */ `${OPENSCAD_DIR}openscad.js`) as Promise<{
      default: (opts: OpenSCADFactoryOptions) => ReturnType<OpenSCADFactory>
    }>,
    // Fetched here rather than by Emscripten so the page can show download progress; reused by every fresh instance.
    fetchWithProgress(`${OPENSCAD_DIR}openscad.wasm`, throttleProgress((p) => post(loadProgressMessage(p)))),
  ])
    .then(([mod, wasmBinary]) => {
      const create = mod.default
      return (opts: OpenSCADFactoryOptions) => create({ ...opts, locateFile: (path) => OPENSCAD_DIR + path, wasmBinary })
    })
    .catch((e: unknown) => {
      factoryPromise = null
      throw e
    })
  return factoryPromise
}
```

`src/render/createRenderWorker.ts` (full file):

```ts
import * as Comlink from 'comlink'
import { emitLoadProgress, isLoadProgressMessage } from './loadProgress'
import type { RenderWorkerApi } from './render.worker'
import type { RenderRequest, RenderResult } from './types'

export interface RenderWorkerHandle {
  render(req: RenderRequest): Promise<RenderResult>
  terminate(): void
}

export type WorkerFactory = () => RenderWorkerHandle

export function createRenderWorker(): RenderWorkerHandle {
  const worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' })
  // Download progress travels beside Comlink's messages; Comlink ignores anything without its own id.
  worker.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (isLoadProgressMessage(event.data)) emitLoadProgress({ loaded: event.data.loaded, total: event.data.total })
  })
  const api = Comlink.wrap<RenderWorkerApi>(worker)
  return {
    render: (req) => api.render(req),
    terminate: () => {
      api[Comlink.releaseProxy]()
      worker.terminate()
    },
  }
}
```

`src/state/store.ts`: add to the imports, the `AppState` interface and the `create` body (every existing field and action stays):

```ts
import type { LoadProgress } from '../render/loadProgress'

// in AppState
  /** OpenSCAD WASM download progress, shown while the first render waits for it. */
  loadProgress: LoadProgress | null
  setLoadProgress(progress: LoadProgress | null): void

// in create()
  loadProgress: null,
  setLoadProgress: (loadProgress) => set({ loadProgress }),
```

`src/ui/StatusPill.tsx`: add the import, the optional parameter and prop, and replace the `'idle'` case:

```ts
import { formatLoadProgress, type LoadProgress } from '../render/loadProgress'

export function describeStatus(
  status: RenderStatus,
  renderMs: number | null,
  error: string | null,
  diagnostics: Diagnostic[],
  loadProgress: LoadProgress | null = null,
): StatusDescription {
  const base = { ms: null, suffix: '', line: null, title: null }
  switch (status) {
    case 'idle':
      return loadProgress
        ? { ...base, tone: 'busy', label: 'Loading OpenSCAD', ms: formatLoadProgress(loadProgress) }
        : { ...base, tone: 'busy', label: 'Loading OpenSCAD…' }
    // 'rendering', 'ok', 'error' unchanged
  }
}
```

In `Props` add `loadProgress?: LoadProgress | null`, destructure it in `StatusPill`, and pass it as the fifth argument: `describeStatus(status, renderMs, error, diagnostics, loadProgress ?? null)`. The `ms` slot already renders in `pc-mono` after the label, which gives "Loading OpenSCAD <mono>5.2 / 8.4 MB</mono>".

`src/panels/ConsolePanel.tsx`: add the imports, the optional parameter and prop, and replace the `'idle'` case of `summaryLine`:

```ts
import type { LoadProgress } from '../render/loadProgress'
import { formatMegabytes } from '../ui/bytes'

export function summaryLine(
  status: RenderStatus,
  error: string | null,
  renderMs: number | null,
  logs: LogLine[],
  loadProgress: LoadProgress | null = null,
): { text: string; tone: LogTone } | null {
  const ms = `${Math.round(renderMs ?? 0)} ms`
  switch (status) {
    case 'idle': {
      if (!loadProgress) return { text: 'Loading OpenSCAD…', tone: 'is-muted' }
      const size = loadProgress.total
        ? `${formatMegabytes(loadProgress.total)} MB`
        : `${formatMegabytes(loadProgress.loaded)} MB so far`
      return { text: `Downloading OpenSCAD (${size}, cached for offline use after this)…`, tone: 'is-muted' }
    }
    // 'rendering', 'ok', 'error' unchanged
  }
}
```

In `Props` add `loadProgress?: LoadProgress | null` and call `summaryLine(status, error, renderMs, logs, loadProgress ?? null)`.

`src/App.tsx`: subscribe once and pass the progress to both places:

```tsx
import { useEffect } from 'react'
import { onLoadProgress } from './render/loadProgress'

// inside App, next to the other store selectors:
  useEffect(() => onLoadProgress(useAppStore.getState().setLoadProgress), [])
  const loadProgress = useAppStore((s) => s.loadProgress)

// header:
  <StatusPill status={status} renderMs={renderMs} error={error} diagnostics={diagnostics} onGoToLine={goToLine} loadProgress={loadProgress} />
// console:
  <ConsolePanel status={status} logs={logs} error={error} renderMs={renderMs} onGoToLine={goToLine} loadProgress={loadProgress} />
```

(Keep any props M2/M3 added to `StatusPill` and `ConsolePanel`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/bytes.test.ts src/render/loadProgress.test.ts src/render/fetchWithProgress.test.ts src/state/store.m4.test.ts src/ui/StatusPill.test.tsx src/panels/ConsolePanel.test.tsx src/App.test.tsx && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Check the real download once**

Run: `npm run dev`, open the app with devtools Network throttling set to "Fast 4G" and the cache disabled.
Expected: the header pill reads "Loading OpenSCAD 0.0 / 11.0 MB" rising to "11.0 / 11.0 MB" (or "… MB" without a total if the dev server compresses), the console shows "Downloading OpenSCAD (11.0 MB, cached for offline use after this)…", then the pill turns into "Rendered N ms". The Network panel shows `openscad.wasm` fetched once by the worker.

- [ ] **Step 6: Commit**

```bash
git add src/ui/bytes.ts src/ui/bytes.test.ts src/render src/state src/ui/StatusPill.tsx src/ui/StatusPill.test.tsx src/panels src/App.tsx src/App.test.tsx
git commit -m "feat(render): show OpenSCAD download progress in the status pill and console

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Quick low-detail preview pass and the triangle warning

**Files:**
- Create: `src/render/previewPass.ts`, `src/viewer/TriangleWarning.tsx`, `src/settings/LowQualityPreviewSwitch.tsx`
- Modify: `src/state/store.ts`, `src/viewer/Viewer.tsx`, `src/App.tsx`, `src/ui/icons.ts`, the M3 Settings › Rendering section
- Test: `src/render/previewPass.test.ts`, `src/viewer/TriangleWarning.test.tsx`, `src/settings/settingsControls.test.tsx`, `src/state/store.m4.test.ts` (extend), `src/App.test.tsx` (extend)

**Interfaces:**
- Consumes: `WorkerFactory` (M1), `usePrefs` (Task 1), `selectCanExport` (M3 version), store `params` (M3), `lastRender` (M2).
- Produces:
  - `LOW_QUALITY_FN = 12`
  - `withPreviewPass(createWorker: WorkerFactory, opts: { enabled(): boolean; onPreview(result: Extract<RenderResult, { ok: true }>, req: RenderRequest): void }): WorkerFactory`
  - store: `interface PreviewMesh { code: string; params: Record<string, ParamValue>; mesh: MeshData }`, `preview: PreviewMesh | null`, `showPreview(p: PreviewMesh): void`, `selectDisplayMesh(s): MeshData | null`, `selectShowingPreview(s): boolean`
  - `TRIANGLE_WARNING = 1_000_000`, `<TriangleWarning count={number} />`
  - `<Viewer previewing? />` badge "Quick preview · full render running"
  - `<LowQualityPreviewSwitch />`

The quick pass is a `WorkerFactory` decorator, so `RenderController`, `useRenderLoop`, `lastRender` and `awaitRender` stay untouched: the controller sees one `render()` call whose result is the full render. The `$fn = 12` mesh only reaches the store's `preview` slot, which no export path reads. Both passes share the controller's one timeout. `-D $fn=12` overrides the top-level `$fn`; calls that pass their own `$fn = …` keep it, as the spec's "overriding `$fn`" implies.

- [ ] **Step 1: Write the failing tests**

`src/render/previewPass.test.ts`:

```ts
import type { Mock } from 'vitest'
import { errorResult, okResult } from '../test/results'
import { LOW_QUALITY_FN, withPreviewPass } from './previewPass'
import type { RenderRequest, RenderResult } from './types'

interface FakeHandle {
  requests: RenderRequest[]
  render: Mock<(req: RenderRequest) => Promise<RenderResult>>
  terminate: Mock<() => void>
}

function fakeFactory(respond: (req: RenderRequest) => RenderResult | Promise<RenderResult>) {
  const handles: FakeHandle[] = []
  const factory = vi.fn(() => {
    const h: FakeHandle = {
      requests: [],
      render: vi.fn(async (req: RenderRequest) => {
        h.requests.push(req)
        return respond(req)
      }),
      terminate: vi.fn(),
    }
    handles.push(h)
    return h
  })
  return { handles, factory }
}

it('renders with $fn = 12 first, reports that mesh, then returns the full render', async () => {
  const quick = okResult()
  const full = okResult()
  const { handles, factory } = fakeFactory((req) => (req.params?.$fn === LOW_QUALITY_FN ? quick : full))
  const onPreview = vi.fn()
  const worker = withPreviewPass(factory, { enabled: () => true, onPreview })()

  await expect(worker.render({ code: 'c', params: { w: 2 } })).resolves.toBe(full)
  expect(handles[0].requests).toEqual([
    { code: 'c', params: { w: 2, $fn: 12 } },
    { code: 'c', params: { w: 2 } },
  ])
  expect(onPreview).toHaveBeenCalledExactlyOnceWith(quick, { code: 'c', params: { w: 2 } })
})

it('renders once when the setting is off', async () => {
  const { handles, factory } = fakeFactory(() => okResult())
  const onPreview = vi.fn()
  await withPreviewPass(factory, { enabled: () => false, onPreview })().render({ code: 'c' })
  expect(handles[0].requests).toEqual([{ code: 'c' }])
  expect(onPreview).not.toHaveBeenCalled()
})

it('does not report a failed quick pass and still renders in full', async () => {
  const full = okResult()
  const { handles, factory } = fakeFactory((req) => (req.params?.$fn === LOW_QUALITY_FN ? errorResult() : full))
  const onPreview = vi.fn()
  await expect(withPreviewPass(factory, { enabled: () => true, onPreview })().render({ code: 'c' })).resolves.toBe(full)
  expect(onPreview).not.toHaveBeenCalled()
  expect(handles[0].requests).toHaveLength(2)
})

it('drops the quick mesh and skips the full pass once the controller has terminated the worker', async () => {
  let release!: (r: RenderResult) => void
  const { handles, factory } = fakeFactory(() => new Promise<RenderResult>((resolve) => (release = resolve)))
  const onPreview = vi.fn()
  const worker = withPreviewPass(factory, { enabled: () => true, onPreview })()
  const pending = worker.render({ code: 'old' })
  await vi.waitFor(() => expect(handles[0].requests).toHaveLength(1))
  worker.terminate()
  release(okResult())
  await pending
  expect(onPreview).not.toHaveBeenCalled()
  expect(handles[0].requests).toHaveLength(1)
  expect(handles[0].terminate).toHaveBeenCalled()
})
```

Append to `src/state/store.m4.test.ts`:

```ts
import { okResult } from '../test/results'
import { selectCanExport, selectDisplayMesh, selectShowingPreview } from './store'

function meshOf(r = okResult()) {
  if (!r.ok) throw new Error('fixture must succeed')
  return r.mesh
}

it('shows the quick preview only while the matching code and parameters render', () => {
  const full = meshOf()
  const quick = meshOf()
  useAppStore.setState({ code: 'cube(1);', params: { w: 2 }, mesh: full, status: 'rendering' })
  useAppStore.getState().showPreview({ code: 'cube(1);', params: { w: 2 }, mesh: quick })
  expect(selectDisplayMesh(useAppStore.getState())).toBe(quick)
  expect(selectShowingPreview(useAppStore.getState())).toBe(true)

  useAppStore.setState({ params: { w: 3 } })
  expect(selectDisplayMesh(useAppStore.getState())).toBe(full)
  useAppStore.setState({ params: { w: 2 }, code: 'cube(2);' })
  expect(selectDisplayMesh(useAppStore.getState())).toBe(full)
  useAppStore.setState({ code: 'cube(1);', status: 'ok' })
  expect(selectDisplayMesh(useAppStore.getState())).toBe(full)
  expect(selectShowingPreview(useAppStore.getState())).toBe(false)
})

it('never makes the quick preview exportable or visible to awaitRender', () => {
  useAppStore.setState({ code: 'cube(1);', status: 'rendering', renderedCode: 'cube(0);' })
  useAppStore.getState().showPreview({ code: 'cube(1);', params: {}, mesh: meshOf() })
  expect(selectCanExport(useAppStore.getState())).toBe(false)
  expect(useAppStore.getState().lastRender).toBeNull()
  expect(useAppStore.getState().renderedCode).toBe('cube(0);')
})
```

`src/viewer/TriangleWarning.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { TriangleWarning } from './TriangleWarning'

it('stays hidden up to one million triangles', () => {
  const { container } = render(<TriangleWarning count={1_000_000} />)
  expect(container).toBeEmptyDOMElement()
})

it('warns with the count and what to do above one million', () => {
  render(<TriangleWarning count={1_234_567} />)
  const callout = screen.getByRole('status')
  expect(callout).toHaveClass('pc-callout', 'is-warn')
  expect(callout).toHaveTextContent('Heavy model: 1,234,567 triangles')
  expect(callout).toHaveTextContent('Phones may slow down or run out of memory. Lower $fn or simplify the model.')
  expect(callout.querySelector('svg.pc-i')).not.toBeNull()
})
```

`src/settings/settingsControls.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LowQualityPreviewSwitch } from './LowQualityPreviewSwitch'
import { usePrefs } from './prefsStore'

beforeEach(() => usePrefs.setState(usePrefs.getInitialState(), true))

it('turns the quick preview pass on and off', async () => {
  const update = vi.fn(async () => {})
  usePrefs.setState({ update })
  render(<LowQualityPreviewSwitch />)
  const toggle = screen.getByRole('checkbox', { name: 'Quick preview before each render' })
  expect(toggle).not.toBeChecked()
  await userEvent.click(toggle)
  expect(update).toHaveBeenCalledWith({ lowQualityPreview: true })
  expect(screen.getByText(/Renders once with \$fn = 12/)).toBeInTheDocument()
})
```

Add to `src/App.test.tsx` (import `usePrefs` from `./settings/prefsStore`; add `afterEach(() => usePrefs.setState(usePrefs.getInitialState(), true))`):

```tsx
it('renders a quick $fn = 12 pass before the full render when the setting is on', async () => {
  usePrefs.setState({ lowQualityPreview: true })
  const seen: RenderRequest[] = []
  render(
    <App
      createWorker={scriptedWorker((req) => {
        seen.push(req)
        return okResult()
      })}
    />,
  )
  await waitFor(() => expect(screen.getByTestId('render-status')).toHaveTextContent(/^Rendered/))
  expect(seen[0].params).toMatchObject({ $fn: 12 })
  expect(seen[1].params ?? {}).not.toHaveProperty('$fn')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/render/previewPass.test.ts src/state/store.m4.test.ts src/viewer/TriangleWarning.test.tsx src/settings/settingsControls.test.tsx src/App.test.tsx`
Expected: FAIL: `./previewPass`, `./TriangleWarning`, `./LowQualityPreviewSwitch` cannot be resolved, `showPreview` is not a function, and the App renders only once.

- [ ] **Step 3: Implement**

`src/render/previewPass.ts`:

```ts
import type { WorkerFactory } from './createRenderWorker'
import type { RenderRequest, RenderResult } from './types'

export const LOW_QUALITY_FN = 12

export interface PreviewPassOptions {
  enabled(): boolean
  onPreview(result: Extract<RenderResult, { ok: true }>, req: RenderRequest): void
}

/**
 * Wraps a worker so each render first compiles with `$fn = 12` (shown at once on slow phones), then in full.
 * The caller only ever receives the full result, so exports and awaitRender never see the quick mesh.
 */
export function withPreviewPass(createWorker: WorkerFactory, opts: PreviewPassOptions): WorkerFactory {
  return () => {
    const inner = createWorker()
    let terminated = false
    return {
      async render(req) {
        if (opts.enabled()) {
          const quick = await inner.render({ ...req, params: { ...req.params, $fn: LOW_QUALITY_FN } })
          // A newer request made the controller kill this worker; its result is never delivered.
          if (terminated) return quick
          if (quick.ok) opts.onPreview(quick, req)
        }
        return inner.render(req)
      },
      terminate() {
        terminated = true
        inner.terminate()
      },
    }
  }
}
```

`src/state/store.ts`: add the type import, the interface, the state, the action and the selectors:

```ts
import type { ParamValue } from '../render/types'

export interface PreviewMesh {
  code: string
  params: Record<string, ParamValue>
  mesh: MeshData
}

// in AppState
  /** The quick `$fn = 12` mesh for the code being rendered; never exported. */
  preview: PreviewMesh | null
  showPreview(preview: PreviewMesh): void

// in create()
  preview: null,
  showPreview: (preview) => set({ preview }),

// after selectCanExport
function sameParams(a: Record<string, ParamValue>, b: Record<string, ParamValue>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => k in b && JSON.stringify(a[k]) === JSON.stringify(b[k]))
}

/** The mesh to draw: the quick preview while the full render of that exact code and parameters runs, else the last good mesh. */
export const selectDisplayMesh = (s: AppState): MeshData | null =>
  s.status === 'rendering' && s.preview !== null && s.preview.code === s.code && sameParams(s.preview.params, s.params)
    ? s.preview.mesh
    : s.mesh

export const selectShowingPreview = (s: AppState): boolean => selectDisplayMesh(s) !== s.mesh
```

`src/viewer/TriangleWarning.tsx`:

```tsx
import { IconWarning } from '../ui/icons'

export const TRIANGLE_WARNING = 1_000_000

export function TriangleWarning({ count }: { count: number }) {
  if (count <= TRIANGLE_WARNING) return null
  return (
    <div role="status" className="pc-callout is-warn max-w-xs">
      <IconWarning className="pc-i" aria-hidden="true" />
      <div className="pc-callout-body">
        <strong>Heavy model: {count.toLocaleString('en-US')} triangles</strong>
        Phones may slow down or run out of memory. Lower $fn or simplify the model.
      </div>
    </div>
  )
}
```

`src/settings/LowQualityPreviewSwitch.tsx`:

```tsx
import { usePrefs } from './prefsStore'

export function LowQualityPreviewSwitch() {
  const on = usePrefs((s) => s.lowQualityPreview)
  const update = usePrefs((s) => s.update)
  return (
    <div className="pc-field">
      <label className="pc-switch">
        <input type="checkbox" checked={on} onChange={(e) => void update({ lowQualityPreview: e.target.checked })} />
        <span className="pc-track" />
        Quick preview before each render
      </label>
      <span className="pc-hint">
        Renders once with $fn = 12 so a rough shape shows sooner on phones, then renders in full. Export waits for the full render.
      </span>
    </div>
  )
}
```

Add `<LowQualityPreviewSwitch />` to the M3 Settings › Rendering section, after the timeout field.

`src/ui/icons.ts`: add `Clock as IconClock` to the export list (used by later tasks; adding it now keeps the file's one-list shape):

```ts
export {
  Check as IconCheck,
  Clock as IconClock,
  Download as IconDownload,
  LoaderCircle as IconSpinner,
  Scan as IconFit,
  TriangleAlert as IconWarning,
  X as IconX,
} from 'lucide-react'
```

(Keep any icons M2/M3 added to this list.)

`src/viewer/Viewer.tsx`: add the `previewing` prop, the badge and the warning:

```tsx
import { IconFit, IconSpinner, IconWarning } from '../ui/icons'
import { TriangleWarning } from './TriangleWarning'

export function Viewer({ mesh, stale, previewing = false }: { mesh: MeshData | null; stale: boolean; previewing?: boolean }) {
  // … unchanged until the top-left overlay, which becomes:
      <div className="absolute top-3 left-3">
        {stale ? (
          <span className="pc-status is-warn">
            <IconWarning className="pc-i" aria-hidden="true" />
            Showing the last model that compiled
          </span>
        ) : previewing ? (
          <span className="pc-status is-busy">
            <IconSpinner className="pc-i" aria-hidden="true" />
            Quick preview · full render running
          </span>
        ) : (
          mesh && <DimsReadout bounds={mesh.bounds} axes />
        )}
      </div>
  // … and the bottom-left caption becomes:
      {mesh && (
        <div className="absolute bottom-3 left-3 flex flex-col items-start gap-2">
          <TriangleWarning count={mesh.triangleCount} />
          <div className="pc-caption pc-mono">{mesh.triangleCount.toLocaleString('en-US')} triangles</div>
        </div>
      )}
```

`src/App.tsx`: wrap the worker factory and draw the display mesh:

```tsx
import { useMemo } from 'react'
import { withPreviewPass } from './render/previewPass'
import { usePrefs } from './settings/prefsStore'
import { selectDisplayMesh, selectShowingPreview } from './state/store'

// inside App, before useRenderLoop:
  const renderWorker = useMemo(
    () =>
      withPreviewPass(createWorker, {
        enabled: () => usePrefs.getState().lowQualityPreview,
        onPreview: (result, req) =>
          useAppStore.getState().showPreview({ code: req.code, params: req.params ?? {}, mesh: result.mesh }),
      }),
    [createWorker],
  )
  useRenderLoop(renderWorker /* keep the debounce/timeout arguments M3 passes */)
  const displayMesh = useAppStore(selectDisplayMesh)
  const previewing = useAppStore(selectShowingPreview)

// in the 3D section:
  <Viewer mesh={displayMesh} stale={stale} previewing={previewing} />
```

`stale` and the header dims keep using `mesh` (the last full render), so the dims never show the rough preview.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/render/previewPass.test.ts src/state/store.m4.test.ts src/viewer/TriangleWarning.test.tsx src/settings/settingsControls.test.tsx src/App.test.tsx && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/render/previewPass.ts src/render/previewPass.test.ts src/state src/viewer src/settings src/ui/icons.ts src/App.tsx src/App.test.tsx
git add -u src   # the M3 Settings › Rendering section
git commit -m "feat(render): optional quick \$fn = 12 preview pass and a heavy-model warning

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Offscreen frame renderer (`renderFrames`, `turntablePoses`, `presetPose`)

**Files:**
- Create: `src/export/frames.ts`, `src/export/glFrameRenderer.ts`, `src/export/pixels.ts`, `src/export/png.ts`
- Test: `src/export/frames.test.ts`, `src/export/pixels.test.ts`

**Interfaces:**
- Consumes: `MeshData`, `Bounds`, `Vec3` (M1 `src/render/types.ts`); `computeCameraFit` (M1 `src/viewer/cameraFit.ts`); `meshToGeometry` (M1 `src/viewer/geometry.ts`); `readToken` (M1 `src/theme/tokens.ts`).
- Produces (contract):
  - `type CameraPose = { position: Vec3; target: Vec3; up?: Vec3 }`
  - `renderFrames(opts: { mesh: MeshData; size: [number, number]; background: string | null; cameras: CameraPose[] }): AsyncGenerator<ImageData>`; `background: null` means transparent
  - `turntablePoses(bounds: Bounds, frames: number): CameraPose[]` (one full turn about Z, starting at the iso pose)
  - `presetPose(bounds: Bounds, preset: 'iso' | 'front' | 'top'): CameraPose`
- Produces (private): `FRAME_FOV = 45`; `createGlFrameRenderer(opts: { width; height; background: string | null; filament: string }): { setMesh(mesh): void; render(pose): ImageData; dispose(): void }`; `flipRows(pixels: Uint8Array, width: number, height: number): Uint8ClampedArray<ArrayBuffer>`; `imageDataToPng(image: ImageData): Promise<Blob>`

The frame renderer runs on the main thread (WebGL needs a canvas; an `OffscreenCanvas` when the browser has one, else a detached `<canvas>`) and yields to the event loop between frames, so the dialog stays responsive. It reads the `filament` token at call time, so exports follow the current theme. Lights match the main viewer's. jsdom has no WebGL, so `frames.test.ts` replaces `glFrameRenderer` with a fake; the real renderer and `imageDataToPng` are covered by the PNG and GIF end-to-end tests in Task 17.

- [ ] **Step 1: Write the failing tests**

`src/export/pixels.test.ts`:

```ts
import { flipRows } from './pixels'

it('turns WebGL bottom-up rows into top-down ImageData rows', () => {
  const pixels = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  expect([...flipRows(pixels, 1, 3)]).toEqual([9, 10, 11, 12, 5, 6, 7, 8, 1, 2, 3, 4])
})
```

`src/export/frames.test.ts`:

```ts
import type { Mock } from 'vitest'
import type { MeshData, Vec3 } from '../render/types'
import { okResult } from '../test/results'
import { computeCameraFit } from '../viewer/cameraFit'
import { FRAME_FOV, presetPose, renderFrames, turntablePoses, type CameraPose } from './frames'

interface RendererOpts {
  width: number
  height: number
  background: string | null
  filament: string
}
interface FakeRenderer {
  opts: RendererOpts
  setMesh: Mock<(mesh: MeshData) => void>
  render: Mock<(pose: CameraPose) => ImageData>
  dispose: Mock<() => void>
}

const { renderers } = vi.hoisted(() => ({ renderers: [] as FakeRenderer[] }))

vi.mock('./glFrameRenderer', () => ({
  createGlFrameRenderer: (opts: RendererOpts) => {
    const r: FakeRenderer = {
      opts,
      setMesh: vi.fn<(mesh: MeshData) => void>(),
      render: vi.fn(
        (_pose: CameraPose) => ({ width: opts.width, height: opts.height, data: new Uint8ClampedArray(4) }) as unknown as ImageData,
      ),
      dispose: vi.fn<() => void>(),
    }
    renderers.push(r)
    return r
  },
}))
vi.mock('../theme/tokens', () => ({ readToken: (name: string) => `token:${name}` }))

const result = okResult()
if (!result.ok) throw new Error('fixture must succeed')
const mesh = result.mesh
const dist = (p: Vec3, t: Vec3) => Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2])

beforeEach(() => {
  renderers.length = 0
})

it('uses the viewer auto-fit as the iso pose', () => {
  const fit = computeCameraFit(mesh.bounds, FRAME_FOV, 1)
  expect(presetPose(mesh.bounds, 'iso')).toEqual({ position: fit.position, target: fit.target })
})

it('looks along +Y for front and straight down with Y up for top', () => {
  const front = presetPose(mesh.bounds, 'front')
  const t = front.target
  expect(front.position[0]).toBeCloseTo(t[0])
  expect(front.position[2]).toBeCloseTo(t[2])
  expect(front.position[1]).toBeLessThan(t[1])

  const top = presetPose(mesh.bounds, 'top')
  expect(top.position[0]).toBeCloseTo(t[0])
  expect(top.position[1]).toBeCloseTo(t[1])
  expect(top.position[2]).toBeGreaterThan(t[2])
  expect(top.up).toEqual([0, 1, 0])
})

it('circles the model once at a constant height and distance, starting at the iso pose', () => {
  const iso = presetPose(mesh.bounds, 'iso')
  const poses = turntablePoses(mesh.bounds, 36)
  expect(poses).toHaveLength(36)
  poses[0].position.forEach((c, i) => expect(c).toBeCloseTo(iso.position[i]))
  for (const p of poses) {
    expect(p.position[2]).toBeCloseTo(iso.position[2])
    expect(dist(p.position, p.target)).toBeCloseTo(dist(iso.position, iso.target))
  }
  const dx = iso.position[0] - iso.target[0]
  const dy = iso.position[1] - iso.target[1]
  const quarter = poses[9].position
  expect(quarter[0] - iso.target[0]).toBeCloseTo(-dy)
  expect(quarter[1] - iso.target[1]).toBeCloseTo(dx)
})

it('renders one frame per pose with the current filament token, then disposes the renderer', async () => {
  const cameras = turntablePoses(mesh.bounds, 3)
  const frames: ImageData[] = []
  for await (const frame of renderFrames({ mesh, size: [64, 48], background: null, cameras })) frames.push(frame)

  expect(frames).toHaveLength(3)
  expect(renderers).toHaveLength(1)
  expect(renderers[0].opts).toEqual({ width: 64, height: 48, background: null, filament: 'token:filament' })
  expect(renderers[0].setMesh).toHaveBeenCalledExactlyOnceWith(mesh)
  expect(renderers[0].render.mock.calls.map(([pose]) => pose)).toEqual(cameras)
  expect(renderers[0].dispose).toHaveBeenCalledTimes(1)
})

it('disposes the renderer when the consumer stops early', async () => {
  const frames = renderFrames({ mesh, size: [8, 8], background: 'token:viewport', cameras: turntablePoses(mesh.bounds, 5) })
  await frames.next()
  await frames.return(undefined)
  expect(renderers[0].render).toHaveBeenCalledTimes(1)
  expect(renderers[0].dispose).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/export/pixels.test.ts src/export/frames.test.ts`
Expected: FAIL, because `./pixels` and `./frames` cannot be resolved.

- [ ] **Step 3: Implement**

`src/export/pixels.ts`:

```ts
/** WebGL's readPixels returns rows bottom-up; ImageData wants them top-down. */
export function flipRows(pixels: Uint8Array, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const row = width * 4
  const out = new Uint8ClampedArray(pixels.length)
  for (let y = 0; y < height; y++) out.set(pixels.subarray(y * row, (y + 1) * row), (height - 1 - y) * row)
  return out
}
```

`src/export/frames.ts`:

```ts
import type { Bounds, MeshData, Vec3 } from '../render/types'
import { readToken } from '../theme/tokens'
import { computeCameraFit } from '../viewer/cameraFit'
import { createGlFrameRenderer } from './glFrameRenderer'

export interface CameraPose {
  position: Vec3
  target: Vec3
  up?: Vec3
}

/** Field of view of every exported frame; the main viewer uses the same. */
export const FRAME_FOV = 45

export function presetPose(bounds: Bounds, preset: 'iso' | 'front' | 'top'): CameraPose {
  const fit = computeCameraFit(bounds, FRAME_FOV, 1)
  const [tx, ty, tz] = fit.target
  switch (preset) {
    case 'iso':
      return { position: fit.position, target: fit.target }
    case 'front':
      return { position: [tx, ty - fit.distance, tz], target: fit.target }
    case 'top':
      // Looking straight down Z, so Z cannot be "up"; Y points up the image.
      return { position: [tx, ty, tz + fit.distance], target: fit.target, up: [0, 1, 0] }
  }
}

/** One full turn about the Z axis, starting at the iso pose. */
export function turntablePoses(bounds: Bounds, frames: number): CameraPose[] {
  const { position, target } = presetPose(bounds, 'iso')
  const dx = position[0] - target[0]
  const dy = position[1] - target[1]
  return Array.from({ length: frames }, (_, i) => {
    const a = (2 * Math.PI * i) / frames
    const c = Math.cos(a)
    const s = Math.sin(a)
    const p: Vec3 = [target[0] + dx * c - dy * s, target[1] + dx * s + dy * c, position[2]]
    return { position: p, target }
  })
}

/** Draws `mesh` once per camera pose, offscreen. `background: null` gives a transparent ground. */
export async function* renderFrames(opts: {
  mesh: MeshData
  size: [number, number]
  background: string | null
  cameras: CameraPose[]
}): AsyncGenerator<ImageData> {
  const [width, height] = opts.size
  const renderer = createGlFrameRenderer({ width, height, background: opts.background, filament: readToken('filament') })
  try {
    renderer.setMesh(opts.mesh)
    for (const pose of opts.cameras) {
      yield renderer.render(pose)
      // Let the page paint and take input between frames.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  } finally {
    renderer.dispose()
  }
}
```

`src/export/glFrameRenderer.ts`:

```ts
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
} from 'three'
import type { MeshData } from '../render/types'
import { meshToGeometry } from '../viewer/geometry'
import type { CameraPose } from './frames'
import { flipRows } from './pixels'

export interface GlFrameRendererOptions {
  width: number
  height: number
  background: string | null
  filament: string
}

export interface GlFrameRenderer {
  setMesh(mesh: MeshData): void
  render(pose: CameraPose): ImageData
  dispose(): void
}

function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export function createGlFrameRenderer({ width, height, background, filament }: GlFrameRendererOptions): GlFrameRenderer {
  const renderer = new WebGLRenderer({
    canvas: createCanvas(width, height),
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    premultipliedAlpha: false,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  if (background) renderer.setClearColor(new Color(background), 1)
  else renderer.setClearColor(new Color(), 0)

  const scene = new Scene()
  // Same lights as the main viewer (white by default; no colour literal needed).
  scene.add(new AmbientLight(undefined, 0.6))
  const key = new DirectionalLight(undefined, 1.4)
  key.position.set(50, -80, 100)
  const fill = new DirectionalLight(undefined, 0.4)
  fill.position.set(-60, 40, -30)
  scene.add(key, fill)

  const camera = new PerspectiveCamera(45, width / height, 0.1, 10_000)
  const material = new MeshStandardMaterial({ color: new Color(filament), roughness: 0.6, metalness: 0.1 })
  let model: Mesh<BufferGeometry, MeshStandardMaterial> | null = null
  const gl = renderer.getContext()
  const pixels = new Uint8Array(width * height * 4)

  return {
    setMesh(mesh) {
      if (model) {
        scene.remove(model)
        model.geometry.dispose()
      }
      model = new Mesh(meshToGeometry(mesh), material)
      scene.add(model)
    },
    render(pose) {
      camera.up.set(...(pose.up ?? [0, 0, 1]))
      camera.position.set(...pose.position)
      camera.lookAt(...pose.target)
      const distance = camera.position.distanceTo(new Vector3(...pose.target))
      camera.near = Math.max(distance / 1000, 0.01)
      camera.far = distance * 100
      camera.updateProjectionMatrix()
      renderer.render(scene, camera)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      return new ImageData(flipRows(pixels, width, height), width, height)
    },
    dispose() {
      model?.geometry.dispose()
      material.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
```

`src/export/png.ts`:

```ts
/** Encodes a frame as PNG with the browser's own encoder. */
export async function imageDataToPng(image: ImageData): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(image.width, image.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('The browser has no 2D canvas to encode the PNG')
    ctx.putImageData(image, 0, 0)
    return canvas.convertToBlob({ type: 'image/png' })
  }
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The browser has no 2D canvas to encode the PNG')
  ctx.putImageData(image, 0, 0)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode the PNG'))), 'image/png'),
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/export/pixels.test.ts src/export/frames.test.ts && npm run typecheck`
Expected: PASS (6 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/export/frames.ts src/export/frames.test.ts src/export/glFrameRenderer.ts src/export/pixels.ts src/export/pixels.test.ts src/export/png.ts
git commit -m "feat(export): offscreen three.js frame renderer with turntable and preset poses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: GIF encoding with gifenc in a module worker

**Files:**
- Modify: `package.json`, `package-lock.json` (add `gifenc`)
- Create: `src/types/gifenc.d.ts`, `src/export/gif.ts`, `src/export/gif.worker.ts`, `src/export/gifClient.ts`
- Test: `src/export/gif.test.ts`

**Interfaces:**
- Consumes: `gifenc` 1.0.3 (`GIFEncoder`, `quantize`, `applyPalette`); Comlink.
- Produces:
  - `class GifBuilder { constructor(width: number, height: number, transparent: boolean); addFrame(rgba: Uint8ClampedArray, delayMs: number): number /* bytes so far */; finish(): Uint8Array }`
  - `type GifWorkerApi` (Comlink: `start(width, height, transparent)`, `addFrame(rgba, delayMs): number`, `finish(): Uint8Array`)
  - `interface GifEncoderHandle { addFrame(frame: ImageData, delayMs: number): Promise<number>; finish(): Promise<Blob>; terminate(): void }`
  - `createGifEncoder(width: number, height: number, transparent: boolean): Promise<GifEncoderHandle>`

gifenc ships no types; its README documents `quantize(rgba, maxColors, { format, oneBitAlpha })`, `applyPalette(rgba, palette, format)`, `GIFEncoder()` with `writeFrame(index, width, height, { palette, delay, repeat, transparent, transparentIndex, dispose })`, `finish()`, `bytes()`, `bytesView()`. It writes delays in hundredths of a second and forces "restore to background" disposal on transparent frames. Each frame gets its own 256-colour palette (the model and ground change little between frames, and a per-frame palette avoids banding on the filament shading). The worker keeps quantisation off the main thread; frames are copied, not transferred, so the caller can keep drawing the same `ImageData` in the preview.

- [ ] **Step 1: Add the dependency**

Run: `npm i gifenc@1.0.3`
Expected: `package.json` lists `"gifenc": "^1.0.3"` under `dependencies`.

- [ ] **Step 2: Write the failing test**

`src/export/gif.test.ts`:

```ts
import { GifBuilder } from './gif'

function solid(w: number, h: number, rgba: [number, number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) out.set(rgba, i * 4)
  return out
}

const text = (bytes: Uint8Array) => String.fromCharCode(...bytes)

/** Graphic Control Extensions: 0x21 0xF9 0x04 packed delayLo delayHi transparentIndex 0x00. */
function graphicControls(b: Uint8Array) {
  const out: Array<{ packed: number; delay: number; transparentIndex: number }> = []
  for (let i = 0; i + 7 < b.length; i++) {
    if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 0x04) {
      out.push({ packed: b[i + 3], delay: b[i + 4] | (b[i + 5] << 8), transparentIndex: b[i + 6] })
    }
  }
  return out
}

it('writes a looping GIF89a of the frame size', () => {
  const gif = new GifBuilder(4, 3, false)
  gif.addFrame(solid(4, 3, [233, 162, 59, 255]), 100)
  const bytes = gif.finish()
  expect(text(bytes.subarray(0, 6))).toBe('GIF89a')
  expect(bytes[6] | (bytes[7] << 8)).toBe(4)
  expect(bytes[8] | (bytes[9] << 8)).toBe(3)
  expect(text(bytes)).toContain('NETSCAPE2.0')
  expect(bytes[bytes.length - 1]).toBe(0x3b)
})

it('stores each frame delay in hundredths of a second', () => {
  const gif = new GifBuilder(2, 2, false)
  gif.addFrame(solid(2, 2, [0, 0, 0, 255]), 800)
  gif.addFrame(solid(2, 2, [255, 255, 255, 255]), 2800)
  expect(graphicControls(gif.finish()).map((g) => g.delay)).toEqual([80, 280])
})

it('marks the cleared ground transparent when asked', () => {
  const frame = solid(2, 2, [233, 162, 59, 255])
  frame.set([0, 0, 0, 0], 0)
  frame.set([0, 0, 0, 0], 4)
  const gif = new GifBuilder(2, 2, true)
  gif.addFrame(frame, 100)
  const [gce] = graphicControls(gif.finish())
  expect(gce.packed & 1).toBe(1)
})

it('keeps opaque frames opaque', () => {
  const gif = new GifBuilder(2, 2, false)
  gif.addFrame(solid(2, 2, [10, 20, 30, 255]), 100)
  expect(graphicControls(gif.finish())[0].packed & 1).toBe(0)
})

it('reports the encoded size so far', () => {
  const gif = new GifBuilder(8, 8, false)
  const first = gif.addFrame(solid(8, 8, [1, 2, 3, 255]), 100)
  const second = gif.addFrame(solid(8, 8, [200, 100, 50, 255]), 100)
  expect(first).toBeGreaterThan(0)
  expect(second).toBeGreaterThan(first)
})

it('rejects a frame of the wrong size and an empty GIF', () => {
  expect(() => new GifBuilder(4, 3, false).addFrame(solid(2, 2, [0, 0, 0, 255]), 100)).toThrow(
    'Frame has 4 pixels, expected 4 × 3',
  )
  expect(() => new GifBuilder(4, 3, false).finish()).toThrow('Add at least one frame before finishing the GIF')
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/export/gif.test.ts`
Expected: FAIL, because `./gif` cannot be resolved.

- [ ] **Step 4: Implement**

`src/types/gifenc.d.ts`:

```ts
declare module 'gifenc' {
  export type Format = 'rgb565' | 'rgb444' | 'rgba4444'
  export type Palette = number[][]

  export interface QuantizeOptions {
    format?: Format
    oneBitAlpha?: boolean | number
    clearAlpha?: boolean
    clearAlphaThreshold?: number
    clearAlphaColor?: number
  }

  export interface WriteFrameOptions {
    palette?: Palette
    first?: boolean
    transparent?: boolean
    transparentIndex?: number
    delay?: number
    repeat?: number
    dispose?: number
  }

  export interface GifStream {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOptions): void
    finish(): void
    bytes(): Uint8Array
    bytesView(): Uint8Array
    reset(): void
  }

  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): GifStream
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: QuantizeOptions): Palette
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: Format): Uint8Array
}
```

`src/export/gif.ts`:

```ts
import { applyPalette, GIFEncoder, quantize, type Format, type GifStream } from 'gifenc'

/** Builds a looping GIF frame by frame; each frame gets its own 256-colour palette. */
export class GifBuilder {
  private readonly gif: GifStream = GIFEncoder()
  private frames = 0
  private readonly width: number
  private readonly height: number
  private readonly transparent: boolean

  constructor(width: number, height: number, transparent: boolean) {
    this.width = width
    this.height = height
    this.transparent = transparent
  }

  /** Adds one frame and returns the GIF's size so far in bytes. */
  addFrame(rgba: Uint8ClampedArray, delayMs: number): number {
    const pixels = this.width * this.height
    if (rgba.length !== pixels * 4) {
      throw new Error(`Frame has ${rgba.length / 4} pixels, expected ${this.width} × ${this.height}`)
    }
    const format: Format = this.transparent ? 'rgba4444' : 'rgb565'
    const palette = quantize(rgba, 256, this.transparent ? { format, oneBitAlpha: true } : { format })
    const index = applyPalette(rgba, palette, format)
    const transparentIndex = this.transparent ? palette.findIndex((c) => c[3] === 0) : -1
    this.gif.writeFrame(index, this.width, this.height, {
      palette,
      delay: delayMs,
      repeat: 0,
      ...(transparentIndex >= 0 ? { transparent: true, transparentIndex } : {}),
    })
    this.frames++
    return this.gif.bytesView().length
  }

  finish(): Uint8Array {
    if (this.frames === 0) throw new Error('Add at least one frame before finishing the GIF')
    this.gif.finish()
    return this.gif.bytes()
  }
}
```

`src/export/gif.worker.ts`:

```ts
import * as Comlink from 'comlink'
import { GifBuilder } from './gif'

let builder: GifBuilder | null = null

function current(): GifBuilder {
  if (!builder) throw new Error('The GIF encoder was not started')
  return builder
}

const api = {
  start(width: number, height: number, transparent: boolean): void {
    builder = new GifBuilder(width, height, transparent)
  },
  addFrame(rgba: Uint8ClampedArray, delayMs: number): number {
    return current().addFrame(rgba, delayMs)
  },
  finish(): Uint8Array {
    const bytes = current().finish()
    builder = null
    return Comlink.transfer(bytes, [bytes.buffer])
  },
}

export type GifWorkerApi = typeof api

Comlink.expose(api)
```

`src/export/gifClient.ts`:

```ts
import * as Comlink from 'comlink'
import type { GifWorkerApi } from './gif.worker'

export interface GifEncoderHandle {
  /** Resolves with the GIF's size so far in bytes. */
  addFrame(frame: ImageData, delayMs: number): Promise<number>
  finish(): Promise<Blob>
  terminate(): void
}

/** Quantising and LZW-compressing frames runs in a module worker so the dialog stays responsive. */
export async function createGifEncoder(width: number, height: number, transparent: boolean): Promise<GifEncoderHandle> {
  const worker = new Worker(new URL('./gif.worker.ts', import.meta.url), { type: 'module' })
  const api = Comlink.wrap<GifWorkerApi>(worker)
  await api.start(width, height, transparent)
  return {
    addFrame: (frame, delayMs) => api.addFrame(frame.data, delayMs),
    finish: async () => new Blob([new Uint8Array(await api.finish())], { type: 'image/gif' }),
    terminate: () => {
      api[Comlink.releaseProxy]()
      worker.terminate()
    },
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/export/gif.test.ts && npm run typecheck`
Expected: PASS (6 tests), no type errors. If Vitest reports that `gifenc` "does not provide an export named 'GIFEncoder'", it resolved the CommonJS build: add `server: { deps: { inline: ['gifenc'] } }` inside `test` in `vite.config.ts` so Vite resolves the package's `module` (ESM) entry, and re-run.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/types/gifenc.d.ts src/export/gif.ts src/export/gif.test.ts src/export/gif.worker.ts src/export/gifClient.ts vite.config.ts
git commit -m "feat(export): GIF encoding with gifenc in a module worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Turntable and timelapse pipelines

**Files:**
- Create: `src/export/turntable.ts`, `src/export/timelapse.ts`, `src/export/caption.ts`, `src/test/versions.ts`
- Test: `src/export/turntable.test.ts`, `src/export/timelapse.test.ts`

**Interfaces:**
- Consumes: `renderFrames`, `turntablePoses`, `presetPose` (Task 5); `createGifEncoder`, `GifEncoderHandle` (Task 6); `RenderQueue` (Task 2); `Version` (M3); `readToken` (M1); `formatMegabytes` (Task 3).
- Produces:
  - `MIN_TURNTABLE_FRAMES = 36`, `MAX_TURNTABLE_FRAMES = 72`, `clampFrames(n: number): number`, `turntableDelayMs(frames: number): number`
  - `interface GifProgress { done: number; total: number; bytes: number }`, `formatGifProgress(p: GifProgress): string` ("Rendering frames · 4 of 6 · about 1.6 MB")
  - `interface FrameDeps { renderFrames: typeof renderFrames; createEncoder: typeof createGifEncoder }`
  - `exportTurntable(opts: { mesh: MeshData; size: [number, number]; frames: number; transparent: boolean; signal: AbortSignal; onProgress(p: GifProgress): void; onFrame?(frame: ImageData): void }, deps?: FrameDeps): Promise<Blob>`
  - `MAX_TIMELAPSE_FRAMES = 40`, `interface TimelapseFilter { includeFailed: boolean; includeVariants: boolean }`, `interface TimelapsePlan { versions: Version[]; skippedFailed: Version[]; skippedVariants: Version[]; sampledFrom: number | null }`
  - `planTimelapse(ancestryHeadFirst: Version[], all: Version[], filter: TimelapseFilter, max?: number): TimelapsePlan`, `sampleEvenly<T>(items: T[], max: number): T[]`, `describePlan(plan: TimelapsePlan): string`, `captionFor(v: Version): string`, `unionBounds(bounds: Bounds[]): Bounds`, `parseSeconds(text: string, limits: { min: number; max: number; fallback: number }): number`
  - `type TimelapseProgress = { phase: 'compile'; done: number; total: number; label: string } | ({ phase: 'frames' } & GifProgress)`, `formatTimelapseProgress(p): string`
  - `interface TimelapseDeps extends FrameDeps { queue: Pick<RenderQueue, 'render'>; drawCaption: typeof drawCaption }`
  - `renderTimelapse(opts: { versions: Version[]; size: [number, number]; frameDelayMs: number; holdMs: number; caption: boolean; turntable: boolean; signal: AbortSignal; onProgress(p: TimelapseProgress): void; onFrame?(frame: ImageData, index: number): void }, deps: TimelapseDeps): Promise<{ blob: Blob; frames: number; failed: string[] }>`
  - `drawCaption(frame: ImageData, text: string, colors: { ink: string; panel: string }): ImageData`
  - test fixture `version(over?: Partial<Version>): Version`

A turntable lasts about 4 s whatever the frame count (36 frames at 110 ms, 72 at 60 ms). The timelapse compiles every chosen version through the `RenderQueue` first (the camera is fixed to the union of all bounding boxes, which is only known once every mesh exists), then draws and encodes. The spec's "Cached STL blobs are used when present" is not possible yet: `Version` has no link to an STL blob (see "Contract issues"), so every frame recompiles.

- [ ] **Step 1: Write the failing tests**

`src/test/versions.ts`:

```ts
import type { Version } from '../db/db'

let n = 0

/** A complete Version with sensible defaults; override what the test is about. */
export function version(over: Partial<Version> = {}): Version {
  n++
  return {
    id: `version-${n}`,
    projectId: 'project-1',
    parentId: null,
    code: `cube(${n});`,
    params: {},
    source: 'ai',
    kind: 'main',
    variantGroupId: null,
    label: `v${n}`,
    message: '',
    model: null,
    compileStatus: 'ok',
    renderMs: 10,
    thumbnailBlobId: null,
    createdAt: n,
    ...over,
  }
}
```

`src/export/turntable.test.ts`:

```ts
import { okResult } from '../test/results'
import { turntablePoses, type CameraPose } from './frames'
import { clampFrames, exportTurntable, formatGifProgress, turntableDelayMs, type FrameDeps, type GifProgress } from './turntable'

vi.mock('../theme/tokens', () => ({ readToken: (name: string) => `token:${name}` }))

const result = okResult()
if (!result.ok) throw new Error('fixture must succeed')
const mesh = result.mesh

function fakes() {
  const delays: number[] = []
  const encoder = {
    addFrame: vi.fn(async (_frame: ImageData, delay: number) => {
      delays.push(delay)
      return delays.length * 1_000
    }),
    finish: vi.fn(async () => new Blob(['GIF89a'], { type: 'image/gif' })),
    terminate: vi.fn(),
  }
  const renderFrames = vi.fn(async function* (opts: { size: [number, number]; background: string | null; cameras: CameraPose[] }) {
    for (let i = 0; i < opts.cameras.length; i++) {
      yield { width: opts.size[0], height: opts.size[1], data: new Uint8ClampedArray(4) } as unknown as ImageData
    }
  })
  const createEncoder = vi.fn(async () => encoder)
  return { delays, encoder, renderFrames, createEncoder, deps: { renderFrames, createEncoder } as unknown as FrameDeps }
}

it('keeps the frame count between 36 and 72', () => {
  expect(clampFrames(10)).toBe(36)
  expect(clampFrames(100)).toBe(72)
  expect(clampFrames(48.4)).toBe(48)
  expect(clampFrames(Number.NaN)).toBe(48)
})

it('spins once in about 4 s, in whole hundredths of a second', () => {
  expect(turntableDelayMs(36)).toBe(110)
  expect(turntableDelayMs(48)).toBe(80)
  expect(turntableDelayMs(72)).toBe(60)
})

it('estimates the final size from the frames so far', () => {
  expect(formatGifProgress({ done: 4, total: 6, bytes: 1_066_667 })).toBe('Rendering frames · 4 of 6 · about 1.6 MB')
  expect(formatGifProgress({ done: 0, total: 6, bytes: 0 })).toBe('Rendering frames · 0 of 6')
})

it('renders one turn on a transparent ground and encodes every frame', async () => {
  const f = fakes()
  const progress: GifProgress[] = []
  const blob = await exportTurntable(
    { mesh, size: [480, 480], frames: 100, transparent: true, signal: new AbortController().signal, onProgress: (p) => progress.push(p) },
    f.deps,
  )
  expect(blob.type).toBe('image/gif')
  expect(f.createEncoder).toHaveBeenCalledWith(480, 480, true)
  expect(f.renderFrames).toHaveBeenCalledWith({ mesh, size: [480, 480], background: null, cameras: turntablePoses(mesh.bounds, 72) })
  expect(f.delays).toHaveLength(72)
  expect(new Set(f.delays)).toEqual(new Set([60]))
  expect(progress.at(-1)).toEqual({ done: 72, total: 72, bytes: 72_000 })
  expect(f.encoder.terminate).toHaveBeenCalled()
})

it('uses the viewport token for a solid ground', async () => {
  const f = fakes()
  await exportTurntable(
    { mesh, size: [640, 480], frames: 36, transparent: false, signal: new AbortController().signal, onProgress: () => {} },
    f.deps,
  )
  expect(f.renderFrames.mock.calls[0][0].background).toBe('token:viewport')
  expect(f.createEncoder).toHaveBeenCalledWith(640, 480, false)
})

it('stops on cancel without finishing the GIF', async () => {
  const f = fakes()
  const controller = new AbortController()
  const run = exportTurntable(
    {
      mesh,
      size: [480, 480],
      frames: 36,
      transparent: false,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.done === 3) controller.abort()
      },
    },
    f.deps,
  )
  await expect(run).rejects.toMatchObject({ name: 'AbortError' })
  expect(f.delays).toHaveLength(3)
  expect(f.encoder.finish).not.toHaveBeenCalled()
  expect(f.encoder.terminate).toHaveBeenCalled()
})
```

`src/export/timelapse.test.ts`:

```ts
import type { Version } from '../db/db'
import { parseStl } from '../render/stl'
import type { RenderRequest, RenderResult } from '../render/types'
import { errorResult } from '../test/results'
import { binaryStl } from '../test/stl'
import { version } from '../test/versions'
import { presetPose, turntablePoses, type CameraPose } from './frames'
import {
  captionFor,
  describePlan,
  formatTimelapseProgress,
  parseSeconds,
  planTimelapse,
  renderTimelapse,
  sampleEvenly,
  unionBounds,
  type TimelapseDeps,
  type TimelapseProgress,
} from './timelapse'

vi.mock('../theme/tokens', () => ({ readToken: (name: string) => `token:${name}` }))

const v1 = version({ id: 'a', label: 'v1', createdAt: 1, message: 'A wall hook for a 30 mm broom handle' })
const v2 = version({ id: 'b', parentId: 'a', label: 'v2', createdAt: 2 })
const v21 = version({ id: 'e', parentId: 'a', label: 'v2.1', kind: 'variant', variantGroupId: 'g', createdAt: 2.5 })
const v3 = version({ id: 'c', parentId: 'b', label: 'v3', createdAt: 3, compileStatus: 'error' })
const v4 = version({ id: 'd', parentId: 'c', label: 'v4', createdAt: 5 })
const elsewhere = version({ id: 'f', parentId: 'zz', label: 'v9', kind: 'variant', createdAt: 4 })
const ancestry = [v4, v3, v2, v1]
const all = [v1, v2, v21, v3, v4, elsewhere]
const labels = (vs: Version[]) => vs.map((v) => v.label)

describe('planTimelapse', () => {
  it('walks the branch oldest first, skipping failed versions and unpicked variants by default', () => {
    const plan = planTimelapse(ancestry, all, { includeFailed: false, includeVariants: false })
    expect(labels(plan.versions)).toEqual(['v1', 'v2', 'v4'])
    expect(labels(plan.skippedFailed)).toEqual(['v3'])
    expect(labels(plan.skippedVariants)).toEqual(['v2.1'])
    expect(describePlan(plan)).toBe('v1 → v4 along the current branch. The failed v3 and 1 unpicked variant are skipped.')
  })

  it('includes failed versions or variants when asked, in creation order', () => {
    const failed = planTimelapse(ancestry, all, { includeFailed: true, includeVariants: false })
    expect(labels(failed.versions)).toEqual(['v1', 'v2', 'v3', 'v4'])
    expect(describePlan(failed)).toBe('v1 → v4 along the current branch. 1 unpicked variant is skipped.')

    const variants = planTimelapse(ancestry, all, { includeFailed: false, includeVariants: true })
    expect(labels(variants.versions)).toEqual(['v1', 'v2', 'v2.1', 'v4'])
    expect(describePlan(variants)).toBe('v1 → v4 along the current branch. The failed v3 is skipped.')
  })

  it('samples long histories evenly to 40 frames, keeping the first and the last', () => {
    const long = Array.from({ length: 63 }, (_, i) => version({ label: `v${i + 1}`, createdAt: 100 + i })).reverse()
    const plan = planTimelapse(long, long, { includeFailed: false, includeVariants: false })
    expect(plan.versions).toHaveLength(40)
    expect(plan.versions[0].label).toBe('v1')
    expect(plan.versions[39].label).toBe('v63')
    expect(plan.sampledFrom).toBe(63)
    expect(describePlan(plan)).toBe('v1 → v63 along the current branch. Showing 40 of 63 versions, evenly spaced.')
  })

  it('describes a branch with one or no usable versions', () => {
    expect(describePlan(planTimelapse([v1], [v1], { includeFailed: false, includeVariants: false }))).toBe('Only v1 so far.')
    expect(describePlan(planTimelapse([v3], [v3], { includeFailed: false, includeVariants: false }))).toBe(
      'Nothing on this branch compiled yet. The failed v3 is skipped.',
    )
  })
})

it('samples evenly', () => {
  expect(sampleEvenly([1, 2, 3, 4, 5], 3)).toEqual([1, 3, 5])
  expect(sampleEvenly([1, 2], 3)).toEqual([1, 2])
})

it('captions a frame with the version and a shortened prompt', () => {
  expect(captionFor(v1)).toBe('v1 · “A wall hook for a 30 mm broom handle”')
  expect(captionFor(version({ label: 'v7', message: '  ' }))).toBe('v7')
  const long = captionFor(version({ label: 'v8', message: 'x'.repeat(100) }))
  expect(long).toBe(`v8 · “${'x'.repeat(71)}…”`)
})

it('reads seconds leniently within limits', () => {
  const limits = { min: 0.05, max: 10, fallback: 0.8 }
  expect(parseSeconds('0.8', limits)).toBe(0.8)
  expect(parseSeconds(' 1,5 ', limits)).toBe(1.5)
  expect(parseSeconds('abc', limits)).toBe(0.8)
  expect(parseSeconds('20', limits)).toBe(10)
  expect(parseSeconds('0', limits)).toBe(0.05)
})

it('formats both phases of progress', () => {
  expect(formatTimelapseProgress({ phase: 'compile', done: 2, total: 6, label: 'v3' })).toBe('Compiling v3 · 3 of 6')
  expect(formatTimelapseProgress({ phase: 'frames', done: 4, total: 6, bytes: 1_066_667 })).toBe(
    'Rendering frames · 4 of 6 · about 1.6 MB',
  )
})

describe('renderTimelapse', () => {
  function meshResult(width: number): RenderResult {
    const stl = binaryStl([
      [
        [0, 0, 0],
        [width, 10, 0],
        [0, 0, 10],
      ],
    ])
    return { ok: true, mesh: parseStl(stl), stl, logs: [], diagnostics: [], renderMs: 5 }
  }

  function fakes(results: Record<string, RenderResult>) {
    const delays: number[] = []
    const cameras: CameraPose[] = []
    const captions: string[] = []
    const encoder = {
      addFrame: vi.fn(async (_f: ImageData, delay: number) => {
        delays.push(delay)
        return delays.length * 500
      }),
      finish: vi.fn(async () => new Blob(['GIF89a'], { type: 'image/gif' })),
      terminate: vi.fn(),
    }
    const queue = { render: vi.fn(async (req: RenderRequest) => results[req.code]) }
    const deps = {
      queue,
      createEncoder: vi.fn(async () => encoder),
      renderFrames: vi.fn(async function* (opts: { cameras: CameraPose[]; size: [number, number] }) {
        cameras.push(...opts.cameras)
        yield { width: opts.size[0], height: opts.size[1], data: new Uint8ClampedArray(4) } as unknown as ImageData
      }),
      drawCaption: vi.fn((frame: ImageData, text: string, _colors: { ink: string; panel: string }) => {
        captions.push(text)
        return frame
      }),
    }
    return { delays, cameras, captions, encoder, queue, deps: deps as unknown as TimelapseDeps, raw: deps }
  }

  const base = {
    size: [640, 480] as [number, number],
    frameDelayMs: 800,
    holdMs: 2_000,
    caption: true,
    turntable: false,
    signal: new AbortController().signal,
    onProgress: () => {},
  }

  it('compiles each version in the queue, fixes the camera to the union of all models, and holds the last frame', async () => {
    const a = version({ label: 'v1', code: 'A', params: { w: 1 }, message: 'first' })
    const b = version({ label: 'v2', code: 'B' })
    const f = fakes({ A: meshResult(10), B: meshResult(40) })
    const progress: TimelapseProgress[] = []
    const out = await renderTimelapse({ ...base, versions: [a, b], onProgress: (p) => progress.push(p) }, f.deps)

    expect(f.queue.render.mock.calls.map(([req]) => req)).toEqual([{ code: 'A', params: { w: 1 } }, { code: 'B', params: {} }])
    const okA = meshResult(10)
    const okB = meshResult(40)
    if (!okA.ok || !okB.ok) throw new Error('fixture must succeed')
    const fixed = presetPose(unionBounds([okA.mesh.bounds, okB.mesh.bounds]), 'iso')
    expect(f.cameras).toEqual([fixed, fixed])
    expect(f.delays).toEqual([800, 2_800])
    expect(f.captions).toEqual(['v1 · “first”', 'v2'])
    expect(f.raw.drawCaption.mock.calls[0][2]).toEqual({ ink: 'token:ink', panel: 'token:panel' })
    expect(out).toMatchObject({ frames: 2, failed: [] })
    expect(progress[0]).toEqual({ phase: 'compile', done: 0, total: 2, label: 'v1' })
    expect(progress.at(-1)).toEqual({ phase: 'frames', done: 2, total: 2, bytes: 1_000 })
    expect(f.encoder.terminate).toHaveBeenCalled()
  })

  it('turns slowly through half a revolution when asked', async () => {
    const vs = [version({ code: 'A' }), version({ code: 'A' }), version({ code: 'A' })]
    const f = fakes({ A: meshResult(10) })
    await renderTimelapse({ ...base, versions: vs, turntable: true, caption: false }, f.deps)
    const okA = meshResult(10)
    if (!okA.ok) throw new Error('fixture must succeed')
    expect(f.cameras).toEqual(turntablePoses(okA.mesh.bounds, 6).slice(0, 3))
    expect(f.captions).toEqual([])
  })

  it('holds the previous model for an included failed version and reports versions that no longer compile', async () => {
    const ok = version({ label: 'v1', code: 'A' })
    const failed = version({ label: 'v2', code: 'BROKEN', compileStatus: 'error' })
    const regressed = version({ label: 'v3', code: 'GONE' })
    const f = fakes({ A: meshResult(10), BROKEN: errorResult(), GONE: errorResult() })
    const out = await renderTimelapse({ ...base, versions: [ok, failed, regressed] }, f.deps)
    expect(f.captions).toEqual(['v1', 'v2 · failed to compile'])
    expect(out).toMatchObject({ frames: 2, failed: ['v3'] })
  })

  it('fails in plain words when nothing compiles', async () => {
    const f = fakes({ X: errorResult() })
    await expect(renderTimelapse({ ...base, versions: [version({ code: 'X' })] }, f.deps)).rejects.toThrow(
      'None of the versions on this branch compiled, so there is nothing to animate',
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/export/turntable.test.ts src/export/timelapse.test.ts`
Expected: FAIL, because `./turntable` and `./timelapse` cannot be resolved.

- [ ] **Step 3: Implement**

`src/export/turntable.ts`:

```ts
import type { MeshData } from '../render/types'
import { readToken } from '../theme/tokens'
import { formatMegabytes } from '../ui/bytes'
import { renderFrames, turntablePoses } from './frames'
import { createGifEncoder } from './gifClient'

export const MIN_TURNTABLE_FRAMES = 36
export const MAX_TURNTABLE_FRAMES = 72
const DEFAULT_TURNTABLE_FRAMES = 48

export function clampFrames(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_TURNTABLE_FRAMES
  return Math.min(MAX_TURNTABLE_FRAMES, Math.max(MIN_TURNTABLE_FRAMES, Math.round(n)))
}

/** About 4 s per turn, rounded to the GIF's 10 ms resolution. */
export function turntableDelayMs(frames: number): number {
  return Math.max(20, Math.round(400 / frames) * 10)
}

export interface GifProgress {
  done: number
  total: number
  bytes: number
}

export function formatGifProgress({ done, total, bytes }: GifProgress): string {
  const estimate = done > 0 && bytes > 0 ? ` · about ${formatMegabytes((bytes / done) * total)} MB` : ''
  return `Rendering frames · ${done} of ${total}${estimate}`
}

export interface FrameDeps {
  renderFrames: typeof renderFrames
  createEncoder: typeof createGifEncoder
}

const defaultDeps: FrameDeps = { renderFrames, createEncoder: createGifEncoder }

export async function exportTurntable(
  opts: {
    mesh: MeshData
    size: [number, number]
    frames: number
    transparent: boolean
    signal: AbortSignal
    onProgress(p: GifProgress): void
    onFrame?(frame: ImageData): void
  },
  deps: FrameDeps = defaultDeps,
): Promise<Blob> {
  const total = clampFrames(opts.frames)
  const [width, height] = opts.size
  const delay = turntableDelayMs(total)
  const encoder = await deps.createEncoder(width, height, opts.transparent)
  try {
    let done = 0
    opts.onProgress({ done, total, bytes: 0 })
    const frames = deps.renderFrames({
      mesh: opts.mesh,
      size: opts.size,
      background: opts.transparent ? null : readToken('viewport'),
      cameras: turntablePoses(opts.mesh.bounds, total),
    })
    for await (const frame of frames) {
      opts.signal.throwIfAborted()
      opts.onFrame?.(frame)
      const bytes = await encoder.addFrame(frame, delay)
      done++
      opts.onProgress({ done, total, bytes })
    }
    opts.signal.throwIfAborted()
    return await encoder.finish()
  } finally {
    encoder.terminate()
  }
}
```

`src/export/caption.ts`:

```ts
/** Draws "v3 · “prompt”" in a panel-coloured strip at the bottom left of a frame. */
export function drawCaption(frame: ImageData, text: string, colors: { ink: string; panel: string }): ImageData {
  if (typeof OffscreenCanvas === 'undefined') return frame
  const canvas = new OffscreenCanvas(frame.width, frame.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return frame
  ctx.putImageData(frame, 0, 0)
  const pad = Math.round(frame.height / 30)
  const fontPx = Math.max(12, Math.round(frame.height / 24))
  ctx.font = `500 ${fontPx}px "JetBrains Mono", ui-monospace, monospace`
  const maxText = frame.width - 4 * pad
  const textWidth = Math.min(ctx.measureText(text).width, maxText)
  const stripHeight = Math.round(fontPx * 1.8)
  const top = frame.height - pad - stripHeight
  ctx.globalAlpha = 0.85
  ctx.fillStyle = colors.panel
  ctx.fillRect(pad, top, textWidth + 2 * pad, stripHeight)
  ctx.globalAlpha = 1
  ctx.fillStyle = colors.ink
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 2 * pad, top + stripHeight / 2, maxText)
  return ctx.getImageData(0, 0, frame.width, frame.height)
}
```

`src/export/timelapse.ts`:

```ts
import type { Version } from '../db/db'
import type { RenderQueue } from '../render/queue'
import type { Bounds, MeshData } from '../render/types'
import { readToken } from '../theme/tokens'
import { drawCaption } from './caption'
import { presetPose, turntablePoses } from './frames'
import { formatGifProgress, type FrameDeps, type GifProgress } from './turntable'

export const MAX_TIMELAPSE_FRAMES = 40

export interface TimelapseFilter {
  includeFailed: boolean
  includeVariants: boolean
}

export interface TimelapsePlan {
  versions: Version[]
  skippedFailed: Version[]
  skippedVariants: Version[]
  /** How many versions qualified before even sampling, when there were more than the frame limit. */
  sampledFrom: number | null
}

export function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items
  if (max <= 1) return items.slice(-1)
  return Array.from({ length: max }, (_, i) => items[Math.round((i * (items.length - 1)) / (max - 1))])
}

/** The versions along the head's ancestry (oldest first), plus unpicked variants that branch off it. */
export function planTimelapse(
  ancestryHeadFirst: Version[],
  all: Version[],
  filter: TimelapseFilter,
  max = MAX_TIMELAPSE_FRAMES,
): TimelapsePlan {
  const onBranch = new Set(ancestryHeadFirst.map((v) => v.id))
  const offshoots = all.filter((v) => v.kind === 'variant' && !onBranch.has(v.id) && v.parentId !== null && onBranch.has(v.parentId))
  const candidates = [...ancestryHeadFirst, ...offshoots].sort((a, b) => a.createdAt - b.createdAt)
  const kept: Version[] = []
  const skippedFailed: Version[] = []
  const skippedVariants: Version[] = []
  for (const v of candidates) {
    if (v.kind === 'variant' && !filter.includeVariants) skippedVariants.push(v)
    else if (v.compileStatus === 'error' && !filter.includeFailed) skippedFailed.push(v)
    else kept.push(v)
  }
  return { versions: sampleEvenly(kept, max), skippedFailed, skippedVariants, sampledFrom: kept.length > max ? kept.length : null }
}

/** "v1 → v6 along the current branch. The failed v4 and 2 unpicked variants are skipped." */
export function describePlan(plan: TimelapsePlan): string {
  const { versions, skippedFailed, skippedVariants } = plan
  const first = versions[0]?.label
  const last = versions[versions.length - 1]?.label
  let text = !first ? 'Nothing on this branch compiled yet.' : first === last ? `Only ${first} so far.` : `${first} → ${last} along the current branch.`

  const parts: string[] = []
  if (skippedFailed.length === 1) parts.push(`The failed ${skippedFailed[0].label}`)
  else if (skippedFailed.length > 1) parts.push(`${skippedFailed.length} failed versions`)
  const variants = skippedVariants.length
  if (variants > 0) parts.push(`${variants} unpicked variant${variants === 1 ? '' : 's'}`)
  if (parts.length > 0) {
    const sentence = parts.join(' and ')
    text += ` ${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} ${skippedFailed.length + variants === 1 ? 'is' : 'are'} skipped.`
  }
  if (plan.sampledFrom !== null) text += ` Showing ${versions.length} of ${plan.sampledFrom} versions, evenly spaced.`
  return text
}

const CAPTION_PROMPT_CHARS = 72

export function captionFor(v: Version): string {
  const message = v.message.replace(/\s+/g, ' ').trim()
  if (!message) return v.label
  const short = message.length > CAPTION_PROMPT_CHARS ? `${message.slice(0, CAPTION_PROMPT_CHARS - 1).trimEnd()}…` : message
  return `${v.label} · “${short}”`
}

export function unionBounds(bounds: Bounds[]): Bounds {
  return {
    min: [0, 1, 2].map((i) => Math.min(...bounds.map((b) => b.min[i]))) as Bounds['min'],
    max: [0, 1, 2].map((i) => Math.max(...bounds.map((b) => b.max[i]))) as Bounds['max'],
  }
}

/** Seconds typed by a person: accepts "1,5", clamps to the limits, falls back when unreadable. */
export function parseSeconds(text: string, { min, max, fallback }: { min: number; max: number; fallback: number }): number {
  const n = Number(text.trim().replace(',', '.'))
  if (!Number.isFinite(n) || text.trim() === '') return fallback
  return Math.min(max, Math.max(min, n))
}

export type TimelapseProgress =
  | { phase: 'compile'; done: number; total: number; label: string }
  | ({ phase: 'frames' } & GifProgress)

export function formatTimelapseProgress(p: TimelapseProgress): string {
  return p.phase === 'compile' ? `Compiling ${p.label} · ${p.done + 1} of ${p.total}` : formatGifProgress(p)
}

export interface TimelapseDeps extends FrameDeps {
  queue: Pick<RenderQueue, 'render'>
  drawCaption: typeof drawCaption
}

export async function renderTimelapse(
  opts: {
    versions: Version[]
    size: [number, number]
    frameDelayMs: number
    holdMs: number
    caption: boolean
    turntable: boolean
    signal: AbortSignal
    onProgress(p: TimelapseProgress): void
    onFrame?(frame: ImageData, index: number): void
  },
  deps: TimelapseDeps,
): Promise<{ blob: Blob; frames: number; failed: string[] }> {
  const { versions, signal } = opts
  const shots: Array<{ version: Version; mesh: MeshData; failed: boolean }> = []
  const failed: string[] = []
  let previous: MeshData | null = null

  for (const [i, version] of versions.entries()) {
    signal.throwIfAborted()
    opts.onProgress({ phase: 'compile', done: i, total: versions.length, label: version.label })
    const result = await deps.queue.render({ code: version.code, params: version.params }, signal)
    if (result.ok) {
      previous = result.mesh
      shots.push({ version, mesh: result.mesh, failed: false })
    } else if (version.compileStatus === 'error' && previous) {
      shots.push({ version, mesh: previous, failed: true })
    } else {
      failed.push(version.label)
    }
  }
  if (shots.length === 0) throw new Error('None of the versions on this branch compiled, so there is nothing to animate')

  const bounds = unionBounds(shots.map((s) => s.mesh.bounds))
  const poses = opts.turntable
    ? turntablePoses(bounds, shots.length * 2).slice(0, shots.length)
    : shots.map(() => presetPose(bounds, 'iso'))
  const background = readToken('viewport')
  const captionColors = { ink: readToken('ink'), panel: readToken('panel') }
  const [width, height] = opts.size
  const encoder = await deps.createEncoder(width, height, false)
  try {
    opts.onProgress({ phase: 'frames', done: 0, total: shots.length, bytes: 0 })
    for (const [i, shot] of shots.entries()) {
      signal.throwIfAborted()
      for await (let frame of deps.renderFrames({ mesh: shot.mesh, size: opts.size, background, cameras: [poses[i]] })) {
        if (opts.caption) {
          const text = shot.failed ? `${shot.version.label} · failed to compile` : captionFor(shot.version)
          frame = deps.drawCaption(frame, text, captionColors)
        }
        opts.onFrame?.(frame, i)
        const delay = opts.frameDelayMs + (i === shots.length - 1 ? opts.holdMs : 0)
        const bytes = await encoder.addFrame(frame, delay)
        opts.onProgress({ phase: 'frames', done: i + 1, total: shots.length, bytes })
      }
    }
    signal.throwIfAborted()
    return { blob: await encoder.finish(), frames: shots.length, failed }
  } finally {
    encoder.terminate()
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/export/turntable.test.ts src/export/timelapse.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/export/turntable.ts src/export/turntable.test.ts src/export/timelapse.ts src/export/timelapse.test.ts src/export/caption.ts src/test/versions.ts
git commit -m "feat(export): turntable and timelapse GIF pipelines over the frame renderer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Share links (`#s=`): encode, validate, import on load and on hash change

**Files:**
- Modify: `package.json`, `package-lock.json` (add `lz-string`)
- Create: `src/share/link.ts`, `src/share/importShared.ts`, `src/share/shareNotice.ts`, `src/share/ShareNotice.tsx`, `src/ui/Callout.tsx`
- Modify: `src/app/GlobalOverlays.tsx`, `src/ui/icons.ts`, the M3 startup code (`restoreLastProject()` call site), the M3 `.json` import handler (`importProjectFile`)
- Test: `src/share/link.test.ts`, `src/share/importShared.test.ts`

**Interfaces:**
- Consumes: `ParamValue` (M1); `useProjectStore().newProject` (M3, see Integration points); `errorMessage` (M1); `formatSize` (Task 3).
- Produces:
  - `interface SharePayload { v: 1; name: string; code: string; params: Record<string, ParamValue> }` (the design doc's `{ v: 1, name, code, params }`)
  - `SHARE_WARN_BYTES = 8_000`, `MAX_SHARE_CHARS = 16_000`, `MAX_CODE_CHARS = 200_000`, `MAX_NAME_CHARS = 120`, `MAX_PARAMS = 200`
  - `encodeShare(p: SharePayload): string`; `type ShareLevel = 'ok' | 'long' | 'too-long'`; `shareLevel(encoded: string, url: string): ShareLevel`
  - `interface ShareLink { url: string | null; bytes: number; level: ShareLevel; payload: SharePayload }`; `createShareLink(payload: SharePayload, base: string): ShareLink`
  - `type ParseResult = { ok: true; payload: SharePayload } | { ok: false; error: string }`; `parseSharePayload(value: unknown): ParseResult`; `decodeShareHash(hash: string): ParseResult | null`; `fileStem(name: string): string`
  - `type ShareOutcome = { status: 'none' } | { status: 'imported'; name: string } | { status: 'error'; error: string }`
  - `importSharedPayload(p: SharePayload): Promise<void>`; `consumeShareHash(loc?, hist?, importer?): Promise<ShareOutcome>`; `openSharedOrLast(restoreLastProject: () => Promise<void>, consume?): Promise<void>`; `listenForShareLinks(consume?): () => void`
  - `interface Notice { tone: 'info' | 'error'; title: string; body: string }`; `useShareNotice` (`notice`, `show(n)`, `dismiss()`); `noticeFor(o: ShareOutcome): Notice | null`; `<ShareNotice />`
  - `<Callout tone title role? children? />` (`pc-callout` with icon + strong title)

lz-string's `compressToEncodedURIComponent` alphabet (`A–Z a–z 0–9 + - $`) is fragment-safe, so the link needs no further escaping; a link that an app percent-encoded is decoded once. Everything decoded is checked before a project exists: `v === 1`, code is a non-empty string under 200,000 characters, the name is trimmed to 120 characters (default "Shared model"), at most 200 parameters, names are OpenSCAD identifiers other than `__proto__`, `constructor`, `prototype`, values are finite numbers, booleans, strings up to 1,000 characters or 1–16 finite numbers. The params object is rebuilt with `Object.fromEntries`, which never touches a prototype. The encoded text is capped at 16,000 characters before decompressing, because lz-string's output can grow quadratically with its input.

- [ ] **Step 1: Add the dependency**

Run: `npm i lz-string@1.5.0`
Expected: `package.json` lists `"lz-string": "^1.5.0"` under `dependencies` (it ships its own typings).

- [ ] **Step 2: Write the failing tests**

`src/share/link.test.ts`:

```ts
import { compressToEncodedURIComponent } from 'lz-string'
import {
  createShareLink,
  decodeShareHash,
  encodeShare,
  fileStem,
  parseSharePayload,
  shareLevel,
  type SharePayload,
} from './link'

const payload: SharePayload = {
  v: 1,
  name: 'Halter für 18650 · Ø 19 mm',
  code: '/* [Dimensions] */\nslots = 4; // [1:1:8]\ncube([slots * 21, 25, 22]); // — fits a drawer\n',
  params: { slots: 5, label: 'AA', lid: true, size: [20, 30, 5] },
}

const hashOf = (json: string) => `#s=${compressToEncodedURIComponent(json)}`

it('round-trips code, unicode and every kind of parameter value', () => {
  expect(decodeShareHash(`#s=${encodeShare(payload)}`)).toEqual({ ok: true, payload })
})

it('ignores hashes that are not share links', () => {
  expect(decodeShareHash('')).toBeNull()
  expect(decodeShareHash('#other')).toBeNull()
})

it('accepts a link an app has percent-encoded', () => {
  expect(decodeShareHash(`#s=${encodeURIComponent(encodeShare(payload))}`)).toEqual({ ok: true, payload })
})

it('builds the link on the current page URL, replacing any hash', () => {
  const link = createShareLink(payload, 'https://meyhem.github.io/promptcad/?x=1#old')
  expect(link.url).toBe(`https://meyhem.github.io/promptcad/?x=1#s=${encodeShare(payload)}`)
  expect(link.bytes).toBe(link.url!.length)
  expect(link.level).toBe('ok')
  expect(link.payload).toBe(payload)
})

it('warns over 8 KB and refuses over 16,000 characters of link text', () => {
  expect(shareLevel('x', 'u'.repeat(8_000))).toBe('ok')
  expect(shareLevel('x', 'u'.repeat(8_001))).toBe('long')
  expect(shareLevel('x'.repeat(16_001), 'u')).toBe('too-long')
})

it('cleans up the name, and defaults it', () => {
  const named = parseSharePayload({ v: 1, name: `  Box\n with   lid ${'x'.repeat(300)}`, code: 'cube(1);', params: {} })
  expect(named.ok && named.payload.name.startsWith('Box with lid x')).toBe(true)
  expect(named.ok && named.payload.name.length).toBe(120)
  expect(parseSharePayload({ v: 1, code: 'cube(1);' })).toEqual({
    ok: true,
    payload: { v: 1, name: 'Shared model', code: 'cube(1);', params: {} },
  })
})

describe('rejects, in plain words', () => {
  const bad = (value: unknown) => {
    const r = parseSharePayload(value)
    if (r.ok) throw new Error('expected a rejection')
    return r.error
  }

  it('links from a newer format or without a model', () => {
    expect(bad({ v: 2, name: 'x', code: 'cube(1);', params: {} })).toBe(
      'The link was made by a newer PromptCAD (format 2). Reload the app to update it, then open the link again.',
    )
    expect(bad([1, 2])).toBe('The link does not contain a PromptCAD model.')
    expect(bad({ v: 1, name: 'x', code: '   ' })).toBe('The link has no OpenSCAD code.')
    expect(bad({ v: 1, code: 'x'.repeat(200_001) })).toBe('The code in the link is longer than 200,000 characters.')
  })

  it('parameters that are not names with simple values', () => {
    expect(bad({ v: 1, code: 'c', params: [1] })).toBe('The parameter values in the link are not a list of names and values.')
    expect(bad({ v: 1, code: 'c', params: { 'w-1': 2 } })).toBe('The link sets a parameter with an invalid name: “w-1”.')
    expect(bad({ v: 1, code: 'c', params: { w: { x: 1 } } })).toBe(
      'The value of parameter w in the link is not a number, true/false, text or a list of numbers.',
    )
    expect(bad({ v: 1, code: 'c', params: { size: ['1', 2] } })).toContain('parameter size')
    expect(bad({ v: 1, code: 'c', params: { size: [] } })).toContain('parameter size')
    expect(bad({ v: 1, code: 'c', params: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`p${i}`, i])) })).toBe(
      'The link sets more than 200 parameters.',
    )
  })

  it('a __proto__ parameter, without polluting any prototype', () => {
    const r = decodeShareHash(hashOf('{"v":1,"name":"x","code":"cube(1);","params":{"__proto__":{"polluted":1}}}'))
    expect(r).toEqual({ ok: false, error: 'The link sets a parameter with an invalid name: “__proto__”.' })
    expect(({} as { polluted?: number }).polluted).toBeUndefined()
  })

  it('damaged, cut-off and oversized links', () => {
    const damaged = 'The link is damaged or cut off, so the model could not be read. Ask for the link again, or for the .json file.'
    expect(decodeShareHash('#s=')).toEqual({ ok: false, error: damaged })
    expect(decodeShareHash('#s=garbage!!')).toEqual({ ok: false, error: damaged })
    const full = encodeShare(payload)
    expect(decodeShareHash(`#s=${full.slice(0, Math.floor(full.length / 2))}`)).toEqual({ ok: false, error: damaged })
    expect(decodeShareHash(hashOf('not json'))).toEqual({ ok: false, error: damaged })
    expect(decodeShareHash(`#s=${'A'.repeat(16_001)}`)).toEqual({
      ok: false,
      error: 'The link is too long to open (over 16.0 KB). Ask for the .json file instead.',
    })
  })
})

it('makes a safe file name from the project name', () => {
  expect(fileStem('Halter für 18650 · Ø 19 mm')).toBe('halter-f-r-18650-19-mm')
  expect(fileStem('***')).toBe('model')
})
```

`src/share/importShared.test.ts`:

```ts
import { useProjectStore } from '../history/projectStore'
import { consumeShareHash, importSharedPayload, listenForShareLinks, noticeFor, openSharedOrLast } from './importShared'
import { encodeShare, type SharePayload } from './link'
import { useShareNotice } from './shareNotice'

const payload: SharePayload = { v: 1, name: 'Broom hook', code: 'cube([62, 38, 44]);', params: { wall: 2.4 } }
const loc = (hash: string) => ({ hash, pathname: '/promptcad/', search: '?x=1' })

beforeEach(() => useShareNotice.setState({ notice: null }))

it('does nothing without a share hash', async () => {
  const hist = { replaceState: vi.fn() }
  const importer = vi.fn(async () => {})
  expect(await consumeShareHash(loc(''), hist, importer)).toEqual({ status: 'none' })
  expect(hist.replaceState).not.toHaveBeenCalled()
  expect(importer).not.toHaveBeenCalled()
})

it('imports a valid link once and clears the hash, keeping the base path', async () => {
  const hist = { replaceState: vi.fn() }
  const importer = vi.fn(async () => {})
  expect(await consumeShareHash(loc(`#s=${encodeShare(payload)}`), hist, importer)).toEqual({ status: 'imported', name: 'Broom hook' })
  expect(importer).toHaveBeenCalledExactlyOnceWith(payload)
  expect(hist.replaceState).toHaveBeenCalledWith(null, '', '/promptcad/?x=1')
})

it('creates no project for a bad link, and still clears the hash', async () => {
  const hist = { replaceState: vi.fn() }
  const importer = vi.fn(async () => {})
  const outcome = await consumeShareHash(loc('#s=garbage!!'), hist, importer)
  expect(outcome).toMatchObject({ status: 'error' })
  expect(importer).not.toHaveBeenCalled()
  expect(hist.replaceState).toHaveBeenCalled()
})

it('reports a project that could not be saved', async () => {
  const importer = vi.fn(async () => {
    throw new Error('QuotaExceededError')
  })
  expect(await consumeShareHash(loc(`#s=${encodeShare(payload)}`), { replaceState: vi.fn() }, importer)).toEqual({
    status: 'error',
    error: 'The model could not be saved on this device: QuotaExceededError',
  })
})

it('imports as a new shared-link project with the code and parameter values only', async () => {
  const newProject = vi.fn(async () => {})
  useProjectStore.setState({ newProject } as never)
  await importSharedPayload(payload)
  expect(newProject).toHaveBeenCalledExactlyOnceWith({
    name: 'Broom hook',
    origin: 'shared-link',
    code: 'cube([62, 38, 44]);',
    params: { wall: 2.4 },
    source: 'import',
    message: 'Opened from a link',
  })
})

it('words the notices', () => {
  expect(noticeFor({ status: 'none' })).toBeNull()
  expect(noticeFor({ status: 'imported', name: 'Broom hook' })).toEqual({
    tone: 'info',
    title: 'Opened “Broom hook” from a link',
    body: 'It is a new project with the code and parameter values from the link. Your other projects are unchanged.',
  })
  expect(noticeFor({ status: 'error', error: 'The link has no OpenSCAD code.' })).toEqual({
    tone: 'error',
    title: 'This link could not be opened',
    body: 'The link has no OpenSCAD code. Your projects are unchanged.',
  })
})

it('opens the shared model instead of the last project, and the last project otherwise', async () => {
  const restore = vi.fn(async () => {})
  await openSharedOrLast(restore, async () => ({ status: 'imported', name: 'Broom hook' }))
  expect(restore).not.toHaveBeenCalled()
  expect(useShareNotice.getState().notice?.title).toBe('Opened “Broom hook” from a link')

  await openSharedOrLast(restore, async () => ({ status: 'error', error: 'The link has no OpenSCAD code.' }))
  expect(restore).toHaveBeenCalledTimes(1)
  expect(useShareNotice.getState().notice?.tone).toBe('error')

  await openSharedOrLast(restore, async () => ({ status: 'none' }))
  expect(restore).toHaveBeenCalledTimes(2)
})

it('imports a link pasted into the address bar of the open tab', async () => {
  const consume = vi.fn(async () => ({ status: 'imported' as const, name: 'Broom hook' }))
  const stop = listenForShareLinks(consume)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  await vi.waitFor(() => expect(useShareNotice.getState().notice?.title).toBe('Opened “Broom hook” from a link'))
  stop()
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  expect(consume).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/share`
Expected: FAIL, because `./link`, `./importShared` and `./shareNotice` cannot be resolved.

- [ ] **Step 4: Implement**

`src/share/link.ts`:

```ts
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import type { ParamValue } from '../render/types'
import { formatSize } from '../ui/bytes'

export interface SharePayload {
  v: 1
  name: string
  code: string
  params: Record<string, ParamValue>
}

export const SHARE_WARN_BYTES = 8_000
/** Longest `#s=` text we decompress; lz-string output can grow quadratically, so this also bounds memory. */
export const MAX_SHARE_CHARS = 16_000
export const MAX_CODE_CHARS = 200_000
export const MAX_NAME_CHARS = 120
export const MAX_PARAMS = 200
const MAX_TEXT_PARAM_CHARS = 1_000
const MAX_VECTOR_LENGTH = 16
const DEFAULT_NAME = 'Shared model'
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_]*$/
const RESERVED = new Set(['__proto__', 'constructor', 'prototype'])
const DAMAGED = 'The link is damaged or cut off, so the model could not be read. Ask for the link again, or for the .json file.'
const NOT_A_MODEL = 'The link does not contain a PromptCAD model.'

export type ParseResult = { ok: true; payload: SharePayload } | { ok: false; error: string }
export type ShareLevel = 'ok' | 'long' | 'too-long'

export interface ShareLink {
  /** null when the link would be too long to open. */
  url: string | null
  bytes: number
  level: ShareLevel
  payload: SharePayload
}

const fail = (error: string): ParseResult => ({ ok: false, error })

export function encodeShare(payload: SharePayload): string {
  return compressToEncodedURIComponent(JSON.stringify(payload))
}

export function shareLevel(encoded: string, url: string): ShareLevel {
  if (encoded.length > MAX_SHARE_CHARS) return 'too-long'
  return url.length > SHARE_WARN_BYTES ? 'long' : 'ok'
}

export function createShareLink(payload: SharePayload, base: string): ShareLink {
  const encoded = encodeShare(payload)
  const url = new URL(base)
  url.hash = `s=${encoded}`
  const href = url.toString()
  const level = shareLevel(encoded, href)
  return { url: level === 'too-long' ? null : href, bytes: href.length, level, payload }
}

function paramValue(v: unknown): ParamValue | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return v.length <= MAX_TEXT_PARAM_CHARS ? v : undefined
  if (Array.isArray(v) && v.length > 0 && v.length <= MAX_VECTOR_LENGTH && v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    return v as number[]
  }
  return undefined
}

/** Validates a decoded link or a `.json` share file before anything is written. */
export function parseSharePayload(value: unknown): ParseResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(NOT_A_MODEL)
  const o = value as Record<string, unknown>
  if (o.v !== 1) {
    return fail(
      typeof o.v === 'number' && o.v > 1
        ? `The link was made by a newer PromptCAD (format ${o.v}). Reload the app to update it, then open the link again.`
        : NOT_A_MODEL,
    )
  }
  if (typeof o.code !== 'string' || o.code.trim() === '') return fail('The link has no OpenSCAD code.')
  if (o.code.length > MAX_CODE_CHARS) {
    return fail(`The code in the link is longer than ${MAX_CODE_CHARS.toLocaleString('en-US')} characters.`)
  }
  const cleanName = typeof o.name === 'string' ? o.name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_CHARS) : ''

  const params = o.params === undefined ? {} : o.params
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return fail('The parameter values in the link are not a list of names and values.')
  }
  const entries = Object.entries(params as Record<string, unknown>)
  if (entries.length > MAX_PARAMS) return fail(`The link sets more than ${MAX_PARAMS} parameters.`)
  const clean: Array<[string, ParamValue]> = []
  for (const [key, raw] of entries) {
    if (!IDENTIFIER.test(key) || RESERVED.has(key)) {
      return fail(`The link sets a parameter with an invalid name: “${key.slice(0, 40)}”.`)
    }
    const checked = paramValue(raw)
    if (checked === undefined) {
      return fail(`The value of parameter ${key} in the link is not a number, true/false, text or a list of numbers.`)
    }
    clean.push([key, checked])
  }
  return { ok: true, payload: { v: 1, name: cleanName || DEFAULT_NAME, code: o.code, params: Object.fromEntries(clean) } }
}

/** null when the hash is not a share link; otherwise the validated payload or a plain-language error. */
export function decodeShareHash(hash: string): ParseResult | null {
  if (!hash.startsWith('#s=')) return null
  let encoded = hash.slice(3)
  if (encoded.includes('%')) {
    try {
      encoded = decodeURIComponent(encoded)
    } catch {
      return fail(DAMAGED)
    }
  }
  if (encoded.length === 0) return fail(DAMAGED)
  if (encoded.length > MAX_SHARE_CHARS) {
    return fail(`The link is too long to open (over ${formatSize(MAX_SHARE_CHARS)}). Ask for the .json file instead.`)
  }
  let json: string | null
  try {
    json = decompressFromEncodedURIComponent(encoded)
  } catch {
    json = null
  }
  if (!json) return fail(DAMAGED)
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return fail(DAMAGED)
  }
  return parseSharePayload(value)
}

export function fileStem(name: string): string {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return stem || 'model'
}
```

`src/share/shareNotice.ts`:

```ts
import { create } from 'zustand'

export interface Notice {
  tone: 'info' | 'error'
  title: string
  body: string
}

export const useShareNotice = create<{ notice: Notice | null; show(notice: Notice | null): void; dismiss(): void }>()((set) => ({
  notice: null,
  show: (notice) => set({ notice }),
  dismiss: () => set({ notice: null }),
}))
```

`src/share/importShared.ts`:

```ts
import { useProjectStore } from '../history/projectStore'
import { errorMessage } from '../render/result'
import { decodeShareHash, type SharePayload } from './link'
import { useShareNotice, type Notice } from './shareNotice'

export type ShareOutcome = { status: 'none' } | { status: 'imported'; name: string } | { status: 'error'; error: string }

export async function importSharedPayload(payload: SharePayload): Promise<void> {
  await useProjectStore.getState().newProject({
    name: payload.name,
    origin: 'shared-link',
    code: payload.code,
    params: payload.params,
    source: 'import',
    message: 'Opened from a link',
  })
}

export async function consumeShareHash(
  loc: Pick<Location, 'hash' | 'pathname' | 'search'> = window.location,
  hist: Pick<History, 'replaceState'> = window.history,
  importer: (payload: SharePayload) => Promise<void> = importSharedPayload,
): Promise<ShareOutcome> {
  const parsed = decodeShareHash(loc.hash)
  if (!parsed) return { status: 'none' }
  // Clear the hash first, so a reload never imports the same link twice or retries a bad one.
  hist.replaceState(null, '', `${loc.pathname}${loc.search}`)
  if (!parsed.ok) return { status: 'error', error: parsed.error }
  try {
    await importer(parsed.payload)
  } catch (e) {
    return { status: 'error', error: `The model could not be saved on this device: ${errorMessage(e)}` }
  }
  return { status: 'imported', name: parsed.payload.name }
}

export function noticeFor(outcome: ShareOutcome): Notice | null {
  switch (outcome.status) {
    case 'none':
      return null
    case 'imported':
      return {
        tone: 'info',
        title: `Opened “${outcome.name}” from a link`,
        body: 'It is a new project with the code and parameter values from the link. Your other projects are unchanged.',
      }
    case 'error':
      return { tone: 'error', title: 'This link could not be opened', body: `${outcome.error} Your projects are unchanged.` }
  }
}

/** Startup: a `#s=` link wins over restoring the last project. */
export async function openSharedOrLast(
  restoreLastProject: () => Promise<void>,
  consume: () => Promise<ShareOutcome> = () => consumeShareHash(),
): Promise<void> {
  const outcome = await consume()
  useShareNotice.getState().show(noticeFor(outcome))
  if (outcome.status !== 'imported') await restoreLastProject()
}

/** A link pasted into the address bar of an open tab only changes the hash; no reload happens. */
export function listenForShareLinks(consume: () => Promise<ShareOutcome> = () => consumeShareHash()): () => void {
  const onHashChange = () => {
    void consume().then((outcome) => {
      if (outcome.status !== 'none') useShareNotice.getState().show(noticeFor(outcome))
    })
  }
  window.addEventListener('hashchange', onHashChange)
  return () => window.removeEventListener('hashchange', onHashChange)
}
```

`src/ui/icons.ts`: add `Info as IconInfo` to the export list.

`src/ui/Callout.tsx`:

```tsx
import type { ReactNode } from 'react'
import { IconCheck, IconInfo, IconWarning } from './icons'

const ICONS = { info: IconInfo, ok: IconCheck, warn: IconWarning, error: IconWarning } as const

export function Callout({
  tone,
  title,
  role,
  children,
}: {
  tone: keyof typeof ICONS
  title: string
  role?: 'status' | 'alert'
  children?: ReactNode
}) {
  const Icon = ICONS[tone]
  return (
    <div role={role} className={`pc-callout is-${tone}`}>
      <Icon className="pc-i" aria-hidden="true" />
      <div className="pc-callout-body">
        <strong>{title}</strong>
        {children}
      </div>
    </div>
  )
}
```

`src/share/ShareNotice.tsx`:

```tsx
import { IconInfo, IconWarning, IconX } from '../ui/icons'
import { useShareNotice } from './shareNotice'

export function ShareNotice() {
  const notice = useShareNotice((s) => s.notice)
  const dismiss = useShareNotice((s) => s.dismiss)
  if (!notice) return null
  const error = notice.tone === 'error'
  const Icon = error ? IconWarning : IconInfo
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`pc-callout ${error ? 'is-error' : 'is-info'} fixed top-[calc(var(--header-height)+12px)] left-1/2 z-40 w-[min(560px,calc(100%-24px))] -translate-x-1/2 shadow-pop`}
    >
      <Icon className="pc-i" aria-hidden="true" />
      <div className="pc-callout-body">
        <strong>{notice.title}</strong>
        {notice.body}
      </div>
      <button type="button" className="pc-btn is-icon is-sm is-ghost" aria-label="Dismiss" onClick={dismiss}>
        <IconX className="pc-i" aria-hidden="true" />
      </button>
    </div>
  )
}
```

`src/app/GlobalOverlays.tsx` (full file after this task):

```tsx
import { useEffect } from 'react'
import { usePrefs } from '../settings/prefsStore'
import { listenForShareLinks } from '../share/importShared'
import { ShareNotice } from '../share/ShareNotice'

/** One mount point for M4's app-wide overlays (dialogs, notices, update prompt) and its startup work. */
export function GlobalOverlays() {
  useEffect(() => {
    void usePrefs.getState().load()
  }, [])
  useEffect(() => listenForShareLinks(), [])
  return <ShareNotice />
}
```

M3 startup code: replace the call that restores the last project, `await restoreLastProject()`, with:

```ts
import { openSharedOrLast } from '../share/importShared'
// …
await openSharedOrLast(restoreLastProject)
```

M3 `.json` import handler (`importProjectFile(text)`): try the share payload first, so a "Save .json instead" file from Task 9 opens from the same **Import .json** menu item:

```ts
import { importSharedPayload } from '../share/importShared'
import { parseSharePayload } from '../share/link'

export async function importProjectFile(text: string): Promise<void> {
  let value: unknown = null
  try {
    value = JSON.parse(text)
  } catch {
    // fall through: the M3 importer reports the parse error in its own words
  }
  const shared = parseSharePayload(value)
  if (shared.ok) {
    await importSharedPayload(shared.payload)
    return
  }
  // … the M3 schema-validated project import, unchanged …
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/share src/app && npm run typecheck`
Expected: PASS, no type errors. If Vitest reports that `lz-string` "does not provide an export named 'compressToEncodedURIComponent'", add `'lz-string'` to `test.server.deps.inline` in `vite.config.ts` (next to `gifenc` if Task 6 needed it) and re-run.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/share src/ui/Callout.tsx src/ui/icons.ts src/app/GlobalOverlays.tsx vite.config.ts
git add -u src   # M3 startup and .json import call sites
git commit -m "feat(share): #s= share links with validation, import on load and on hash change

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Export dialog shell, Model file and Link tabs, header Share button

**Files:**
- Create: `src/ui/Modal.tsx`, `src/export/exportStore.ts`, `src/export/ExportDialog.tsx`, `src/export/tabs/layout.tsx`, `src/export/tabs/ModelFileTab.tsx`, `src/export/tabs/LinkTab.tsx`
- Modify: `src/export/ExportButtons.tsx`, `src/ui/icons.ts`, `src/app/GlobalOverlays.tsx`, `src/App.tsx`
- Test: `src/ui/Modal.test.tsx`, `src/export/ExportDialog.test.tsx`, `src/export/ExportButtons.test.tsx` (modify), `src/App.test.tsx` (modify)

**Interfaces:**
- Consumes: `exportStl`, `exportScad`, `saveFile` (M1); `exportDisabledReason` (M1); `selectCanExport` (M3 version); store `params` (M3); `useProjectStore` (M3); `createShareLink`, `fileStem`, `MAX_SHARE_CHARS` (Task 8); `Callout` (Task 8); `formatSize` (Task 3).
- Produces:
  - `<Modal labelledBy onClose closeOnScrim? className? children />`: portal, `pc-scrim`, `role="dialog"`, `aria-modal`, Esc closes, Tab wraps, focus returns to the opener
  - `type ExportTab = 'model' | 'image' | 'turntable' | 'timelapse' | 'link'`; `useExportStore` (`open`, `tab`, `openAt(tab)`, `setTab(tab)`, `close()`)
  - `<ExportDialog />` titled "Export and share" with a `pc-tabs` tab list; `TABS` registry (later tasks add Image, Turntable, Timelapse)
  - `<TabBody>`, `<TabFooter>` layout helpers
  - `<ExportButtons canExportStl disabledReason onExportStl onShare />`: **Share** (`pc-btn is-sm`) + **Export STL** (primary)

The Main and Export screens keep **Export STL** as the header's one-click primary and add **Share**, which opens the dialog; "Export .scad" moves into the dialog's Model file tab. The phone header's Export icon (Task 15) opens the same dialog on Model file.

- [ ] **Step 1: Write the failing tests**

`src/ui/Modal.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Modal } from './Modal'

function Harness({ closeOnScrim = true, onClose = vi.fn() }: { closeOnScrim?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <Modal
          labelledBy="t"
          closeOnScrim={closeOnScrim}
          onClose={() => {
            onClose()
            setOpen(false)
          }}
          className="pc-dialog"
        >
          <h2 id="t">Export and share</h2>
          <button type="button">First</button>
          <button type="button">Last</button>
        </Modal>
      )}
    </>
  )
}

it('is a labelled modal dialog that takes focus and gives it back', async () => {
  render(<Harness />)
  const opener = screen.getByRole('button', { name: 'Open' })
  await userEvent.click(opener)
  const dialog = screen.getByRole('dialog', { name: 'Export and share' })
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  expect(dialog.parentElement).toHaveClass('pc-scrim')
  expect(screen.getByRole('button', { name: 'First' })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(opener).toHaveFocus()
})

it('keeps Tab inside the dialog', async () => {
  render(<Harness />)
  await userEvent.click(screen.getByRole('button', { name: 'Open' }))
  await userEvent.tab()
  expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus()
  await userEvent.tab()
  expect(screen.getByRole('button', { name: 'First' })).toHaveFocus()
  await userEvent.tab({ shift: true })
  expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus()
})

it('closes on a click on the scrim unless told not to', async () => {
  const onClose = vi.fn()
  const { unmount } = render(<Harness onClose={onClose} />)
  await userEvent.click(screen.getByRole('button', { name: 'Open' }))
  await userEvent.click(screen.getByRole('dialog'))
  expect(onClose).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('dialog').parentElement!)
  expect(onClose).toHaveBeenCalledOnce()
  unmount()

  const keep = vi.fn()
  render(<Harness closeOnScrim={false} onClose={keep} />)
  await userEvent.click(screen.getByRole('button', { name: 'Open' }))
  await userEvent.click(screen.getByRole('dialog').parentElement!)
  expect(keep).not.toHaveBeenCalled()
})
```

`src/export/ExportDialog.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useProjectStore } from '../history/projectStore'
import { createShareLink } from '../share/link'
import { useAppStore } from '../state/store'
import { okResult } from '../test/results'
import { ExportDialog } from './ExportDialog'
import { useExportStore } from './exportStore'
import { exportScad, exportStl, saveFile } from './saveFile'

vi.mock('./saveFile', () => ({
  saveFile: vi.fn(async () => 'downloaded'),
  exportStl: vi.fn(async () => 'downloaded'),
  exportScad: vi.fn(async () => 'downloaded'),
}))
vi.mock('../share/link', async (importOriginal) => {
  const real = await importOriginal<typeof import('../share/link')>()
  return { ...real, createShareLink: vi.fn(real.createShareLink) }
})

const writeText = vi.fn(async () => {})

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useExportStore.setState(useExportStore.getInitialState(), true)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  useProjectStore.setState({ project: { id: 'p1', name: 'Broom hook' } } as never)
  const r = okResult()
  if (!r.ok) throw new Error('fixture must succeed')
  const params = { wall: 2 }
  useAppStore.setState({ code: 'cube(1);', params, status: 'ok', mesh: r.mesh, stl: r.stl, renderedCode: 'cube(1);', renderedParams: params } as never)
})

const readText = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.readAsText(blob)
  })

const primary = () => document.querySelectorAll('[role="dialog"] .pc-btn.is-primary')

it('opens on the requested tab and switches tabs', async () => {
  useExportStore.getState().openAt('link')
  render(<ExportDialog />)
  const dialog = screen.getByRole('dialog', { name: 'Export and share' })
  expect(within(dialog).getByRole('tab', { name: 'Link' })).toHaveAttribute('aria-selected', 'true')
  await userEvent.click(within(dialog).getByRole('tab', { name: 'Model file' }))
  expect(within(dialog).getByRole('tab', { name: 'Model file' })).toHaveAttribute('aria-selected', 'true')
  expect(useExportStore.getState().tab).toBe('model')
})

it('exports STL and .scad from the Model file tab', async () => {
  useExportStore.getState().openAt('model')
  render(<ExportDialog />)
  expect(primary()).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'Export STL' }))
  await userEvent.click(screen.getByRole('button', { name: 'Export .scad' }))
  expect(exportStl).toHaveBeenCalledOnce()
  expect(exportScad).toHaveBeenCalledWith('cube(1);')
})

it('explains why STL export is blocked', () => {
  useAppStore.setState({ status: 'error' })
  useExportStore.getState().openAt('model')
  render(<ExportDialog />)
  expect(screen.getByRole('button', { name: 'Export STL' })).toBeDisabled()
  expect(screen.getByText('Fix the error first, so the file matches the code')).toBeInTheDocument()
})

it('shows and copies a link carrying the project name, code and parameter values', async () => {
  useExportStore.getState().openAt('link')
  render(<ExportDialog />)
  const input = screen.getByRole('textbox', { name: 'Share link' })
  expect((input as HTMLInputElement).value).toMatch(/#s=[A-Za-z0-9+\-$]+$/)
  expect(createShareLink).toHaveBeenCalledWith({ v: 1, name: 'Broom hook', code: 'cube(1);', params: { wall: 2 } }, window.location.href)
  expect(screen.getByText(/KB · Code and parameter values only\. No keys, chat or history\./)).toBeInTheDocument()
  expect(primary()).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'Copy link' }))
  expect(writeText).toHaveBeenCalledWith((input as HTMLInputElement).value)
  expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
})

it('warns about a long link and offers the .json file instead', async () => {
  vi.mocked(createShareLink).mockReturnValueOnce({
    url: 'https://example.test/#s=long',
    bytes: 9_400,
    level: 'long',
    payload: { v: 1, name: 'Broom hook', code: 'cube(1);', params: { wall: 2 } },
  })
  useExportStore.getState().openAt('link')
  render(<ExportDialog />)
  expect(screen.getByText('Long link: 9.4 KB')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Save .json instead' }))
  const [blob, name] = vi.mocked(saveFile).mock.calls[0]
  expect(name).toBe('broom-hook.json')
  expect(JSON.parse(await readText(blob))).toEqual({ v: 1, name: 'Broom hook', code: 'cube(1);', params: { wall: 2 } })
})

it('hides a link that is too long to open', () => {
  vi.mocked(createShareLink).mockReturnValueOnce({
    url: null,
    bytes: 20_000,
    level: 'too-long',
    payload: { v: 1, name: 'Broom hook', code: 'cube(1);', params: {} },
  })
  useExportStore.getState().openAt('link')
  render(<ExportDialog />)
  expect(screen.queryByRole('textbox', { name: 'Share link' })).toBeNull()
  expect(screen.getByText('Too large for a link')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Copy link' })).toBeDisabled()
})

it('closes with the Close button', async () => {
  useExportStore.getState().openAt('model')
  render(<ExportDialog />)
  await userEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(useExportStore.getState().open).toBe(false)
})
```

Replace the two component tests in `src/export/ExportButtons.test.tsx` (keep the `exportDisabledReason` describe block):

```tsx
it('disables STL export with the reason as a tooltip, and keeps Share available', () => {
  render(
    <ExportButtons
      canExportStl={false}
      disabledReason="Fix the error first, so the file matches the code"
      onExportStl={() => {}}
      onShare={() => {}}
    />,
  )
  const stl = screen.getByRole('button', { name: 'Export STL' })
  expect(stl).toBeDisabled()
  expect(stl).toHaveAttribute('title', 'Fix the error first, so the file matches the code')
  expect(stl).toHaveClass('pc-btn', 'is-primary')
  expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Share' })).not.toHaveClass('is-primary')
})

it('calls the handlers', async () => {
  const onExportStl = vi.fn()
  const onShare = vi.fn()
  render(<ExportButtons canExportStl disabledReason={null} onExportStl={onExportStl} onShare={onShare} />)
  const stl = screen.getByRole('button', { name: 'Export STL' })
  expect(stl).not.toHaveAttribute('title')
  await userEvent.click(stl)
  await userEvent.click(screen.getByRole('button', { name: 'Share' }))
  expect(onExportStl).toHaveBeenCalledOnce()
  expect(onShare).toHaveBeenCalledOnce()
})
```

In `src/App.test.tsx`, in the test "keeps the last mesh (dimmed) but disables STL export after a failed edit, without a dialog", replace the line `expect(screen.getByRole('button', { name: 'Export .scad' })).toBeEnabled()` with `expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled()`, and add:

```tsx
it('opens the export dialog on the Link tab from Share', async () => {
  render(<App createWorker={scriptedWorker(() => okResult())} />)
  await userEvent.click(screen.getByRole('button', { name: 'Share' }))
  const dialog = screen.getByRole('dialog', { name: 'Export and share' })
  expect(within(dialog).getByRole('tab', { name: 'Link' })).toHaveAttribute('aria-selected', 'true')
})
```

(Import `within` from `@testing-library/react`, and reset `useExportStore` in `beforeEach`: `useExportStore.setState(useExportStore.getInitialState(), true)`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/Modal.test.tsx src/export/ExportDialog.test.tsx src/export/ExportButtons.test.tsx src/App.test.tsx`
Expected: FAIL: `./Modal`, `./ExportDialog`, `./exportStore` cannot be resolved; there is no Share button.

- [ ] **Step 3: Implement**

`src/ui/icons.ts`: add `Copy as IconCopy` and `Share2 as IconShare` to the export list.

`src/ui/Modal.tsx`:

```tsx
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface Props {
  labelledBy: string
  onClose(): void
  /** false for dialogs whose content would be lost by a stray click (the variant picker). */
  closeOnScrim?: boolean
  className?: string
  children: ReactNode
}

export function Modal({ labelledBy, onClose, closeOnScrim = true, className = '', children }: Props) {
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    return () => previous?.focus()
  }, [])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !dialog.current) return
    const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      className="pc-scrim fixed inset-0 z-50 grid place-items-center overflow-y-auto p-3 md:p-6"
      onMouseDown={(e) => {
        if (closeOnScrim && e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={labelledBy} className={className} onKeyDown={onKeyDown}>
        {children}
      </div>
    </div>,
    document.body,
  )
}
```

`src/export/exportStore.ts`:

```ts
import { create } from 'zustand'

export type ExportTab = 'model' | 'image' | 'turntable' | 'timelapse' | 'link'

interface ExportState {
  open: boolean
  tab: ExportTab
  openAt(tab: ExportTab): void
  setTab(tab: ExportTab): void
  close(): void
}

export const useExportStore = create<ExportState>()((set) => ({
  open: false,
  tab: 'model',
  openAt: (tab) => set({ open: true, tab }),
  setTab: (tab) => set({ tab }),
  close: () => set({ open: false }),
}))
```

`src/export/tabs/layout.tsx`:

```tsx
import type { ReactNode } from 'react'

/** Preview on the left, options in a 300 px column on the right; stacked on phones. */
export function TabBody({ children }: { children: ReactNode }) {
  return <div className="grid gap-6 px-6 py-5 md:grid-cols-[minmax(0,1fr)_300px]">{children}</div>
}

export function TabFooter({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3 border-t border-line px-6 py-4">{children}</div>
}
```

`src/export/tabs/ModelFileTab.tsx`:

```tsx
import type { ReactNode } from 'react'
import { selectCanExport, useAppStore } from '../../state/store'
import { IconDownload } from '../../ui/icons'
import { exportDisabledReason } from '../ExportButtons'
import { exportScad, exportStl } from '../saveFile'

function FileRow({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-md border border-line bg-inset p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-semibold">{title}</span>
        <span className="pc-caption">{hint}</span>
      </div>
      {children}
    </div>
  )
}

export function ModelFileTab() {
  const canExportStl = useAppStore(selectCanExport)
  const status = useAppStore((s) => s.status)
  const reason = canExportStl ? null : exportDisabledReason(status === 'ok' ? 'rendering' : status)
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <FileRow title="STL (binary)" hint={reason ?? 'For slicers. Matches the code and parameter values on screen.'}>
        <button
          type="button"
          className="pc-btn is-primary"
          disabled={!canExportStl}
          title={reason ?? undefined}
          onClick={() => {
            const { stl } = useAppStore.getState()
            if (stl) void exportStl(stl)
          }}
        >
          <IconDownload className="pc-i" aria-hidden="true" />
          Export STL
        </button>
      </FileRow>
      <FileRow title="OpenSCAD source (.scad)" hint="The code as it is in the editor.">
        <button type="button" className="pc-btn" onClick={() => void exportScad(useAppStore.getState().code)}>
          Export .scad
        </button>
      </FileRow>
    </div>
  )
}
```

`src/export/tabs/LinkTab.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useProjectStore } from '../../history/projectStore'
import { createShareLink, fileStem, MAX_SHARE_CHARS } from '../../share/link'
import { useAppStore } from '../../state/store'
import { formatSize } from '../../ui/bytes'
import { Callout } from '../../ui/Callout'
import { IconCopy } from '../../ui/icons'
import { saveFile } from '../saveFile'
import { TabFooter } from './layout'

export function LinkTab() {
  const code = useAppStore((s) => s.code)
  const params = useAppStore((s) => s.params)
  const name = useProjectStore((s) => s.project?.name ?? 'Untitled')
  const link = useMemo(() => createShareLink({ v: 1, name, code, params }, window.location.href), [name, code, params])
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => setCopy('idle'), [link.url])

  const copyLink = async () => {
    if (!link.url) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }
  const saveJson = () =>
    void saveFile(new Blob([JSON.stringify(link.payload, null, 2)], { type: 'application/json' }), `${fileStem(name)}.json`)
  const jsonFirst = link.level !== 'ok'

  return (
    <>
      <div className="flex flex-col gap-4 px-6 py-5">
        {link.url && (
          <div className="pc-field">
            <label htmlFor="share-link">Share link</label>
            <div className="pc-input is-mono">
              <input id="share-link" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
            </div>
            <span className="pc-hint">{formatSize(link.bytes)} · Code and parameter values only. No keys, chat or history.</span>
          </div>
        )}
        {link.level === 'long' && (
          <Callout tone="warn" title={`Long link: ${formatSize(link.bytes)}`}>
            Some apps cut links over 8 KB. Send the .json file instead; it opens from Import in the project menu.
          </Callout>
        )}
        {link.level === 'too-long' && (
          <Callout tone="error" title="Too large for a link">
            This model needs more than {formatSize(MAX_SHARE_CHARS)} of link text, which does not open reliably. Send the .json file
            instead; it opens from Import in the project menu.
          </Callout>
        )}
        {copy === 'failed' && (
          <p role="alert" className="pc-caption text-error">
            Copy failed. Select the link and copy it by hand.
          </p>
        )}
      </div>
      <TabFooter>
        <span className="flex-1" />
        <button type="button" className={`pc-btn ${jsonFirst ? 'is-primary' : ''}`} onClick={saveJson}>
          {jsonFirst ? 'Save .json instead' : 'Save .json'}
        </button>
        <button type="button" className={`pc-btn ${jsonFirst ? '' : 'is-primary'}`} disabled={!link.url} onClick={() => void copyLink()}>
          <IconCopy className="pc-i" aria-hidden="true" />
          {copy === 'copied' ? 'Copied' : 'Copy link'}
        </button>
      </TabFooter>
    </>
  )
}
```

`src/export/ExportDialog.tsx`:

```tsx
import type { ComponentType } from 'react'
import { IconX } from '../ui/icons'
import { Modal } from '../ui/Modal'
import { useExportStore, type ExportTab } from './exportStore'
import { LinkTab } from './tabs/LinkTab'
import { ModelFileTab } from './tabs/ModelFileTab'

/** In the screen's order; Tasks 10 and 11 insert Image, Turntable and Timelapse before Link. */
export const TABS: Array<{ id: ExportTab; label: string; Panel: ComponentType }> = [
  { id: 'model', label: 'Model file', Panel: ModelFileTab },
  { id: 'link', label: 'Link', Panel: LinkTab },
]

export function ExportDialog() {
  const open = useExportStore((s) => s.open)
  const tab = useExportStore((s) => s.tab)
  const setTab = useExportStore((s) => s.setTab)
  const close = useExportStore((s) => s.close)
  if (!open) return null
  const active = TABS.find((t) => t.id === tab) ?? TABS[0]

  return (
    <Modal labelledBy="export-title" onClose={close} className="pc-dialog max-w-[920px] gap-0 overflow-hidden p-0">
      <div className="flex items-center gap-3 px-6 pt-5 pb-4">
        <h2 id="export-title" className="flex-1">
          Export and share
        </h2>
        <button type="button" className="pc-btn is-icon is-ghost" aria-label="Close" onClick={close}>
          <IconX className="pc-i" aria-hidden="true" />
        </button>
      </div>
      <div className="overflow-x-auto px-6">
        <div className="pc-tabs" role="tablist" aria-label="Export format">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`export-tab-${t.id}`}
              aria-selected={t.id === active.id}
              aria-controls="export-panel"
              className="pc-tab"
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div id="export-panel" role="tabpanel" aria-labelledby={`export-tab-${active.id}`}>
        <active.Panel />
      </div>
    </Modal>
  )
}
```

`src/export/ExportButtons.tsx`: replace the `Props` interface and the component (keep `exportDisabledReason`):

```tsx
import { IconDownload, IconShare } from '../ui/icons'

interface Props {
  canExportStl: boolean
  disabledReason: string | null
  onExportStl(): void
  onShare(): void
}

export function ExportButtons({ canExportStl, disabledReason, onExportStl, onShare }: Props) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" className="pc-btn is-sm" onClick={onShare}>
        <IconShare className="pc-i" aria-hidden="true" />
        Share
      </button>
      <button
        type="button"
        className="pc-btn is-sm is-primary"
        disabled={!canExportStl}
        title={canExportStl ? undefined : (disabledReason ?? undefined)}
        onClick={onExportStl}
      >
        <IconDownload className="pc-i" aria-hidden="true" />
        Export STL
      </button>
    </div>
  )
}
```

`src/App.tsx`: in the header's `<ExportButtons … />`, replace the `onExportScad={…}` prop with:

```tsx
          onShare={() => useExportStore.getState().openAt('link')}
```

(import `useExportStore` from `./export/exportStore`).

`src/app/GlobalOverlays.tsx`: import `ExportDialog` and return both overlays:

```tsx
import { ExportDialog } from '../export/ExportDialog'
// …
  return (
    <>
      <ExportDialog />
      <ShareNotice />
    </>
  )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/Modal.test.tsx src/export src/App.test.tsx && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/Modal.tsx src/ui/Modal.test.tsx src/ui/icons.ts src/export src/app/GlobalOverlays.tsx src/App.tsx src/App.test.tsx
git commit -m "feat(export): Export and share dialog with Model file and Link tabs, header Share button

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Image (PNG) and Turntable tabs

**Files:**
- Create: `src/viewer/viewerCamera.ts`, `src/export/sizes.ts`, `src/export/FramePreview.tsx`, `src/export/ProgressBar.tsx`, `src/export/tabs/ImageTab.tsx`, `src/export/tabs/TurntableTab.tsx`
- Modify: `src/viewer/Viewer.tsx`, `src/export/ExportDialog.tsx`, `src/export/tabs/layout.tsx`
- Test: `src/viewer/viewerCamera.test.ts`, `src/export/tabs/ImageTab.test.tsx`, `src/export/tabs/TurntableTab.test.tsx`

**Interfaces:**
- Consumes: `renderFrames`, `presetPose`, `turntablePoses`, `CameraPose` (Task 5); `imageDataToPng` (Task 5); `exportTurntable`, `clampFrames`, `formatGifProgress`, `GifProgress` (Task 7); `saveFile` (M1); `readToken` (M1); `isAbortError` (Task 2); `Callout` (Task 8); `TabBody`, `TabFooter` (Task 9).
- Produces:
  - `setViewerPose(pose: CameraPose | null): void`, `getViewerPose(): CameraPose | null` (the main viewer reports its orbit pose on every change)
  - `interface SizeOption { label: string; size: [number, number] }`; `IMAGE_SIZES` (1080 × 1080, 1920 × 1080, 800 × 600 px); `GIF_SIZES` (480 × 480, 640 × 480, 1080 × 1080 px); `previewSize(size, maxWidth?): [number, number]`
  - `<FramePreview frame label placeholder? overlay? />`, `<ProgressBar label fraction />`, `<NothingToExport />`
  - `type CameraChoice = 'current' | 'iso' | 'front' | 'top'`; `poseFor(choice, bounds): CameraPose`
  - `<ImageTab />` (Save PNG → `model.png`), `<TurntableTab />` (Save GIF → `model-turntable.gif`)

Both tabs export the last model that compiled (`mesh` in the store), which is what the viewer shows. The live preview re-renders at most 480 px wide whenever an option changes.

- [ ] **Step 1: Write the failing tests**

`src/viewer/viewerCamera.test.ts`:

```ts
import { getViewerPose, setViewerPose } from './viewerCamera'

it('remembers the last pose the main viewer reported', () => {
  expect(getViewerPose()).toBeNull()
  setViewerPose({ position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1] })
  expect(getViewerPose()).toEqual({ position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1] })
  setViewerPose(null)
  expect(getViewerPose()).toBeNull()
})
```

`src/export/tabs/ImageTab.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MeshData } from '../../render/types'
import { useAppStore } from '../../state/store'
import { okResult } from '../../test/results'
import { setViewerPose } from '../../viewer/viewerCamera'
import { presetPose, renderFrames, type CameraPose } from '../frames'
import { imageDataToPng } from '../png'
import { saveFile } from '../saveFile'
import { ImageTab } from './ImageTab'

vi.mock('../frames', async (importOriginal) => {
  const real = await importOriginal<typeof import('../frames')>()
  return {
    ...real,
    renderFrames: vi.fn(async function* (opts: { size: [number, number] }) {
      yield { width: opts.size[0], height: opts.size[1], data: new Uint8ClampedArray(4) } as unknown as ImageData
    }),
  }
})
vi.mock('../png', () => ({ imageDataToPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })) }))
vi.mock('../saveFile', () => ({ saveFile: vi.fn(async () => 'downloaded') }))
vi.mock('../FramePreview', () => ({
  FramePreview: ({ label }: { label: string }) => <div data-testid="frame-preview">{label}</div>,
}))

let mesh: MeshData
beforeEach(() => {
  vi.clearAllMocks()
  setViewerPose(null)
  const r = okResult()
  if (!r.ok) throw new Error('fixture must succeed')
  mesh = r.mesh
  useAppStore.setState({ ...useAppStore.getInitialState(), mesh }, true)
})

const lastCall = () => vi.mocked(renderFrames).mock.calls.at(-1)![0]

it('saves a PNG at the chosen size, camera and background', async () => {
  render(<ImageTab />)
  await userEvent.selectOptions(screen.getByLabelText('Size'), '800 × 600 px')
  await userEvent.selectOptions(screen.getByLabelText('Camera'), 'Top')
  await userEvent.click(screen.getByRole('checkbox', { name: 'Transparent background' }))
  await waitFor(() => expect(lastCall().size).toEqual([480, 360]))

  await userEvent.click(screen.getByRole('button', { name: 'Save PNG' }))
  await waitFor(() => expect(saveFile).toHaveBeenCalled())
  expect(lastCall()).toEqual({ mesh, size: [800, 600], background: null, cameras: [presetPose(mesh.bounds, 'top')] })
  expect(imageDataToPng).toHaveBeenCalledWith(expect.objectContaining({ width: 800, height: 600 }))
  expect(vi.mocked(saveFile).mock.calls[0][1]).toBe('model.png')
  expect(document.querySelectorAll('.pc-btn.is-primary')).toHaveLength(1)
})

it('defaults to the current view when the viewer has one, and to iso otherwise', async () => {
  const { unmount } = render(<ImageTab />)
  expect(screen.getByLabelText('Camera')).toHaveValue('iso')
  expect(screen.getByRole('option', { name: 'Current view' })).toBeDisabled()
  unmount()

  const pose: CameraPose = { position: [5, -50, 40], target: [10, 10, 5], up: [0, 0, 1] }
  setViewerPose(pose)
  render(<ImageTab />)
  expect(screen.getByLabelText('Camera')).toHaveValue('current')
  await waitFor(() => expect(lastCall().cameras).toEqual([pose]))
})

it('explains when there is nothing to export', () => {
  useAppStore.setState({ mesh: null })
  render(<ImageTab />)
  expect(screen.getByText('Nothing to export yet')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save PNG' })).toBeNull()
})
```

`src/export/tabs/TurntableTab.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAppStore } from '../../state/store'
import { okResult } from '../../test/results'
import { saveFile } from '../saveFile'
import { exportTurntable } from '../turntable'
import { TurntableTab } from './TurntableTab'

vi.mock('../turntable', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../turntable')>()),
  exportTurntable: vi.fn(),
}))
vi.mock('../frames', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../frames')>()),
  renderFrames: vi.fn(async function* () {}),
}))
vi.mock('../saveFile', () => ({ saveFile: vi.fn(async () => 'downloaded') }))
vi.mock('../FramePreview', () => ({ FramePreview: () => <div data-testid="frame-preview" /> }))

let finish: (blob: Blob) => void
let signal: AbortSignal

beforeEach(() => {
  vi.clearAllMocks()
  const r = okResult()
  if (!r.ok) throw new Error('fixture must succeed')
  useAppStore.setState({ ...useAppStore.getInitialState(), mesh: r.mesh }, true)
  vi.mocked(exportTurntable).mockImplementation(async (opts) => {
    signal = opts.signal
    opts.onProgress({ done: 1, total: 72, bytes: 1_000 })
    return new Promise<Blob>((resolve, reject) => {
      finish = resolve
      opts.signal.addEventListener('abort', () => reject(opts.signal.reason))
    })
  })
})

it('clamps the frame count, shows progress, and saves the GIF', async () => {
  render(<TurntableTab />)
  const frames = screen.getByLabelText('Frames')
  await userEvent.clear(frames)
  await userEvent.type(frames, '100')
  await userEvent.tab()
  expect(frames).toHaveValue('72')

  await userEvent.click(screen.getByRole('button', { name: 'Save GIF' }))
  expect(exportTurntable).toHaveBeenCalledWith(expect.objectContaining({ frames: 72, size: [480, 480], transparent: false }))
  expect(await screen.findByText('Rendering frames · 1 of 72 · about 0.1 MB')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save GIF' })).toBeDisabled()

  finish(new Blob(['GIF89a'], { type: 'image/gif' }))
  await waitFor(() => expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), 'model-turntable.gif'))
  expect(screen.getByRole('button', { name: 'Save GIF' })).toBeEnabled()
})

it('cancels without an error', async () => {
  render(<TurntableTab />)
  await userEvent.click(screen.getByRole('button', { name: 'Save GIF' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
  expect(signal.aborted).toBe(true)
  await waitFor(() => expect(screen.queryByText(/Rendering frames/)).toBeNull())
  expect(screen.queryByRole('alert')).toBeNull()
  expect(saveFile).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/viewer/viewerCamera.test.ts src/export/tabs`
Expected: FAIL, because `./viewerCamera`, `./ImageTab` and `./TurntableTab` cannot be resolved.

- [ ] **Step 3: Implement**

`src/viewer/viewerCamera.ts`:

```ts
import type { CameraPose } from '../export/frames'

let current: CameraPose | null = null

/** The main viewer's orbit pose, for "Current view" exports. Not React state: only read on demand. */
export function setViewerPose(pose: CameraPose | null): void {
  current = pose
}

export function getViewerPose(): CameraPose | null {
  return current
}
```

`src/viewer/Viewer.tsx`: add a reporter inside the `<Canvas>` (after `<CameraFitter … />`):

```tsx
import { setViewerPose } from './viewerCamera'

interface ControlsWithEvents extends ControlsLike {
  addEventListener(type: 'change', listener: () => void): void
  removeEventListener(type: 'change', listener: () => void): void
}

/** Reports the orbit pose so the PNG export can use "Current view". */
function PoseReporter() {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as ControlsWithEvents | null
  useEffect(() => {
    if (!controls) return
    const save = () =>
      setViewerPose({ position: camera.position.toArray(), target: controls.target.toArray(), up: camera.up.toArray() })
    save()
    controls.addEventListener('change', save)
    return () => {
      controls.removeEventListener('change', save)
      setViewerPose(null)
    }
  }, [camera, controls])
  return null
}

// inside <Canvas>, after <CameraFitter … />:
        <PoseReporter />
```

`src/export/sizes.ts`:

```ts
export interface SizeOption {
  label: string
  size: [number, number]
}

export const IMAGE_SIZES: SizeOption[] = [
  { label: '1080 × 1080 px', size: [1080, 1080] },
  { label: '1920 × 1080 px', size: [1920, 1080] },
  { label: '800 × 600 px', size: [800, 600] },
]

export const GIF_SIZES: SizeOption[] = [
  { label: '480 × 480 px', size: [480, 480] },
  { label: '640 × 480 px', size: [640, 480] },
  { label: '1080 × 1080 px', size: [1080, 1080] },
]

/** The live preview renders at most `maxWidth` wide, keeping the aspect ratio. */
export function previewSize([w, h]: [number, number], maxWidth = 480): [number, number] {
  const scale = Math.min(1, maxWidth / w)
  return [Math.round(w * scale), Math.round(h * scale)]
}
```

`src/export/FramePreview.tsx`:

```tsx
import { useEffect, useRef, type ReactNode } from 'react'
import { IconSpinner } from '../ui/icons'

export function FramePreview({
  frame,
  label,
  placeholder,
  overlay,
}: {
  frame: ImageData | null
  label: string
  placeholder?: ReactNode
  overlay?: ReactNode
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvas.current
    if (!c || !frame) return
    c.width = frame.width
    c.height = frame.height
    c.getContext('2d')?.putImageData(frame, 0, 0)
  }, [frame])

  return (
    <div className="relative grid h-[300px] place-items-center overflow-hidden rounded-md border border-line bg-viewport">
      {frame ? (
        <canvas ref={canvas} role="img" aria-label={label} className="max-h-full max-w-full" />
      ) : (
        (placeholder ?? (
          <span className="pc-status is-busy">
            <IconSpinner className="pc-i" aria-hidden="true" />
            Rendering preview…
          </span>
        ))
      )}
      {overlay}
    </div>
  )
}
```

`src/export/ProgressBar.tsx`:

```tsx
export function ProgressBar({ label, fraction }: { label: string; fraction: number }) {
  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100)
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="pc-caption pc-mono">{label}</span>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1 rounded-pill bg-inset">
        <div className="h-1 rounded-pill bg-accent" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
```

Add to `src/export/tabs/layout.tsx` (the import at the top of the file, the component at the end):

```tsx
import { Callout } from '../../ui/Callout'

export function NothingToExport() {
  return (
    <div className="px-6 py-5">
      <Callout tone="info" title="Nothing to export yet">
        Render a model first. Images use the last model that compiled.
      </Callout>
    </div>
  )
}
```

`src/export/tabs/ImageTab.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { errorMessage } from '../../render/result'
import type { Bounds } from '../../render/types'
import { useAppStore } from '../../state/store'
import { readToken } from '../../theme/tokens'
import { IconDownload } from '../../ui/icons'
import { getViewerPose } from '../../viewer/viewerCamera'
import { FramePreview } from '../FramePreview'
import { presetPose, renderFrames, type CameraPose } from '../frames'
import { imageDataToPng } from '../png'
import { saveFile } from '../saveFile'
import { IMAGE_SIZES, previewSize } from '../sizes'
import { NothingToExport, TabBody, TabFooter } from './layout'

export type CameraChoice = 'current' | 'iso' | 'front' | 'top'
const CAMERA_LABELS: Record<CameraChoice, string> = { current: 'Current view', iso: 'Iso', front: 'Front', top: 'Top' }
const CAMERA_CHOICES = Object.keys(CAMERA_LABELS) as CameraChoice[]

export function poseFor(choice: CameraChoice, bounds: Bounds): CameraPose {
  return choice === 'current' ? (getViewerPose() ?? presetPose(bounds, 'iso')) : presetPose(bounds, choice)
}

async function lastFrame(frames: AsyncGenerator<ImageData>): Promise<ImageData | null> {
  let last: ImageData | null = null
  for await (const frame of frames) last = frame
  return last
}

export function ImageTab() {
  const mesh = useAppStore((s) => s.mesh)
  const [sizeIndex, setSizeIndex] = useState(0)
  const [camera, setCamera] = useState<CameraChoice>(() => (getViewerPose() ? 'current' : 'iso'))
  const [transparent, setTransparent] = useState(false)
  const [preview, setPreview] = useState<ImageData | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { size, label } = IMAGE_SIZES[sizeIndex]

  useEffect(() => {
    if (!mesh) return
    let live = true
    const background = transparent ? null : readToken('viewport')
    lastFrame(renderFrames({ mesh, size: previewSize(IMAGE_SIZES[sizeIndex].size), background, cameras: [poseFor(camera, mesh.bounds)] })).then(
      (frame) => live && setPreview(frame),
      (e: unknown) => live && setError(`Could not draw the preview: ${errorMessage(e)}`),
    )
    return () => {
      live = false
    }
  }, [mesh, sizeIndex, transparent, camera])

  if (!mesh) return <NothingToExport />

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const background = transparent ? null : readToken('viewport')
      const frame = await lastFrame(renderFrames({ mesh, size, background, cameras: [poseFor(camera, mesh.bounds)] }))
      if (frame) await saveFile(await imageDataToPng(frame), 'model.png')
    } catch (e) {
      setError(`Could not save the PNG: ${errorMessage(e)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <TabBody>
        <div className="flex min-w-0 flex-col gap-3">
          <FramePreview frame={preview} label={`Preview of the ${label} image`} />
          <span className="pc-caption">The last model that compiled, at {label}.</span>
        </div>
        <div className="flex flex-col gap-4">
          <div className="pc-field">
            <label htmlFor="image-size">Size</label>
            <select id="image-size" className="pc-select" value={sizeIndex} onChange={(e) => setSizeIndex(Number(e.target.value))}>
              {IMAGE_SIZES.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="pc-field">
            <label htmlFor="image-camera">Camera</label>
            <select id="image-camera" className="pc-select" value={camera} onChange={(e) => setCamera(e.target.value as CameraChoice)}>
              {CAMERA_CHOICES.map((c) => (
                <option key={c} value={c} disabled={c === 'current' && !getViewerPose()}>
                  {CAMERA_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <label className="pc-switch">
            <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
            <span className="pc-track" />
            Transparent background
          </label>
        </div>
      </TabBody>
      <TabFooter>
        <span className="min-w-0 flex-1">
          {error && (
            <span role="alert" className="pc-caption text-error">
              {error}
            </span>
          )}
        </span>
        <button type="button" className="pc-btn is-primary" disabled={saving} onClick={() => void save()}>
          <IconDownload className="pc-i" aria-hidden="true" />
          Save PNG
        </button>
      </TabFooter>
    </>
  )
}
```

`src/export/tabs/TurntableTab.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../../render/result'
import { useAppStore } from '../../state/store'
import { readToken } from '../../theme/tokens'
import { IconDownload } from '../../ui/icons'
import { isAbortError } from '../../util/abort'
import { FramePreview } from '../FramePreview'
import { presetPose, renderFrames } from '../frames'
import { ProgressBar } from '../ProgressBar'
import { saveFile } from '../saveFile'
import { GIF_SIZES, previewSize } from '../sizes'
import { clampFrames, exportTurntable, formatGifProgress, type GifProgress } from '../turntable'
import { NothingToExport, TabBody, TabFooter } from './layout'

export function TurntableTab() {
  const mesh = useAppStore((s) => s.mesh)
  const [framesText, setFramesText] = useState('48')
  const [sizeIndex, setSizeIndex] = useState(0)
  const [transparent, setTransparent] = useState(false)
  const [preview, setPreview] = useState<ImageData | null>(null)
  const [progress, setProgress] = useState<GifProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useRef<AbortController | null>(null)
  const frames = clampFrames(Number(framesText))

  useEffect(() => () => run.current?.abort(), [])

  useEffect(() => {
    if (!mesh || run.current) return
    let live = true
    const background = transparent ? null : readToken('viewport')
    void (async () => {
      for await (const frame of renderFrames({
        mesh,
        size: previewSize(GIF_SIZES[sizeIndex].size),
        background,
        cameras: [presetPose(mesh.bounds, 'iso')],
      })) {
        if (live) setPreview(frame)
      }
    })()
    return () => {
      live = false
    }
  }, [mesh, sizeIndex, transparent])

  if (!mesh) return <NothingToExport />

  const save = async () => {
    const controller = new AbortController()
    run.current = controller
    setError(null)
    setProgress({ done: 0, total: frames, bytes: 0 })
    try {
      const blob = await exportTurntable({
        mesh,
        size: GIF_SIZES[sizeIndex].size,
        frames,
        transparent,
        signal: controller.signal,
        onProgress: setProgress,
        onFrame: setPreview,
      })
      await saveFile(blob, 'model-turntable.gif')
    } catch (e) {
      if (!isAbortError(e)) setError(`Could not make the GIF: ${errorMessage(e)}`)
    } finally {
      run.current = null
      setProgress(null)
    }
  }

  return (
    <>
      <TabBody>
        <FramePreview
          frame={preview}
          label="Turntable preview"
          overlay={
            progress && (
              <span className="pc-caption pc-mono absolute top-3 right-3">
                frame {progress.done} / {progress.total}
              </span>
            )
          }
        />
        <div className="flex flex-col gap-4">
          <div className="pc-field">
            <label htmlFor="turntable-frames">Frames</label>
            <div className="pc-input is-mono">
              <input
                id="turntable-frames"
                inputMode="numeric"
                value={framesText}
                onChange={(e) => setFramesText(e.target.value)}
                onBlur={() => setFramesText(String(frames))}
              />
              <span className="pc-unit">frames</span>
            </div>
            <span className="pc-hint">36–72. More frames turn more smoothly and make a bigger file.</span>
          </div>
          <div className="pc-field">
            <label htmlFor="turntable-size">Size</label>
            <select id="turntable-size" className="pc-select" value={sizeIndex} onChange={(e) => setSizeIndex(Number(e.target.value))}>
              {GIF_SIZES.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <label className="pc-switch">
            <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
            <span className="pc-track" />
            Transparent background
          </label>
        </div>
      </TabBody>
      <TabFooter>
        {progress ? (
          <>
            <ProgressBar label={formatGifProgress(progress)} fraction={progress.done / progress.total} />
            <button type="button" className="pc-btn is-ghost" onClick={() => run.current?.abort()}>
              Cancel
            </button>
          </>
        ) : (
          <span className="min-w-0 flex-1">
            {error && (
              <span role="alert" className="pc-caption text-error">
                {error}
              </span>
            )}
          </span>
        )}
        <button type="button" className="pc-btn is-primary" disabled={progress !== null} onClick={() => void save()}>
          <IconDownload className="pc-i" aria-hidden="true" />
          Save GIF
        </button>
      </TabFooter>
    </>
  )
}
```

`src/export/ExportDialog.tsx`: import the two tabs and extend `TABS`:

```tsx
import { ImageTab } from './tabs/ImageTab'
import { TurntableTab } from './tabs/TurntableTab'

export const TABS: Array<{ id: ExportTab; label: string; Panel: ComponentType }> = [
  { id: 'model', label: 'Model file', Panel: ModelFileTab },
  { id: 'image', label: 'Image', Panel: ImageTab },
  { id: 'turntable', label: 'Turntable', Panel: TurntableTab },
  { id: 'link', label: 'Link', Panel: LinkTab },
]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/viewer/viewerCamera.test.ts src/export && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Check in the browser**

Run: `npm run dev`; open **Share**, then **Image**: the preview shows the default model on the viewport ground; switching Camera to Top shows it from above; Transparent background shows the panel through the preview. **Save PNG** downloads `model.png` at 1080 × 1080. Orbit the main viewer first and choose "Current view": the PNG matches the orbit. **Turntable**, **Save GIF**: the progress bar counts frames with a size estimate, the preview spins, and `model-turntable.gif` loops one turn in about 4 s. Switch the OS to light mode and export again: the ground and filament follow the light tokens.

- [ ] **Step 6: Commit**

```bash
git add src/viewer/viewerCamera.ts src/viewer/viewerCamera.test.ts src/viewer/Viewer.tsx src/export
git commit -m "feat(export): PNG and turntable GIF tabs with live preview and current-view camera

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Timelapse tab

**Files:**
- Create: `src/export/tabs/TimelapseTab.tsx`
- Modify: `src/export/ExportDialog.tsx`
- Test: `src/export/tabs/TimelapseTab.test.tsx`

**Interfaces:**
- Consumes: `ancestry`, `listVersions` (M3); `useProjectStore` (`project`, `head`) (M3); `planTimelapse`, `describePlan`, `renderTimelapse`, `formatTimelapseProgress`, `parseSeconds`, `TimelapseProgress` (Task 7); `getRenderQueue` (Task 2); `renderFrames` (Task 5); `createGifEncoder` (Task 6); `drawCaption` (Task 7); `GIF_SIZES`, `FramePreview`, `ProgressBar`, `TabBody`, `TabFooter` (Tasks 9–10).
- Produces: `<TimelapseTab />` (Save GIF → `model-timelapse.gif`); the dialog's tab list in the screen's order: Model file, Image, Turntable, Timelapse, Link.

Options and defaults from the Export screen: Frame duration 0.8 s, Hold on last frame 2 s, Size, "Caption with version and prompt" on, "Slow turntable" on, "Include failed versions" off, plus "Include unpicked variants" off. The caption under the preview is `describePlan`'s sentence. Compiling takes most of the time, so the progress bar spends its first half on "Compiling v3 · 3 of 6" and the second on "Rendering frames · 4 of 6 · about 1.6 MB".

- [ ] **Step 1: Write the failing test**

`src/export/tabs/TimelapseTab.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useProjectStore } from '../../history/projectStore'
import { ancestry, listVersions } from '../../history/versions'
import { version } from '../../test/versions'
import { saveFile } from '../saveFile'
import { renderTimelapse } from '../timelapse'
import { TimelapseTab } from './TimelapseTab'

vi.mock('../../history/versions', () => ({ ancestry: vi.fn(), listVersions: vi.fn() }))
vi.mock('../timelapse', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../timelapse')>()),
  renderTimelapse: vi.fn(),
}))
vi.mock('../../render/sharedQueue', () => ({ getRenderQueue: () => ({ render: vi.fn() }) }))
vi.mock('../saveFile', () => ({ saveFile: vi.fn(async () => 'downloaded') }))
vi.mock('../FramePreview', () => ({ FramePreview: () => <div data-testid="frame-preview" /> }))

const v1 = version({ id: 'a', label: 'v1', createdAt: 1 })
const v2 = version({ id: 'b', parentId: 'a', label: 'v2', createdAt: 2 })
const v21 = version({ id: 'e', parentId: 'a', label: 'v2.1', kind: 'variant', variantGroupId: 'g', createdAt: 2.5 })
const v3 = version({ id: 'c', parentId: 'b', label: 'v3', createdAt: 3, compileStatus: 'error' })
const v4 = version({ id: 'd', parentId: 'c', label: 'v4', createdAt: 5 })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(ancestry).mockResolvedValue([v4, v3, v2, v1])
  vi.mocked(listVersions).mockResolvedValue([v1, v2, v21, v3, v4])
  vi.mocked(renderTimelapse).mockResolvedValue({ blob: new Blob(['GIF89a'], { type: 'image/gif' }), frames: 3, failed: [] })
  useProjectStore.setState({ project: { id: 'project-1', name: 'Hook' }, head: v4 } as never)
})

it('describes which versions the timelapse shows and follows the switches', async () => {
  render(<TimelapseTab />)
  expect(await screen.findByText('v1 → v4 along the current branch. The failed v3 and 1 unpicked variant are skipped.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Include failed versions' }))
  expect(screen.getByText('v1 → v4 along the current branch. 1 unpicked variant is skipped.')).toBeInTheDocument()
  expect(ancestry).toHaveBeenCalledWith('d')
  expect(listVersions).toHaveBeenCalledWith('project-1')
})

it('renders the planned versions with the chosen timing and saves the GIF', async () => {
  render(<TimelapseTab />)
  await screen.findByText(/along the current branch/)
  const duration = screen.getByLabelText('Frame duration')
  await userEvent.clear(duration)
  await userEvent.type(duration, '1,5')
  await userEvent.click(screen.getByRole('button', { name: 'Save GIF' }))

  await waitFor(() => expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), 'model-timelapse.gif'))
  const [opts] = vi.mocked(renderTimelapse).mock.calls[0]
  expect(opts.versions.map((v) => v.label)).toEqual(['v1', 'v2', 'v4'])
  expect(opts).toMatchObject({ size: [480, 480], frameDelayMs: 1_500, holdMs: 2_000, caption: true, turntable: true })
  expect(document.querySelectorAll('.pc-btn.is-primary')).toHaveLength(1)
})

it('says which versions were left out because they no longer compile', async () => {
  vi.mocked(renderTimelapse).mockResolvedValue({ blob: new Blob(['GIF89a']), frames: 2, failed: ['v2'] })
  render(<TimelapseTab />)
  await screen.findByText(/along the current branch/)
  await userEvent.click(screen.getByRole('button', { name: 'Save GIF' }))
  expect(await screen.findByText('Left out v2: it no longer compiles.')).toBeInTheDocument()
})

it('needs at least two versions that compiled', async () => {
  vi.mocked(ancestry).mockResolvedValue([v1])
  vi.mocked(listVersions).mockResolvedValue([v1])
  render(<TimelapseTab />)
  expect(await screen.findByText('Only v1 so far.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save GIF' })).toBeDisabled()
  expect(screen.getByText('Needs at least two versions on this branch that compiled.')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/export/tabs/TimelapseTab.test.tsx`
Expected: FAIL, because `./TimelapseTab` cannot be resolved.

- [ ] **Step 3: Implement**

`src/export/tabs/TimelapseTab.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Version } from '../../db/db'
import { useProjectStore } from '../../history/projectStore'
import { ancestry, listVersions } from '../../history/versions'
import { errorMessage } from '../../render/result'
import { getRenderQueue } from '../../render/sharedQueue'
import { IconDownload } from '../../ui/icons'
import { isAbortError } from '../../util/abort'
import { drawCaption } from '../caption'
import { FramePreview } from '../FramePreview'
import { renderFrames } from '../frames'
import { createGifEncoder } from '../gifClient'
import { ProgressBar } from '../ProgressBar'
import { saveFile } from '../saveFile'
import { GIF_SIZES } from '../sizes'
import {
  describePlan,
  formatTimelapseProgress,
  parseSeconds,
  planTimelapse,
  renderTimelapse,
  type TimelapseProgress,
} from '../timelapse'
import { TabBody, TabFooter } from './layout'

function progressFraction(p: TimelapseProgress): number {
  return p.phase === 'compile' ? (p.done / p.total) * 0.5 : 0.5 + (p.done / p.total) * 0.5
}

function Seconds({ id, label, value, onChange }: { id: string; label: string; value: string; onChange(v: string): void }) {
  return (
    <div className="pc-field">
      <label htmlFor={id}>{label}</label>
      <div className="pc-input is-mono">
        <input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
        <span className="pc-unit">s</span>
      </div>
    </div>
  )
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="pc-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="pc-track" />
      {label}
    </label>
  )
}

export function TimelapseTab() {
  const project = useProjectStore((s) => s.project)
  const head = useProjectStore((s) => s.head)
  const [history, setHistory] = useState<{ ancestry: Version[]; all: Version[] } | null>(null)
  const [frameDelay, setFrameDelay] = useState('0.8')
  const [hold, setHold] = useState('2')
  const [sizeIndex, setSizeIndex] = useState(0)
  const [caption, setCaption] = useState(true)
  const [turntable, setTurntable] = useState(true)
  const [includeFailed, setIncludeFailed] = useState(false)
  const [includeVariants, setIncludeVariants] = useState(false)
  const [progress, setProgress] = useState<TimelapseProgress | null>(null)
  const [frame, setFrame] = useState<{ image: ImageData; index: number } | null>(null)
  const [message, setMessage] = useState<{ tone: 'warn' | 'error'; text: string } | null>(null)
  const run = useRef<AbortController | null>(null)

  useEffect(() => () => run.current?.abort(), [])

  useEffect(() => {
    if (!project || !head) {
      setHistory(null)
      return
    }
    let live = true
    Promise.all([ancestry(head.id), listVersions(project.id)]).then(
      ([branch, all]) => live && setHistory({ ancestry: branch, all }),
      (e: unknown) => live && setMessage({ tone: 'error', text: `Could not read the history: ${errorMessage(e)}` }),
    )
    return () => {
      live = false
    }
  }, [project, head])

  const plan = useMemo(
    () => (history ? planTimelapse(history.ancestry, history.all, { includeFailed, includeVariants }) : null),
    [history, includeFailed, includeVariants],
  )
  const enough = (plan?.versions.length ?? 0) >= 2

  const save = async () => {
    if (!plan || !enough) return
    const controller = new AbortController()
    run.current = controller
    setMessage(null)
    setFrame(null)
    setProgress({ phase: 'compile', done: 0, total: plan.versions.length, label: plan.versions[0].label })
    try {
      const out = await renderTimelapse(
        {
          versions: plan.versions,
          size: GIF_SIZES[sizeIndex].size,
          frameDelayMs: Math.round(parseSeconds(frameDelay, { min: 0.05, max: 10, fallback: 0.8 }) * 1000),
          holdMs: Math.round(parseSeconds(hold, { min: 0, max: 10, fallback: 2 }) * 1000),
          caption,
          turntable,
          signal: controller.signal,
          onProgress: setProgress,
          onFrame: (image, index) => setFrame({ image, index }),
        },
        { queue: getRenderQueue(), renderFrames, createEncoder: createGifEncoder, drawCaption },
      )
      await saveFile(out.blob, 'model-timelapse.gif')
      if (out.failed.length > 0) {
        const verb = out.failed.length === 1 ? 'it no longer compiles' : 'they no longer compile'
        setMessage({ tone: 'warn', text: `Left out ${out.failed.join(', ')}: ${verb}.` })
      }
    } catch (e) {
      if (!isAbortError(e)) setMessage({ tone: 'error', text: `Could not make the GIF: ${errorMessage(e)}` })
    } finally {
      run.current = null
      setProgress(null)
    }
  }

  return (
    <>
      <TabBody>
        <div className="flex min-w-0 flex-col gap-3">
          <FramePreview
            frame={frame?.image ?? null}
            label="Timelapse frame"
            placeholder={<span className="pc-caption">Save GIF renders every version again; frames appear here.</span>}
            overlay={
              frame &&
              progress?.phase === 'frames' && (
                <span className="pc-caption pc-mono absolute top-3 right-3">
                  frame {frame.index + 1} / {progress.total}
                </span>
              )
            }
          />
          <span className="pc-caption">{plan ? describePlan(plan) : 'Reading the history…'}</span>
        </div>
        <div className="flex flex-col gap-4">
          <Seconds id="timelapse-duration" label="Frame duration" value={frameDelay} onChange={setFrameDelay} />
          <Seconds id="timelapse-hold" label="Hold on last frame" value={hold} onChange={setHold} />
          <div className="pc-field">
            <label htmlFor="timelapse-size">Size</label>
            <select id="timelapse-size" className="pc-select" value={sizeIndex} onChange={(e) => setSizeIndex(Number(e.target.value))}>
              {GIF_SIZES.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="pc-stack">
            <Switch label="Caption with version and prompt" checked={caption} onChange={setCaption} />
            <Switch label="Slow turntable" checked={turntable} onChange={setTurntable} />
            <Switch label="Include failed versions" checked={includeFailed} onChange={setIncludeFailed} />
            <Switch label="Include unpicked variants" checked={includeVariants} onChange={setIncludeVariants} />
          </div>
        </div>
      </TabBody>
      <TabFooter>
        {progress ? (
          <>
            <ProgressBar label={formatTimelapseProgress(progress)} fraction={progressFraction(progress)} />
            <button type="button" className="pc-btn is-ghost" onClick={() => run.current?.abort()}>
              Cancel
            </button>
          </>
        ) : (
          <span className="min-w-0 flex-1">
            {message ? (
              <span role={message.tone === 'error' ? 'alert' : 'status'} className={`pc-caption ${message.tone === 'error' ? 'text-error' : ''}`}>
                {message.text}
              </span>
            ) : (
              plan && !enough && <span className="pc-caption">Needs at least two versions on this branch that compiled.</span>
            )}
          </span>
        )}
        <button type="button" className="pc-btn is-primary" disabled={!enough || progress !== null} onClick={() => void save()}>
          <IconDownload className="pc-i" aria-hidden="true" />
          Save GIF
        </button>
      </TabFooter>
    </>
  )
}
```

`src/export/ExportDialog.tsx`: import the tab and complete `TABS`:

```tsx
import { TimelapseTab } from './tabs/TimelapseTab'

export const TABS: Array<{ id: ExportTab; label: string; Panel: ComponentType }> = [
  { id: 'model', label: 'Model file', Panel: ModelFileTab },
  { id: 'image', label: 'Image', Panel: ImageTab },
  { id: 'turntable', label: 'Turntable', Panel: TurntableTab },
  { id: 'timelapse', label: 'Timelapse', Panel: TimelapseTab },
  { id: 'link', label: 'Link', Panel: LinkTab },
]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/export && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/export/tabs/TimelapseTab.tsx src/export/tabs/TimelapseTab.test.tsx src/export/ExportDialog.tsx
git commit -m "feat(export): timelapse GIF tab along the current branch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 12: Variant generation and saving the pick

**Files:**
- Create: `src/variants/types.ts`, `src/variants/temperatures.ts`, `src/variants/runVariants.ts`, `src/variants/recordUsage.ts`, `src/history/setHead.ts`, `src/variants/commitPick.ts`, `src/variants/variantStore.ts`
- Test: `src/variants/temperatures.test.ts`, `src/variants/runVariants.test.ts`, `src/variants/recordUsage.test.ts`, `src/history/setHead.test.ts`, `src/variants/commitPick.test.ts`, `src/variants/variantStore.test.ts`

**Interfaces:**
- Consumes: `LlmProvider`, `ChatRequest`, `LlmMessage`, `AdapterKind`, `ProviderError` (M2 `src/ai/types.ts`); `PromptContext` (M2 `src/ai/prompt.ts`); `runTurn`, `TurnEvent` (M2 `src/ai/runTurn.ts`); `computeCost` (M2 `src/ai/cost.ts`); `describeProviderError` (M2 `src/ai/errors.ts`); `ProviderProfile`, `UsageRecord`, `PromptCadDb`, `db` (M2); `RenderQueue`, `getRenderQueue` (Task 2); `createVersion` (M3); `useProjectStore().openProject` (M3); `db.projects` (M3).
- Produces:
  - `VARIANT_LETTERS = ['A', 'B', 'C']`; `interface VariantRequest { provider; profile; model; history; userText: string; ctx; maxFixAttempts; projectId: string | null; parentId: string | null }`
  - `type SlotStatus = 'generating' | 'queued' | 'fixing' | 'ok' | 'error' | 'no-code' | 'failed-request' | 'cancelled'`
  - `interface VariantSlot { letter; model; temperature: number | undefined; status; code: string | null; result: RenderResult | null; resultCode: string | null; prose: string; usage: { inputTokens; outputTokens; cost: number | null }; fixAttempt: number; renderSeq: number | null; error: { title: string; body: string } | null }`; `initialSlots(model, temperatures): VariantSlot[]`
  - `VARIANT_TEMPERATURES = [undefined, 0.7, 1.0]`; `variantTemperatures(adapter: AdapterKind, count: number): Array<number | undefined>`; `withTemperature(provider: LlmProvider, temperature: number | undefined): LlmProvider`
  - `interface RunVariantsDeps { queue: Pick<RenderQueue, 'render'>; runTurn: typeof runTurn; recordUsage(record: Omit<UsageRecord, 'id' | 'createdAt'>): Promise<void> }`
  - `runVariants(req: VariantRequest, slots: VariantSlot[], opts: { signal: AbortSignal; onSlot(index: number, patch: Partial<VariantSlot>): void }, deps: RunVariantsDeps): Promise<void>`
  - `recordUsage(record: Omit<UsageRecord, 'id' | 'createdAt'>, database?: PromptCadDb): Promise<void>`
  - `setHead(projectId: string, versionId: string, database?: PromptCadDb): Promise<void>`
  - `interface CommitPickInput { projectId; parentId; groupId; prompt; slots; picked }`; `compileStatusOf(slot: VariantSlot): Version['compileStatus']`; `interface CommitPickDeps { createVersion; setHead; openProject }`; `commitPick(input: CommitPickInput, deps?: CommitPickDeps): Promise<Version>`
  - `VARIANT_COUNT = 3`; `useVariantStore`: `open`, `groupId`, `request`, `slots`, `selected`, `picking`, `error`, `start(req)`, `regenerate()`, `discard()`, `select(i)`, `pick(): Promise<void>`

Each slot is one `runTurn` (so auto-fix works exactly as in chat) with `render` bound to the `RenderQueue` and `apply` writing into the slot, never the editor. `runTurn` has no temperature option (see "Contract issues"), so slots B and C get a provider wrapped by `withTemperature`, which sets `ChatRequest.temperature`; the Anthropic adapter drops temperature, so for Anthropic profiles all three use the default and differ by sampling alone. All three use the composer's model (the picker's "A · model" labels support per-slot models later). The queue renders FIFO, so "Rendering…" is the queued slot with the lowest `renderSeq`. Every reply writes a `usage` row at once, so tokens are counted even if the user discards all three.

Picking writes, in order: the pick as `kind: 'main'`, `source: 'ai'`, with the group's `variantGroupId`; every other slot that has code as `kind: 'variant'` with the same parent and group; then moves the project's head to the pick and reloads it with `openProject`, which puts the pick's code into the editor. `compileStatus` is `'ok'`/`'error'` only when the stored code is the code that rendered, else `'pending'`. Variant versions get `thumbnailBlobId: null` (see Deferred).

- [ ] **Step 1: Write the failing tests**

`src/variants/temperatures.test.ts`:

```ts
import type { ChatRequest, LlmProvider } from '../ai/types'
import { variantTemperatures, withTemperature } from './temperatures'

async function drain(events: AsyncIterable<unknown>) {
  for await (const e of events) void e
}

it('keeps A at the default and samples B and C hotter, except on Anthropic', () => {
  expect(variantTemperatures('openai-compatible', 3)).toEqual([undefined, 0.7, 1.0])
  expect(variantTemperatures('anthropic', 3)).toEqual([undefined, undefined, undefined])
  expect(variantTemperatures('openai-compatible', 1)).toEqual([undefined])
})

it('sets the temperature on every request that has none', async () => {
  const seen: ChatRequest[] = []
  const base: LlmProvider = {
    listModels: vi.fn(async () => []),
    async *streamChat(req) {
      seen.push(req)
      yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }
    },
  }
  const hot = withTemperature(base, 0.7)
  await drain(hot.streamChat({ model: 'm', system: 's', messages: [] }))
  await drain(hot.streamChat({ model: 'm', system: 's', messages: [], temperature: 0.2 }))
  expect(seen.map((r) => r.temperature)).toEqual([0.7, 0.2])
  await hot.listModels()
  expect(base.listModels).toHaveBeenCalled()
  expect(withTemperature(base, undefined)).toBe(base)
})
```

`src/variants/runVariants.test.ts`:

```ts
import type { runTurn } from '../ai/runTurn'
import { ProviderError, type LlmProvider } from '../ai/types'
import type { ProviderProfile } from '../db/db'
import type { RenderRequest } from '../render/types'
import { errorResult, okResult } from '../test/results'
import { runVariants, type RunVariantsDeps } from './runVariants'
import { initialSlots, type VariantRequest, type VariantSlot } from './types'

type TurnOpts = Parameters<typeof runTurn>[0]

const profile: ProviderProfile = {
  id: 'profile-1',
  name: 'Fake',
  adapter: 'openai-compatible',
  baseUrl: 'https://fake-llm.test/v1',
  apiKey: 'test-key',
  defaultModel: 'fake-model',
  cachedModels: [],
  capabilities: { streaming: true, vision: false, audio: false },
  priceTable: { 'fake-model': { inputPerMTok: 1, outputPerMTok: 2 } },
  createdAt: 0,
  updatedAt: 0,
}
const provider: LlmProvider = { listModels: async () => [], async *streamChat() {} }
const request: VariantRequest = {
  provider,
  profile,
  model: 'fake-model',
  history: [{ role: 'user', content: 'earlier' }],
  userText: 'A hook for a 30 mm broom handle',
  ctx: { code: 'cube(1);' },
  maxFixAttempts: 2,
  projectId: 'project-1',
  parentId: 'version-3',
}

function harness(scripts: Array<(o: TurnOpts) => Promise<void>>) {
  const slots: VariantSlot[] = initialSlots('fake-model', [undefined, 0.7, 1.0])
  const onSlot = (i: number, patch: Partial<VariantSlot>) => {
    slots[i] = { ...slots[i], ...patch }
  }
  let call = 0
  const turns = vi.fn(async (o: TurnOpts) => scripts[call++](o))
  const queue = { render: vi.fn(async (req: RenderRequest) => (req.code.includes('broken') ? errorResult() : okResult())) }
  const recordUsage = vi.fn(async () => {})
  const deps = { queue, runTurn: turns, recordUsage } as unknown as RunVariantsDeps
  return { slots, onSlot, turns, queue, recordUsage, deps }
}

const reply = (o: TurnOpts, code: string | null, attempt = 0) =>
  o.onEvent({ type: 'reply', result: { code, prose: 'Made it.', usage: { inputTokens: 1_000, outputTokens: 500 }, model: o.model }, attempt })

const success = (code: string) => async (o: TurnOpts) => {
  reply(o, code)
  o.apply(code, 'ai')
  o.onEvent({ type: 'rendered', result: await o.render(code, o.signal), attempt: 0 })
}

it('asks three times in parallel with the same model and prompt, and renders in the background queue', async () => {
  const h = harness([success('cube(10);'), success('cube(20);'), success('cube(30);')])
  const controller = new AbortController()
  await runVariants(request, h.slots, { signal: controller.signal, onSlot: h.onSlot }, h.deps)

  expect(h.turns).toHaveBeenCalledTimes(3)
  for (const [opts] of h.turns.mock.calls) {
    expect(opts).toMatchObject({ model: 'fake-model', userText: request.userText, history: request.history, ctx: request.ctx, maxFixAttempts: 2 })
    expect(opts.signal).toBe(controller.signal)
  }
  expect(h.turns.mock.calls[0][0].provider).toBe(provider)
  expect(h.turns.mock.calls[1][0].provider).not.toBe(provider)
  expect(h.queue.render.mock.calls.map(([req]) => req)).toEqual([{ code: 'cube(10);' }, { code: 'cube(20);' }, { code: 'cube(30);' }])
  expect(h.slots.map((s) => [s.status, s.code, s.resultCode, s.renderSeq])).toEqual([
    ['ok', 'cube(10);', 'cube(10);', null],
    ['ok', 'cube(20);', 'cube(20);', null],
    ['ok', 'cube(30);', 'cube(30);', null],
  ])
})

it('records usage for every reply, including auto-fix replies, and sums it per slot', async () => {
  const fixThenSucceed = async (o: TurnOpts) => {
    reply(o, 'broken(')
    o.apply('broken(', 'ai')
    const failed = await o.render('broken(', o.signal)
    o.onEvent({ type: 'rendered', result: failed, attempt: 0 })
    o.onEvent({ type: 'fixing', attempt: 1, of: 2, errors: 'syntax error' })
    reply(o, 'cube(1);', 1)
    o.apply('cube(1);', 'autofix')
    o.onEvent({ type: 'rendered', result: await o.render('cube(1);', o.signal), attempt: 1 })
  }
  const h = harness([fixThenSucceed, success('cube(2);'), success('cube(3);')])
  await runVariants(request, h.slots, { signal: new AbortController().signal, onSlot: h.onSlot }, h.deps)

  expect(h.recordUsage).toHaveBeenCalledTimes(4)
  expect(h.recordUsage).toHaveBeenCalledWith(
    expect.objectContaining({
      profileId: 'profile-1',
      model: 'fake-model',
      inputTokens: 1_000,
      outputTokens: 500,
      costSource: 'price-table',
      projectId: 'project-1',
      versionId: null,
    }),
  )
  expect(h.slots[0]).toMatchObject({ status: 'ok', code: 'cube(1);', fixAttempt: 1, usage: { inputTokens: 2_000, outputTokens: 1_000 } })
  expect(h.slots[0].usage.cost).toBeCloseTo(0.004)
})

it('marks a reply without code, a failed request and a cancelled turn', async () => {
  const noCode = async (o: TurnOpts) => reply(o, null)
  const rejected = async () => {
    throw new ProviderError('auth', 'Invalid API key', 401)
  }
  const waitsForever = (o: TurnOpts) =>
    new Promise<void>((_, reject) => o.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
  const h = harness([noCode, rejected, waitsForever])
  const controller = new AbortController()
  const run = runVariants(request, h.slots, { signal: controller.signal, onSlot: h.onSlot }, h.deps)
  await new Promise((resolve) => setTimeout(resolve, 0))
  controller.abort()
  await run

  expect(h.slots.map((s) => s.status)).toEqual(['no-code', 'failed-request', 'cancelled'])
  expect(h.slots[1].error?.title).toBeTruthy()
  expect(h.slots[0].code).toBeNull()
})

it('numbers renders in the order they entered the queue', async () => {
  const h = harness([success('cube(1);'), success('cube(2);'), success('cube(3);')])
  const seqs: Array<number | null | undefined> = []
  await runVariants(
    request,
    h.slots,
    {
      signal: new AbortController().signal,
      onSlot: (i, patch) => {
        if (patch.status === 'queued') seqs.push(patch.renderSeq)
        h.onSlot(i, patch)
      },
    },
    h.deps,
  )
  expect(seqs).toEqual([1, 2, 3])
})
```

`src/variants/recordUsage.test.ts`:

```ts
import 'fake-indexeddb/auto'
import { PromptCadDb } from '../db/db'
import { recordUsage } from './recordUsage'

it('writes one usage row with an id and a timestamp', async () => {
  const database = new PromptCadDb(`usage-${crypto.randomUUID()}`)
  const before = Date.now()
  await recordUsage(
    {
      profileId: 'profile-1',
      model: 'fake-model',
      inputTokens: 1_000,
      outputTokens: 500,
      cost: 0.002,
      costSource: 'price-table',
      projectId: 'project-1',
      versionId: null,
    },
    database,
  )
  const rows = await database.usage.toArray()
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ profileId: 'profile-1', inputTokens: 1_000, cost: 0.002, projectId: 'project-1' })
  expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/)
  expect(rows[0].createdAt).toBeGreaterThanOrEqual(before)
  await database.delete()
})
```

`src/history/setHead.test.ts`:

```ts
import 'fake-indexeddb/auto'
import { PromptCadDb, type Project } from '../db/db'
import { setHead } from './setHead'

const project: Project = {
  id: 'project-1',
  name: 'Hook',
  createdAt: 1,
  updatedAt: 1,
  headVersionId: 'v1',
  providerProfileId: null,
  enabledLibraries: [],
  origin: 'blank',
}

it('moves the project head without creating a version', async () => {
  const database = new PromptCadDb(`head-${crypto.randomUUID()}`)
  await database.projects.put(project)
  await setHead('project-1', 'v4', database)
  const stored = await database.projects.get('project-1')
  expect(stored?.headVersionId).toBe('v4')
  expect(stored?.updatedAt).toBeGreaterThan(1)
  expect(await database.versions.count()).toBe(0)
  await expect(setHead('missing', 'v4', database)).rejects.toThrow('Project missing was not found')
  await database.delete()
})
```

`src/variants/commitPick.test.ts`:

```ts
import type { Version } from '../db/db'
import { errorResult, okResult } from '../test/results'
import { commitPick, compileStatusOf, type CommitPickDeps } from './commitPick'
import { initialSlots, type VariantSlot } from './types'

type NewVersion = Omit<Version, 'id' | 'label' | 'createdAt'>

function fakes() {
  const created: NewVersion[] = []
  const calls: string[] = []
  const deps: CommitPickDeps = {
    createVersion: vi.fn(async (input: NewVersion) => {
      created.push(input)
      calls.push(`create ${input.kind} ${input.code}`)
      return { ...input, id: `id-${created.length}`, label: `v${created.length}`, createdAt: created.length }
    }),
    setHead: vi.fn(async (projectId: string, versionId: string) => {
      calls.push(`head ${projectId} ${versionId}`)
    }),
    openProject: vi.fn(async (projectId: string) => {
      calls.push(`open ${projectId}`)
    }),
  }
  return { created, calls, deps }
}

function slots(): VariantSlot[] {
  const [a, b, c] = initialSlots('fake-model', [undefined, 0.7, 1.0])
  return [
    { ...a, status: 'ok', code: 'A', result: okResult(), resultCode: 'A' },
    { ...b, status: 'error', code: 'B', result: errorResult(), resultCode: 'B' },
    // Picked while C's auto-fix was still rendering: its newest code never rendered.
    { ...c, status: 'queued', code: 'C2', result: errorResult(), resultCode: 'C1' },
  ]
}

const input = { projectId: 'project-1', parentId: 'version-3', groupId: 'group-1', prompt: 'A hook' }

it('stores the pick as the main version, the others as variants of the same group, then moves the head', async () => {
  const f = fakes()
  const pick = await commitPick({ ...input, slots: slots(), picked: 0 }, f.deps)

  expect(f.calls).toEqual(['create main A', 'create variant B', 'create variant C2', 'head project-1 id-1', 'open project-1'])
  expect(pick.id).toBe('id-1')
  expect(f.created[0]).toEqual({
    projectId: 'project-1',
    parentId: 'version-3',
    code: 'A',
    params: {},
    source: 'ai',
    kind: 'main',
    variantGroupId: 'group-1',
    message: 'A hook',
    model: 'fake-model',
    compileStatus: 'ok',
    renderMs: 12,
    thumbnailBlobId: null,
  })
  expect(f.created.map((v) => [v.kind, v.variantGroupId, v.parentId, v.compileStatus])).toEqual([
    ['main', 'group-1', 'version-3', 'ok'],
    ['variant', 'group-1', 'version-3', 'error'],
    ['variant', 'group-1', 'version-3', 'pending'],
  ])
  expect(f.created[2].renderMs).toBeNull()
})

it('does not store slots without code', async () => {
  const f = fakes()
  const s = slots()
  s[1] = { ...s[1], status: 'failed-request', code: null, result: null, resultCode: null }
  await commitPick({ ...input, slots: s, picked: 0 }, f.deps)
  expect(f.created.map((v) => v.code)).toEqual(['A', 'C2'])
})

it('refuses without a project or code', async () => {
  const f = fakes()
  await expect(commitPick({ ...input, projectId: null, slots: slots(), picked: 0 }, f.deps)).rejects.toThrow('No project is open')
  const s = slots()
  s[0] = { ...s[0], code: null }
  await expect(commitPick({ ...input, slots: s, picked: 0 }, f.deps)).rejects.toThrow('Variant A has no code')
  expect(f.created).toEqual([])
})

it('derives compile status from the code that rendered', () => {
  const [a] = slots()
  expect(compileStatusOf(a)).toBe('ok')
  expect(compileStatusOf({ ...a, resultCode: 'other' })).toBe('pending')
  expect(compileStatusOf({ ...a, result: null })).toBe('pending')
})
```

`src/variants/variantStore.test.ts`:

```ts
import type { LlmProvider } from '../ai/types'
import type { ProviderProfile } from '../db/db'
import { okResult } from '../test/results'
import { commitPick } from './commitPick'
import { runVariants } from './runVariants'
import type { VariantRequest, VariantSlot } from './types'
import { useVariantStore } from './variantStore'

vi.mock('./runVariants', () => ({ runVariants: vi.fn(async () => {}) }))
vi.mock('./commitPick', () => ({ commitPick: vi.fn(async () => ({ id: 'picked' })) }))
vi.mock('./recordUsage', () => ({ recordUsage: vi.fn() }))
vi.mock('../ai/runTurn', () => ({ runTurn: vi.fn() }))
vi.mock('../render/sharedQueue', () => ({ getRenderQueue: () => ({ render: vi.fn() }) }))

const request = {
  provider: {} as LlmProvider,
  profile: { id: 'profile-1', adapter: 'openai-compatible', baseUrl: 'https://fake-llm.test/v1' } as ProviderProfile,
  model: 'fake-model',
  history: [],
  userText: 'A hook',
  ctx: { code: '' },
  maxFixAttempts: 2,
  projectId: 'project-1',
  parentId: 'version-3',
} satisfies VariantRequest

type RunArgs = Parameters<typeof runVariants>
const lastRun = () => vi.mocked(runVariants).mock.calls.at(-1) as RunArgs

beforeEach(() => {
  vi.clearAllMocks()
  useVariantStore.getState().discard()
})

it('opens with three generating slots and starts the run', () => {
  useVariantStore.getState().start(request)
  const s = useVariantStore.getState()
  expect(s.open).toBe(true)
  expect(s.groupId).toMatch(/^[0-9a-f-]{36}$/)
  expect(s.slots.map((slot) => [slot.letter, slot.status, slot.temperature])).toEqual([
    ['A', 'generating', undefined],
    ['B', 'generating', 0.7],
    ['C', 'generating', 1.0],
  ])
  const [req, slots, opts] = lastRun()
  expect(req).toBe(request)
  expect(slots).toEqual(s.slots)
  expect(opts.signal.aborted).toBe(false)
})

it('applies slot updates and selects the first variant that renders', () => {
  useVariantStore.getState().start(request)
  const [, , opts] = lastRun()
  opts.onSlot(1, { status: 'ok', code: 'cube(2);', result: okResult(), resultCode: 'cube(2);' })
  opts.onSlot(0, { status: 'ok', code: 'cube(1);', result: okResult(), resultCode: 'cube(1);' })
  const s = useVariantStore.getState()
  expect(s.slots[1]).toMatchObject({ status: 'ok', code: 'cube(2);' })
  expect(s.selected).toBe(1)
})

it('regenerates with a new group and ignores the old run', () => {
  useVariantStore.getState().start(request)
  const [, , first] = lastRun()
  const firstGroup = useVariantStore.getState().groupId
  useVariantStore.getState().regenerate()
  expect(first.signal.aborted).toBe(true)
  expect(useVariantStore.getState().groupId).not.toBe(firstGroup)
  first.onSlot(0, { status: 'ok' })
  expect(useVariantStore.getState().slots[0].status).toBe('generating')
})

it('discards without saving anything', () => {
  useVariantStore.getState().start(request)
  const [, , opts] = lastRun()
  useVariantStore.getState().discard()
  expect(opts.signal.aborted).toBe(true)
  expect(useVariantStore.getState().open).toBe(false)
  expect(commitPick).not.toHaveBeenCalled()
})

it('picks only a rendered variant, commits it and closes', async () => {
  useVariantStore.getState().start(request)
  const [, , opts] = lastRun()
  opts.onSlot(0, { status: 'error' })
  useVariantStore.getState().select(0)
  await useVariantStore.getState().pick()
  expect(commitPick).not.toHaveBeenCalled()

  opts.onSlot(2, { status: 'ok', code: 'cube(3);', result: okResult(), resultCode: 'cube(3);' })
  useVariantStore.getState().select(2)
  const slots = useVariantStore.getState().slots
  await useVariantStore.getState().pick()
  expect(commitPick).toHaveBeenCalledWith({
    projectId: 'project-1',
    parentId: 'version-3',
    groupId: expect.any(String),
    prompt: 'A hook',
    slots,
    picked: 2,
  })
  expect(opts.signal.aborted).toBe(true)
  expect(useVariantStore.getState().open).toBe(false)
})

it('keeps the picker open with the reason when saving fails', async () => {
  vi.mocked(commitPick).mockRejectedValueOnce(new Error('No project is open'))
  useVariantStore.getState().start(request)
  const [, , opts] = lastRun()
  opts.onSlot(0, { status: 'ok', code: 'cube(1);' } satisfies Partial<VariantSlot>)
  await useVariantStore.getState().pick()
  expect(useVariantStore.getState()).toMatchObject({ open: true, picking: false, error: 'Could not save the variants: No project is open' })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/variants src/history/setHead.test.ts`
Expected: FAIL, because `./temperatures`, `./runVariants`, `./types`, `./recordUsage`, `./setHead`, `./commitPick` and `./variantStore` cannot be resolved.

- [ ] **Step 3: Implement**

`src/variants/types.ts`:

```ts
import type { PromptContext } from '../ai/prompt'
import type { LlmMessage, LlmProvider } from '../ai/types'
import type { ProviderProfile } from '../db/db'
import type { RenderResult } from '../render/types'

export const VARIANT_LETTERS = ['A', 'B', 'C'] as const
export type VariantLetter = (typeof VARIANT_LETTERS)[number]

export interface VariantRequest {
  provider: LlmProvider
  profile: ProviderProfile
  model: string
  history: LlmMessage[]
  userText: string
  ctx: PromptContext
  maxFixAttempts: number
  projectId: string | null
  /** The head when the prompt was sent; variants of a follow-up edit branch from it. */
  parentId: string | null
}

export type SlotStatus = 'generating' | 'queued' | 'fixing' | 'ok' | 'error' | 'no-code' | 'failed-request' | 'cancelled'

export interface SlotUsage {
  inputTokens: number
  outputTokens: number
  cost: number | null
}

export interface VariantSlot {
  letter: VariantLetter
  model: string
  temperature: number | undefined
  status: SlotStatus
  /** Latest code from the model (or its auto-fix). */
  code: string | null
  /** Latest finished render, and the code it belongs to (may lag `code` while a fix renders). */
  result: RenderResult | null
  resultCode: string | null
  prose: string
  usage: SlotUsage
  fixAttempt: number
  /** Order in which this slot's pending render entered the queue; null when none is pending. */
  renderSeq: number | null
  error: { title: string; body: string } | null
}

export function initialSlots(model: string, temperatures: Array<number | undefined>): VariantSlot[] {
  return temperatures.map((temperature, i) => ({
    letter: VARIANT_LETTERS[i],
    model,
    temperature,
    status: 'generating',
    code: null,
    result: null,
    resultCode: null,
    prose: '',
    usage: { inputTokens: 0, outputTokens: 0, cost: null },
    fixAttempt: 0,
    renderSeq: null,
    error: null,
  }))
}
```

`src/variants/temperatures.ts`:

```ts
import type { AdapterKind, LlmProvider } from '../ai/types'

/** A keeps the model's default; B and C sample hotter for more different shapes. */
export const VARIANT_TEMPERATURES = [undefined, 0.7, 1.0] as const

/** The Anthropic adapter drops temperature, so its variants differ by sampling alone. */
export function variantTemperatures(adapter: AdapterKind, count: number): Array<number | undefined> {
  return VARIANT_TEMPERATURES.slice(0, count).map((t) => (adapter === 'anthropic' ? undefined : t))
}

/** runTurn has no temperature option; this sets ChatRequest.temperature on the way to the provider. */
export function withTemperature(provider: LlmProvider, temperature: number | undefined): LlmProvider {
  if (temperature === undefined) return provider
  return {
    listModels: (signal) => provider.listModels(signal),
    streamChat: (req, signal) => provider.streamChat({ ...req, temperature: req.temperature ?? temperature }, signal),
  }
}
```

`src/variants/runVariants.ts`:

```ts
import { computeCost } from '../ai/cost'
import { describeProviderError } from '../ai/errors'
import type { runTurn } from '../ai/runTurn'
import type { UsageRecord } from '../db/db'
import type { RenderQueue } from '../render/queue'
import { withTemperature } from './temperatures'
import type { SlotStatus, SlotUsage, VariantRequest, VariantSlot } from './types'

export interface RunVariantsDeps {
  queue: Pick<RenderQueue, 'render'>
  runTurn: typeof runTurn
  recordUsage(record: Omit<UsageRecord, 'id' | 'createdAt'>): Promise<void>
}

/** One runTurn per slot, in parallel; renders go through the background queue and never touch the editor. */
export async function runVariants(
  req: VariantRequest,
  slots: VariantSlot[],
  opts: { signal: AbortSignal; onSlot(index: number, patch: Partial<VariantSlot>): void },
  deps: RunVariantsDeps,
): Promise<void> {
  let renderSeq = 0
  const priceOf = (model: string) => req.profile.priceTable[model] ?? req.profile.cachedModels.find((m) => m.id === model)?.price

  await Promise.all(
    slots.map(async (slot, i) => {
      const usage: SlotUsage = { inputTokens: 0, outputTokens: 0, cost: null }
      let status: SlotStatus = slot.status
      const update = (patch: Partial<VariantSlot>) => {
        if (patch.status) status = patch.status
        opts.onSlot(i, patch)
      }

      try {
        await deps.runTurn({
          provider: withTemperature(req.provider, slot.temperature),
          model: slot.model,
          history: req.history,
          userText: req.userText,
          ctx: req.ctx,
          maxFixAttempts: req.maxFixAttempts,
          signal: opts.signal,
          render: async (code, signal) => {
            update({ status: 'queued', renderSeq: ++renderSeq })
            const result = await deps.queue.render({ code }, signal)
            update({ status: result.ok ? 'ok' : 'error', result, resultCode: code, renderSeq: null })
            return result
          },
          apply: (code) => update({ code }),
          onEvent: (e) => {
            if (e.type === 'reply') {
              const { cost, costSource } = computeCost(e.result.usage, priceOf(e.result.model))
              usage.inputTokens += e.result.usage.inputTokens
              usage.outputTokens += e.result.usage.outputTokens
              if (cost !== null) usage.cost = (usage.cost ?? 0) + cost
              update({
                usage: { ...usage },
                prose: e.result.prose,
                model: e.result.model,
                ...(e.result.code === null && e.attempt === 0 ? { status: 'no-code' as const } : {}),
              })
              void deps
                .recordUsage({
                  profileId: req.profile.id,
                  model: e.result.model,
                  inputTokens: e.result.usage.inputTokens,
                  outputTokens: e.result.usage.outputTokens,
                  cost,
                  costSource,
                  projectId: req.projectId,
                  versionId: null,
                })
                .catch((err: unknown) => console.warn('Could not record token usage', err))
            } else if (e.type === 'fixing') {
              update({ status: 'fixing', fixAttempt: e.attempt })
            } else if (e.type === 'gave-up' && status !== 'error') {
              update({ status: 'error' })
            }
          },
        })
        if (status === 'generating') update({ status: 'no-code' })
      } catch (e) {
        if (opts.signal.aborted) update({ status: 'cancelled', renderSeq: null })
        else update({ status: 'failed-request', error: describeProviderError(e, req.profile.baseUrl), renderSeq: null })
      }
    }),
  )
}
```

`src/variants/recordUsage.ts`:

```ts
import { db as defaultDb, type PromptCadDb, type UsageRecord } from '../db/db'

/** One usage row per variant reply (the chat path writes its own through M2's repository). */
export async function recordUsage(record: Omit<UsageRecord, 'id' | 'createdAt'>, database: PromptCadDb = defaultDb): Promise<void> {
  await database.usage.put({ ...record, id: crypto.randomUUID(), createdAt: Date.now() })
}
```

`src/history/setHead.ts`:

```ts
import { db as defaultDb, type PromptCadDb } from '../db/db'

/** Points the project at an existing version; unlike restore(), it creates no new version. */
export async function setHead(projectId: string, versionId: string, database: PromptCadDb = defaultDb): Promise<void> {
  const updated = await database.projects.update(projectId, { headVersionId: versionId, updatedAt: Date.now() })
  if (updated === 0) throw new Error(`Project ${projectId} was not found`)
}
```

`src/variants/commitPick.ts`:

```ts
import type { Version } from '../db/db'
import { useProjectStore } from '../history/projectStore'
import { setHead } from '../history/setHead'
import { createVersion } from '../history/versions'
import type { VariantSlot } from './types'

export interface CommitPickInput {
  projectId: string | null
  parentId: string | null
  groupId: string
  prompt: string
  slots: VariantSlot[]
  picked: number
}

export interface CommitPickDeps {
  createVersion: typeof createVersion
  setHead(projectId: string, versionId: string): Promise<void>
  openProject(projectId: string): Promise<void>
}

const defaultDeps: CommitPickDeps = {
  createVersion,
  setHead: (projectId, versionId) => setHead(projectId, versionId),
  openProject: async (projectId) => {
    await useProjectStore.getState().openProject(projectId)
  },
}

/** 'ok'/'error' only when the stored code is the code that rendered. */
export function compileStatusOf(slot: VariantSlot): Version['compileStatus'] {
  if (!slot.result || slot.resultCode !== slot.code) return 'pending'
  return slot.result.ok ? 'ok' : 'error'
}

export async function commitPick(input: CommitPickInput, deps: CommitPickDeps = defaultDeps): Promise<Version> {
  const { projectId, parentId, groupId, prompt, slots, picked } = input
  if (!projectId) throw new Error('No project is open')
  const chosen = slots[picked]
  if (!chosen?.code) throw new Error(`Variant ${chosen?.letter ?? picked + 1} has no code`)

  const fields = (slot: VariantSlot, code: string, kind: Version['kind']) => ({
    projectId,
    parentId,
    code,
    params: {},
    source: 'ai' as const,
    kind,
    variantGroupId: groupId,
    message: prompt,
    model: slot.model,
    compileStatus: compileStatusOf(slot),
    renderMs: slot.resultCode === slot.code ? (slot.result?.renderMs ?? null) : null,
    thumbnailBlobId: null,
  })

  const pick = await deps.createVersion(fields(chosen, chosen.code, 'main'))
  for (const [i, slot] of slots.entries()) {
    if (i !== picked && slot.code !== null) await deps.createVersion(fields(slot, slot.code, 'variant'))
  }
  await deps.setHead(projectId, pick.id)
  await deps.openProject(projectId)
  return pick
}
```

`src/variants/variantStore.ts`:

```ts
import { create } from 'zustand'
import { runTurn } from '../ai/runTurn'
import { errorMessage } from '../render/result'
import { getRenderQueue } from '../render/sharedQueue'
import { commitPick } from './commitPick'
import { recordUsage } from './recordUsage'
import { runVariants } from './runVariants'
import { variantTemperatures } from './temperatures'
import { initialSlots, type VariantRequest, type VariantSlot } from './types'

export const VARIANT_COUNT = 3

interface VariantData {
  open: boolean
  groupId: string | null
  request: VariantRequest | null
  slots: VariantSlot[]
  selected: number | null
  picking: boolean
  error: string | null
}

interface VariantState extends VariantData {
  start(req: VariantRequest): void
  regenerate(): void
  discard(): void
  select(index: number): void
  pick(): Promise<void>
}

const CLOSED: VariantData = { open: false, groupId: null, request: null, slots: [], selected: null, picking: false, error: null }

let controller: AbortController | null = null

export const useVariantStore = create<VariantState>()((set, get) => ({
  ...CLOSED,

  start: (req) => {
    controller?.abort()
    const run = new AbortController()
    controller = run
    const slots = initialSlots(req.model, variantTemperatures(req.profile.adapter, VARIANT_COUNT))
    set({ open: true, groupId: crypto.randomUUID(), request: req, slots, selected: null, picking: false, error: null })
    void runVariants(
      req,
      slots,
      {
        signal: run.signal,
        onSlot: (i, patch) => {
          if (controller !== run) return
          set((s) => {
            const next = s.slots.slice()
            next[i] = { ...next[i], ...patch }
            return { slots: next, selected: s.selected ?? (patch.status === 'ok' ? i : null) }
          })
        },
      },
      { queue: getRenderQueue(), runTurn, recordUsage },
    )
  },

  regenerate: () => {
    const { request } = get()
    if (request) get().start(request)
  },

  discard: () => {
    controller?.abort()
    controller = null
    set(CLOSED)
  },

  select: (index) => set({ selected: index }),

  pick: async () => {
    const { request, slots, selected, groupId } = get()
    if (!request || !groupId || selected === null || slots[selected]?.status !== 'ok') return
    set({ picking: true, error: null })
    // Stop the others; whatever code they have is still stored as a variant.
    controller?.abort()
    controller = null
    try {
      await commitPick({ projectId: request.projectId, parentId: request.parentId, groupId, prompt: request.userText, slots, picked: selected })
      set(CLOSED)
    } catch (e) {
      set({ picking: false, error: `Could not save the variants: ${errorMessage(e)}` })
    }
  },
}))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/variants src/history/setHead.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/variants src/history/setHead.ts src/history/setHead.test.ts
git commit -m "feat(variants): three parallel turns in the background queue, usage per reply, saving the pick

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Variant picker and the composer's variant count

**Files:**
- Create: `src/variants/describeSlot.ts`, `src/variants/VariantPreview.tsx`, `src/variants/VariantPicker.tsx`, `src/variants/VariantCountButton.tsx`, `src/variants/VariantProgressPill.tsx`
- Modify: `src/ui/icons.ts`, `src/app/GlobalOverlays.tsx`, `src/App.tsx`, `src/chat/Composer.tsx` (M2)
- Test: `src/variants/describeSlot.test.ts`, `src/variants/VariantPicker.test.tsx`, `src/variants/variantControls.test.tsx`

**Interfaces:**
- Consumes: `useVariantStore`, `VariantSlot`, `initialSlots` (Task 12); `parseCustomizer` (M3); `formatDims` (M1); `describeStatus` (M1); `formatCost` (M2); `computeCameraFit`, `meshToGeometry`, `useTokens` (M1); `Modal` (Task 9); `usePrefs` (Task 1).
- Produces:
  - `type SlotTone = 'busy' | 'ok' | 'warn' | 'error' | 'neutral'`; `interface SlotView { tone; label; detail }`; `isRenderingNow(slot, all)`; `describeSlot(slot, all, maxFixAttempts): SlotView`; `variantProgressLabel(slots): string | null`
  - `<VariantPreview mesh label />` (small orbitable canvas), `<VariantPicker />` ("Pick a variant"), `<VariantCountButton />` ("Variants per prompt", 1 ↔ 3), `<VariantProgressPill />` (header "Rendering 2 of 3")

The picker shows what `useVariantStore` holds and calls its actions; saving the pick is Task 12's `commitPick`.

- [ ] **Step 1: Write the failing tests**

`src/variants/describeSlot.test.ts`:

```ts
import { errorResult, okResult } from '../test/results'
import { describeSlot, variantProgressLabel } from './describeSlot'
import { initialSlots, type VariantSlot } from './types'

const [a, b, c] = initialSlots('fake-model', [undefined, 0.7, 1.0])
const code = 'w = 20; // [5:1:100]\nh = 10; // [2:1:50]\ncube([w, w, h]);'
const withWarning = () => {
  const r = okResult()
  return { ...r, diagnostics: [{ line: 2, severity: 'warning' as const, message: "Ignoring unknown variable 'x'" }] }
}

it('names every state with a word, as status pills must', () => {
  expect(describeSlot(a, [a, b, c], 2)).toEqual({ tone: 'busy', label: 'Generating…', detail: 'waiting for the model' })

  const first: VariantSlot = { ...a, status: 'queued', renderSeq: 1 }
  const second: VariantSlot = { ...b, status: 'queued', renderSeq: 2 }
  expect(describeSlot(first, [first, second, c], 2)).toEqual({ tone: 'busy', label: 'Rendering…', detail: 'compiling in the background' })
  expect(describeSlot(second, [first, second, c], 2)).toEqual({ tone: 'neutral', label: 'Queued', detail: 'waiting for the renderer' })

  expect(describeSlot({ ...a, status: 'fixing', fixAttempt: 1 }, [a], 2)).toMatchObject({ tone: 'busy', label: 'Auto-fix 1 of 2' })
  expect(describeSlot({ ...a, status: 'ok', code, result: okResult(), resultCode: code }, [a], 2)).toEqual({
    tone: 'ok',
    label: 'Rendered',
    detail: '20 × 20 × 10 mm · 2 params',
  })
  expect(describeSlot({ ...a, status: 'ok', code, result: withWarning(), resultCode: code }, [a], 2)).toMatchObject({
    tone: 'warn',
    label: '1 warning',
  })
  expect(describeSlot({ ...a, status: 'error', code: 'x', result: errorResult(), resultCode: 'x' }, [a], 2)).toEqual({
    tone: 'error',
    label: 'Failed · line 1',
    detail: 'did not compile',
  })
  expect(describeSlot({ ...a, status: 'no-code' }, [a], 2)).toEqual({ tone: 'warn', label: 'No code', detail: 'the reply had no OpenSCAD code' })
  expect(
    describeSlot({ ...a, status: 'failed-request', error: { title: 'The provider rejected the API key', body: '…' } }, [a], 2),
  ).toEqual({ tone: 'error', label: 'Request failed', detail: 'The provider rejected the API key' })
  expect(describeSlot({ ...a, status: 'cancelled' }, [a], 2)).toEqual({ tone: 'neutral', label: 'Stopped', detail: 'cancelled' })
})

it('counts progress for the header pill', () => {
  const done: VariantSlot = { ...a, status: 'ok' }
  const queued: VariantSlot = { ...b, status: 'queued', renderSeq: 1 }
  expect(variantProgressLabel([a, b, c])).toBe('Generating 3 variants')
  expect(variantProgressLabel([done, done, queued])).toBe('Rendering 3 of 3')
  expect(variantProgressLabel([done, queued, { ...c, status: 'fixing' }])).toBe('Rendering 2 of 3')
  expect(variantProgressLabel([done, done, { ...c, status: 'error' }])).toBeNull()
})
```

`src/variants/VariantPicker.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LlmProvider } from '../ai/types'
import type { ProviderProfile } from '../db/db'
import { errorResult, okResult } from '../test/results'
import { initialSlots, type VariantRequest, type VariantSlot } from './types'
import { VariantPicker } from './VariantPicker'
import { useVariantStore } from './variantStore'

vi.mock('./VariantPreview', () => ({
  VariantPreview: ({ label }: { label: string }) => <div data-testid="variant-preview">{label}</div>,
}))

const request: VariantRequest = {
  provider: {} as LlmProvider,
  profile: { id: 'p', adapter: 'openai-compatible', baseUrl: 'https://fake-llm.test/v1' } as ProviderProfile,
  model: 'fake-model',
  history: [],
  userText: 'A hook for a 30 mm broom handle',
  ctx: { code: '' },
  maxFixAttempts: 2,
  projectId: 'project-1',
  parentId: null,
}

function seed(overrides: Partial<VariantSlot>[], selected: number | null = null) {
  const base = initialSlots('fake-model', [undefined, 0.7, 1.0])
  const slots = base.map((s, i) => ({ ...s, ...overrides[i] }))
  const actions = { pick: vi.fn(async () => {}), discard: vi.fn(), regenerate: vi.fn() }
  useVariantStore.setState({ open: true, groupId: 'g', request, slots, selected, picking: false, error: null, ...actions })
  return actions
}

const usage = { inputTokens: 1_000, outputTokens: 500, cost: 0.002 }

it('shows three cards with preview, status, size, parameters and cost, as in the Variants screen', () => {
  seed([
    { status: 'ok', code: 'cube(1);', result: okResult(), resultCode: 'cube(1);', usage },
    { status: 'queued', renderSeq: 1, code: 'cube(2);', usage },
    { status: 'queued', renderSeq: 2, code: 'cube(3);' },
  ])
  render(<VariantPicker />)
  const dialog = screen.getByRole('dialog', { name: 'Pick a variant' })
  expect(dialog).toHaveTextContent('“A hook for a 30 mm broom handle” Sent 3 times at once to fake-model.')

  const [a, b, c] = within(dialog).getAllByRole('option')
  expect(a).toHaveClass('pc-variant')
  expect(within(a).getByTestId('variant-preview')).toHaveTextContent('Variant A')
  expect(a).toHaveTextContent('A · fake-model')
  expect(within(a).getByText('Rendered')).toHaveClass('pc-status', 'is-ok')
  expect(a).toHaveTextContent('20 × 20 × 10 mm · 0 params')
  expect(a).toHaveTextContent('$0.002')
  expect(within(b).getAllByText('Rendering…')[0].closest('.pc-status')).toHaveClass('is-busy')
  expect(within(c).getAllByText('Queued')).not.toHaveLength(0)
  expect(c).toHaveTextContent('waiting for the renderer')
  expect(c).toHaveTextContent('$0.000')
  expect(dialog.querySelectorAll('svg.pc-i').length).toBeGreaterThanOrEqual(6)
  expect(dialog).toHaveTextContent("Drag to orbit any preview. The ones you don't pick stay in history as variants.")
})

it('uses only a rendered variant and marks failed ones', async () => {
  const actions = seed([
    { status: 'error', code: 'x', result: errorResult(), resultCode: 'x' },
    { status: 'ok', code: 'cube(2);', result: okResult(), resultCode: 'cube(2);' },
    { status: 'failed-request', error: { title: 'The provider rejected the API key', body: '' } },
  ])
  render(<VariantPicker />)
  const [a, b, c] = screen.getAllByRole('option')
  expect(a).toHaveClass('is-failed')
  expect(c).toHaveClass('is-failed')
  const use = screen.getByRole('button', { name: 'Use variant' })
  expect(use).toBeDisabled()

  await userEvent.click(a)
  expect(a).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('button', { name: 'Use variant A' })).toBeDisabled()

  await userEvent.click(b)
  const useB = screen.getByRole('button', { name: 'Use variant B' })
  expect(useB).toBeEnabled()
  expect(useB).toHaveClass('is-primary')
  expect(document.querySelectorAll('[role="dialog"] .pc-btn.is-primary')).toHaveLength(1)
  await userEvent.click(useB)
  expect(actions.pick).toHaveBeenCalledOnce()
})

it('selects a card from the keyboard', async () => {
  seed([{}, { status: 'ok', code: 'c', result: okResult(), resultCode: 'c' }, {}])
  render(<VariantPicker />)
  screen.getAllByRole('option')[1].focus()
  await userEvent.keyboard('{Enter}')
  expect(useVariantStore.getState().selected).toBe(1)
})

it('discards, regenerates, and treats Esc as discard', async () => {
  const actions = seed([{}, {}, {}])
  render(<VariantPicker />)
  await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
  expect(actions.regenerate).toHaveBeenCalledOnce()
  await userEvent.click(screen.getByRole('button', { name: 'Discard all' }))
  await userEvent.keyboard('{Escape}')
  expect(actions.discard).toHaveBeenCalledTimes(2)
})

it('shows why saving failed', () => {
  seed([{}, {}, {}])
  useVariantStore.setState({ error: 'Could not save the variants: No project is open' })
  render(<VariantPicker />)
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save the variants: No project is open')
})
```

`src/variants/variantControls.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePrefs } from '../settings/prefsStore'
import { initialSlots } from './types'
import { VariantCountButton } from './VariantCountButton'
import { VariantProgressPill } from './VariantProgressPill'
import { useVariantStore } from './variantStore'

beforeEach(() => usePrefs.setState(usePrefs.getInitialState(), true))

it('toggles between one reply and three variants per prompt', async () => {
  const update = vi.fn(async () => {})
  usePrefs.setState({ update })
  const { rerender } = render(<VariantCountButton />)
  const button = screen.getByRole('button', { name: 'Variants per prompt' })
  expect(button).toHaveTextContent('1')
  expect(button).toHaveAttribute('aria-pressed', 'false')
  await userEvent.click(button)
  expect(update).toHaveBeenCalledWith({ variantCount: 3 })

  usePrefs.setState({ variantCount: 3 })
  rerender(<VariantCountButton />)
  expect(button).toHaveTextContent('3')
  expect(button).toHaveAttribute('title', '3 variants per prompt')
})

it('shows variant progress in the header only while the picker works', () => {
  useVariantStore.setState({ open: false, slots: [] })
  const { container, rerender } = render(<VariantProgressPill />)
  expect(container).toBeEmptyDOMElement()
  useVariantStore.setState({ open: true, slots: initialSlots('m', [undefined, 0.7, 1]) })
  rerender(<VariantProgressPill />)
  expect(screen.getByRole('status')).toHaveTextContent('Generating 3 variants')
  expect(screen.getByRole('status')).toHaveClass('pc-status', 'is-busy')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/variants`
Expected: FAIL: `./describeSlot`, `./VariantPicker`, `./VariantCountButton`, `./VariantProgressPill` cannot be resolved.

- [ ] **Step 3: Implement**

`src/variants/describeSlot.ts`:

```ts
import { formatDims } from '../render/dims'
import { parseCustomizer } from '../scad/customizer'
import { describeStatus } from '../ui/StatusPill'
import type { VariantSlot } from './types'

export type SlotTone = 'busy' | 'ok' | 'warn' | 'error' | 'neutral'

export interface SlotView {
  tone: SlotTone
  label: string
  detail: string
}

function paramsLabel(code: string | null): string {
  const n = code ? parseCustomizer(code).length : 0
  return `${n} param${n === 1 ? '' : 's'}`
}

/** The queue is FIFO, so the queued slot that entered first is the one compiling now. */
export function isRenderingNow(slot: VariantSlot, all: VariantSlot[]): boolean {
  if (slot.status !== 'queued' || slot.renderSeq === null) return false
  const pending = all.flatMap((s) => (s.status === 'queued' && s.renderSeq !== null ? [s.renderSeq] : []))
  return slot.renderSeq === Math.min(...pending)
}

export function describeSlot(slot: VariantSlot, all: VariantSlot[], maxFixAttempts: number): SlotView {
  switch (slot.status) {
    case 'generating':
      return { tone: 'busy', label: 'Generating…', detail: 'waiting for the model' }
    case 'queued':
      return isRenderingNow(slot, all)
        ? { tone: 'busy', label: 'Rendering…', detail: 'compiling in the background' }
        : { tone: 'neutral', label: 'Queued', detail: 'waiting for the renderer' }
    case 'fixing':
      return { tone: 'busy', label: `Auto-fix ${slot.fixAttempt} of ${maxFixAttempts}`, detail: 'sending the errors back' }
    case 'ok': {
      const r = slot.result
      const warnings = r?.diagnostics.filter((d) => d.severity === 'warning').length ?? 0
      const dims = r?.ok ? formatDims(r.mesh.bounds) : 'size unknown'
      return {
        tone: warnings > 0 ? 'warn' : 'ok',
        label: warnings > 0 ? `${warnings} warning${warnings === 1 ? '' : 's'}` : 'Rendered',
        detail: `${dims} · ${paramsLabel(slot.code)}`,
      }
    }
    case 'error': {
      const r = slot.result
      const label = r && !r.ok ? describeStatus('error', r.renderMs, r.error, r.diagnostics).label : 'Failed'
      return { tone: 'error', label, detail: 'did not compile' }
    }
    case 'no-code':
      return { tone: 'warn', label: 'No code', detail: 'the reply had no OpenSCAD code' }
    case 'failed-request':
      return { tone: 'error', label: 'Request failed', detail: slot.error?.title ?? 'the provider returned an error' }
    case 'cancelled':
      return { tone: 'neutral', label: 'Stopped', detail: 'cancelled' }
  }
}

/** Header pill text while the picker works; null once every slot has settled. */
export function variantProgressLabel(slots: VariantSlot[]): string | null {
  const total = slots.length
  if (slots.some((s) => s.status === 'generating')) return `Generating ${total} variants`
  const pending = slots.filter((s) => s.status === 'queued' || s.status === 'fixing').length
  return pending === 0 ? null : `Rendering ${total - pending + 1} of ${total}`
}
```

`src/ui/icons.ts`: add `Layers as IconLayers` and `RefreshCw as IconRefresh` to the export list.

`src/variants/VariantPreview.tsx`:

```tsx
import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Object3D } from 'three'
import type { MeshData } from '../render/types'
import { useTokens } from '../theme/tokens'
import { computeCameraFit } from '../viewer/cameraFit'
import { meshToGeometry } from '../viewer/geometry'

// OpenSCAD is Z-up; set before any camera exists, as the main viewer does.
Object3D.DEFAULT_UP.set(0, 0, 1)

const TOKENS = ['viewport', 'filament'] as const
const ASPECT = 4 / 3

/** Small orbitable preview inside a variant card; renders on demand only. */
export function VariantPreview({ mesh, label }: { mesh: MeshData; label: string }) {
  const t = useTokens(TOKENS)
  const geometry = useMemo(() => meshToGeometry(mesh), [mesh])
  useEffect(() => () => geometry.dispose(), [geometry])
  const fit = useMemo(() => computeCameraFit(mesh.bounds, 45, ASPECT), [mesh])

  return (
    <div className="h-full w-full" role="img" aria-label={label}>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ fov: 45, position: fit.position, near: Math.max(fit.distance / 1000, 0.01), far: fit.distance * 100 }}
      >
        <color attach="background" args={[t.viewport]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[50, -80, 100]} intensity={1.4} />
        <directionalLight position={[-60, 40, -30]} intensity={0.4} />
        <mesh geometry={geometry}>
          <meshStandardMaterial color={t.filament} roughness={0.6} metalness={0.1} />
        </mesh>
        <OrbitControls makeDefault target={fit.target} />
      </Canvas>
    </div>
  )
}
```

`src/variants/VariantPicker.tsx`:

```tsx
import { formatCost } from '../ui/format'
import { IconCheck, IconClock, IconRefresh, IconSpinner, IconWarning, IconX } from '../ui/icons'
import { Modal } from '../ui/Modal'
import { describeSlot, type SlotTone, type SlotView } from './describeSlot'
import type { VariantSlot } from './types'
import { VariantPreview } from './VariantPreview'
import { useVariantStore } from './variantStore'

const ICONS = { busy: IconSpinner, ok: IconCheck, warn: IconWarning, error: IconX, neutral: IconClock } as const

function SlotPill({ tone, label }: { tone: SlotTone; label: string }) {
  const Icon = ICONS[tone]
  return (
    <span className={`pc-status ${tone === 'neutral' ? '' : `is-${tone}`}`.trim()}>
      <Icon className="pc-i" aria-hidden="true" />
      {label}
    </span>
  )
}

function VariantCard({ slot, view, selected, onSelect }: { slot: VariantSlot; view: SlotView; selected: boolean; onSelect(): void }) {
  const mesh = slot.status === 'ok' && slot.result?.ok ? slot.result.mesh : null
  const failed = slot.status === 'error' || slot.status === 'failed-request'
  const spent = slot.usage.inputTokens + slot.usage.outputTokens === 0 ? formatCost(0) : formatCost(slot.usage.cost)
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      className={`pc-variant cursor-pointer ${failed ? 'is-failed' : ''}`.trim()}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <span className="pc-variant-view w-full">
        {mesh ? <VariantPreview key={slot.resultCode ?? ''} mesh={mesh} label={`Variant ${slot.letter}`} /> : <SlotPill tone={view.tone} label={view.label} />}
      </span>
      <span className="pc-variant-meta">
        <span className="min-w-0 truncate font-semibold">
          {slot.letter} · {slot.model}
        </span>
        <SlotPill tone={view.tone} label={view.label} />
      </span>
      <span className="pc-variant-meta pc-caption">
        <span className="pc-mono min-w-0 truncate">{view.detail}</span>
        <span className="pc-mono">{spent}</span>
      </span>
    </div>
  )
}

export function VariantPicker() {
  const open = useVariantStore((s) => s.open)
  const request = useVariantStore((s) => s.request)
  const slots = useVariantStore((s) => s.slots)
  const selected = useVariantStore((s) => s.selected)
  const picking = useVariantStore((s) => s.picking)
  const error = useVariantStore((s) => s.error)
  const select = useVariantStore((s) => s.select)
  const pick = useVariantStore((s) => s.pick)
  const discard = useVariantStore((s) => s.discard)
  const regenerate = useVariantStore((s) => s.regenerate)
  if (!open || !request) return null

  const chosen = selected !== null ? slots[selected] : null
  const canUse = chosen?.status === 'ok' && !picking

  return (
    <Modal
      labelledBy="variants-title"
      onClose={discard}
      closeOnScrim={false}
      className="flex w-full max-w-[1180px] flex-col gap-5 rounded-lg border border-line bg-panel p-6 shadow-pop"
    >
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id="variants-title" className="text-[20px] leading-[26px] font-semibold tracking-[-0.01em]">
            Pick a variant
          </h2>
          <p className="pc-muted">
            “{request.userText}” Sent {slots.length} times at once to {request.model}.
          </p>
        </div>
        <button type="button" className="pc-btn is-icon is-ghost" aria-label="Close" onClick={discard}>
          <IconX className="pc-i" aria-hidden="true" />
        </button>
      </div>

      <div role="listbox" aria-label="Variants" className="grid gap-4 md:grid-cols-3">
        {slots.map((slot, i) => (
          <VariantCard
            key={slot.letter}
            slot={slot}
            view={describeSlot(slot, slots, request.maxFixAttempts)}
            selected={selected === i}
            onSelect={() => select(i)}
          />
        ))}
      </div>

      {error && (
        <p role="alert" className="pc-caption text-error">
          {error}
        </p>
      )}

      <div className="pc-row justify-between">
        <span className="pc-caption">Drag to orbit any preview. The ones you don't pick stay in history as variants.</span>
        <div className="pc-row">
          <button type="button" className="pc-btn is-ghost" onClick={discard}>
            Discard all
          </button>
          <button type="button" className="pc-btn" onClick={regenerate}>
            <IconRefresh className="pc-i" aria-hidden="true" />
            Regenerate
          </button>
          <button type="button" className="pc-btn is-primary" disabled={!canUse} onClick={() => void pick()}>
            {chosen ? `Use variant ${chosen.letter}` : 'Use variant'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
```

`src/variants/VariantCountButton.tsx`:

```tsx
import { usePrefs } from '../settings/prefsStore'
import { IconLayers } from '../ui/icons'

export function VariantCountButton() {
  const count = usePrefs((s) => s.variantCount)
  const update = usePrefs((s) => s.update)
  return (
    <button
      type="button"
      className="pc-btn is-sm is-ghost"
      aria-label="Variants per prompt"
      aria-pressed={count === 3}
      title={count === 3 ? '3 variants per prompt' : '1 reply per prompt'}
      onClick={() => void update({ variantCount: count === 3 ? 1 : 3 })}
    >
      <IconLayers className="pc-i" aria-hidden="true" />
      <span className="pc-mono">{count}</span>
    </button>
  )
}
```

`src/variants/VariantProgressPill.tsx`:

```tsx
import { IconSpinner } from '../ui/icons'
import { variantProgressLabel } from './describeSlot'
import { useVariantStore } from './variantStore'

export function VariantProgressPill() {
  const open = useVariantStore((s) => s.open)
  const slots = useVariantStore((s) => s.slots)
  const label = open ? variantProgressLabel(slots) : null
  if (!label) return null
  return (
    <span role="status" className="pc-status is-busy">
      <IconSpinner className="pc-i" aria-hidden="true" />
      {label}
    </span>
  )
}
```

`src/app/GlobalOverlays.tsx`: import `VariantPicker` and render it first in the fragment:

```tsx
import { VariantPicker } from '../variants/VariantPicker'
// …
  return (
    <>
      <VariantPicker />
      <ExportDialog />
      <ShareNotice />
    </>
  )
```

`src/App.tsx`: render the progress pill right after the `<StatusPill … />` in the desktop header:

```tsx
import { VariantProgressPill } from './variants/VariantProgressPill'
// …
        <VariantProgressPill />
```

`src/chat/Composer.tsx` (M2): add the count button before **Send** in `.pc-composer-bar`, and branch the send handler. With the names from "Integration points" (`draft`, `setDraft`, `profile`, `provider`, `model`, and the `history`, `ctx` and `maxFixAttempts` the handler already builds for `runTurn`):

```tsx
import { useProjectStore } from '../history/projectStore'
import { usePrefs } from '../settings/prefsStore'
import { VariantCountButton } from '../variants/VariantCountButton'
import { useVariantStore } from '../variants/variantStore'

// in the send handler, after history and ctx are built and before runTurn is called:
    if (usePrefs.getState().variantCount === 3) {
      const { project, head } = useProjectStore.getState()
      useVariantStore.getState().start({
        provider,
        profile,
        model,
        history,
        userText: draft,
        ctx,
        maxFixAttempts,
        projectId: project?.id ?? null,
        parentId: head?.id ?? null,
      })
      setDraft('')
      return
    }

// in .pc-composer-bar, between <span className="pc-spacer" /> and the Send button:
          <VariantCountButton />
```

(When M5 adds image parts to the composer, a message with images keeps the single-reply path until `VariantRequest.userText` accepts `ContentPart[]`; see Deferred.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/variants src/App.test.tsx && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/variants src/ui/icons.ts src/app/GlobalOverlays.tsx src/App.tsx src/chat/Composer.tsx
git commit -m "feat(variants): Pick a variant dialog, header progress and composer variant count

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 14: PWA (precache, update prompt, manifest and token-drawn icons)

**Files:**
- Modify: `package.json`, `package-lock.json` (add `vite-plugin-pwa`; `icons` script; `predev`/`prebuild` run it), `.gitignore`, `vite.config.ts`, `src/app/GlobalOverlays.tsx`, `src/ui/icons.ts`
- Create: `build/pwa.ts`, `scripts/gen-icons.ts`, `src/pwa/usePwaUpdate.ts`, `src/pwa/UpdatePrompt.tsx`, `src/test/pwaRegisterStub.ts`
- Test: `build/pwa.test.ts`, `scripts/gen-icons.test.ts`, `src/pwa/UpdatePrompt.test.tsx`

**Interfaces:**
- Consumes: `CSP` (M1 `build/csp.ts`); `design/tokens.json`; `vite-plugin-pwa` 2.0 (`VitePWA`, `VitePWAOptions`, `IconResource`, `virtual:pwa-register/react` → `useRegisterSW`).
- Produces:
  - `MAX_PRECACHE_BYTES = 32 * 1024 * 1024`, `PRECACHE_GLOB = '**/*.{js,css,html,wasm,woff2,zip,png,svg}'`, `ICONS: IconResource[]`
  - `readTokens(path?): TokenFile`, `primaryColor(tokens: TokenFile, name: string): string`
  - `pwaOptions(base: string, tokens?: TokenFile): Partial<VitePWAOptions>`; `pwaHeadPlugin(base: string, tokens?: TokenFile): Plugin`
  - `hexToRgb(hex: string): Rgb`, `renderIcon(spec: IconSpec): Uint8Array`, `encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array`, `ICON_FILES`
  - `usePwaUpdate(): { needRefresh: boolean; reload(): void; dismiss(): void }`; `<UpdatePrompt needRefresh onReload onDismiss />`

The pinned OpenSCAD WASM is 11,000,303 bytes (`public/openscad/openscad.wasm`), over Workbox's 2 MiB default, so the precache limit is raised to 32 MiB, leaving room for a larger pinned build and the library zips (D8). `registerType: 'prompt'` never swaps a running app; `injectRegister: false` because the app imports `virtual:pwa-register/react` itself, so nothing inline enters `index.html` and `script-src 'self'` holds (the service worker is same-origin; `worker-src 'self' blob:` already allows it). `base` follows `BASE_PATH`, so the worker's scope is `/promptcad/` on GitHub Pages. D11: the icon is the filament square (`brand-dot`: 8 px with a 2 px radius in the screens) on `bg`, both from the primary (dark) theme in `design/tokens.json`, rendered by a dependency-free PNG encoder (`node:zlib`). Regular icons draw the square at half the width; the maskable icon at 40 %, inside the 80 % safe circle.

- [ ] **Step 1: Add the dependency and scripts**

Run:

```bash
npm i -D vite-plugin-pwa@^2.0.0
npm pkg set scripts.icons="tsx scripts/gen-icons.ts"
npm pkg set scripts.predev="tsx scripts/fetch-openscad.ts --if-missing && tsx scripts/gen-icons.ts"
npm pkg set scripts.prebuild="tsx scripts/fetch-openscad.ts --if-missing && tsx scripts/gen-icons.ts"
printf 'public/icons/\n' >> .gitignore
```

Expected: `package.json` lists `vite-plugin-pwa` (which brings `workbox-build` and `workbox-window`) under `devDependencies`; `npm run e2e` and the Pages workflow run `prebuild` through `npm run build`, so the icons exist before Vite copies `public/`.

- [ ] **Step 2: Write the failing tests**

`build/pwa.test.ts`:

```ts
// @vitest-environment node
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CSP } from './csp'
import { ICONS, MAX_PRECACHE_BYTES, PRECACHE_GLOB, primaryColor, pwaHeadPlugin, pwaOptions, readTokens } from './pwa'

const WASM = fileURLToPath(new URL('../public/openscad/openscad.wasm', import.meta.url))
const tokens = readTokens()

it('asks before updating and registers from the bundle, never from an inline script', () => {
  const options = pwaOptions('/promptcad/')
  expect(options.registerType).toBe('prompt')
  expect(options.injectRegister).toBe(false)
  expect(options.base).toBe('/promptcad/')
  expect(CSP).toContain("script-src 'self' 'wasm-unsafe-eval'")
  expect(CSP).toContain("worker-src 'self' blob:")
})

it('precaches the shell, fonts, icons, library zips and the OpenSCAD WASM', () => {
  const { workbox } = pwaOptions('/')
  expect(workbox?.globPatterns).toEqual([PRECACHE_GLOB])
  for (const ext of ['js', 'css', 'html', 'wasm', 'woff2', 'zip', 'png', 'svg']) expect(PRECACHE_GLOB).toContain(ext)
  expect(workbox?.maximumFileSizeToCacheInBytes).toBe(MAX_PRECACHE_BYTES)
})

it.skipIf(!existsSync(WASM))('leaves at least twice the pinned WASM size in the precache limit', () => {
  expect(statSync(WASM).size * 2).toBeLessThanOrEqual(MAX_PRECACHE_BYTES)
})

it('is an installable standalone app coloured from the design tokens', () => {
  const { manifest } = pwaOptions('/')
  if (!manifest) throw new Error('manifest missing')
  expect(manifest).toMatchObject({ name: 'PromptCAD', short_name: 'PromptCAD', display: 'standalone', start_url: '.', scope: '.' })
  expect(manifest.background_color).toBe(primaryColor(tokens, 'bg'))
  expect(manifest.theme_color).toBe(primaryColor(tokens, 'panel'))
  expect(manifest.icons).toBe(ICONS)
  expect(ICONS.map((i) => [i.src, i.sizes, i.purpose])).toEqual([
    ['icons/icon-192.png', '192x192', 'any'],
    ['icons/icon-512.png', '512x512', 'any'],
    ['icons/icon-maskable-512.png', '512x512', 'maskable'],
  ])
})

it('adds the iOS touch icon and the theme colour under the base path', () => {
  const transform = pwaHeadPlugin('/promptcad/', tokens).transformIndexHtml as (html: string) => string
  const html = transform('<html><head><title>PromptCAD</title></head><body></body></html>')
  expect(html).toContain('<link rel="apple-touch-icon" href="/promptcad/icons/icon-192.png">')
  expect(html).toContain(`<meta name="theme-color" content="${primaryColor(tokens, 'panel')}">`)
})
```

`scripts/gen-icons.test.ts`:

```ts
// @vitest-environment node
import { crc32, inflateSync } from 'node:zlib'
import { ICONS, primaryColor, readTokens } from '../build/pwa'
import { encodePng, hexToRgb, ICON_FILES, renderIcon, type Rgb } from './gen-icons'

function decodePng(png: Uint8Array) {
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  let offset = 8
  let width = 0
  let height = 0
  const types: string[] = []
  const idat: Uint8Array[] = []
  while (offset < png.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8))
    const data = png.subarray(offset + 8, offset + 8 + length)
    expect(view.getUint32(offset + 8 + length)).toBe(crc32(png.subarray(offset + 4, offset + 8 + length)))
    types.push(type)
    if (type === 'IHDR') {
      const ihdr = new DataView(data.buffer, data.byteOffset, data.byteLength)
      width = ihdr.getUint32(0)
      height = ihdr.getUint32(4)
      expect([data[8], data[9]]).toEqual([8, 6])
    }
    if (type === 'IDAT') idat.push(data)
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = 1 + width * 4
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    expect(raw[y * stride]).toBe(0)
    rgba.set(raw.subarray(y * stride + 1, (y + 1) * stride), y * width * 4)
  }
  return { width, height, rgba, types }
}

const bg: Rgb = [13, 16, 21]
const fg: Rgb = [233, 162, 59]
const pixel = (rgba: Uint8Array, size: number, x: number, y: number) => [...rgba.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)]

it('encodes a valid 8-bit RGBA PNG', () => {
  const png = decodePng(encodePng(4, 2, renderIcon({ size: 4, square: 0.5, background: bg, foreground: fg }).subarray(0, 32)))
  expect(png).toMatchObject({ width: 4, height: 2, types: ['IHDR', 'IDAT', 'IEND'] })
})

it('draws the filament square centred on the ground colour', () => {
  const size = 64
  const { rgba } = decodePng(encodePng(size, size, renderIcon({ size, square: 0.5, background: bg, foreground: fg })))
  expect(pixel(rgba, size, 32, 32)).toEqual([...fg, 255])
  expect(pixel(rgba, size, 2, 2)).toEqual([...bg, 255])
  expect(pixel(rgba, size, 18, 32)).toEqual([...fg, 255])
  expect(pixel(rgba, size, 14, 32)).toEqual([...bg, 255])
})

it('keeps the maskable square inside the 80 % safe circle', () => {
  const size = 100
  const rgba = renderIcon({ size, square: 0.4, background: bg, foreground: fg })
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(rgba, size, x, y)
      if (r !== bg[0] || g !== bg[1] || b !== bg[2]) expect(Math.hypot(x + 0.5 - 50, y + 0.5 - 50)).toBeLessThanOrEqual(40)
    }
  }
})

it('reads #rrggbb colours only, and the tokens are such colours', () => {
  expect(hexToRgb('#e9a23b')).toEqual([233, 162, 59])
  expect(() => hexToRgb('rgb(1, 2, 3)')).toThrow('Expected a #rrggbb colour, got rgb(1, 2, 3)')
  const tokens = readTokens()
  expect(() => hexToRgb(primaryColor(tokens, 'bg'))).not.toThrow()
  expect(() => hexToRgb(primaryColor(tokens, 'filament'))).not.toThrow()
})

it('writes the files the manifest names', () => {
  expect(ICON_FILES.map((f) => `icons/${f.file}`)).toEqual(ICONS.map((i) => i.src))
})
```

`src/pwa/UpdatePrompt.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UpdatePrompt } from './UpdatePrompt'

it('stays hidden until a new version is waiting', () => {
  const { container } = render(<UpdatePrompt needRefresh={false} onReload={() => {}} onDismiss={() => {}} />)
  expect(container).toBeEmptyDOMElement()
})

it('asks before reloading into the new version', async () => {
  const onReload = vi.fn()
  const onDismiss = vi.fn()
  render(<UpdatePrompt needRefresh onReload={onReload} onDismiss={onDismiss} />)
  const prompt = screen.getByRole('status')
  expect(prompt).toHaveClass('pc-callout', 'is-info')
  expect(prompt).toHaveTextContent('New version available')
  expect(prompt).toHaveTextContent('Reload to use it. Your projects stay on this device.')
  expect(prompt.querySelectorAll('.pc-btn.is-primary')).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
  await userEvent.click(screen.getByRole('button', { name: 'Later' }))
  expect(onReload).toHaveBeenCalledOnce()
  expect(onDismiss).toHaveBeenCalledOnce()
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run build/pwa.test.ts scripts/gen-icons.test.ts src/pwa`
Expected: FAIL, because `./pwa`, `./gen-icons` and `./UpdatePrompt` cannot be resolved.

- [ ] **Step 4: Implement**

`build/pwa.ts`:

```ts
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import type { IconResource, VitePWAOptions } from 'vite-plugin-pwa'

/** The pinned OpenSCAD WASM is ~11 MB; Workbox's 2 MiB default would silently leave it out of the offline cache. */
export const MAX_PRECACHE_BYTES = 32 * 1024 * 1024
export const PRECACHE_GLOB = '**/*.{js,css,html,wasm,woff2,zip,png,svg}'

export const ICONS: IconResource[] = [
  { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]

export interface TokenFile {
  color: { themes: { id: string }[]; tokens: { name: string; value: string | Record<string, string> }[] }
}

export function readTokens(path: URL = new URL('../design/tokens.json', import.meta.url)): TokenFile {
  return JSON.parse(readFileSync(path, 'utf8')) as TokenFile
}

/** A colour token's value in the primary (first, dark) theme. */
export function primaryColor(tokens: TokenFile, name: string): string {
  const theme = tokens.color.themes[0]?.id
  const token = tokens.color.tokens.find((t) => t.name === name)
  const value = typeof token?.value === 'string' ? token.value : theme ? token?.value[theme] : undefined
  if (!value) throw new Error(`Colour token "${name}" not found in design/tokens.json`)
  return value
}

export function pwaOptions(base: string, tokens: TokenFile = readTokens()): Partial<VitePWAOptions> {
  return {
    base,
    registerType: 'prompt',
    // The app imports virtual:pwa-register/react itself; nothing inline goes into index.html (CSP).
    injectRegister: false,
    // The PNG glob already covers the icons.
    includeManifestIcons: false,
    manifest: {
      name: 'PromptCAD',
      short_name: 'PromptCAD',
      description: 'Describe a part, get OpenSCAD code, render it in the browser and export STL.',
      display: 'standalone',
      start_url: '.',
      scope: '.',
      background_color: primaryColor(tokens, 'bg'),
      theme_color: primaryColor(tokens, 'panel'),
      icons: ICONS,
    },
    workbox: {
      globPatterns: [PRECACHE_GLOB],
      maximumFileSizeToCacheInBytes: MAX_PRECACHE_BYTES,
      cleanupOutdatedCaches: true,
    },
  }
}

/** iOS reads apple-touch-icon rather than manifest icons; theme-color tints the browser chrome. */
export function pwaHeadPlugin(base: string, tokens: TokenFile = readTokens()): Plugin {
  const panel = primaryColor(tokens, 'panel')
  return {
    name: 'promptcad-pwa-head',
    transformIndexHtml: (html) =>
      html.replace(
        '</head>',
        `  <meta name="theme-color" content="${panel}">\n    <link rel="apple-touch-icon" href="${base}icons/icon-192.png">\n  </head>`,
      ),
  }
}
```

`scripts/gen-icons.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import { primaryColor, readTokens } from '../build/pwa'

export type Rgb = [number, number, number]

export function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new Error(`Expected a #rrggbb colour, got ${hex}`)
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export interface IconSpec {
  size: number
  /** Side of the square as a fraction of the icon. */
  square: number
  background: Rgb
  foreground: Rgb
}

/** The wordmark's filament square (corner radius a quarter of its side) centred on the ground, 4 × 4 supersampled. */
export function renderIcon({ size, square, background, foreground }: IconSpec): Uint8Array {
  const out = new Uint8Array(size * size * 4)
  const side = size * square
  const radius = side * 0.25
  const lo = (size - side) / 2
  const hi = lo + side
  const inside = (x: number, y: number) => {
    if (x < lo || x > hi || y < lo || y > hi) return false
    const cx = Math.min(Math.max(x, lo + radius), hi - radius)
    const cy = Math.min(Math.max(y, lo + radius), hi - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius
  }
  const samples = 4
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) if (inside(x + (sx + 0.5) / samples, y + (sy + 0.5) / samples)) hits++
      }
      const a = hits / (samples * samples)
      const i = (y * size + x) * 4
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(background[c] * (1 - a) + foreground[c] * a)
      out[i + 3] = 255
    }
  }
  return out
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13)
  const header = new DataView(ihdr.buffer)
  header.setUint32(0, width)
  header.setUint32(4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const stride = 1 + width * 4
  const raw = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1) // filter 0
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

export const ICON_FILES = [
  { file: 'icon-192.png', size: 192, square: 0.5 },
  { file: 'icon-512.png', size: 512, square: 0.5 },
  { file: 'icon-maskable-512.png', size: 512, square: 0.4 },
] as const

const OUT_DIR = fileURLToPath(new URL('../public/icons/', import.meta.url))

async function main(): Promise<void> {
  const tokens = readTokens()
  const background = hexToRgb(primaryColor(tokens, 'bg'))
  const foreground = hexToRgb(primaryColor(tokens, 'filament'))
  await mkdir(OUT_DIR, { recursive: true })
  for (const { file, size, square } of ICON_FILES) {
    await writeFile(OUT_DIR + file, encodePng(size, size, renderIcon({ size, square, background, foreground })))
  }
  console.log(`Wrote ${ICON_FILES.length} icons to ${OUT_DIR}`)
}

const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
```

`vite.config.ts` (full file; keep any `test.server.deps.inline` entry Tasks 6 and 8 added):

```ts
/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { cspPlugin } from './build/csp'
import { pwaHeadPlugin, pwaOptions } from './build/pwa'

// Sub-path the app is served from; the Pages workflow sets it (e.g. /promptcad/). Local dev and tests use /.
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), cspPlugin(), pwaHeadPlugin(base), VitePWA(pwaOptions(base))],
  worker: { format: 'es' },
  build: {
    // Never inline fonts as data: URIs; the CSP allows fonts from 'self' only.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', 'build/**/*.test.ts'],
    // The PWA plugin's virtual module only exists in a Vite build or dev server; unit tests use a stand-in.
    alias: { 'virtual:pwa-register/react': fileURLToPath(new URL('./src/test/pwaRegisterStub.ts', import.meta.url)) },
  },
})
```

`src/test/pwaRegisterStub.ts`:

```ts
type Flag = [boolean, (value: boolean) => void]

/** Vitest stand-in for virtual:pwa-register/react: no service worker, no update waiting. */
export function useRegisterSW(): { needRefresh: Flag; offlineReady: Flag; updateServiceWorker(reload?: boolean): Promise<void> } {
  return { needRefresh: [false, () => {}], offlineReady: [false, () => {}], updateServiceWorker: async () => {} }
}
```

`src/pwa/usePwaUpdate.ts`:

```ts
/// <reference types="vite-plugin-pwa/react" />
import { useRegisterSW } from 'virtual:pwa-register/react'

/** Registers the service worker and reports when a new version is waiting; never reloads on its own. */
export function usePwaUpdate(): { needRefresh: boolean; reload(): void; dismiss(): void } {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  return {
    needRefresh,
    reload: () => void updateServiceWorker(true),
    dismiss: () => setNeedRefresh(false),
  }
}
```

`src/ui/icons.ts`: `RefreshCw as IconRefresh` is already exported (Task 13).

`src/pwa/UpdatePrompt.tsx`:

```tsx
import { IconRefresh } from '../ui/icons'

export function UpdatePrompt({ needRefresh, onReload, onDismiss }: { needRefresh: boolean; onReload(): void; onDismiss(): void }) {
  if (!needRefresh) return null
  return (
    <div
      role="status"
      className="pc-callout is-info fixed right-4 bottom-[calc(var(--header-height)+16px)] z-40 max-w-sm shadow-pop md:bottom-4"
    >
      <IconRefresh className="pc-i" aria-hidden="true" />
      <div className="pc-callout-body">
        <strong>New version available</strong>
        Reload to use it. Your projects stay on this device.
        <div className="pc-row mt-2">
          <button type="button" className="pc-btn is-sm is-primary" onClick={onReload}>
            Reload
          </button>
          <button type="button" className="pc-btn is-sm is-ghost" onClick={onDismiss}>
            Later
          </button>
        </div>
      </div>
    </div>
  )
}
```

`src/app/GlobalOverlays.tsx` (full file after this task):

```tsx
import { useEffect } from 'react'
import { ExportDialog } from '../export/ExportDialog'
import { UpdatePrompt } from '../pwa/UpdatePrompt'
import { usePwaUpdate } from '../pwa/usePwaUpdate'
import { usePrefs } from '../settings/prefsStore'
import { listenForShareLinks } from '../share/importShared'
import { ShareNotice } from '../share/ShareNotice'
import { VariantPicker } from '../variants/VariantPicker'

/** One mount point for M4's app-wide overlays (dialogs, notices, update prompt) and its startup work. */
export function GlobalOverlays() {
  const pwa = usePwaUpdate()
  useEffect(() => {
    void usePrefs.getState().load()
  }, [])
  useEffect(() => listenForShareLinks(), [])
  return (
    <>
      <VariantPicker />
      <ExportDialog />
      <ShareNotice />
      <UpdatePrompt needRefresh={pwa.needRefresh} onReload={pwa.reload} onDismiss={pwa.dismiss} />
    </>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run build scripts src/pwa src/app && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Check the production build**

Run: `npm run build && ls dist/icons dist/sw.js dist/manifest.webmanifest && grep -c openscad.wasm dist/sw.js`
Expected: the three icons, `sw.js` and the manifest exist; `sw.js` lists `openscad/openscad.wasm` (count ≥ 1). The build log shows no "will not be precached" warning. `grep -c '<script' dist/index.html` counts only the module entry script (no inline register script).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore vite.config.ts build/pwa.ts build/pwa.test.ts scripts/gen-icons.ts scripts/gen-icons.test.ts src/pwa src/test/pwaRegisterStub.ts src/app/GlobalOverlays.tsx
git commit -m "feat(pwa): offline precache with the OpenSCAD WASM, update prompt, manifest and token icons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Phone layout (Chat / Code / 3D tabs, key row, parameter sheet, paused viewer)

**Files:**
- Create: `src/layout/useIsPhone.ts`, `src/layout/PhoneLayout.tsx`, `src/layout/ParamSheet.tsx`, `src/editor/KeyRow.tsx`
- Modify: `src/state/store.ts`, `src/editor/CodeEditor.tsx`, `src/viewer/Viewer.tsx`, `src/ui/icons.ts`, `src/App.tsx`
- Test: `src/layout/phoneLayout.test.tsx`, `src/editor/KeyRow.test.tsx`, `src/editor/CodeEditor.test.tsx` (extend), `src/state/store.m4.test.ts` (extend), `src/App.test.tsx` (extend)

**Interfaces:**
- Consumes: `useAppStore` `reveal`, `goToLine` (M1); `CodeEditor` (M1, maybe extended by M2/M3); `Viewer` (Tasks 4, 10); `GlobalOverlays` (Task 1); `ChatPanel`, `CustomizerDock`, `ProjectMenu` (Integration points); `useExportStore` (Task 9).
- Produces:
  - `PHONE_QUERY = '(max-width: 767.98px)'`, `useIsPhone(): boolean` (below Tailwind's `md`)
  - `type PhoneTab = 'chat' | 'code' | '3d'`; `<PhoneLayout header chat code keyRow viewer={(paused: boolean) => ReactNode} params overlays? />`
  - `<ParamSheet>{children}</ParamSheet>`: bottom sheet with a grabber button "Parameters"
  - `SYMBOL_KEYS = [';', '{', '}', '(', ')', '[', ']']`, `INDENT = '  '`, `<KeyRow onInsert={(text: string) => void} />`
  - store: `interface InsertRequest { text: string; id: number }`, `insert: InsertRequest | null`, `insertText(text: string): void`
  - `<CodeEditor insert? />` inserts at the cursor and keeps focus
  - `<Viewer paused? />`: `frameloop="never"` while paused, redraw on resume; Fit view is 44 px on coarse pointers

All three panels stay mounted (the editor keeps its undo history and the viewer its camera); hidden ones get the `hidden` attribute. The viewer already renders on demand only; while its tab is hidden it stops entirely (`frameloop="never"`) and redraws once when shown. The key row's buttons cancel `pointerdown`/`mousedown`, so tapping them never moves focus out of CodeMirror and the phone keyboard stays open. A request to reveal a line (status pill or console click) switches to the Code tab.

- [ ] **Step 1: Write the failing tests**

`src/editor/KeyRow.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeyRow } from './KeyRow'

it('offers the symbols from the spec plus Indent', () => {
  render(<KeyRow onInsert={() => {}} />)
  const toolbar = screen.getByRole('toolbar', { name: 'Code symbols' })
  expect([...toolbar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
    ';',
    '{',
    '}',
    '(',
    ')',
    '[',
    ']',
    'Indent',
  ])
})

it('inserts on tap without taking focus from the editor', async () => {
  const onInsert = vi.fn()
  render(<KeyRow onInsert={onInsert} />)
  const semicolon = screen.getByRole('button', { name: ';' })
  expect(fireEvent.pointerDown(semicolon)).toBe(false)
  expect(fireEvent.mouseDown(semicolon)).toBe(false)
  await userEvent.click(semicolon)
  await userEvent.click(screen.getByRole('button', { name: 'Indent' }))
  expect(onInsert.mock.calls).toEqual([[';'], ['  ']])
})
```

Add to `src/editor/CodeEditor.test.tsx` (it already imports `render` and `EditorView`; add them if not):

```tsx
it('inserts key-row text at the cursor and keeps focus in the editor', () => {
  const onChange = vi.fn()
  const { container, rerender } = render(<CodeEditor value="cube(1)" onChange={onChange} diagnostics={[]} />)
  const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!
  view.dispatch({ selection: { anchor: 7 } })
  rerender(<CodeEditor value="cube(1)" onChange={onChange} diagnostics={[]} insert={{ text: ';', id: 1 }} />)
  expect(onChange).toHaveBeenLastCalledWith('cube(1);')
  expect(document.activeElement).toBe(view.contentDOM)
  rerender(<CodeEditor value="cube(1)" onChange={onChange} diagnostics={[]} insert={{ text: ';', id: 1 }} />)
  expect(view.state.doc.toString()).toBe('cube(1);')
})
```

Append to `src/state/store.m4.test.ts`:

```ts
it('queues key-row insertions with fresh ids', () => {
  useAppStore.getState().insertText(';')
  const first = useAppStore.getState().insert
  useAppStore.getState().insertText(';')
  expect(first?.text).toBe(';')
  expect(useAppStore.getState().insert?.id).not.toBe(first?.id)
})
```

`src/layout/phoneLayout.test.tsx`:

```tsx
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAppStore } from '../state/store'
import { ParamSheet } from './ParamSheet'
import { PhoneLayout } from './PhoneLayout'
import { PHONE_QUERY, useIsPhone } from './useIsPhone'

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>()
  const list = {
    matches,
    media: PHONE_QUERY,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }
  window.matchMedia = vi.fn(() => list) as unknown as typeof window.matchMedia
  return {
    set(next: boolean) {
      list.matches = next
      listeners.forEach((l) => l())
    },
  }
}

afterEach(() => Reflect.deleteProperty(window, 'matchMedia'))
beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))

it('follows the md breakpoint', () => {
  const media = mockMatchMedia(false)
  const { result } = renderHook(() => useIsPhone())
  expect(result.current).toBe(false)
  act(() => media.set(true))
  expect(result.current).toBe(true)
  expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 767.98px)')
})

it('is not a phone where matchMedia is missing', () => {
  const { result } = renderHook(() => useIsPhone())
  expect(result.current).toBe(false)
})

function layout() {
  const viewer = vi.fn((paused: boolean) => <div data-testid="viewer-slot" data-paused={String(paused)} />)
  render(
    <PhoneLayout
      header={<header>PromptCAD</header>}
      chat={<textarea aria-label="Prompt" />}
      code={<div data-testid="code-slot" />}
      keyRow={<div role="toolbar" aria-label="Code symbols" />}
      viewer={viewer}
      params={<div data-testid="params-slot" />}
    />,
  )
  return { viewer }
}

it('shows Chat first with the 3D view paused', () => {
  layout()
  const tabs = screen.getByRole('tablist', { name: 'Views' })
  expect(tabs).toHaveClass('pc-tabbar')
  expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeVisible()
  expect(screen.getByTestId('viewer-slot')).not.toBeVisible()
  expect(screen.getByTestId('viewer-slot')).toHaveAttribute('data-paused', 'true')
})

it('switches tabs by tap and by arrow keys, resuming the viewer only on 3D', async () => {
  layout()
  await userEvent.click(screen.getByRole('tab', { name: '3D' }))
  expect(screen.getByTestId('viewer-slot')).toBeVisible()
  expect(screen.getByTestId('viewer-slot')).toHaveAttribute('data-paused', 'false')
  expect(screen.getByRole('textbox', { name: 'Prompt' })).not.toBeVisible()

  await userEvent.keyboard('{ArrowLeft}')
  expect(screen.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tab', { name: 'Code' })).toHaveFocus()
  expect(screen.getByTestId('code-slot')).toBeVisible()
  expect(screen.getByRole('toolbar', { name: 'Code symbols' })).toBeVisible()
  expect(screen.getByTestId('viewer-slot')).toHaveAttribute('data-paused', 'true')
})

it('jumps to Code when something asks to reveal a line', () => {
  layout()
  act(() => useAppStore.getState().goToLine(9))
  expect(screen.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true')
})

it('opens and closes the parameter sheet from its grabber', async () => {
  render(
    <ParamSheet>
      <div data-testid="params" />
    </ParamSheet>,
  )
  const grabber = screen.getByRole('button', { name: 'Parameters' })
  expect(grabber).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByTestId('params')).not.toBeVisible()
  await userEvent.click(grabber)
  expect(grabber).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByTestId('params')).toBeVisible()
})
```

Add to `src/App.test.tsx` (`afterEach(() => Reflect.deleteProperty(window, 'matchMedia'))`):

```tsx
it('uses the Chat / Code / 3D tab layout on a phone', () => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query === '(max-width: 767.98px)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
  render(<App createWorker={scriptedWorker(() => okResult())} />)
  expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
  expect(screen.getByRole('toolbar', { name: 'Code symbols' })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/editor src/layout src/state/store.m4.test.ts src/App.test.tsx`
Expected: FAIL: `./KeyRow`, `./PhoneLayout`, `./ParamSheet`, `./useIsPhone` cannot be resolved; `insertText` is not a function; the editor ignores `insert`.

- [ ] **Step 3: Implement**

`src/state/store.ts`: add the type, state, action and counter:

```ts
export interface InsertRequest {
  text: string
  id: number
}

// in AppState
  /** Text the phone key row asks the editor to insert at the cursor. */
  insert: InsertRequest | null
  insertText(text: string): void

// next to `let revealId = 0`
let insertId = 0

// in create()
  insert: null,
  insertText: (text) => set({ insert: { text, id: ++insertId } }),
```

`src/editor/CodeEditor.tsx`: add the prop and an effect next to the reveal effect:

```tsx
import type { InsertRequest, RevealRequest } from '../state/store'

interface Props {
  value: string
  onChange(code: string): void
  diagnostics: Diagnostic[]
  reveal?: RevealRequest | null
  /** From the phone key row; each new id inserts once at the cursor. */
  insert?: InsertRequest | null
}

export function CodeEditor({ value, onChange, diagnostics, reveal = null, insert = null }: Props) {
  // … existing refs and effects …

  // Keyed on the id, so re-rendering with an equal request never inserts twice.
  const insertId = insert?.id
  useEffect(() => {
    const view = viewRef.current
    if (!view || !insert) return
    view.dispatch({ ...view.state.replaceSelection(insert.text), scrollIntoView: true, userEvent: 'input.type' })
    view.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertId])

  // … return unchanged
}
```

(Keep any props M2/M3 added to `Props`.)

`src/editor/KeyRow.tsx`:

```tsx
import type { MouseEvent, PointerEvent } from 'react'

export const SYMBOL_KEYS = [';', '{', '}', '(', ')', '[', ']'] as const
export const INDENT = '  '

const KEY = 'h-10 min-w-0 flex-1 rounded-sm border border-line bg-panel font-mono text-[15px] font-medium text-ink'

/** Cancelling the press keeps focus (and the phone keyboard) in the editor. */
const keepFocus = (e: PointerEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>) => e.preventDefault()

export function KeyRow({ onInsert }: { onInsert(text: string): void }) {
  return (
    <div role="toolbar" aria-label="Code symbols" className="flex shrink-0 gap-1 border-t border-line bg-panel-raised px-2 py-1">
      {SYMBOL_KEYS.map((key) => (
        <button key={key} type="button" className={KEY} onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={() => onInsert(key)}>
          {key}
        </button>
      ))}
      <button type="button" aria-label="Indent" className={KEY} onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={() => onInsert(INDENT)}>
        ⇥
      </button>
    </div>
  )
}
```

`src/layout/useIsPhone.ts`:

```ts
import { useSyncExternalStore } from 'react'

/** Below Tailwind's md breakpoint (48rem). */
export const PHONE_QUERY = '(max-width: 767.98px)'

function query(): MediaQueryList | null {
  return typeof matchMedia === 'function' ? matchMedia(PHONE_QUERY) : null
}

function subscribe(onChange: () => void): () => void {
  const list = query()
  list?.addEventListener('change', onChange)
  return () => list?.removeEventListener('change', onChange)
}

export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, () => query()?.matches ?? false, () => false)
}
```

`src/layout/ParamSheet.tsx`:

```tsx
import { useState, type ReactNode } from 'react'

/** Bottom sheet over the 3D tab; the grabber row toggles it. */
export function ParamSheet({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative -mt-3 flex max-h-[60%] shrink-0 flex-col rounded-t-lg border-t border-line bg-panel-raised px-4 pb-4 shadow-pop">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="param-sheet-body"
        className="flex min-h-(--touch-target) flex-col items-center justify-center gap-1 pt-2 font-semibold text-ink"
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true" className="h-1 w-9 rounded-pill bg-line-strong" />
        Parameters
      </button>
      <div id="param-sheet-body" hidden={!open} className="min-h-0 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}
```

`src/ui/icons.ts`: add `Box as IconBox`, `Code as IconCode` and `MessageSquare as IconChat` to the export list.

`src/layout/PhoneLayout.tsx`:

```tsx
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { useAppStore } from '../state/store'
import { IconBox, IconChat, IconCode } from '../ui/icons'
import { ParamSheet } from './ParamSheet'

export type PhoneTab = 'chat' | 'code' | '3d'

const TABS: Array<{ id: PhoneTab; label: string; Icon: typeof IconChat }> = [
  { id: 'chat', label: 'Chat', Icon: IconChat },
  { id: 'code', label: 'Code', Icon: IconCode },
  { id: '3d', label: '3D', Icon: IconBox },
]

interface Props {
  header: ReactNode
  chat: ReactNode
  code: ReactNode
  keyRow: ReactNode
  /** Rendered once and kept mounted; `paused` is true while the 3D tab is hidden. */
  viewer(paused: boolean): ReactNode
  params: ReactNode | null
  overlays?: ReactNode
}

export function PhoneLayout({ header, chat, code, keyRow, viewer, params, overlays }: Props) {
  const [tab, setTab] = useState<PhoneTab>('chat')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const reveal = useAppStore((s) => s.reveal)

  useEffect(() => {
    if (reveal) setTab('code')
  }, [reveal])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    const i = TABS.findIndex((t) => t.id === tab)
    const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : -1
    if (next < 0) return
    e.preventDefault()
    setTab(TABS[next].id)
    tabRefs.current[next]?.focus()
  }

  const panel = (id: PhoneTab) => ({
    id: `phone-panel-${id}`,
    role: 'tabpanel' as const,
    'aria-labelledby': `phone-tab-${id}`,
    hidden: tab !== id,
    className: 'flex h-full min-h-0 flex-col',
  })

  return (
    <div className="pc-root flex h-full flex-col bg-bg text-ink">
      {header}
      <div className="relative min-h-0 flex-1 bg-panel">
        <section {...panel('chat')}>{chat}</section>
        <section {...panel('code')}>
          <div className="min-h-0 flex-1">{code}</div>
          {keyRow}
        </section>
        <section {...panel('3d')}>
          <div className="min-h-0 flex-1">{viewer(tab !== '3d')}</div>
          {params && <ParamSheet>{params}</ParamSheet>}
        </section>
      </div>
      <nav role="tablist" aria-label="Views" className="pc-tabbar box-content shrink-0 pb-[env(safe-area-inset-bottom)]" onKeyDown={onKeyDown}>
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`phone-tab-${t.id}`}
            aria-controls={`phone-panel-${t.id}`}
            aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1}
            className="pc-tab"
            onClick={() => setTab(t.id)}
          >
            <t.Icon className="pc-i" aria-hidden="true" />
            {t.label}
          </button>
        ))}
      </nav>
      {overlays}
    </div>
  )
}
```

`src/viewer/Viewer.tsx`: add the `paused` prop, a resume helper inside the canvas, and the coarse-pointer size on Fit view:

```tsx
/** Redraws once when the hidden 3D tab is shown again. */
function ResumeOnShow({ paused }: { paused: boolean }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    if (!paused) invalidate()
  }, [paused, invalidate])
  return null
}

export function Viewer({
  mesh,
  stale,
  previewing = false,
  paused = false,
}: {
  mesh: MeshData | null
  stale: boolean
  previewing?: boolean
  paused?: boolean
}) {
  // …
      <Canvas frameloop={paused ? 'never' : 'demand'} dpr={[1, 2]} camera={{ fov: 45, near: 0.1, far: 10_000, position: [60, -80, 60] }}>
        {/* … existing children … */}
        <ResumeOnShow paused={paused} />
      </Canvas>
  // Fit view button className gains pointer-coarse:size-(--touch-target):
          className="grid size-(--control-sm) place-items-center rounded-sm border border-line bg-panel text-ink-muted hover:text-ink disabled:text-ink-disabled pointer-coarse:size-(--touch-target)"
```

`src/App.tsx`: choose the layout. Build the editor element once (keeping the props M2/M3 pass to `CodeEditor`) and add `insert`:

```tsx
import { KeyRow } from './editor/KeyRow'
import { PhoneLayout } from './layout/PhoneLayout'
import { useIsPhone } from './layout/useIsPhone'
import { IconDownload } from './ui/icons'
// ChatPanel, CustomizerDock, ProjectMenu: the M2/M3 components (see Integration points)

// inside App, with the other selectors:
  const isPhone = useIsPhone()
  const insert = useAppStore((s) => s.insert)
  const insertText = useAppStore((s) => s.insertText)
  const editor = <CodeEditor value={code} onChange={setCode} diagnostics={diagnostics} reveal={reveal} insert={insert} />

  if (isPhone) {
    return (
      <PhoneLayout
        header={
          <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b border-line bg-panel pr-2 pl-4">
            <ProjectMenu />
            <span className="flex-1" />
            <StatusPill status={status} renderMs={renderMs} error={error} diagnostics={diagnostics} onGoToLine={goToLine} loadProgress={loadProgress} />
            <button type="button" className="pc-btn is-icon is-ghost" aria-label="Export" onClick={() => useExportStore.getState().openAt('model')}>
              <IconDownload className="pc-i" aria-hidden="true" />
            </button>
          </header>
        }
        chat={<ChatPanel />}
        code={editor}
        keyRow={<KeyRow onInsert={insertText} />}
        viewer={(paused) => <Viewer mesh={displayMesh} stale={stale} previewing={previewing} paused={paused} />}
        params={<CustomizerDock />}
        overlays={<GlobalOverlays />}
      />
    )
  }
  // … the desktop return, with {editor} in place of the inline <CodeEditor … /> element
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/editor src/layout src/state src/App.test.tsx && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Check on a phone-sized viewport**

Run: `npm run dev`; open devtools device mode (Pixel 7).
Expected, against PhoneChat, PhoneCode and Phone3D: the header shows the project button, the status pill and an Export icon; the tab bar sits at the bottom with Chat selected (accent top border); Code shows the editor with the key row; tapping `;` inserts at the cursor and the editor keeps focus; 3D shows the model with a 44 px Fit view button and the "Parameters" sheet, which opens to the Customizer controls; switching away from 3D and back keeps the camera. A compile error's pill click on Chat jumps to Code.

- [ ] **Step 6: Commit**

```bash
git add src/layout src/editor src/state src/viewer/Viewer.tsx src/ui/icons.ts src/App.tsx src/App.test.tsx
git commit -m "feat(mobile): Chat / Code / 3D tab layout with symbol key row, parameter sheet and paused viewer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Voice prompts (Web Speech dictation, recorder fallback)

**Files:**
- Create: `src/voice/support.ts`, `src/voice/transcribe.ts`, `src/voice/useDictation.ts`, `src/voice/voiceStore.ts`, `src/voice/MicButton.tsx`, `src/voice/DictationCaption.tsx`, `src/settings/TranscriptionModelField.tsx`
- Modify: `src/ui/icons.ts`, `src/chat/Composer.tsx` (M2), the M2 providers page (Audio capability switch)
- Test: `src/voice/support.test.ts`, `src/voice/transcribe.test.ts`, `src/voice/useDictation.test.tsx`, `src/voice/voiceControls.test.tsx`, `src/settings/settingsControls.test.tsx` (extend)

**Interfaces:**
- Consumes: `ProviderProfile` (M2; `capabilities.audio`, `adapter`, `baseUrl`, `apiKey`, `keyEncrypted`); `usePrefs` (`transcriptionModel`) (Task 1); `errorMessage` (M1); `isAbortError` (Task 2).
- Produces:
  - `SpeechRecognitionLike`, `SpeechRecognitionCtor`, `getSpeechRecognition(win?: object): SpeechRecognitionCtor | null`
  - `type MicMode = 'speech' | 'record' | null`; `micMode({ speech: boolean; recorder: boolean; profile: ProviderProfile | null }): MicMode`
  - `joinDraft(base: string, spoken: string): string`; `speechErrorMessage(code: string): string`
  - `interface TranscribeConfig { baseUrl: string; apiKey: string; model: string }`; `transcribe(audio: Blob, config: TranscribeConfig, signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<string>`
  - `type DictationPhase = 'idle' | 'listening' | 'transcribing' | 'error'`; `interface DictationState { phase; message: string | null }`
  - `useDictation(opts: { mode: MicMode; onText(text: string, final: boolean): void; transcribeWith(): TranscribeConfig | null; lang?: string }): { state: DictationState; toggle(): void }`
  - `useComposerDictation(opts: { value: string; onChange(v: string): void; profile: ProviderProfile | null }): { mode: MicMode; state: DictationState; toggle(): void }`
  - `useVoiceStore` (`transcript`, `setTranscript`, `takeTranscript()`)
  - `<MicButton listening busy onToggle />`, `<DictationCaption state mode />`, `<TranscriptionModelField />`

Web Speech (standard `SpeechRecognition` or Chrome's `webkitSpeechRecognition`) runs continuous with interim results: each result event rewrites the composer as the draft from before the mic was tapped plus everything heard so far, so the text stays editable before sending. Without Web Speech, the mic records with `MediaRecorder` and posts the audio to the profile's OpenAI-compatible `POST {baseUrl}/audio/transcriptions` (multipart `file` + `model`, `Authorization: Bearer <key>`), only when the profile is OpenAI-compatible with `capabilities.audio` on and its key is not locked; otherwise the mic is hidden. The transcript of a sent message is kept for `StoredMessage.audioTranscript`.

- [ ] **Step 1: Write the failing tests**

`src/voice/support.test.ts`:

```ts
import type { ProviderProfile } from '../db/db'
import { getSpeechRecognition, joinDraft, micMode, speechErrorMessage, type SpeechRecognitionCtor } from './support'

const profile = (over: Partial<ProviderProfile> = {}) =>
  ({
    adapter: 'openai-compatible',
    capabilities: { streaming: true, vision: false, audio: true },
    keyEncrypted: false,
    ...over,
  }) as ProviderProfile

it('prefers the standard SpeechRecognition and falls back to the webkit one', () => {
  const Standard = class {} as unknown as SpeechRecognitionCtor
  const Webkit = class {} as unknown as SpeechRecognitionCtor
  expect(getSpeechRecognition({ SpeechRecognition: Standard, webkitSpeechRecognition: Webkit })).toBe(Standard)
  expect(getSpeechRecognition({ webkitSpeechRecognition: Webkit })).toBe(Webkit)
  expect(getSpeechRecognition({})).toBeNull()
})

it('uses dictation where it exists, recording only for an audio-capable OpenAI-compatible profile, and hides the mic otherwise', () => {
  expect(micMode({ speech: true, recorder: true, profile: null })).toBe('speech')
  expect(micMode({ speech: false, recorder: true, profile: profile() })).toBe('record')
  expect(micMode({ speech: false, recorder: true, profile: profile({ capabilities: { streaming: true, vision: false, audio: false } }) })).toBeNull()
  expect(micMode({ speech: false, recorder: true, profile: profile({ adapter: 'anthropic' }) })).toBeNull()
  expect(micMode({ speech: false, recorder: true, profile: profile({ keyEncrypted: true }) })).toBeNull()
  expect(micMode({ speech: false, recorder: false, profile: profile() })).toBeNull()
  expect(micMode({ speech: false, recorder: true, profile: null })).toBeNull()
})

it('appends spoken text to the draft with one space', () => {
  expect(joinDraft('', ' make it five slots ')).toBe('make it five slots')
  expect(joinDraft('Walls 2.4 mm.  ', 'And a lid')).toBe('Walls 2.4 mm. And a lid')
  expect(joinDraft('Keep this', '')).toBe('Keep this')
})

it('explains recognition errors in plain words', () => {
  expect(speechErrorMessage('not-allowed')).toBe("Microphone access was blocked. Allow it in the browser's site settings, then tap the mic again.")
  expect(speechErrorMessage('no-speech')).toBe('No speech was heard. Tap the mic and try again.')
  expect(speechErrorMessage('network')).toBe('Speech recognition needs a network connection.')
  expect(speechErrorMessage('bad-grammar')).toBe('Speech recognition stopped: bad-grammar.')
})
```

`src/voice/transcribe.test.ts`:

```ts
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
```

`src/voice/useDictation.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react'
import type { ProviderProfile } from '../db/db'
import { usePrefs } from '../settings/prefsStore'
import type { SpeechRecognitionLike, SpeechResultEventLike } from './support'
import { transcribe } from './transcribe'
import { useComposerDictation, useDictation } from './useDictation'
import { useVoiceStore } from './voiceStore'

vi.mock('./transcribe', () => ({ transcribe: vi.fn(async () => 'five slots') }))

class FakeRecognition implements SpeechRecognitionLike {
  static last: FakeRecognition | null = null
  lang = ''
  continuous = false
  interimResults = false
  onresult: SpeechRecognitionLike['onresult'] = null
  onerror: SpeechRecognitionLike['onerror'] = null
  onend: SpeechRecognitionLike['onend'] = null
  start = vi.fn()
  stop = vi.fn(() => this.onend?.())
  abort = vi.fn()
  constructor() {
    FakeRecognition.last = this
  }
}

const event = (...parts: Array<[string, boolean]>): SpeechResultEventLike => ({
  results: parts.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })),
})

afterEach(() => {
  Reflect.deleteProperty(window, 'webkitSpeechRecognition')
  Reflect.deleteProperty(window, 'MediaRecorder')
  Reflect.deleteProperty(navigator, 'mediaDevices')
  useVoiceStore.setState({ transcript: null })
})

it('dictates with interim results until the mic is tapped again', () => {
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true })
  const onText = vi.fn()
  const { result } = renderHook(() => useDictation({ mode: 'speech', onText, transcribeWith: () => null, lang: 'en-GB' }))
  act(() => result.current.toggle())
  const rec = FakeRecognition.last!
  expect(rec).toMatchObject({ continuous: true, interimResults: true, lang: 'en-GB' })
  expect(rec.start).toHaveBeenCalled()
  expect(result.current.state.phase).toBe('listening')

  act(() => rec.onresult?.(event(['make it', false])))
  act(() => rec.onresult?.(event(['make it ', true], ['five slots', false])))
  expect(onText.mock.calls).toEqual([
    ['make it', false],
    ['make it five slots', false],
  ])

  act(() => result.current.toggle())
  expect(rec.stop).toHaveBeenCalled()
  expect(result.current.state).toEqual({ phase: 'idle', message: null })
})

it('reports a blocked microphone', () => {
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true })
  const { result } = renderHook(() => useDictation({ mode: 'speech', onText: () => {}, transcribeWith: () => null }))
  act(() => result.current.toggle())
  act(() => FakeRecognition.last!.onerror?.({ error: 'not-allowed' }))
  expect(result.current.state.phase).toBe('error')
  expect(result.current.state.message).toMatch(/^Microphone access was blocked/)
})

it('records, then transcribes through the provider', async () => {
  const track = { stop: vi.fn() }
  const stream = { getTracks: () => [track] }
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn(async () => stream) }, configurable: true })
  class FakeRecorder {
    mimeType = 'audio/webm'
    ondataavailable: ((e: { data: Blob }) => void) | null = null
    onstop: (() => void) | null = null
    start = vi.fn()
    stop = vi.fn(() => {
      this.ondataavailable?.({ data: new Blob(['audio']) })
      this.onstop?.()
    })
  }
  Object.defineProperty(window, 'MediaRecorder', { value: FakeRecorder, configurable: true })

  const onText = vi.fn()
  const config = { baseUrl: 'https://fake-llm.test/v1', apiKey: 'k', model: 'whisper-1' }
  const { result } = renderHook(() => useDictation({ mode: 'record', onText, transcribeWith: () => config }))
  await act(async () => result.current.toggle())
  expect(result.current.state.phase).toBe('listening')
  await act(async () => result.current.toggle())

  expect(transcribe).toHaveBeenCalledWith(expect.any(Blob), config)
  expect(track.stop).toHaveBeenCalled()
  expect(onText).toHaveBeenCalledWith('five slots', true)
  expect(result.current.state.phase).toBe('idle')
})

it('does nothing without a mic mode', () => {
  const onText = vi.fn()
  const { result } = renderHook(() => useDictation({ mode: null, onText, transcribeWith: () => null }))
  act(() => result.current.toggle())
  expect(result.current.state.phase).toBe('idle')
})

it('writes into the composer after the existing draft and keeps the final transcript', () => {
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true })
  usePrefs.setState({ transcriptionModel: 'whisper-1' })
  const onChange = vi.fn()
  const { result } = renderHook(() => useComposerDictation({ value: 'Walls 2.4 mm.', onChange, profile: null as ProviderProfile | null }))
  expect(result.current.mode).toBe('speech')
  act(() => result.current.toggle())
  act(() => FakeRecognition.last!.onresult?.(event(['and a lid', true])))
  expect(onChange).toHaveBeenLastCalledWith('Walls 2.4 mm. and a lid')
  expect(useVoiceStore.getState().takeTranscript()).toBe('and a lid')
  expect(useVoiceStore.getState().transcript).toBeNull()
})
```

`src/voice/voiceControls.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DictationCaption } from './DictationCaption'
import { MicButton } from './MicButton'

it('is a Dictate button that turns into Stop dictation while listening', async () => {
  const onToggle = vi.fn()
  const { rerender } = render(<MicButton listening={false} busy={false} onToggle={onToggle} />)
  await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
  expect(onToggle).toHaveBeenCalledOnce()

  rerender(<MicButton listening busy={false} onToggle={onToggle} />)
  const stop = screen.getByRole('button', { name: 'Stop dictation' })
  expect(stop).toHaveAttribute('aria-pressed', 'true')
  expect(stop).toHaveClass('bg-accent-soft', 'text-accent')

  rerender(<MicButton listening={false} busy onToggle={onToggle} />)
  expect(screen.getByRole('button', { name: 'Dictate' })).toBeDisabled()
})

it('captions each phase in the screen wording', () => {
  const { rerender, container } = render(<DictationCaption state={{ phase: 'idle', message: null }} mode="speech" />)
  expect(container).toBeEmptyDOMElement()

  rerender(<DictationCaption state={{ phase: 'listening', message: null }} mode="speech" />)
  expect(screen.getByRole('status')).toHaveTextContent(
    'Listening… tap the mic to stop. Chrome sends speech to Google for recognition.',
  )
  rerender(<DictationCaption state={{ phase: 'listening', message: null }} mode="record" />)
  expect(screen.getByRole('status')).toHaveTextContent('Recording… tap the mic to stop. The audio goes to your provider to be transcribed.')
  rerender(<DictationCaption state={{ phase: 'transcribing', message: null }} mode="record" />)
  expect(screen.getByRole('status')).toHaveTextContent('Transcribing…')
  rerender(<DictationCaption state={{ phase: 'error', message: 'No speech was heard. Tap the mic and try again.' }} mode="speech" />)
  expect(screen.getByRole('alert')).toHaveTextContent('No speech was heard. Tap the mic and try again.')
  expect(screen.getByRole('alert')).toHaveClass('pc-caption', 'text-error')
})
```

Append to `src/settings/settingsControls.test.tsx`:

```tsx
import { TranscriptionModelField } from './TranscriptionModelField'

it('edits the transcription model and saves it on blur', async () => {
  const update = vi.fn(async () => {})
  usePrefs.setState({ update, transcriptionModel: 'whisper-1' })
  render(<TranscriptionModelField />)
  const field = screen.getByLabelText('Transcription model')
  expect(field).toHaveValue('whisper-1')
  await userEvent.clear(field)
  await userEvent.type(field, 'gpt-4o-transcribe')
  await userEvent.tab()
  expect(update).toHaveBeenCalledWith({ transcriptionModel: 'gpt-4o-transcribe' })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/voice src/settings`
Expected: FAIL, because the `src/voice/*` modules and `TranscriptionModelField` cannot be resolved.

- [ ] **Step 3: Implement**

`src/voice/support.ts`:

```ts
import type { ProviderProfile } from '../db/db'

export interface SpeechAlternativeLike {
  transcript: string
}
export interface SpeechResultLike {
  readonly length: number
  readonly isFinal: boolean
  [index: number]: SpeechAlternativeLike
}
export interface SpeechResultEventLike {
  readonly results: { readonly length: number; [index: number]: SpeechResultLike }
}

/** The part of the Web Speech API we use; TypeScript's DOM lib does not declare it. */
export interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: SpeechResultEventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike

export function getSpeechRecognition(win: object = window): SpeechRecognitionCtor | null {
  const w = win as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export type MicMode = 'speech' | 'record' | null

export function micMode({ speech, recorder, profile }: { speech: boolean; recorder: boolean; profile: ProviderProfile | null }): MicMode {
  if (speech) return 'speech'
  if (recorder && profile?.adapter === 'openai-compatible' && profile.capabilities.audio && !profile.keyEncrypted) return 'record'
  return null
}

export function joinDraft(base: string, spoken: string): string {
  const tail = spoken.trim()
  if (!tail) return base
  const head = base.trimEnd()
  return head ? `${head} ${tail}` : tail
}

export function speechErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return "Microphone access was blocked. Allow it in the browser's site settings, then tap the mic again."
    case 'no-speech':
      return 'No speech was heard. Tap the mic and try again.'
    case 'audio-capture':
      return 'No microphone was found.'
    case 'network':
      return 'Speech recognition needs a network connection.'
    default:
      return `Speech recognition stopped: ${code}.`
  }
}
```

`src/voice/transcribe.ts`:

```ts
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
```

`src/voice/voiceStore.ts`:

```ts
import { create } from 'zustand'

/** The last final transcript, kept until the message it produced is sent (StoredMessage.audioTranscript). */
export const useVoiceStore = create<{ transcript: string | null; setTranscript(t: string | null): void; takeTranscript(): string | null }>()(
  (set, get) => ({
    transcript: null,
    setTranscript: (transcript) => set({ transcript }),
    takeTranscript: () => {
      const t = get().transcript
      set({ transcript: null })
      return t
    },
  }),
)
```

`src/voice/useDictation.ts`:

```ts
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProviderProfile } from '../db/db'
import { errorMessage } from '../render/result'
import { usePrefs } from '../settings/prefsStore'
import { getSpeechRecognition, joinDraft, micMode, speechErrorMessage, type MicMode, type SpeechRecognitionLike } from './support'
import { transcribe, type TranscribeConfig } from './transcribe'
import { useVoiceStore } from './voiceStore'

export type DictationPhase = 'idle' | 'listening' | 'transcribing' | 'error'
export interface DictationState {
  phase: DictationPhase
  message: string | null
}

const IDLE: DictationState = { phase: 'idle', message: null }

export interface DictationOptions {
  mode: MicMode
  onText(text: string, final: boolean): void
  transcribeWith(): TranscribeConfig | null
  lang?: string
}

export function useDictation({ mode, onText, transcribeWith, lang }: DictationOptions): { state: DictationState; toggle(): void } {
  const [state, setState] = useState<DictationState>(IDLE)
  const recognition = useRef<SpeechRecognitionLike | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const latest = useRef({ onText, transcribeWith })
  latest.current = { onText, transcribeWith }

  useEffect(
    () => () => {
      recognition.current?.abort()
      if (recorder.current?.state === 'recording') recorder.current.stop()
    },
    [],
  )

  const startSpeech = () => {
    const Recognition = getSpeechRecognition()
    if (!Recognition) return
    const rec = new Recognition()
    rec.lang = lang ?? navigator.language
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e) => {
      let text = ''
      let final = true
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript
        if (!e.results[i].isFinal) final = false
      }
      latest.current.onText(text.trim(), final)
    }
    rec.onerror = (e) => {
      if (e.error !== 'aborted') setState({ phase: 'error', message: speechErrorMessage(e.error) })
    }
    rec.onend = () => {
      recognition.current = null
      setState((s) => (s.phase === 'listening' ? IDLE : s))
    }
    recognition.current = rec
    rec.start()
    setState({ phase: 'listening', message: null })
  }

  const startRecording = async () => {
    const config = latest.current.transcribeWith()
    if (!config) return
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setState({ phase: 'error', message: speechErrorMessage('not-allowed') })
      return
    }
    const rec = new MediaRecorder(stream)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      recorder.current = null
      setState({ phase: 'transcribing', message: null })
      transcribe(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), config).then(
        (text) => {
          latest.current.onText(text, true)
          setState(IDLE)
        },
        (e: unknown) => setState({ phase: 'error', message: errorMessage(e) }),
      )
    }
    recorder.current = rec
    rec.start()
    setState({ phase: 'listening', message: null })
  }

  const toggle = () => {
    if (state.phase === 'transcribing') return
    if (recognition.current) {
      recognition.current.stop()
      return
    }
    if (recorder.current) {
      recorder.current.stop()
      return
    }
    if (mode === 'speech') startSpeech()
    else if (mode === 'record') void startRecording()
  }

  return { state, toggle }
}

/** The composer's mic: dictation lands after the draft as it was when the mic was tapped. */
export function useComposerDictation({
  value,
  onChange,
  profile,
}: {
  value: string
  onChange(v: string): void
  profile: ProviderProfile | null
}): { mode: MicMode; state: DictationState; toggle(): void } {
  const mode = useMemo(
    () =>
      micMode({
        speech: getSpeechRecognition() !== null,
        recorder: typeof MediaRecorder !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function',
        profile,
      }),
    [profile],
  )
  const transcriptionModel = usePrefs((s) => s.transcriptionModel)
  const base = useRef('')
  const valueRef = useRef(value)
  valueRef.current = value

  const dictation = useDictation({
    mode,
    onText: (text, final) => {
      onChange(joinDraft(base.current, text))
      if (final) useVoiceStore.getState().setTranscript(text)
    },
    transcribeWith: () => (profile ? { baseUrl: profile.baseUrl, apiKey: profile.apiKey, model: transcriptionModel } : null),
  })

  const toggle = () => {
    if (dictation.state.phase === 'idle' || dictation.state.phase === 'error') base.current = valueRef.current
    dictation.toggle()
  }

  return { mode, state: dictation.state, toggle }
}
```

`src/ui/icons.ts`: add `Mic as IconMic` to the export list.

`src/voice/MicButton.tsx`:

```tsx
import { IconMic } from '../ui/icons'

export function MicButton({ listening, busy, onToggle }: { listening: boolean; busy: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      className={`pc-btn is-icon is-sm is-ghost ${listening ? 'bg-accent-soft text-accent' : ''}`.trim()}
      aria-label={listening ? 'Stop dictation' : 'Dictate'}
      aria-pressed={listening}
      disabled={busy}
      onClick={onToggle}
    >
      <IconMic className="pc-i" aria-hidden="true" />
    </button>
  )
}
```

`src/voice/DictationCaption.tsx`:

```tsx
import type { MicMode } from './support'
import type { DictationState } from './useDictation'

export function DictationCaption({ state, mode }: { state: DictationState; mode: MicMode }) {
  if (state.phase === 'error' && state.message) {
    return (
      <p role="alert" className="pc-caption mt-1.5 text-error">
        {state.message}
      </p>
    )
  }
  const text =
    state.phase === 'listening'
      ? mode === 'speech'
        ? 'Listening… tap the mic to stop. Chrome sends speech to Google for recognition.'
        : 'Recording… tap the mic to stop. The audio goes to your provider to be transcribed.'
      : state.phase === 'transcribing'
        ? 'Transcribing…'
        : null
  if (!text) return null
  return (
    <p role="status" className="pc-caption mt-1.5">
      {text}
    </p>
  )
}
```

`src/settings/TranscriptionModelField.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { usePrefs } from './prefsStore'

export function TranscriptionModelField() {
  const model = usePrefs((s) => s.transcriptionModel)
  const update = usePrefs((s) => s.update)
  const [text, setText] = useState(model)
  useEffect(() => setText(model), [model])
  return (
    <div className="pc-field">
      <label htmlFor="transcription-model">Transcription model</label>
      <div className="pc-input is-mono">
        <input id="transcription-model" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => void update({ transcriptionModel: text })} />
      </div>
      <span className="pc-hint">Used for dictation where the browser has no speech recognition, on profiles with Audio switched on.</span>
    </div>
  )
}
```

Add `<TranscriptionModelField />` to the M2 providers page, directly under the Audio capability switch.

`src/chat/Composer.tsx` (M2): add the mic after the attach button and the caption under `.pc-composer`, and hand the transcript to the message that is sent:

```tsx
import { DictationCaption } from '../voice/DictationCaption'
import { MicButton } from '../voice/MicButton'
import { useComposerDictation } from '../voice/useDictation'
import { useVoiceStore } from '../voice/voiceStore'

// inside the component:
  const dictation = useComposerDictation({ value: draft, onChange: setDraft, profile })

// in .pc-composer-bar, after the attach button (replacing any placeholder mic M2 rendered):
          {dictation.mode && (
            <MicButton
              listening={dictation.state.phase === 'listening'}
              busy={dictation.state.phase === 'transcribing'}
              onToggle={dictation.toggle}
            />
          )}

// right after the closing </div> of .pc-composer:
      <DictationCaption state={dictation.state} mode={dictation.mode} />

// in the send handler, where the user's message is created (M3 persists it as a StoredMessage):
    const audioTranscript = useVoiceStore.getState().takeTranscript()
    // pass `audioTranscript` into the user message M3 stores (StoredMessage.audioTranscript); null when typed
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/voice src/settings && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Check dictation in Chrome**

Run: `npm run dev`, open the app in Chrome, tap the mic in the composer and speak.
Expected: the mic turns accent, the caption reads "Listening… tap the mic to stop. Chrome sends speech to Google for recognition.", words appear in the prompt as you speak and can be edited before **Send**. In Firefox (no Web Speech) the mic is hidden unless the active profile is OpenAI-compatible with Audio on; then it records, shows "Transcribing…", and fills the prompt from `/audio/transcriptions`.

- [ ] **Step 6: Commit**

```bash
git add src/voice src/settings src/ui/icons.ts src/chat/Composer.tsx
git add -u src   # the M2 providers page
git commit -m "feat(voice): dictate prompts with Web Speech, or record and transcribe via the provider

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 17: End-to-end tests (desktop and phone) with a fake LLM

**Files:**
- Modify: `playwright.config.ts`
- Create: `e2e/support.ts`, `e2e/variants.spec.ts`, `e2e/share.spec.ts`, `e2e/export.spec.ts`, `e2e/pwa.spec.ts`, `e2e/phone.spec.ts`

**Interfaces:**
- Consumes: the production build with CSP (M1 `webServer`), the real OpenSCAD WASM, the UI from Tasks 1–16, the M2 composer (`textbox` "Prompt", `button` "Send") and the M2 database layout (`promptcad` IndexedDB, stores `providerProfiles` and `settings`, keyed by `id`).
- Produces:
  - `RENDER_TIMEOUT`, `FAKE_BASE = 'https://fake-llm.test/v1'`, `watchCspViolations(page)`, `waitForFirstRender(page)`, `seedFakeProvider(page, settings?)`, `routeFakeLlm(page, codes: string[])`
  - Playwright projects `chromium` (Desktop Chrome, every spec except `phone.spec.ts`) and `phone` (Pixel 7, `phone.spec.ts` only); service workers blocked except in `pwa.spec.ts`

The fake provider is written straight into IndexedDB after the app has opened its database (so Dexie's schema version is already in place), then the page reloads. It answers `GET /models`, `OPTIONS` preflights, and `POST /chat/completions` both streaming (SSE with a final usage chunk) and non-streaming, returning the next code from the list in a fenced `openscad` block. Service workers are blocked by default so `page.route` sees every request; the PWA spec opts in. Like M1's smoke tests, the specs assume a fresh browser context opens a project whose code is M1's `DEFAULT_CODE` (20 × 20 × 10 mm).

- [ ] **Step 1: Configure the projects**

`playwright.config.ts` (full file):

```ts
import { defineConfig, devices } from '@playwright/test'

// BASE_PATH is the sub-path the app is served from, e.g. /promptcad/ on GitHub Pages. Tests navigate relative to it.
const basePath = process.env.BASE_PATH ?? '/'
const baseURL = `http://localhost:4173${basePath}`

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  // Service workers would answer requests before page.route sees them; pwa.spec.ts turns them on for itself.
  use: { baseURL, acceptDownloads: true, serviceWorkers: 'block' },
  webServer: {
    // Production build, so the CSP meta tag and the service worker are the deployed ones.
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /phone\.spec\.ts/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /phone\.spec\.ts/ },
  ],
})
```

- [ ] **Step 2: Write the shared helpers**

`e2e/support.ts`:

```ts
import { expect, type Page } from '@playwright/test'

export const RENDER_TIMEOUT = 90_000
export const FAKE_BASE = 'https://fake-llm.test/v1'
const FENCE = '`'.repeat(3)

export function watchCspViolations(page: Page): string[] {
  const violations: string[] = []
  page.on('console', (msg) => {
    if (msg.text().includes('Content Security Policy')) violations.push(msg.text())
  })
  return violations
}

export async function waitForFirstRender(page: Page): Promise<void> {
  await expect(page.getByTestId('render-status')).toHaveText(/^Rendered/, { timeout: RENDER_TIMEOUT })
}

/** Adds an OpenAI-compatible profile for FAKE_BASE and makes it active, then reloads. */
export async function seedFakeProvider(page: Page, settings: Record<string, unknown> = {}): Promise<void> {
  await page.goto('./')
  await waitForFirstRender(page)
  await page.evaluate(
    async ({ base, patch }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('promptcad')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      const now = Date.now()
      const tx = db.transaction(['providerProfiles', 'settings'], 'readwrite')
      tx.objectStore('providerProfiles').put({
        id: 'fake-profile',
        name: 'Fake LLM',
        adapter: 'openai-compatible',
        baseUrl: base,
        apiKey: 'test-key',
        defaultModel: 'fake-model',
        cachedModels: [{ id: 'fake-model' }],
        capabilities: { streaming: true, vision: false, audio: false },
        priceTable: { 'fake-model': { inputPerMTok: 1, outputPerMTok: 2 } },
        createdAt: now,
        updatedAt: now,
      })
      const store = tx.objectStore('settings')
      const current = await new Promise<Record<string, unknown> | undefined>((resolve) => {
        const req = store.get('app')
        req.onsuccess = () => resolve(req.result as Record<string, unknown> | undefined)
      })
      store.put({ id: 'app', autoFixAttempts: 2, ...current, activeProfileId: 'fake-profile', activeModel: 'fake-model', ...patch })
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    },
    { base: FAKE_BASE, patch: settings },
  )
  await page.reload()
  await waitForFirstRender(page)
}

/** Serves an OpenAI-compatible endpoint whose replies are the given codes, in turn, as full files. */
export async function routeFakeLlm(page: Page, codes: string[]): Promise<{ requests: number }> {
  const state = { requests: 0 }
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  }
  await page.route(`${FAKE_BASE}/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.url().endsWith('/models')) {
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'fake-model' }] }) })
    }
    const body = req.postDataJSON() as { stream?: boolean }
    const code = codes[state.requests++ % codes.length]
    const text = `Here is the part.\n\n${FENCE}openscad\n${code}\n${FENCE}\n`
    const usage = { prompt_tokens: 1_000, completion_tokens: 500, total_tokens: 1_500 }
    if (body.stream) {
      const deltas = [text.slice(0, 20), text.slice(20)].map(
        (content) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`,
      )
      const sse = [...deltas, `data: ${JSON.stringify({ choices: [], usage })}\n\n`, 'data: [DONE]\n\n'].join('')
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse })
    }
    return route.fulfill({
      status: 200,
      headers: cors,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage }),
    })
  })
  return state
}
```

- [ ] **Step 3: Write the specs**

`e2e/variants.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { RENDER_TIMEOUT, routeFakeLlm, seedFakeProvider, watchCspViolations } from './support'

test('asks for three variants, renders them in the background and uses the picked one', async ({ page }) => {
  const csp = watchCspViolations(page)
  const llm = await routeFakeLlm(page, ['cube([10, 10, 10]);', 'cube([20, 10, 10]);', 'cube([30, 10, 10]);'])
  await seedFakeProvider(page, { variantCount: 1 })

  const count = page.getByRole('button', { name: 'Variants per prompt' })
  await expect(count).toHaveText('1')
  await count.click()
  await expect(count).toHaveText('3')

  await page.getByRole('textbox', { name: 'Prompt' }).fill('A test block')
  await page.getByRole('button', { name: 'Send' }).click()

  const dialog = page.getByRole('dialog', { name: 'Pick a variant' })
  await expect(dialog).toBeVisible()
  for (const dims of ['10 × 10 × 10 mm', '20 × 10 × 10 mm', '30 × 10 × 10 mm']) {
    await expect(dialog.getByRole('option').filter({ hasText: dims })).toHaveCount(1, { timeout: RENDER_TIMEOUT })
  }
  expect(llm.requests).toBe(3)
  // The main view was not disturbed by the background renders.
  await expect(page.getByTestId('dims')).toHaveText('20 × 20 × 10 mm')

  const widest = dialog.getByRole('option').filter({ hasText: '30 × 10 × 10 mm' })
  await widest.locator('.pc-variant-meta').first().click()
  await expect(widest).toHaveAttribute('aria-selected', 'true')
  await dialog.getByRole('button', { name: /^Use variant [ABC]$/ }).click()

  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('dims')).toHaveText('30 × 10 × 10 mm', { timeout: RENDER_TIMEOUT })
  expect(csp).toEqual([])
})
```

`e2e/share.spec.ts`:

```ts
import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'
import { RENDER_TIMEOUT, waitForFirstRender, watchCspViolations } from './support'

// lz-string is CommonJS without named ESM exports; Playwright runs specs as ESM.
const LZString = createRequire(import.meta.url)('lz-string') as typeof import('lz-string')

test('a share link opens as a new project, and the link the app makes opens the same model', async ({ page, context }) => {
  const csp = watchCspViolations(page)
  const payload = { v: 1, name: 'Shared block', code: 'cube([12, 8, 4]);', params: {} }
  await page.goto(`./#s=${LZString.compressToEncodedURIComponent(JSON.stringify(payload))}`)

  await expect(page.getByTestId('dims')).toHaveText('12 × 8 × 4 mm', { timeout: RENDER_TIMEOUT })
  await expect(page.getByText('Opened “Shared block” from a link')).toBeVisible()
  expect(new URL(page.url()).hash).toBe('')

  await page.getByRole('button', { name: 'Share' }).click()
  const link = await page.getByRole('textbox', { name: 'Share link' }).inputValue()
  expect(link).toMatch(/#s=[A-Za-z0-9+\-$]+$/)

  const second = await context.newPage()
  await second.goto(link)
  await expect(second.getByTestId('dims')).toHaveText('12 × 8 × 4 mm', { timeout: RENDER_TIMEOUT })
  expect(csp).toEqual([])
})

test('a damaged link creates nothing and says why', async ({ page }) => {
  await page.goto('./#s=garbage!!')
  await expect(page.getByRole('alert')).toContainText('This link could not be opened')
  await waitForFirstRender(page)
  expect(new URL(page.url()).hash).toBe('')
})
```

`e2e/export.spec.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { waitForFirstRender, watchCspViolations } from './support'

async function openExport(page: Page, tab: string) {
  await page.goto('./')
  await waitForFirstRender(page)
  await page.getByRole('button', { name: 'Share' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export and share' })
  await dialog.getByRole('tab', { name: tab }).click()
  return dialog
}

test('saves a PNG of the model at the chosen size', async ({ page }) => {
  const csp = watchCspViolations(page)
  const dialog = await openExport(page, 'Image')
  await dialog.getByLabel('Size').selectOption({ label: '800 × 600 px' })
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Save PNG' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('model.png')
  const bytes = await readFile((await file.path())!)
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(bytes.readUInt32BE(16)).toBe(800)
  expect(bytes.readUInt32BE(20)).toBe(600)
  expect(csp).toEqual([])
})

test('saves a looping turntable GIF encoded in a worker', async ({ page }) => {
  const csp = watchCspViolations(page)
  const dialog = await openExport(page, 'Turntable')
  await dialog.getByLabel('Frames').fill('36')
  const download = page.waitForEvent('download', { timeout: 60_000 })
  await dialog.getByRole('button', { name: 'Save GIF' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('model-turntable.gif')
  const bytes = await readFile((await file.path())!)
  expect(bytes.subarray(0, 6).toString('latin1')).toBe('GIF89a')
  expect(bytes.readUInt16LE(6)).toBe(480)
  expect(bytes.includes(Buffer.from('NETSCAPE2.0'))).toBe(true)
  expect(csp).toEqual([])
})
```

`e2e/pwa.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { RENDER_TIMEOUT, waitForFirstRender, watchCspViolations } from './support'

test.use({ serviceWorkers: 'allow' })

test('registers a service worker that keeps the app and OpenSCAD working offline', async ({ page, context }) => {
  const csp = watchCspViolations(page)
  await page.goto('./')
  const scriptURL = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL ?? '')
  expect(new URL(scriptURL).pathname).toBe(`${new URL(page.url()).pathname}sw.js`)
  await waitForFirstRender(page)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByTestId('dims')).toHaveText('20 × 20 × 10 mm', { timeout: RENDER_TIMEOUT })
  await context.setOffline(false)
  expect(csp).toEqual([])
})

test('serves an installable manifest with the generated icons', async ({ page, request }) => {
  await page.goto('./')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  const manifestUrl = new URL(href!, page.url())
  const manifest = (await (await request.get(manifestUrl.toString())).json()) as {
    display: string
    icons: Array<{ src: string; sizes: string; purpose?: string }>
  }
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons.map((i) => i.sizes)).toEqual(['192x192', '512x512', '512x512'])
  for (const icon of manifest.icons) {
    const res = await request.get(new URL(icon.src, manifestUrl).toString())
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toBe('image/png')
  }
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', /icons\/icon-192\.png$/)
})
```

`e2e/phone.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { waitForFirstRender } from './support'

test('switches between Chat, Code and 3D, with the symbol key row in Code', async ({ page }) => {
  await page.goto('./')
  await waitForFirstRender(page)
  const tabs = page.getByRole('tablist', { name: 'Views' })
  await expect(tabs).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible()

  await tabs.getByRole('tab', { name: '3D' }).click()
  await expect(page.getByTestId('viewer')).toBeVisible()
  await expect(page.getByTestId('dims-axes')).toHaveAttribute('aria-label', '20 × 20 × 10 mm')
  const fit = await page.getByRole('button', { name: 'Fit view' }).boundingBox()
  expect(fit!.height).toBeGreaterThanOrEqual(44)

  await tabs.getByRole('tab', { name: 'Code' }).click()
  await expect(page.getByTestId('viewer')).toBeHidden()
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.getByRole('toolbar', { name: 'Code symbols' }).getByRole('button', { name: ';' }).click()
  await expect(page.locator('.cm-content')).toBeFocused()
  await expect(page.locator('.cm-line').last()).toHaveText(';')

  await tabs.getByRole('tab', { name: 'Chat' }).click()
  await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible()
})
```

- [ ] **Step 4: Run the end-to-end tests**

Run: `npm run e2e`
Expected: every spec passes in both projects (the M1 smoke tests and earlier milestones' specs in `chromium`, `phone.spec.ts` in `phone`). If one fails:
- **CSP violation in a console line**: report the directive; do not loosen `script-src`. A `worker-src` violation means the service worker or a worker was served from another origin; an inline-script violation means `injectRegister` is not `false`.
- **Variants never leave "Generating…"**: open the trace; if the fake endpoint got no request, the seeded settings row did not make the profile active (check the M2 settings repository merges `DEFAULT_SETTINGS`), or M2 requested a path other than `/chat/completions`.
- **Offline reload shows "Loading OpenSCAD…" forever**: `sw.js` lacks `openscad/openscad.wasm` (precache limit) or the worker's WASM fetch is not under the worker's scope; check `BASE_PATH`.
- **Phone spec finds no tab bar**: the Pixel 7 viewport (412 px) must match `PHONE_QUERY`.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts e2e
git commit -m "test(e2e): variants with a fake LLM, share links, PNG and GIF export, offline PWA, phone tabs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Full verification, manual phone check, push

**Files:** none new.

**Interfaces:** consumes everything above; produces a green `main` deployed to GitHub Pages.

- [ ] **Step 1: Run every check**

Run: `npm run typecheck && npm test && npm run e2e`
Expected: no type errors; all Vitest suites pass (including `src/styles/noHardcodedColors.test.ts`, so no hex or palette class slipped into `src/`); all Playwright specs pass in `chromium` and `phone`.

- [ ] **Step 2: Check the base path build**

Run: `BASE_PATH=/promptcad/ npm run e2e`
Expected: PASS, including M1's "loads every file from under the base path" and the PWA spec (the worker's scope is `/promptcad/`).

- [ ] **Step 3: Exit criterion on a real phone**

Deploying happens on push; after the Pages workflow finishes, on an Android phone in Chrome open https://meyhem.github.io/promptcad/ and:
1. Install it (menu › Install app): the home-screen icon is the filament square on the dark ground; it opens standalone.
2. Turn on airplane mode, reopen it: the model renders.
3. Back online, with a provider set up, tap the mic and dictate "a wall hook for a 30 mm broom handle"; the words appear in the prompt.
4. Set variants to 3, send, wait for three cards, orbit one, tap **Use variant B**: the model and the editor show B; History lists the other two as variants.
5. **Share** (desktop) or Export icon › Link (phone), **Copy link**, open it in another browser: a new project with the same model opens.

Record anything that differs from the screens as an issue; do not hold the push for cosmetic differences.

- [ ] **Step 4: Push**

Per CLAUDE.md (checks green, never force):

```bash
git status --short   # expect a clean tree
git push origin HEAD
```

Expected: the push succeeds and the "Test and deploy to GitHub Pages" workflow runs typecheck, unit and end-to-end tests, then deploys `dist/`.

---

## Deferred from M4

| Item | Milestone | Hook left in M4 |
| --- | --- | --- |
| Image parts in a variant prompt (photo or sketch sent to three models) | M5 | `VariantRequest.userText` is a string; widening it to `string \| ContentPart[]` is the only change, since `runTurn` already accepts parts |
| Per-slot model choice ("A · claude-sonnet", "B · gpt-5-mini" as in the Variants screen) | Later (post-M4) | `VariantSlot.model` and `initialSlots(model, …)` already carry a model per slot; the picker labels show it |
| Version thumbnails for unpicked variants | M3 follow-up | `commitPick` (Task 12) writes `thumbnailBlobId: null`; `renderFrames` at 96 × 96 px plus `imageDataToPng` produce one once a blob repository API is fixed |
| Timelapse frames from cached STL blobs instead of recompiling | M3 follow-up | `renderTimelapse` takes its meshes from `deps.queue.render`; a cache lookup by version slots in front of it once `Version` links to an `stl` blob |
| Export screen's thumbnail strip under the timelapse preview | M4 polish | `onFrame(frame, index)` already streams every frame to the tab |
| "Camera presets" viewer button on the phone 3D tab (Phone3D screen) | M4 polish | `presetPose(bounds, 'iso' \| 'front' \| 'top')` is the same pose source the Image tab uses |
| WebM turntable via MediaRecorder | Later | `renderFrames` yields frames; a MediaRecorder sink can replace `createGifEncoder` behind `FrameDeps` |
| Web Share Target (share a photo straight into a new prompt) | M5 | Manifest options live in `build/pwa.ts`; images enter through M5's attach path |
| Hiding the tab bar while the phone keyboard is open (PhoneCode screen) | M4 polish | `PhoneLayout` owns the tab bar; a `visualViewport` resize listener can hide it |
| Low-quality preview for click-to-refine's tagged preview format | M5 | `withPreviewPass` wraps any `WorkerFactory`; M5's `preview: { tagged: true }` requests pass through unchanged |
| Settings › Usage entries for variant replies grouped per prompt | Later | Every variant reply already writes a `usage` row with `projectId` |

## Contract issues

These are problems found in the design doc's Shared contracts. The plan keeps the contracts as written and works around each one as described.

1. **`runTurn` has no `temperature` option**, although the design says variants may use different temperatures and `ChatRequest.temperature` exists for that. Workaround: `withTemperature(provider, t)` wraps the provider (Task 12). Suggested fix: add `temperature?: number` to `runTurn`'s options and pass it to `generateCode`.
2. **`newProject(opts)` has no fixed option shape in the contract.** Task 8 calls `newProject({ name, origin: 'shared-link', code, params, source: 'import', message: 'Opened from a link' })`, which matches the `NewProjectOptions` the parallel M3 plan defines, and assumes it creates version 1 and opens the project. Suggested fix: move `NewProjectOptions` into the contract.
3. **No way to move the head to an existing version.** `restore(versionId)` creates a new `restore` version, which is wrong for a variant pick. Task 12 adds `src/history/setHead.ts` (a direct `db.projects.update`) and then calls `openProject`, assuming `openProject` loads the head's code and params into the editor without creating a version. Suggested fix: add `setHead(versionId)` to `projectStore`.
4. **The Zustand hook name of `src/history/projectStore.ts` is not fixed.** This plan uses `useProjectStore`.
5. **Repository function names in `src/db/usage.ts` and `src/db/settings.ts` are not fixed.** M4 writes variant usage rows through its own `src/variants/recordUsage.ts` and reads/writes its settings through `src/db/prefs.ts`. Suggested fix: name `addUsage(record)` and `updateSettings(patch)` in the contract.
6. **`Settings` needs one more M4 field.** The editable transcription model (`whisper-1` by default) is not among "M4 adds: variantCount, lowQualityPreview"; Task 1 adds `transcriptionModel: string`.
7. **`Version` has no link to a cached STL blob**, so the spec's "Cached STL blobs are used when present" for timelapse cannot be honoured; every frame recompiles (Task 7).
8. **No blob repository API** for writing thumbnails, so variant versions get `thumbnailBlobId: null` (Task 12).
9. **The M3 project `.json` format and import function are not in the contract.** The spec's "offer a `.json` file instead" needs the recipient to open it; Task 8 hooks the share payload into M3's import handler (`importProjectFile`) ahead of the project schema.
10. **Locked keys.** With M3's passphrase lock, `ProviderProfile.apiKey` holds ciphertext and no contract function returns the plaintext key, which the `/audio/transcriptions` fallback needs. Task 16 hides the record fallback for `keyEncrypted` profiles. Suggested fix: a `resolveApiKey(profile)` in the contract.
11. **`StoredMessage.audioTranscript` is "used from M4"**, but the contract does not say how the composer hands a message to M3's persistence. Task 16 exposes `useVoiceStore().takeTranscript()` for that call site.
12. **`chatStore` has no actions in the contract**, so a variant turn adds no assistant message to the chat; the pick is recorded as a version with the prompt as its message.
13. **`RenderQueue` reports no per-job start**, so the picker infers "Rendering…" from FIFO order (`renderSeq`), which is right only while variants are the queue's only user (a timelapse started at the same time would make a waiting variant look like it is rendering).
14. **Component names are not contracts** (`Composer`, `ChatPanel`, `CustomizerDock`, `ProjectMenu`, M3's startup and Settings sections), so M4's integration edits name them as assumptions (see "Integration points").
15. **Header Export button.** The design doc says the export dialog replaces the header Export button's direct download, but the Main and Export screens keep **Export STL** as a direct primary and add **Share**. This plan follows the screens: **Share** opens the dialog, **Export STL** stays one click.
