# ChatSCAD — Technical Spec

Oct 11, 2026 · @Michal

## Overview

ChatSCAD is a client-only React PWA where an LLM writes OpenSCAD, the browser compiles it with OpenSCAD WASM, and the user iterates by chat, code, sliders, 3D picking or images, then exports STL. There is no backend: keys, projects and history live on the device.

**Goals**

- Prompt to printable model in one loop: describe, preview, refine, export STL.
- Bring-your-own-key for any OpenAI-compatible provider, plus native Anthropic and Gemini.
- Every change (AI, manual, slider) is a version you can diff, restore or branch from.
- Usable on a phone: installable, works offline for editing and rendering.

**Non-goals (v1)**

- Accounts, cloud sync, collaboration (sharing is via self-contained URLs only).
- Server-side rendering or a CORS proxy.
- 3D-printing analysis (overhangs, bed fit, weight); planned later, with hooks kept in the architecture.
- Slicing, printer control, or non-OpenSCAD CAD kernels.

## Decisions and architecture

Rendering, storage and AI calls all run in the user's browser; static hosting is the only infrastructure.

| Decision | Choice |
| --- | --- |
| Rendering | OpenSCAD WASM in a Web Worker |
| Storage | Local only (IndexedDB); no backend, no proxy |
| Editing | AI agent (build, optional vision review), code editor, parameter sliders, click-to-refine, image and sketch input |
| Providers | Any OpenAI-compatible endpoint plus native Anthropic; keys entered in the app |
| Output | Live preview, STL export, full version history |

_Architecture diagram (main thread, worker, storage, providers): see the [source doc](https://claude.ai/artifact/CBshRJgBT9uEz2b9ErCj5j)._

The render controller is the only path to the worker, so chat, code and sliders all get the same debounce, cancel and timeout behaviour.

## Tech stack

Vite + React + TypeScript, with every heavy job (compile, mesh parse, thumbnail) off the main thread.

| Concern | Choice | Why |
| --- | --- | --- |
| Build | Vite, TypeScript strict | Fast dev loop, first-class worker and WASM imports |
| UI state | Zustand | Small, no provider tree, easy to persist slices |
| Persistence | Dexie (IndexedDB) | Versioned schema, live queries for history lists |
| Code editor | CodeMirror 6 | Much better on mobile than Monaco; small bundle; custom OpenSCAD language + lint |
| 3D viewer | three.js via react-three-fiber + drei | Orbit controls, raycasting for click-to-refine, grid and axes |
| Compiler | OpenSCAD WASM build, Manifold backend | Same engine as desktop OpenSCAD, fast CSG |
| Worker RPC | Comlink | Typed calls into the render and parse workers |
| PWA | vite-plugin-pwa (Workbox) | Precache app shell and WASM, update prompt |
| Styling | Tailwind | Fast responsive layouts for phone and desktop |
| Parsing | tree-sitter-openscad (WASM) | AST for Customizer params, source ranges for picking |

All choices are client-side; nothing needs a server beyond static hosting (Cloudflare Pages, Netlify or GitHub Pages).

## Rendering pipeline

Each render runs in a dedicated Web Worker with a fresh OpenSCAD WASM instance, so a hung or crashed compile is killed by terminating the worker.

1. **Trigger.** AI response, slider change, or editor change (debounced \~600 ms, configurable). A newer request cancels the in-flight one.
2. **Write inputs** to the WASM virtual FS: `main.scad`, bundled libraries (BOSL2, MCAD as optional zips), user-imported files.
3. **Compile** with `--backend=manifold`, parameter overrides as `-D name=value`, output to an in-memory file. Preview format carries per-face colour (needed for click-to-refine); final export writes binary STL.
4. **Parse** the mesh in the worker into typed arrays (positions, normals, face → source-tag ids) and transfer them to the main thread without copying.
5. **Display** in three.js: auto-fit camera on first render, keep the camera on re-renders, show bounding-box dimensions in mm.
6. **Report** stdout/stderr, warnings, `echo()` output and render time to a console panel; map error line numbers back into the editor as diagnostics.

**Limits.** Default timeout 60 s (setting). Optional low-quality preview pass by overriding `$fn` before the full render. Last good mesh stays on screen when a compile fails.

**Export.** STL (binary) is the v1 target; 3MF and the `.scad` source are cheap extras. On mobile, use the Web Share API with a file, falling back to a download link, because direct downloads are unreliable on iOS.

## AI provider layer

One `LlmProvider` interface (`listModels`, `streamChat`, capability flags) with three adapters; the rest of the app never sees provider differences.

| Adapter | Covers | Notes |
| --- | --- | --- |
| OpenAI-compatible | OpenAI, OpenRouter, Groq, Mistral, DeepSeek, Together, Gemini's OpenAI endpoint, Ollama, LM Studio | User sets base URL, key, model; models from `GET /models` with manual fallback |
| Anthropic | Claude models | Native Messages API; browser calls need the direct-browser-access header |
| Gemini (optional) | Google models | Only if the OpenAI-compatible endpoint proves limiting |

**Provider profiles.** Users save several profiles (name, base URL, key, default model, capability flags: vision, streaming, tool calls). A "Test connection" button sends a tiny request and reports CORS, auth and model errors in plain words.

**CORS.** With no backend, a provider that blocks browser requests cannot work. The UI says so per profile; local servers need their allowed-origins setting (e.g. Ollama's `OLLAMA_ORIGINS`). A proxy can be added later behind the same interface.

**Prompting.**

- System prompt fixes the contract: valid OpenSCAD only, millimetres, top-level parameters with Customizer comments, named modules per logical part, no external libraries unless enabled.
- First generation returns a full file in one fenced block.
- Follow-up edits return search/replace blocks against the current version (cheaper, fewer regressions); the app falls back to requesting a full file if a block fails to apply.
- Context sent each turn: current code, the user message, compile errors, optional viewport screenshot and selected part.

**Auto-fix loop.** If the result fails to compile, the app sends stderr back automatically, up to N attempts (default 2). Each attempt is a version so nothing is hidden.

**Agent review.** The Project tab's left column is the Agent. Its composer has two modes, chosen with an Edit | Agent switch above the input box and kept per project (a new project starts in Agent). **Edit** sends one builder turn as above and never plans or reviews; its replies carry an "Edit" tag, and "Review vN" under the latest edit reviews it on request. **Agent** plans, builds, reviews and fixes: a request in a project without checks is planned first (the builder model turns it into checks and module names, which the user approves, edits or skips, or approval can be turned off in the agent settings); checks are stored on the project and editable from the column header. The send button reads "Send" in Edit and "Run agent" in Agent, and a line beside the switch says what the mode does. Each agent run is grouped in the transcript with a strip of its steps (plan, build, each review and fix); older runs fold to one line. Without a vision model Agent is disabled and a note says how to turn on Vision. The model, effort and variants (Edit only) sit inside the input box, below the request. The reviewer gets four views (iso, front, top, right) with each top-level part in its own colour from the click-to-refine tags, a legend of colour, module and lines, the size, warnings, code and checks, and answers in JSON: a verdict and evidence per check, issues tied to parts and checks, and suggested checks. Fixes for failed checks start ticked; "Fix N issues" sends them back to the builder. "Fix until every check passes" repeats without asking up to the round limit (default 3). The viewer's Part colours button shows the same colours. Design: `docs/superpowers/specs/2026-10-13-agent-review-design.md`.

## Editing modes

All four modes write to the same code buffer and each committed change becomes a version.

**Code editor.** CodeMirror 6 with an OpenSCAD grammar, bracket matching, autocomplete for built-ins and the project's own modules, inline compile errors, format on save. "Ask AI about selection" sends the highlighted range as context.

**Parametric models.** Every model is parametric by default: the system prompt requires all tunable dimensions as top-level variables with OpenSCAD Customizer comments, grouped by `/* [Group] */` tabs. The app parses them (tree-sitter AST) and builds sensible controls from the annotation and value type:

| Declaration | Control |
| --- | --- |
| `w = 40; // [10:1:200]` | Slider plus number input, with min, step, max |
| `w = 40; // 0.5` | Number input with step |
| `shape = "round"; // [round, square]` | Dropdown |
| `holes = true;` | Toggle |
| `label = "ABC";` | Text input |
| `size = [20, 30, 5];` | Vector input (one field per axis) |

Changes re-render via `-D` overrides without touching source. "Bake" writes values into the code as a new version; named presets per project; "Reset to defaults". Un-annotated top-level numbers still get a number input, with an "Ask AI to annotate" button.

**Click-to-refine.** Before a preview compile, the app wraps each top-level statement (and each module call inside the main assembly) in a `color()` that encodes a tag id, keeping a map from tag id to source range. Manifold preserves per-face colour through CSG, so a ray hit on a face resolves to the statement that produced it. The user taps a part, it is highlighted in 3D and in the editor, and the chat box is scoped: "make this hole 2 mm wider" edits only that range. Fallbacks: if tags are lost (e.g. inside `hull()`), use the bounding box and a viewport screenshot with the selection outlined for a vision model. The user's own `color()` calls are restored in the final export.

**Image and sketch input.** Attach a photo, upload a drawing, or sketch on a simple canvas with dimension annotations. Sent as image parts to vision-capable models only; the button is disabled with an explanation for profiles without vision. Images are downscaled client-side (max \~1568 px long edge) and stored with the version that used them.

**Start from photos.** A new project can start from one photo or several tagged angles (front, top, side, back, bottom, other) of a real object, plus a description and a scale choice (a coin, card or ruler in the photos, or only the sizes in the description). The photos belong to the project (at most 5, 1024 px) and go with every builder, planner and reviewer request. The builder marks every Customizer annotation with its source (`from description`, `from photo`, `guessed`); the Customizer and a Sizes card after each build show it, guesses first. A Photos dialog adds angles later and refines the model against all photos, keeping the sizes the user set. The viewer can show a reference photo and match its camera angle.

## Variants, gallery, voice and model choice

These v1 features reuse the same render pipeline and version store; none needs a backend.

**Variants.** "Generate 3" sends the same prompt as three parallel requests (optionally to different models or with different temperatures). Results render one by one in the single worker, queued, and appear as a 3-up picker with thumbnails, orbitable previews, compile status, model name and token cost. Picking one makes it the head version. The other two are kept in history as versions with `kind = variant`, sharing a `variantGroupId`, shown collapsed under the chosen one and restorable at any time. Variants of a follow-up edit branch from the current head.

**Example gallery.** Bundled, offline, parametric starter models (box with lid, enclosure, bracket, knob, gear, hinge, cable clip, phone stand). Each has a thumbnail, tags and its parameters ready. "Start from this" copies it into a new project as version 1. Stored as static JSON in the app bundle, so community submissions can be added by pull request later.

**Voice prompts.** A mic button in chat uses the Web Speech API for live dictation into the prompt box, editable before sending. Where it is unavailable (Firefox, some PWAs), record with MediaRecorder and send to the provider's `/audio/transcriptions` endpoint if the profile supports it; otherwise hide the button. Note that Chrome's built-in recognition is processed by Google's servers.

**Model selection.** Each profile loads its model list from `GET /models` (cached, searchable, with a manual entry field). A model picker sits next to the send button, so the model can change per message; the version records which model produced it. Capability flags (vision, audio) are taken from the provider metadata when available, or set by the user.

**Token and cost tracking.** Read usage from every response (`usage` fields; streaming requests ask for usage in the final chunk where supported; OpenRouter also reports cost directly). Cost is computed from provider-reported prices when available, else from an editable per-model price table. Shown per message, per project, and per profile per day and month, with a free-tier quota indicator when limits are known.

## Sharing and export

All exports run client-side from the current version.

- **Share via URL.** Code and parameter values, compressed with lz-string into the URL hash (`#s=…`), so nothing is uploaded. Opening a link imports a new project. No keys, chat or history are included. Links over \~8 KB show a warning and offer a `.json` file instead.
- **PNG.** Snapshot of the viewer at chosen resolution, transparent or solid background, from the current camera or a preset (iso, front, top).
- **Turntable GIF.** Render 36–72 frames rotating the camera offscreen, encode with a small GIF encoder (e.g. gifenc) in a worker; options for size, frame count and background. WebM via MediaRecorder as a lighter alternative.
- **Timelapse GIF.** Plays the model's history from the first version to the current one, one frame per version along the head's ancestry (variants and failed compiles skipped by default, optional). Each frame is re-rendered offscreen from the stored code and params with a fixed camera (auto-fit to the largest bounding box, or a saved bookmark), optional slow turntable, and an optional caption with the version number and prompt. Options: frame duration, hold on the last frame, size, which versions to include. Renders queue through the same worker; a progress bar shows frames done. Cached STL blobs are used when present to avoid recompiling; long histories (over \~40 versions) sample evenly.
- **Source.** Download `.scad`, optionally with used library files zipped alongside.
- **STL** as described in the rendering pipeline.

All image exports share one export dialog with a live preview and a common frame renderer (offscreen three.js scene), so PNG, turntable and timelapse differ only in the frame list they feed it.

## Future: 3D printing hooks

Printing features are out of scope for v1, but the architecture keeps room for them:

- Mesh data from the worker is kept in a reusable `MeshAnalysis` module boundary (overhangs, wall thickness, manifold checks, volume) instead of living inside the viewer.
- The viewer supports overlay layers (heatmaps, build plate, section plane) as a plugin point.
- The database reserves a `printerProfiles` table (bed size, nozzle, material densities) so bed-fit checks, weight and cost estimates, auto-orient and slicer handoff can be added without migration pain.

## Projects and version history

History is a tree, not a list: editing an old version creates a branch instead of discarding newer work.

| Table | Key fields |
| --- | --- |
| `projects` | id, name, createdAt, updatedAt, headVersionId, providerProfileId, enabledLibraries, origin (`blank` · `gallery` · `shared-link`), photos, brief, scale |
| `versions` | id, projectId, parentId, code, params (JSON), source (`ai` · `manual` · `slider` · `autofix` · `restore`), kind (`main` · `variant`), variantGroupId, message, model, compileStatus, renderMs, createdAt |
| `messages` | id, projectId, versionId, role, content, imageBlobIds, audioTranscript |
| `usage` | id, profileId, model, versionId, inputTokens, outputTokens, cost, costSource (`provider` · `price-table`), createdAt |
| `presets` | id, projectId, name, params (JSON) |
| `blobs` | id, kind (`thumbnail` · `image` · `stl`), data (Blob) |
| `providerProfiles` | id, name, adapter, baseUrl, encryptedKey, defaultModel, cachedModels, capabilities, priceTable |
| `printerProfiles` | reserved for future printing features |
| `settings` | singleton: theme, debounce, timeout, auto-fix attempts, variant count, lock mode |

**Behaviour**

- Manual edits are coalesced: a version is created on render success, on blur, or after 30 s idle, not on every keystroke.
- Each version stores a small PNG thumbnail captured from the viewer.
- Timeline panel: thumbnails, source icon, message; tap to preview without switching head; restore, branch, or diff (side-by-side code diff).
- Undo/redo moves along the head's ancestry.
- Export/import a project as one JSON (or zip with blobs) for backup, since there is no sync.
- Request `navigator.storage.persist()` so the browser does not evict data; show usage in settings.

## PWA and mobile UX

Phone layout is three tabs (Agent, Code, 3D) with the 3D view always one tap away; desktop is a resizable three-pane split.

- **Offline.** Precache the app shell, OpenSCAD WASM and library zips; editing, sliders, rendering and export work offline. Only AI calls need a network.
- **First load.** The WASM binary is several MB; fetch it in the background after first paint and show a progress state, not a blank screen.
- **Updates.** Prompt "New version available" instead of silently swapping a running app.
- **Touch.** One-finger orbit, two-finger pan/zoom, tap to select a part, long-press for part menu. Sliders at least 44 px tall.
- **Keyboard.** Extra key row above the mobile keyboard for `; { } ( ) [ ]` in the code tab.
- **Install.** Manifest with icons and `display: standalone`; optional Web Share Target so a photo can be shared straight into a new prompt.
- **Performance.** Cap pixel ratio at 2, pause the render loop when the 3D tab is hidden, warn when a mesh exceeds \~1M triangles.

## Security

The main threat is key theft through XSS, so the app ships no third-party scripts at runtime and a strict Content Security Policy.

- **CSP.** `script-src 'self' 'wasm-unsafe-eval'`; `connect-src` limited to `https:` plus explicit localhost entries for local models. No analytics, no CDN scripts.
- **Key storage.** Default: keys in IndexedDB, shown masked, never logged or included in project exports. Optional lock mode: encrypt keys with a passphrase (PBKDF2 to an AES-GCM key via WebCrypto), held in memory until the tab closes.
- **Model output is untrusted.** Generated code only ever runs inside the OpenSCAD WASM sandbox; never `eval`, never rendered as HTML. Markdown in chat is sanitized.
- **Imports.** Project JSON is schema-validated before writing to the database.
- **Guidance in UI.** Recommend provider keys with spending limits and per-app scope where the provider supports it.

## Milestones

Build in five phases, each ending with something usable; click-to-refine goes last because it depends on every layer below it.

1. **Render core.** Vite app, render worker, CodeMirror, three.js viewer, STL and `.scad` export. Exit: paste OpenSCAD, see it, download STL.
2. **AI loop.** Provider profiles, model picker, OpenAI-compatible and Anthropic adapters, streaming chat, auto-fix loop, token and cost tracking. Exit: prompt to model without touching code, cost visible.
3. **Parametric and history.** Customizer parser and controls, presets, Dexie schema, version tree, thumbnails, diff, restore and branch, example gallery. Exit: start from a gallery model, tune sliders, restore any version.
4. **Variants, sharing, PWA.** Generate 3 with picker and variant history, URL sharing, PNG and turntable GIF, offline caching, phone layout, voice prompts. Exit: install on phone, dictate a prompt, pick a variant, share a link.
5. **Vision and click-to-refine.** Image and sketch input, tag-colour instrumentation, 3D picking, scoped edits. Exit: tap a part and change only it.

## Risks and open questions

The two risks worth testing in a spike first are mobile WASM performance and colour survival through CSG for picking.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Heavy models slow or crash phone browsers | Bad mobile experience | Low-`$fn` preview pass, timeout, triangle warning, memory-safe worker restart |
| Face colours lost in some operations (`hull`, `minkowski`, imports) | Click-to-refine misses | Bounding-box + screenshot fallback to a vision model |
| Providers blocking browser CORS | Some providers unusable | Clear per-profile error; optional proxy later behind the same interface |
| LLMs produce broken or non-manifold geometry | Failed renders, unprintable STL | Auto-fix loop, strict system prompt, manifold check before export |
| Browser evicts IndexedDB | Lost projects | Persistent storage request, export reminders |

**Open questions**

- [ ] Ship BOSL2 by default, or as an opt-in library per project?
- [ ] Keep the CodeMirror grammar hand-written, or reuse tree-sitter for highlighting too?
- [ ] Is 3MF export (with colours, for multi-material printers) worth adding to v1?
- [ ] Hosting target and domain for the PWA.
