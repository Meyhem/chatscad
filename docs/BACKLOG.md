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
