# Backlog

Feature ideas not yet scheduled into a plan. Each entry says what the user gets and what it touches. When an idea is picked up, move it into a plan under `docs/superpowers/plans/` and remove it here.

## Model picker with pricing when setting up a provider

**Idea.** When the user connects a new provider profile, the "Default model" field is a dropdown of the models that provider offers, instead of a free-text input. Where the provider reports prices, each option shows them (for example "gpt-4o-mini · $0.15 / $0.60 per 1M tokens").

**Behaviour.**

- The list loads as soon as it can: right after the API key is entered, or before it for providers whose model list needs no key (OpenRouter, local servers such as Ollama).
- Searchable, since some providers list hundreds of models. Manual entry stays available for models the list omits.
- Prices come from provider metadata when reported (OpenRouter returns them in `/models`); otherwise fall back to the profile's editable price table, or show no price rather than a guessed one.
- Capability flags (vision, audio) are prefilled from the same metadata where available.
- If listing fails (CORS, bad key, endpoint missing), say what failed and keep the free-text field working.

**Touches.** `src/settings/ProfileForm.tsx` (Default model field), `LlmProvider.listModels` in the adapters under `src/ai/`, `cachedModels` and `priceTable` on the profile. Fits SPEC "Model selection" and "Token and cost tracking", which already describe `/models` loading and provider-reported prices.

## New projects start empty

**Idea.** "New project" opens an empty workspace: no starter cube with a cylinder cutout, nothing in the viewer, an empty (or comment-only) editor. The user starts from a prompt or their own code.

**Behaviour.**

- Empty code is a valid state, not an error: the status pill and viewer show an empty state (for example "Nothing to render yet"), the console stays quiet, and STL export is disabled.
- The empty state points at the next step: type a prompt, write code, or pick something from the gallery.
- No render request goes to the worker while the code is empty.

**Touches.** `DEFAULT_CODE` in `src/state/store.ts` (initial `code` and the "New project" action in `src/workbench/ProjectMenu.tsx`). `src/chat/sendPrompt.ts` and `src/variants/startVariants.ts` compare against `DEFAULT_CODE` to treat the starter as "no code yet"; that check becomes "code is empty". Existing tests and e2e specs that rely on the starter cube need a fixture of their own.

## Resizable panels on desktop

**Idea.** The user can resize every desktop panel by dragging the border between panels: chat, 3D view, code, sliders (customizer) and console. The layout stays the way they leave it.

**Behaviour.**

- Vertical splitters between the three columns: chat, 3D view, code. Today they are fixed at 360 px, flexible and 440 px (`md:grid-cols-[360px_minmax(0,1fr)_440px]` in `src/App.tsx`).
- Horizontal splitters inside columns: 3D view against the sliders dock, and code editor against the console. The console is a fixed `h-44` in `src/workbench/CodePane.tsx`.
- Every panel has a sensible minimum size, so dragging can't make it vanish or overlap another panel. Double-clicking a splitter resets that split to its default.
- Content that doesn't fit scrolls inside its own panel and never grows the page. This matters most for long chats and projects with many sliders.
- Sizes are stored per device (layout preference, not project data) and restored on reload. A "Reset layout" action restores the defaults.
- Splitters work from the keyboard and with screen readers (`role="separator"`, `aria-valuenow`, arrow keys to resize), and are wide enough to grab with a pointer. Splitter colours use tokens only.
- When a panel resizes, the 3D viewer resizes with it, without reloading the scene.
- The phone layout (`src/layout/PhoneLayout.tsx`) keeps its own sheet-based layout and is out of scope.

## The PromptCAD title goes home

**Idea.** The "PromptCAD" title at the top left is a link to the workbench (the current project) on every view, so the user doesn't have to find "Back to project" at the top right of settings.

**Behaviour.**

- On settings and the gallery, clicking the title does the same as "Back to project". "Back to project" stays where it is.
- On the workbench the title does nothing visible (or is plain text), so clicking it never discards anything or reloads the page.
- It is a real button or link, reachable from the keyboard, with an accessible name such as "PromptCAD, back to project" and a visible focus ring. The title looks the same as today apart from hover and focus states.

**Touches.** The title in `src/App.tsx`, `src/settings/SettingsPage.tsx` and `src/gallery/GalleryView.tsx`. Easiest as one shared header-title component.

## Image export shows the whole model

**Idea.** In the share/export window, the Image tab's preview and saved PNG show the whole model, or exactly what the viewer camera shows for "Current view". Today the preview crops part of the model.

**Behaviour.**

- "Current view" matches the viewer: same camera position, target, field of view and framing. If the image's aspect ratio differs from the viewport, the image widens or heightens the frame and never crops what the viewer shows.
- The preset cameras (Iso, Front, Top) fit the whole model's bounds into the chosen image size, with the same margin as the viewer's Fit view.
- The preview and the saved file match, at every image size.

**Likely cause.** Both cameras use a 45° vertical FOV, but the aspect ratio differs. `poseFor` in `src/export/tabs/ImageTab.tsx` copies only the viewer's position and target (`getViewerPose` in `src/viewer/viewerCamera.ts`), which were framed for the viewer's wide canvas. When `renderFrames` in `src/export/frames.ts` renders that pose into a narrower image (square, for example), the sides get cut off. The presets also fit with a fixed aspect of 1 (`computeCameraFit(bounds, FRAME_FOV, 1)` in `presetPose`), not the chosen image size. The fix probably stores the viewer's aspect with the pose, keeps the horizontal extent when the export is narrower, and fits presets to the real export aspect. A test should check that the model's projected bounds stay inside the frame.

## Animated turntable preview

**Idea.** In the export and share window, the Turntable tab's preview already spins the way the GIF will, so the user sees the result before saving. Today the preview is one still iso frame. It only moves while the GIF is being encoded.

**Behaviour.**

- The preview loops through the turntable poses at the GIF's frame rate, using the current frame count, size and background settings. Changing a setting restarts the loop with the new frames.
- Frames are rendered at preview size and cached for the loop, so playing it doesn't re-render every frame each turn. While frames are still rendering, the preview shows the ones it already has.
- The preview pauses when the tab or window is hidden, and with `prefers-reduced-motion` it shows a still frame plus a play control.
- Saving the GIF still works as it does today.

**Touches.** The preview effect in `src/export/tabs/TurntableTab.tsx` renders one `presetPose(mesh.bounds, 'iso')` frame. It would render `turntablePoses(mesh.bounds, frames)` from `src/export/frames.ts` and play them through `FramePreview`, which needs a frame-sequence mode or an animated sibling. The Timelapse tab could reuse the same player.
