import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { Version } from '../db/db'
import { importFromText, saveProjectFile } from '../history/projectFile'
import { useProjectStore } from '../history/projectStore'
import { renderedVersionLabel } from '../history/renderedVersion'
import { useAgentStore } from '../agent/agentStore'
import { saveImage } from '../db/images'
import { useAppStore } from '../state/store'
import { makeProject, makeVersion } from '../test/fixtures'
import { HistoryControls } from './HistoryControls'
import { ProjectMenu } from './ProjectMenu'
import { RenderedFromCaption } from './RenderedFromCaption'
import { isEditableTarget, useUndoShortcuts } from './useUndoShortcuts'

vi.mock('../history/projectFile', () => ({
  saveProjectFile: vi.fn(async () => {}),
  importFromText: vi.fn(async () => ({ ok: false, error: 'versions[2].code must be text' })),
}))

vi.mock('../db/images', () => ({ saveImage: vi.fn(async () => 'blob-1') }))
vi.mock('../refine/useVisionSupport', () => ({ useVisionSupport: () => true }))
vi.mock('../photos/projectPhotos', async (original) => ({
  ...(await original<typeof import('../photos/projectPhotos')>()),
  preparePhoto: async (blob: Blob) => ({ blob, mediaType: 'image/jpeg' as const, width: 1, height: 1 }),
}))

const actions = {
  newProject: vi.fn(async () => makeProject()),
  openProject: vi.fn(async () => {}),
  renameProject: vi.fn(async () => {}),
  deleteProject: vi.fn(async () => {}),
  undo: vi.fn(async () => {}),
  redo: vi.fn(async () => {}),
}

const v1 = makeVersion({ id: 'v1', label: 'v1', code: 'w = 1; // [0:9]\ncube(w);' })
const v2 = makeVersion({ id: 'v2', label: 'v2', parentId: 'v1', code: 'w = 1; // [0:9]\ncube(w);', params: { w: 5 } })
const v3 = makeVersion({ id: 'v3', label: 'v3', parentId: 'v2', code: 'broken(' })

beforeEach(() => {
  Object.values(actions).forEach((a) => a.mockClear())
  useAppStore.setState(useAppStore.getInitialState(), true)
  useProjectStore.setState({
    project: makeProject({ id: 'p1', name: '18650 holder' }),
    recent: [makeProject({ id: 'p1', name: '18650 holder' }), makeProject({ id: 'p2', name: 'Cable clip' })],
    versions: [v1, v2, v3],
    head: v3,
    redoStack: [],
    ...actions,
  })
})

describe('ProjectMenu', () => {
  const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /18650 holder/ }))

  it('shows the project name and opens a menu with the project actions and recent projects', () => {
    render(<ProjectMenu />)
    expect(screen.getByRole('button', { name: /18650 holder/ })).toHaveAttribute('aria-expanded', 'false')
    openMenu()
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'New project…', 'Rename…', 'Examples', 'Export project (.json)', 'Import project (.json)…', 'Cable clip', 'Delete project…',
    ])
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('asks for a name and libraries, then starts an empty new project and returns to the workbench', async () => {
    useAppStore.getState().setView('history')
    render(<ProjectMenu />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'New project…' }))
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Hose filter' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    await waitFor(() =>
      expect(actions.newProject).toHaveBeenCalledWith({ name: 'Hose filter', code: '', origin: 'blank', enabledLibraries: ['BOSL2'] }),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useAppStore.getState().view).toBe('workbench')
  })

  it('starts a photo project: saves the photos, keeps the brief and scale, and sends the brief to the agent', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:thumb'), revokeObjectURL: vi.fn() })
    const submit = vi.fn(async () => {})
    useAgentStore.setState({ submit })
    render(<ProjectMenu />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'New project…' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Photos' }))
    fireEvent.change(screen.getByLabelText('Add front photo'), { target: { files: [new File(['x'], 'front.jpg', { type: 'image/jpeg' })] } })
    await screen.findByRole('img', { name: 'Front photo' })
    fireEvent.change(screen.getByLabelText('Describe it'), { target: { value: 'A wall bracket for a 25 mm rod' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create and build' }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith('A wall bracket for a 25 mm rod', undefined, { mode: 'agent', showPhotos: true }))
    expect(saveImage).toHaveBeenCalledTimes(1)
    expect(actions.newProject).toHaveBeenCalledWith({
      name: 'Untitled project',
      code: '',
      origin: 'photos',
      enabledLibraries: ['BOSL2'],
      photos: [expect.objectContaining({ blobId: 'blob-1', angle: 'front' })],
      brief: 'A wall bracket for a 25 mm rod',
      scale: 'reference',
    })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumb')
    expect(useAppStore.getState().view).toBe('workbench')
  })

  it('renames, opens a recent project, opens the examples and exports', async () => {
    render(<ProjectMenu />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }))
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Cell holder' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    await waitFor(() => expect(actions.renameProject).toHaveBeenCalledWith('Cell holder'))

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cable clip' }))
    await waitFor(() => expect(actions.openProject).toHaveBeenCalledWith('p2'))

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export project (.json)' }))
    expect(saveProjectFile).toHaveBeenCalledWith('p1')

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Examples' }))
    expect(useAppStore.getState().view).toBe('gallery')
  })

  it('asks before deleting, then deletes', async () => {
    render(<ProjectMenu />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete project…' }))
    expect(screen.getByText('Delete “18650 holder”?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))
    await waitFor(() => expect(actions.deleteProject).toHaveBeenCalledWith('p1'))
  })

  it('shows why an import failed, naming the field', async () => {
    render(<ProjectMenu />)
    openMenu()
    const file = new File(['{"format":"chatscad-project"}'], 'bad.json', { type: 'application/json' })
    fireEvent.change(screen.getByLabelText('Project file'), { target: { files: [file] } })
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't import bad.jsonversions[2].code must be text")
    expect(importFromText).toHaveBeenCalledWith('{"format":"chatscad-project"}')
  })

  it('opens the first imported project', async () => {
    vi.mocked(importFromText).mockResolvedValueOnce({ ok: true, projects: [makeProject({ id: 'p9' })] })
    render(<ProjectMenu />)
    openMenu()
    fireEvent.change(screen.getByLabelText('Project file'), { target: { files: [new File(['{}'], 'ok.json')] } })
    await waitFor(() => expect(actions.openProject).toHaveBeenCalledWith('p9'))
  })
})

describe('HistoryControls and shortcuts', () => {
  it('undoes and redoes, and leaves view switching to the tabs', () => {
    render(<HistoryControls />)
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(actions.undo).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'History' })).toBeNull()
  })

  it('disables Undo at the first version and enables Redo after an undo', () => {
    act(() => useProjectStore.setState({ head: v1, redoStack: ['v2'] }))
    render(<HistoryControls />)
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled()
  })

  it('maps Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y outside the editor and form fields', () => {
    renderHook(() => useUndoShortcuts())
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(window, { key: 'y', metaKey: true })
    expect(actions.undo).toHaveBeenCalledTimes(1)
    expect(actions.redo).toHaveBeenCalledTimes(2)

    const editor = document.createElement('div')
    editor.className = 'cm-editor'
    const line = document.createElement('div')
    editor.append(line)
    document.body.append(editor)
    fireEvent.keyDown(line, { key: 'z', ctrlKey: true })
    expect(actions.undo).toHaveBeenCalledTimes(1)
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true)
    expect(isEditableTarget(document.body)).toBe(false)
    editor.remove()
  })
})

describe('the version behind the visible model', () => {
  const versions: Version[] = [v1, v2, v3]

  it('finds the nearest version on the ancestry with the rendered code and overrides', () => {
    expect(renderedVersionLabel(versions, v3, v1.code, { w: 5 })).toBe('v2')
    expect(renderedVersionLabel(versions, v3, v1.code, {})).toBe('v1')
    expect(renderedVersionLabel(versions, v3, 'other', {})).toBeNull()
    expect(renderedVersionLabel(versions, null, v1.code, {})).toBeNull()
  })

  it('shows "from v2" next to the dims while the model is stale', () => {
    useAppStore.getState().renderFinished({ ok: true, mesh: { positions: new Float32Array(), normals: new Float32Array(), triangleCount: 1, bounds: { min: [0, 0, 0], max: [1, 1, 1] } }, stl: new ArrayBuffer(0), logs: [], diagnostics: [], renderMs: 1 }, v1.code, { w: 5 })
    const { rerender } = render(<RenderedFromCaption />)
    expect(screen.getByText('from v2')).toBeInTheDocument()
    act(() => useProjectStore.setState({ versions: [], head: null }))
    rerender(<RenderedFromCaption />)
    expect(screen.getByText('last model that compiled')).toBeInTheDocument()
  })
})
