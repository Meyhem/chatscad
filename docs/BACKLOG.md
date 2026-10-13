# Backlog

Feature ideas not yet scheduled into a plan. Each entry says what the user gets and what it touches. When an idea is picked up, move it into a plan under `docs/superpowers/plans/` and remove it here.

## Dimensioned views export

**Idea.** A new export that produces a drawing sheet of the model seen from several angles (front, top, right and an isometric view), each annotated with its dimensions, so the user can check sizes or hand the part to someone without opening a CAD tool.

**Behaviour.**

- One image (PNG) or page (PDF/SVG) with the standard orthographic views laid out in a grid, plus an isometric view for context. Each view is labelled ("Front", "Top", "Right", "Iso").
- Orthographic views use an orthographic camera, so lengths on screen are true to scale; the sheet states the scale or shows a scale bar.
- Every orthographic view carries dimension lines with arrows and values for the two axes it shows (for example width and height on the front view), in mm with units on every number ("20 mm"). The overall bounding box ("20 × 20 × 10 mm") appears in the sheet's caption.
- Export is allowed only when the current code is rendered and the render is ok, like STL export.
- Colours, fonts and line weights come from the design tokens, with a light background that prints well.

**Touches.** A new tab in `src/export/tabs/` next to `ImageTab.tsx`, reusing `glFrameRenderer.ts` and the framing in `src/export/frames.ts`. The view presets (`iso`, `front`, `top`, `right`) already exist for agent review in `src/agent/frames.ts`; the bounding box comes from the same source as `src/ui/DimsReadout.tsx`. Dimension lines are drawn as a 2D overlay (canvas or SVG) on top of each rendered view.

## Permissive multi-word model search

**Idea.** The model picker's search finds a model from any loose, partial, multi-word query, so "dee fla 4" lands on DeepSeek V4 Flash at once.

**Behaviour.**

- Every space-separated word of the query must match somewhere in the model, in any order and in any part of the name: "dee fla 4", "flash dee v4" and "4 flash deep" all find `deepseek/deepseek-v4-flash`.
- Punctuation and case never matter, in the query or the model: "deep-seek v4", "DeepSeek/V4" and "deepseek_v4" match like "deepseek v4". Today a query word with a `-`, `/` or `.` fails, because it is matched character by character against the id.
- Both the model id and the display name the provider reports (`ModelInfo.name`, for example "DeepSeek: DeepSeek V4 Flash") are searched; a word may match either.
- Small typos still match a long word ("flsh", "deepsek"), ranked below exact and prefix matches.
- Ranking stays as it is for the easy cases: whole words and word starts first, then prefixes, then scattered letters; ties keep the provider's order. The top result is the one Enter picks.

**Touches.** `src/chat/fuzzy.ts` (`fuzzyScore`, `fuzzyFilter`) and its tests; `src/chat/ModelPicker.tsx`, which today passes only ids (`modelIds(p)`) and would pass names too. `src/settings/ModelCombobox.tsx` should use the same matcher so both pickers agree.
