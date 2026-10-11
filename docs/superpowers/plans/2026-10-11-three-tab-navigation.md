# Three-Tab Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the History toggle button, the Settings gear and "Back to project" with three persistent tabs (Project, History, Settings) that look and behave the same on every view.

**Architecture:** One `ViewTabs` tablist drives the existing `useAppStore` `view` state (`'workbench' | 'history' | 'settings'`; `'gallery'` stays a separate full page reached from the project menu). The desktop header is rendered once by `App` for all three tabs: fixed left (brand, project menu, tabs) and right (Share, Export STL), with a contextual middle. On phones the same tabs sit as a full-width strip under the header; the Chat / Code / 3D bar stays at the bottom, only on the Project tab.

**Tech Stack:** React 19, Zustand, Tailwind v4 with design tokens, Vitest + Testing Library, Playwright.

**Spec:** `docs/SPEC.md` (binding) and the design canvas https://claude.ai/artifact/TNXkMGKfbuVrEAh8MEvMDA, row "Navigation · three tabs" (`NavProject`, `NavHistory`, `NavSettings`, `NavPhoneProject`, `NavPhoneHistory`).

## Global Constraints

- Tokens only: no hex colours and no Tailwind palette classes in `src/`.
- Copy: sentence case, no exclamation marks or emoji.
- TDD: write the failing test first and watch it fail.
- The workbench stays mounted while History or Settings is shown, so the editor's undo history and the camera survive.
- Share and Export stay modal (`useExportStore.openAt`), reachable from every tab.
- A feature is complete when `npm run typecheck`, `npm test` and `npm run e2e` pass; then commit and push.

## Review Focus

- Switching Project → Settings → Project keeps the editor content and the viewer instance (workbench never unmounts). Pinned in Task 2's App test (`workbench` test id stays in the DOM, hidden).
- Keyboard users can move between tabs with Left/Right arrows, and only the selected tab is in the tab order (roving tabindex). Pinned in Task 1.
- Two tablists on a phone must have distinct accessible names ("Views" for Project/History/Settings, "Panels" for Chat/Code/3D), or screen readers and tests can't tell them apart. Pinned in Task 3.
- "Add a provider" in the first-run callout and "New project" from the History tab still land on the right tab (they call `setView`); the tab's `aria-selected` must follow the store. Pinned in Task 1 (store-driven selection) and Task 2.
- The Gallery (Examples) page keeps its own "Back to project" button; it is not one of the tabs. Existing `GalleryView.test.tsx` covers it unchanged.

---

### Task 1: `ViewTabs` component

**Files:**
- Create: `src/workbench/ViewTabs.tsx`
- Test: `src/workbench/ViewTabs.test.tsx`

**Interfaces:**
- Produces: `export type TabView = 'workbench' | 'history' | 'settings'`, `export function ViewTabs(props: { fill?: boolean }): JSX.Element`, `export const viewPanelId = (view: TabView) => string` (returns `view-panel-${view}`). Tabs have ids `view-tab-${view}`, labels "Project", "History", "Settings", `aria-controls` = `viewPanelId(view)`. `fill` makes the tablist full width with three equal 40 px tabs (phone).

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { useAppStore } from '../state/store'
import { ViewTabs } from './ViewTabs'

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))

it('shows Project, History and Settings with the current view selected', () => {
  render(<ViewTabs />)
  const tabs = screen.getByRole('tablist', { name: 'Views' })
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Project', 'History', 'Settings'])
  expect(screen.getByRole('tab', { name: 'Project' })).toHaveAttribute('aria-selected', 'true')
  expect(tabs).toBeInTheDocument()
  act(() => useAppStore.getState().setView('settings'))
  expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tab', { name: 'Project' })).toHaveAttribute('aria-selected', 'false')
})

it('switches the view on click', () => {
  render(<ViewTabs />)
  fireEvent.click(screen.getByRole('tab', { name: 'History' }))
  expect(useAppStore.getState().view).toBe('history')
  fireEvent.click(screen.getByRole('tab', { name: 'Project' }))
  expect(useAppStore.getState().view).toBe('workbench')
})

it('moves with the arrow keys and keeps only the selected tab in the tab order', () => {
  render(<ViewTabs />)
  const project = screen.getByRole('tab', { name: 'Project' })
  expect(project).toHaveAttribute('tabindex', '0')
  expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('tabindex', '-1')
  fireEvent.keyDown(project, { key: 'ArrowLeft' })
  expect(useAppStore.getState().view).toBe('settings')
  expect(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Settings' }), { key: 'ArrowRight' })
  expect(useAppStore.getState().view).toBe('workbench')
})

it('points each tab at its panel', () => {
  render(<ViewTabs />)
  expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-controls', 'view-panel-history')
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/workbench/ViewTabs.test.tsx`
Expected: FAIL, cannot resolve `./ViewTabs`.

- [ ] **Step 3: Implement**

```tsx
import { useRef, type KeyboardEvent } from 'react'
import { useAppStore } from '../state/store'
import { IconBox, IconHistory, IconSettings } from '../ui/icons'

export type TabView = 'workbench' | 'history' | 'settings'

const TABS: Array<{ view: TabView; label: string; Icon: typeof IconBox }> = [
  { view: 'workbench', label: 'Project', Icon: IconBox },
  { view: 'history', label: 'History', Icon: IconHistory },
  { view: 'settings', label: 'Settings', Icon: IconSettings },
]

export const viewPanelId = (view: TabView) => `view-panel-${view}`

/** Project / History / Settings. The same strip on every view, so the way back is always the same click. */
export function ViewTabs({ fill = false }: { fill?: boolean }) {
  const view = useAppStore((s) => s.view)
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const i = TABS.findIndex((t) => t.view === view)
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    e.preventDefault()
    const next = (i + step + TABS.length) % TABS.length
    useAppStore.getState().setView(TABS[next].view)
    refs.current[next]?.focus()
  }

  return (
    <nav
      role="tablist"
      aria-label="Views"
      className={`pc-tabs${fill ? ' grid w-full grid-cols-3' : ''}`}
      onKeyDown={onKeyDown}
    >
      {TABS.map((t, i) => (
        <button
          key={t.view}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="tab"
          id={`view-tab-${t.view}`}
          aria-controls={viewPanelId(t.view)}
          aria-selected={view === t.view}
          tabIndex={view === t.view ? 0 : -1}
          className={`pc-tab${fill ? ' h-10 justify-center' : ''}`}
          onClick={() => useAppStore.getState().setView(t.view)}
        >
          <t.Icon className="pc-i" aria-hidden="true" />
          {t.label}
        </button>
      ))}
    </nav>
  )
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/workbench/ViewTabs.test.tsx` → PASS.

- [ ] **Step 5: Commit**

`git add src/workbench/ViewTabs.tsx src/workbench/ViewTabs.test.tsx && git commit -m "feat: Project, History and Settings view tabs"`

### Task 2: Desktop shell uses the tabs

**Files:**
- Modify: `src/App.tsx` (desktop branch), `src/settings/SettingsPage.tsx`, `src/workbench/HistoryControls.tsx`, `src/history/HistoryView.tsx` (panel id/role on its `<main>`)
- Test: `src/App.test.tsx`, `src/settings/SettingsPage.test.tsx`, `src/workbench/header.test.tsx`, `e2e/history.spec.ts`, `e2e/ai-loop.spec.ts`

**Interfaces:**
- Consumes: `ViewTabs`, `viewPanelId` from Task 1.
- Produces: `SettingsPage` renders no header and no "Back to project"; it keeps `data-testid="settings"`, gets `role="tabpanel"`, `id={viewPanelId('settings')}`, `aria-labelledby="view-tab-settings"`, and a visually hidden `<h1 className="sr-only">Settings</h1>`. `HistoryControls` renders only Undo and Redo.

Header layout (all three tabs): `PromptCAD` h1 · divider · `ProjectMenu` · `ViewTabs` · divider · contextual · spacer · contextual right · `ExportButtons`.
- Project: `StatusPill`, `VariantProgressPill`, `DimsReadout`, `RenderedFromCaption` in the middle; `HistoryControls` (undo/redo) on the right.
- History: `StatusPill` only.
- Settings: caption "Applies to every project".

- [ ] **Step 1: Update tests to the new behaviour (they fail)**

`src/App.test.tsx`, replace the settings round-trip test:

```tsx
it('switches between the Project, History and Settings tabs, keeping the workbench mounted', async () => {
  render(<App createWorker={scriptedWorker(() => okResult())} />)
  expect(screen.getByRole('tab', { name: 'Project' })).toHaveAttribute('aria-selected', 'true')
  await userEvent.click(screen.getByRole('tab', { name: 'Settings' }))
  expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByTestId('workbench')).not.toBeVisible()
  expect(screen.queryByRole('button', { name: 'Back to project' })).toBeNull()
  expect(screen.getByText('Applies to every project')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Export STL' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab', { name: 'Project' }))
  expect(screen.getByTestId('workbench')).toBeVisible()
  expect(screen.queryByTestId('settings')).toBeNull()
})
```

In the same file, the first-run test additionally asserts `expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true')`. In the "switches to the History and Examples views" test, replace `expect(screen.queryByRole('region', { name: '3D view' })).toBeNull()` with `expect(screen.getByRole('region', { name: '3D view', hidden: true })).not.toBeVisible()` and assert `screen.queryByRole('button', { name: 'Undo' })` is null while History is shown.

`src/settings/SettingsPage.test.tsx`, replace the "full page with a Back to project button" test:

```tsx
it('is the Settings tab panel, with no header or back button of its own', () => {
  render(<SettingsPage />)
  expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'view-panel-settings')
  expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Back to project' })).toBeNull()
})
```

`src/workbench/header.test.tsx`, replace "undoes, redoes and toggles the History view":

```tsx
it('undoes and redoes, and leaves view switching to the tabs', () => {
  render(<HistoryControls />)
  expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(actions.undo).toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'History' })).toBeNull()
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/App.test.tsx src/settings/SettingsPage.test.tsx src/workbench/header.test.tsx` → FAIL (no tabs, Back to project still present, History button still present).

- [ ] **Step 3: Implement**

- `HistoryControls.tsx`: delete the History button, the `view`/`inHistory` lines and the `IconHistory`/`useAppStore` imports.
- `SettingsPage.tsx`: delete the `<header>` and `setView`; root becomes `<div role="tabpanel" id={viewPanelId('settings')} aria-labelledby="view-tab-settings" data-testid="settings" className="flex min-h-0 flex-1 flex-col">` with `<h1 className="sr-only">Settings</h1>` as its first child.
- `HistoryView.tsx`: its root `<main>` gets `role="tabpanel" id={viewPanelId('history')} aria-labelledby="view-tab-history"`.
- `App.tsx` desktop branch: move the `<header>` out of the `data-testid="workbench"` wrapper so it renders for every tab; insert `<ViewTabs />` after `ProjectMenu` followed by a divider; render the Project-only items under `view === 'workbench'`, the status pill under `view === 'history'`, the "Applies to every project" caption under `view === 'settings'`; drop the gear button; keep `ExportButtons`. Below the header: `{view === 'settings' && <SettingsPage />}`, `{view === 'history' && <HistoryView … />}`, and the workbench wrapper `<div data-testid="workbench" hidden={view !== 'workbench'}>` holding `<main id={viewPanelId('workbench')} role="tabpanel" aria-labelledby="view-tab-workbench">`.
- `e2e/history.spec.ts`: `getByRole('button', { name: 'History' })` → `getByRole('tab', { name: 'History' })`; `getByRole('button', { name: 'Settings' })` → `getByRole('tab', { name: 'Settings' })`; `getByRole('button', { name: 'Back to project' })` → `getByRole('tab', { name: 'Project' })`. Same Back-to-project replacement in `e2e/ai-loop.spec.ts`.

- [ ] **Step 4: Run unit tests and typecheck**

Run: `npm run typecheck && npm test` → PASS.

- [ ] **Step 5: Commit**

`git commit -am "feat: Project, History and Settings tabs in the desktop header"`

### Task 3: Phone uses the same tabs

**Files:**
- Modify: `src/App.tsx` (phone branch), `src/layout/PhoneLayout.tsx`
- Test: `src/App.test.tsx`, `src/layout/phoneLayout.test.tsx`, `e2e/phone.spec.ts`

**Interfaces:**
- Consumes: `ViewTabs` with `fill`.
- Produces: `PhoneLayout`'s bottom tablist is named "Panels". The phone header has icon buttons "Share" (`openAt('link')`) and "Export STL" (`openAt('model')`), no Settings gear. A strip with `<ViewTabs fill />` sits under the header on all three tabs; History and Settings render their pages below it, without the bottom bar.

- [ ] **Step 1: Update tests (they fail)**

`src/layout/phoneLayout.test.tsx`: `getByRole('tablist', { name: 'Views' })` → `{ name: 'Panels' }`. `e2e/phone.spec.ts`: same rename, and add after the Chat step:

```ts
  await page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name: 'Settings' }).click()
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'Panels' })).toHaveCount(0)
  await page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name: 'Project' }).click()
  await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible()
```

`src/App.test.tsx` phone tests:

```tsx
it('uses the Chat / Code / 3D panels under the Project, History and Settings tabs on a phone', () => {
  mockPhone()
  render(<App createWorker={scriptedWorker(() => okResult())} />)
  expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument()
  expect(screen.getByRole('tablist', { name: 'Panels' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Export STL' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull()
  expect(screen.getByRole('toolbar', { name: 'Code symbols', hidden: true })).toBeInTheDocument()
})

it('shows the settings tab on a phone too, so a provider can be added', async () => {
  mockPhone()
  render(<App createWorker={scriptedWorker(() => okResult())} />)
  await userEvent.click(screen.getByRole('tab', { name: 'Settings' }))
  expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  expect(screen.queryByRole('tablist', { name: 'Panels' })).toBeNull()
  expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument()
})
```

where `mockPhone()` is a helper in the file wrapping the existing `window.matchMedia` stub.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/App.test.tsx src/layout/phoneLayout.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

- `PhoneLayout.tsx`: `aria-label="Views"` → `aria-label="Panels"`.
- `App.tsx`: build `phoneHeader` once (ProjectMenu, spacer, StatusPill, Share and Export STL icon buttons, then a `div` with `border-b border-line bg-panel px-3 py-2` holding `<ViewTabs fill />`). Use it for `isPhone && view === 'workbench'` (passed as `PhoneLayout`'s `header`, keeping the workbench mounted is not needed on phone since PhoneLayout is already the whole page), and for `isPhone && (view === 'history' || view === 'settings')`: `<div className="pc-root flex h-full flex-col bg-bg text-ink">{phoneHeader}{page}<ComposerBridge /><GlobalOverlays /></div>`.

- [ ] **Step 4: Run all checks**

Run: `npm run typecheck && npm test && npm run e2e` → PASS.

- [ ] **Step 5: Commit**

`git commit -am "feat: Project, History and Settings tabs on phones"`

### Task 4: Design copies and push

**Files:**
- Modify: `design/screens/` (add the five `Nav*.dc.html` boards), `design/README.md` (screens version)

- [ ] **Step 1:** Copy `NavProject`, `NavHistory`, `NavSettings`, `NavPhoneProject`, `NavPhoneHistory` `.dc.html` from the canvas into `design/screens/`, and update the README's screens version and date.
- [ ] **Step 2:** `git add design && git commit -m "docs: three-tab navigation screens"`
- [ ] **Step 3:** With all checks green, `git push origin main`.
