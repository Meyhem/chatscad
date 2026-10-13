# Start from photos — design

Oct 13, 2026 · screens: `design/screens/Photo*.dc.html` (canvas https://claude.ai/artifact/TNXkMGKfbuVrEAh8MEvMDA, row "Start from photos")

## Goal

A new project can start from photos of a real object instead of from words alone. The user adds one photo or several tagged angles, describes what the object is and the sizes they know, and the agent builds a first parametric model from both. Every size in the result says where it came from, so the user checks the guesses first. The photos stay with the project: later builds and reviews see them, and more angles can be added when a render shows the model got something wrong.

This is for two jobs: replicating or replacing a real part, and making a part that fits a real object. Both need the photos as a lasting reference, not as a one-off attachment.

## Decisions

| # | Decision |
| --- | --- |
| P1 | The new project dialog gets a **Start from** choice: Blank or Photos. Photos adds a photo picker, a description box and a scale choice; the library cards collapse to one line with a Change button. Blank is the dialog as it is today. |
| P2 | **One photo or several angles** is a choice in the dialog, not a mode of the project. "One photo" shows a single slot. "Several angles" shows slots tagged front, top, side, back, bottom and other. One filled slot is enough to build; a project holds at most five photos. |
| P3 | Photos are **reference images of the project** (`Project.photos`), not attachments of a message. They are stored as image blobs, downscaled to 1024 px on the long edge (smaller than chat attachments, because they are sent with every request). |
| P4 | The **description becomes the first request.** It is sent through the agent like any request, so the first run plans checks from it and from the photos, builds, and reviews. The first user bubble shows the photos and the description. The description is also kept on the project (`Project.brief`) and can be edited in the Photos dialog. |
| P5 | **Scale** is a two-way choice: find a coin, card or ruler in the photos, or use only the sizes in the description. It changes one sentence of the prompt. The app does not detect or measure the reference object itself. |
| P6 | **Every builder turn and every review in a photo project gets the photos**, each preceded by its angle tag, plus a photo section in the system prompt: the photos show the real object, the description is authoritative, sizes the photos cannot show are guesses, and every parameter must say its source. |
| P7 | **Sizes carry their source in the code.** A Customizer annotation may end with `from description`, `from photo` or `guessed` (for example `wall = 3; // [1.2:0.2:6] guessed`). The customizer parser keeps the control and records the source; the Customizer dock shows it under the parameter name; guessed values are marked in the warn colour. The source lives in the `.scad` file, so it survives export and import. |
| P8 | After each build in a photo project the agent adds a **Sizes card**: every top-level parameter with its value and source, guessed ones first. Editing a value in the card is a parameter change (a `-D` override, like the dock); it re-renders at once. "Sizes look right" closes the card. "Add a photo" opens the Photos dialog. A newer build supersedes the card. |
| P9 | **The user's sizes survive later builds.** In a photo project the build context lists the current parameter overrides ("The user set these sizes; keep them: wall = 3.2 mm"). This holds for every build, including refinements and fixes. |
| P10 | A **Photos dialog** opens from the Agent header ("Photos · N"). It shows the slots, the editable description, and two actions: "Save photos only" and "Refine with N photos". Refine sends an agent request to compare the model with all photos and fix what differs, naming the new photos. Removing a photo unlinks it from the project; blobs are deleted with the project. |
| P11 | The **reviewer sees the photos** with the review frames and is told to compare the render against the photo of the matching angle (front, top; side maps to the right frame). Other angles are still sent as reference. |
| P12 | The **viewer can show a reference photo** in its top left corner: a small picture with tabs for each angle and a hide button. Choosing a tagged angle moves the camera to the matching preset (front, top, side as right, back, bottom); "other" leaves the camera alone. The choice is per session, not stored. |
| P13 | **Photos need vision.** When the active profile has no vision, the Photos option is disabled with the existing explanation and an "Open AI providers" button. Photo projects build in Agent mode by default; without a reviewer the run degrades to a plain build, as any agent run does. |
| P14 | **Project files carry the photos** as base64 data with their tags, the brief and the scale choice, validated on import. Share links do not include photos (size), and a shared project opens as a blank-origin project with the brief only. |
| P15 | On phones the dialog fills the screen; photo slots open the camera or the photo library (`capture="environment"` on the file input). |

## Architecture

```
NewProjectDialog ─ Start from: Photos ─▶ newProject({ origin: 'photos', photos, brief, scale })
                                              │
                                              ▼
                                   agentStore.submit(brief)  ── plan (photos + brief) ─▶ build ─▶ review (photos + frames)
                                              │                                              │
                                              ▼                                              ▼
                                   sendPrompt → prepareTurnInput + projectPhotos()        Sizes card (parameter sources)
                                              │
                                              ▼
                                   buildSystemPrompt(ctx.photos) ── photoSection()
```

- `src/photos/projectPhotos.ts`: the `ProjectPhoto` type, angle tags and labels, `MAX_PROJECT_PHOTOS`, `PHOTO_MAX_EDGE`, `preparePhoto(file)`, `photoParts(photos)` (content parts with `Reference photo (front)` text before each image), `photoLabel(angle)`.
- `src/photos/photoPrompt.ts`: `photoSection(ctx)` for the system prompt, `keepSizesSection(params)` for P9, `refineText(newAngles)` for P10, `PHOTO_PLAN_NOTE` for the planner.
- `src/photos/PhotoSlots.tsx`: the slot grid used by both dialogs (one-photo and several-angles layouts, add, remove, drop, camera on phones).
- `src/photos/PhotosDialog.tsx`: the project Photos dialog (P10); `src/photos/PhotosButton.tsx`: the Agent header button.
- `src/photos/ReferencePhoto.tsx`: the viewer overlay (P12).
- `src/workbench/NewProjectDialog.tsx`: Start from, the photo step, the description and scale fields, "Create and build".
- `src/scad/customizer.ts`: `CustomizerParam.source`; `src/customizer/ParamRow.tsx`: shows it.
- `src/agent/sizes.ts` and `src/agent/ui/SizesCardView.tsx`: the Sizes card (P8), a third `AgentCard` kind.
- `src/ai/prompt.ts`: `PromptContext.photos`, `PromptContext.keepParams`; `src/chat/sendPrompt.ts` and `src/refine/turnInput.ts`: project photos joined to the outgoing content parts.
- `src/agent/plan.ts`, `src/agent/review.ts`: optional `photos` content parts.
- `src/history/projectFile.ts`: photos, brief and scale in the file format (version stays 1, fields optional).

## Data

```ts
type PhotoAngle = 'front' | 'top' | 'side' | 'back' | 'bottom' | 'other' | 'photo' // 'photo': the one-photo case
interface ProjectPhoto { id: string; blobId: string; angle: PhotoAngle; addedAt: number }
interface Project {
  …
  origin: 'blank' | 'gallery' | 'shared-link' | 'photos'
  photos?: ProjectPhoto[]        // absent on every project before this feature
  brief?: string                 // the description; at most 2,000 characters
  scale?: 'reference' | 'description'
}
interface CustomizerParam { …; source: 'description' | 'photo' | 'guess' | null }
```

No new Dexie index, so no schema bump. Blobs reuse `kind: 'image'`. `deleteProject` removes the photo blobs with the project's other blobs.

## Prompts

**System prompt, photo projects** (appended after the library section):

> Reference photos of the real object are attached to the request, each labelled with its angle. The description is authoritative where it gives a size or a feature. Use the photos for shape, proportions and features. Sizes the photos cannot show are guesses: choose sensible values for a printed part and say so. [Scale: Estimate sizes from the coin, card or ruler in the photos (a 1 euro coin is 23.25 mm, a credit card 85.6 × 54 mm). | Take sizes only from the description; estimate the rest by proportion and mark them guessed.] End every Customizer annotation with its source: `from description`, `from photo` or `guessed`, for example `wall = 3; // [1.2:0.2:6] guessed`. The model is a starting point the user will correct, so keep it simple and parametric.

**Keep sizes** (P9, in the request context when overrides exist): "The user set these sizes; keep them: wall = 3.2, cup_depth = 28."

**Planner** adds: "Reference photos of the real object are attached. Plan checks for the features they show and for every size in the description." The planner gets the photos as content parts.

**Reviewer** adds: "Reference photos of the real object are attached. Compare the rendered front view with the front photo and the top view with the top photo (the side photo matches the right view). A check fails when the render clearly differs from the photo in shape or in the presence of a feature."

**Refine** (P10): "Compare the model with the reference photos and fix what differs. New photos: side. Keep the sizes the user set." The user bubble shows "Refine with 3 photos".

## UI copy

- Dialog: "Start blank, or from photos of a real object. Photos are a starting point; describe the rest in words." Slots: "Front", "Top", "Side", "Back", "Bottom", "Other angle"; hint "Fill the angles you have. One is enough to start." One-photo tips: shoot straight at the best side; put a coin, card or ruler next to it; what one photo cannot show is guessed. Description label "Describe it", placeholder "What it is, sizes you know, what it attaches to". Scale options "Find a coin, card or ruler in the photos" and "Only the sizes in the description". Submit "Create and build"; footer "The agent plans checks from your description and photos, then builds v1."
- Sizes card: "Sizes in v1 · 7", pill "2 guessed", sources "From description", "From photo", "Guessed", note "Changing a size here re-renders at once. Later builds keep it." Buttons "Sizes look right", "Add a photo".
- Photos dialog: "3 of 5 photos", "Save photos only", "Refine with 3 photos", "v1 stays in History."
- No vision: the existing `NO_VISION_EXPLANATION` and "Open AI providers".
- Errors: "Up to 5 photos per project. IMG_0412.jpg was not added." "Could not read IMG_0412.jpg. Add a PNG, JPEG or WebP image."

## Error handling

- A photo that fails to decode is skipped with the message above; the dialog still submits with the rest.
- The first build fails to compile: auto-fix runs as it does today; the Sizes card appears only after a successful render.
- The builder omits sources: the card lists the parameters with "Source not given" and the dock shows nothing extra. Nothing else changes.
- Photos cannot be loaded from the database (evicted blob): the turn is sent without that photo and a note says "1 photo could not be loaded".
- Stop, edits and parameter changes cancel a running refine as they cancel any agent run.

## Testing

- Unit: `preparePhoto` downscales to 1024 px; `photoParts` orders tags and text; `photoSection` for both scale choices; customizer parser reads the three sources and leaves controls unchanged; Sizes card groups guessed first and writes overrides; project file round-trips photos, brief and scale and rejects bad data; `selectActiveProfile` without vision disables Photos.
- Component: NewProjectDialog states (blank, one photo, angles, no vision); PhotosDialog add, remove, save, refine; ParamRow source caption; ReferencePhoto tabs and camera call.
- End to end (`e2e/photos.spec.ts`, fake vision provider): create a project from two photos and a description; the planner, builder and reviewer requests each carry two image parts and the tag texts; the Sizes card shows a guessed size; change it and confirm the re-render; open Photos, add a third photo, Refine, and confirm the next build request carries three images and the keep-sizes line.

## Out of scope

Measuring from photos in the app, perspective correction, detecting the reference object, photo editing or cropping, and sending photos from Edit-mode turns selectively. Photos in share links.
