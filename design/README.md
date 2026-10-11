# Design sources

Copies of the PromptCAD design system that the app builds from. The originals live in two Claude artifacts:

- Design system (tokens, brand book, components): https://claude.ai/artifact/Ww9x79XKgeaW9w19vs13io (version `1791700265-ad72`, copied 2026-10-11)
- Screens (desktop workbench, flows, phone tabs): https://claude.ai/artifact/TNXkMGKfbuVrEAh8MEvMDA (version `1791700959-9a31`)

| File | What | Changes from the source |
| --- | --- | --- |
| `tokens.json` | Colour (dark primary, light peer), type, spacing, radius, shadow and size tokens | None. `npm run tokens` regenerates `src/styles/tokens.css` from it. |
| `components.css` | The `pc-*` component classes (buttons, inputs, tabs, status pill, console, dims readout, callout, dialog, …) | The Google Fonts `@import` line is removed: the app's CSP forbids font CDNs, so Archivo and JetBrains Mono are self-hosted through fontsource. |

To update: copy the files again from the artifact, keep the one change above, run `npm run tokens`, then `npm test`.
