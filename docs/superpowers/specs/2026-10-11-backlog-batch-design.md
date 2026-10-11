# Backlog batch: design

Date: 2026-10-11. Source: `docs/BACKLOG.md` (all six entries). Visual reference: the "Backlog proposals" row of the screens canvas (https://claude.ai/artifact/TNXkMGKfbuVrEAh8MEvMDA, boards `Backlog*.dc.html`), approved 2026-10-11.

Each section is one shippable change with its own commit. They are independent; the order below is the build order (smallest risk first, largest last).

## 1. The ChatSCAD title goes home

**What.** One shared `BrandTitle` component in `src/ui/BrandTitle.tsx`.

- On the workbench (`view === 'workbench'`) it renders plain text exactly as today (`<h1>` in `App.tsx`, so the `heading` named "ChatSCAD" stays).
- On settings, history and the gallery it renders `<h1><button type="button" aria-label="ChatSCAD, back to project">` with the brand dot and text. Click calls `setView('workbench')`. Hover gives `bg-panel-raised`; `:focus-visible` gives the standard focus ring. `title="Back to project"`.
- Used in the desktop header of `App.tsx` and in `GalleryView`'s header. Gallery keeps its "Back to project" button. Settings has no back button (the tabs replace it); the title behaves like the Project tab.
- Switching view never discards state: the workbench stays mounted while hidden, as today.

**Tests.** Component test: plain text on workbench; button with the accessible name elsewhere; click sets view to workbench. Update `App.test.tsx` only where the heading query changes.

## 2. Image export shows the whole model

**Cause.** `getViewerPose()` stores only position and target. `renderFrames` renders the pose with `PerspectiveCamera(45, w/h)`. A narrower export than the viewer crops the sides. Presets fit with aspect 1 regardless of the export size.

**Design.**

- `CameraPose` gains optional `fov?: number` (vertical, degrees) and `aspect?: number` (width / height of the viewport that framed it). `PoseReporter` in `Viewer.tsx` records the canvas aspect and the camera fov with the pose.
- New pure helper `fitPoseToAspect(pose, targetAspect): { pose, fov }` in `src/export/frames.ts`. When the target is narrower than the source aspect, it widens the vertical fov so the horizontal extent stays the same: `vFov' = 2·atan(tan(hFov/2) / targetAspect)`, where `hFov = 2·atan(tan(vFov/2)·sourceAspect)`. When the target is wider, the vertical fov is kept (the frame gets wider, nothing is cropped). Position and target are unchanged.
- The frame renderer takes a per-camera fov (`cameras: { pose, fov? }[]` or a `fov` on the pose). Default stays `FRAME_FOV`.
- `presetPose(bounds, preset, aspect = 1)` passes the real export aspect to `computeCameraFit`. `ImageTab` and `TurntableTab` pass `size.width / size.height`.
- The preview and the saved PNG use the same pose and fov; only the pixel size differs, so they match at every size.

**Copy.** The caption under the Image preview: "The last model that compiled, at {W} × {H} px." stays. No new copy.

**Tests.** Unit: project the eight corners of a bounds box through the camera built from `fitPoseToAspect(...)` and assert every NDC coordinate is within [-1, 1], for a wide-to-square and a square-to-wide case, and for each preset at 1080 × 1080, 1920 × 1080 and 800 × 600. Existing ImageTab tests keep passing.

## 3. Animated turntable preview

**Design.**

- New `useFrameLoop(frames: ImageData[], delayMs: number, playing: boolean)` hook returning the current index. Uses `setTimeout` chained per frame; stops when `document.visibilityState === 'hidden'` and resumes on `visibilitychange`.
- `TurntableTab`'s preview effect renders `turntablePoses(mesh.bounds, frames)` at preview size through `renderFrames`, appending each frame to state as it arrives (the loop plays the frames it has). It depends on `[mesh, frames, sizeIndex, transparent]`; a change aborts the in-flight render (AbortController) and starts again. Frames are cached in component state for the loop; no re-render per turn.
- Delay is `turntableDelayMs(frames)`, the same as the GIF.
- `prefers-reduced-motion: reduce` (via `matchMedia`): starts paused on frame 0. A play/pause button (`vbtn`, `aria-label` "Play preview" / "Pause preview") is always shown bottom-left of the preview.
- Overlay top-right: "frame {i} / {n}". While frames are still rendering, the caption bottom-left reads "Rendering preview frames · {done} of {n}".
- While a GIF is being saved, the preview shows the save's streamed frames as today and the loop is paused.
- `FramePreview` stays a still-frame component; the tab passes it the current frame.

**Tests.** Hook test with fake timers (advances, pauses when hidden, respects `playing`). TurntableTab test: preview requests `frames` cameras; reduced motion starts paused and shows "Play preview"; changing frames restarts.

## 4. New projects start empty

**Design.**

- `DEFAULT_CODE` is removed. The store's initial `code` is `''`. "New project" calls `newProject({ code: '', origin: 'blank' })`. First run (`startApp`) therefore also opens empty.
- `sendPrompt.ts` and `startVariants.ts`: the "no code yet" check becomes `code.trim() === ''`.
- Render loop: when `code.trim() === ''`, no request goes to the worker; any in-flight render is cancelled; the store gets `status: 'empty'`, `stl: null`, mesh cleared, console cleared. Leaving the empty state renders normally.
- `StatusPill`: `empty` → neutral pill "Nothing to render".
- Viewer: when status is `empty`, a centred card over the grid: heading "Nothing to render yet", text "Describe a part in the chat, write OpenSCAD in the editor, or start from an example.", button "Browse examples" (`setView('gallery')`).
- Editor: CodeMirror `placeholder("Write OpenSCAD here, or describe a part in the chat")`.
- Chat with no messages: "Describe what you want to make" plus the example caption "For example, “a wall hook for a 30 mm broom handle”." (only if the chat has no empty state today; otherwise keep the existing one).
- Export STL and Share are disabled (`selectCanExport` already requires ok status).
- Phone layout uses the same components, so it gets the same empty states.

**Tests.** Store, render loop (no worker call with empty code), status pill, viewer empty card, sendPrompt/startVariants with `''`. E2E: a `loadFixtureModel(page, code)` helper in `e2e/support.ts` types or seeds the old starter so existing specs keep their "20 × 20 × 10 mm" expectations; a new spec checks a new project shows "Nothing to render yet" and a disabled Export STL.

## 5. Resizable panels on desktop

**Design.**

- New `Splitter` component (`src/layout/Splitter.tsx`): `role="separator"`, `aria-orientation`, `aria-label` ("Resize chat", "Resize code", "Resize parameters", "Resize console"), `aria-valuenow/min/max` in px, `tabIndex=0`, `title="Drag to resize. Double-click to reset."`. 1 px `bg-line` line with a 9 px invisible hit area; `bg-accent` (2 px) while dragging or focused. Pointer events with pointer capture. Keys: arrows ±16 px, Home/End to min/max. Double-click resets to the default.
- Layout state: new `layout` prefs `{ chatWidth, codeWidth, dockHeight, consoleHeight }` (px), stored in the existing IndexedDB `settings` row through `prefs.ts`/`usePrefs`. Defaults: chat 360, code 440, dock = content height capped at 45 % (today's behaviour, stored as `null` until dragged), console 176. Writes are debounced (250 ms) after a drag ends.
- Limits: chat 280–560, code 320–720, 3D view keeps at least 360 px wide (column widths clamp against the window), dock 96 px to viewer height − 160 px, console 72 px to pane height − 160 px. Clamping happens on window resize too, without overwriting the stored value.
- `App.tsx` desktop grid becomes `grid-template-columns: {chat}px 1px minmax(360px,1fr) 1px {code}px` with splitters in the 1 px tracks. `CodePane` console height and `CustomizerDock` height come from the layout prefs. All panels scroll inside (`min-h-0 overflow-auto`), never the page.
- The R3F canvas resizes through its own resize observer; no remount.
- Settings › Appearance gains "Panel layout" with a "Reset layout" button.
- `PhoneLayout` is untouched.

**Tests.** Splitter unit tests (keyboard, clamp, double-click reset, aria values). Layout prefs persistence. App test: four separators on desktop, none on phone. E2E: drag the chat splitter, reload, width is kept; Reset layout restores 360 px.

## 6. Model picker with pricing

**Design.**

- New `ModelCombobox` (`src/settings/ModelCombobox.tsx`), replacing the `<input list>` in `ProfileForm`. ARIA 1.2 combobox: `input role="combobox"` + `listbox`, arrow keys, Enter, Escape. Filters by id and name (case-insensitive substring), shows the first 50 matches plus "{n} of {total} models · prices per 1M input / output tokens". Each option: name (or id), id in mono, price "$3.00 / $15.00" or "No price listed", tags "vision"/"audio". Last option "Use “{query}” as typed" when the query is not an exact id.
- Price shown: `priceTable[id]` if set, else the listed price, else "No price listed". Never a guess.
- Auto loading: a `useModelList(profile)` hook calls `createProvider(profile).listModels()` 600 ms after `baseUrl` or `apiKey` changes, or right away on mount when the preset needs no key (OpenRouter, Ollama, LM Studio, or an empty key on a localhost URL). Results go to `cachedModels`. States: idle, loading ("Loading the model list from {name}…"), loaded ("{n} models from {name}. Type to search, or enter any model name."), error ("Couldn't load the model list: {reason}. Type a model name instead.", reason from the existing `testConnection` error classifier). "Test connection" keeps working and also refreshes the list.
- Capabilities: `ModelInfo` gains `capabilities?: { vision?: boolean; audio?: boolean }`. The OpenAI-compatible adapter reads OpenRouter's `architecture.input_modalities` (`image` → vision, `audio` → audio). When the user picks a model with reported capabilities, the profile's vision/audio switches are set to them; a caption "From the model list" shows next to a switch set that way until the user changes it. Without metadata the switches are left alone.
- Free text always works: typing any value and blurring or pressing Enter saves it as `defaultModel`.

**Tests.** Combobox component tests (filter, keyboard, as-typed option, price formatting, no price). Hook tests with a fake provider (debounce, keyless preset loads on mount, error message). Adapter test for modality mapping. Update existing ProfileForm tests that use the datalist. E2E `ai-loop.spec.ts` keeps typing into "Default model".

## Cross-cutting

- Tokens only, sentence case, units on numbers, no exclamation marks.
- Each item: TDD, then `npm run typecheck`, `npm test`, `npm run e2e`, then commit and push (per `CLAUDE.md`).
- When an item ships, remove its entry from `docs/BACKLOG.md` in the same commit.
