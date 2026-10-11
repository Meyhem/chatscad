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
