# Agent with optional vision review — design

Oct 13, 2026 · branch `feat/agent-review` · screens: `design/screens/Agent*.dc.html` (canvas https://claude.ai/artifact/TNXkMGKfbuVrEAh8MEvMDA, row "Agent in the Project tab")

## Goal

The Project tab's Chat column becomes the **Agent** column. A builder model writes and edits OpenSCAD as chat does today. A vision-capable reviewer model can look at coloured renders of the result, judge it against the project's checks, and propose fixes the user approves. The aim is fewer silent misses ("the lid is missing", "the rail is on one side only") without making every small edit slow or expensive.

## Decisions

| # | Decision |
| --- | --- |
| A1 | The agent replaces Chat in the Project tab (desktop column and phone tab). No new top-level tab. History and Settings are unchanged. |
| A2 | Every request builds, exactly as a chat turn does today: one version per build, auto-fix, scoped edits, attachments, voice and variants keep working. |
| A3 | Review is optional. It runs on its own after the first build of a model (the editor was empty when the request was sent), when Review is on for a request, from "Review vN" under the latest reply, and after each "Fix N issues" in a review round. Without a vision model the Review control is disabled and says why; the builder still works. |
| A4 | Checks are stored per project. A request that will be reviewed, sent to a project with no checks, first gets a plan: the builder model turns the request into checks and part names. The user approves, edits or skips the plan. Later reviews may suggest new checks from newer requests; the user adds them with one click. Checks can be edited any time from the Agent header. |
| A5 | The reviewer sees four views (iso, front, top, right) at 768 × 768 px with each top-level part in its own colour on a fixed light ground, a legend (colour → part name → lines), the size, triangle count and compiler warnings, the code, the checks, the original request and the latest request. |
| A6 | Part colours come from the existing click-to-refine tagged render (`RenderRequest.preview.tagged`, `MeshData.faceTags`). Palette: Okabe–Ito based, 7 colours, then repeat; grey for untagged faces. They become design tokens `part-1`…`part-7`, `part-none`, `frame-ground`. |
| A7 | The reviewer answers in JSON: a status and evidence per check, issues (severity, part, check, change), and suggested new checks. Unreadable answers get one retry asking for JSON only, then show an error card. |
| A8 | Approval modes: "Ask me each round" (default): the review card lists fixes with tick boxes; fixes for failed checks start ticked, others unticked. "Fix until every check passes": ticked fixes go back to the builder without asking until all checks pass or the round limit (default 3) is reached. |
| A9 | The live viewer gets a Part colours toggle that paints the current model with the same palette and shows the legend. |
| A10 | The review replaces M5's one-line "Visual check" (setting and code removed). |
| A11 | Review cards and plan cards live in memory for the session. Each card is also saved as a chat note with a one-line summary, so a reloaded project still shows what happened. Checks persist on the project and travel in project export files. |

## Architecture

```
Composer ─ sendPrompt ─ runTurn (builder) ─ render ─▶ version
              │                                  │
              │ plan first? (A4)                 ▼ review? (A3)
              ▼                          agent/review.ts
       agent/plan.ts                       ├ tagged render on the background queue
       (builder model, JSON)               ├ agent/frames.ts: 4 coloured PNGs
                                           ├ reviewer model (JSON)
                                           ▼
                                    agentStore: review card ─ "Fix N issues" ─▶ sendPrompt (round + 1)
```

- `src/agent/checks.ts`: `Check` type and helpers; `src/agent/partColours.ts`: palette, colour names, per-vertex colour arrays.
- `src/agent/plan.ts`: planner prompt, JSON parsing, `runPlan`.
- `src/agent/review.ts`: reviewer prompt, JSON parsing, `runReview` with injected render, frames and provider.
- `src/agent/frames.ts`: four coloured frames through `createGlFrameRenderer` with vertex colours.
- `src/agent/agentStore.ts`: cards, the "review next request" flag, the running loop, and the actions the UI calls.
- `src/agent/reviewer.ts`: picks the reviewer profile and model from settings (vision required).
- UI: `PlanCard`, `ReviewCard`, `ChecksButton`, `ReviewButton` (composer, with settings popover), the viewer's `PartColoursToggle` and legend.

## Data

- `Project.checks?: Check[]` where `Check = { id, kind: 'part' | 'size' | 'fit' | 'feature' | 'print' | 'other', text }`. No Dexie index, so no schema bump. Project files carry `checks` when present.
- `Settings` gains `reviewProfileId: string | null`, `reviewModel: string | null` (null: the active builder model when it has vision), `reviewNewModels: boolean` (true), `reviewRounds: number` (3), `reviewMode: 'ask' | 'auto'` ('ask'). `visualCheck` is dropped.
- Planner and reviewer calls record usage rows with the project id.

## Error handling

- No vision model: Review disabled with "Review needs a model that takes images. Turn on Vision for a provider in Settings › AI providers."
- Tagged render fails or finds no parts: the review still runs on uncoloured frames and says so in the prompt and on the card ("Parts not coloured").
- Provider errors show in the card in the same words as chat errors. Stop cancels a running plan, review or loop.
- A manual edit or parameter change while a review runs stops it, as it stops a chat turn.

## Testing

- Unit: palette and colour arrays, plan and review JSON parsing (fenced, prose around it, invalid), prompt contents, reviewer selection, agentStore flows with fake provider and fake frames, card components, checks persistence, project file round trip.
- End to end: a fake OpenAI-compatible vision provider returns a plan, a model, a review with one failing check, a fix and a passing review; the test approves the plan, ticks the fix, and sees the review pass.

## Out of scope

Section views, printability analysis, the reviewer editing code directly, and persisting review images.
