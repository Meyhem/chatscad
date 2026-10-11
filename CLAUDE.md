# PromptCAD

Client-only React PWA: an LLM (from M2) writes OpenSCAD, the browser compiles it with OpenSCAD WASM in a Web Worker, the user iterates and exports STL. No backend; static hosting only (GitHub Pages).

- Spec (binding authority): `docs/SPEC.md`
- Plans: `docs/superpowers/plans/` (M1 render core is implemented)
- Design sources: `design/` (`tokens.json`, `components.css`; see `design/README.md` for where they come from and how to refresh them)

## Git workflow

- **After every completed feature or fix, commit and push the current branch to `origin` automatically, without asking.** A feature or fix is complete when `npm run typecheck`, `npm test` and `npm run e2e` pass. Never push with failing checks.
- Never force-push, and never rewrite history that has been pushed.
- Push the branch you are on. Do not merge into or push to `main` unless the user asks; every push to `main` deploys the site to GitHub Pages.
- One logical change per commit, with a conventional message (`feat:`, `fix:`, `build:`, `docs:`, `chore:`, `test:`).

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server (fetches the pinned OpenSCAD WASM first if missing) |
| `npm test` | Vitest unit and component tests (jsdom) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run e2e` | Production build plus Playwright against the real OpenSCAD WASM, CSP active |
| `npm run build` | Static build into `dist/`; set `BASE_PATH=/promptcad/` to build for a sub-path |
| `npm run tokens` | Regenerate `src/styles/tokens.css` from `design/tokens.json` |
| `npm run fetch:openscad` | Install the pinned OpenSCAD WASM; `-- --latest` prints the newest snapshot and its SHA-256 for a deliberate bump |

## Architecture

- `src/render/`: `RenderController` is the only path to the worker (600 ms debounce, a newer request cancels the in-flight one, 60 s timeout kills and respawns the worker). The worker loads a fresh OpenSCAD instance per render. `runOpenSCAD` is pure and tested with a fake factory.
- `src/state/store.ts`: Zustand store. STL export is allowed only when `renderedCode === code` and the status is ok.
- `src/editor/`: CodeMirror 6 with a hand-written OpenSCAD stream grammar, a token-based theme, and an inline diagnostics extension (error line, gutter colour, callout).
- `src/viewer/`: react-three-fiber viewer. OpenSCAD is Z-up. WebGL colours come from tokens via `useTokens`.
- `src/ui/`, `src/panels/`, `src/export/`: design-system components (status pill, dims readout, console, export buttons).
- `build/csp.ts`: CSP meta tag injected into production HTML only.

## Rules that are easy to break

- **TDD.** Write the failing test first and watch it fail. Tests that read the filesystem start with `// @vitest-environment node`.
- **Tokens only.** No hex colours and no Tailwind palette classes in `src/` (a test enforces it). Use the CSS variables or token utilities (`bg-panel`, `text-ink`, `border-line`) and the `pc-*` classes. Never edit `src/styles/tokens.css` by hand.
- **Copy follows the design system voice.** Sentence case, units on every number ("20 × 20 × 10 mm", "Rendered 412 ms"), the `×` sign, errors that say what failed and where, no exclamation marks or emoji.
- **CSP stays strict.** `script-src 'self' 'wasm-unsafe-eval'`, fonts and everything else self-hosted. Do not add CDNs, analytics, or `data:` fonts (Vite font inlining is disabled on purpose).
- **Model output is untrusted.** Render it as text only (`textContent`, React text nodes), never as HTML.
- **OpenSCAD WASM is pinned by URL and SHA-256** in `scripts/fetch-openscad.ts`. Bump it on purpose, never by downloading "latest" into the build.
- **Base path.** All asset URLs must work under `BASE_PATH` (GitHub Pages serves from `/promptcad/`). Use `import.meta.env.BASE_URL`, never a hard-coded leading `/`.

## Deployment

`.github/workflows/pages.yml` runs typecheck, unit tests and the end-to-end tests on every push and pull request. On `main` it uploads the tested `dist/` and deploys it to GitHub Pages at https://meyhem.github.io/promptcad/. Pages must be set to "GitHub Actions" as its source in the repository settings.
