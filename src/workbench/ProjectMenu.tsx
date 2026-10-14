import { useEffect, useRef, useState } from 'react'
import { useAgentStore } from '../agent/agentStore'
import { saveImage } from '../db/images'
import { importFromText, saveProjectFile } from '../history/projectFile'
import { useProjectStore } from '../history/projectStore'
import type { ProjectPhoto } from '../photos/projectPhotos'
import { useAppStore } from '../state/store'
import { NewProjectDialog } from './NewProjectDialog'
import { useNewProjectDialog } from './newProjectDialogStore'
import { IconChevronDown, IconGallery, IconImport, IconPlus, IconX } from '../ui/icons'

type Mode = 'menu' | 'rename' | 'delete'

const item = 'pc-btn is-ghost is-sm w-full justify-start'

export function ProjectMenu() {
  const project = useProjectStore((s) => s.project)
  const recent = useProjectStore((s) => s.recent)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('menu')
  const [name, setName] = useState('')
  const creating = useNewProjectDialog((s) => s.open)
  const setCreating = useNewProjectDialog((s) => s.setOpen)
  const [importError, setImportError] = useState<{ file: string; error: string } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const close = () => {
    setOpen(false)
    setMode('menu')
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    const onDown = (e: MouseEvent) => rootRef.current && !rootRef.current.contains(e.target as Node) && close()
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const store = () => useProjectStore.getState()
  const toWorkbench = () => useAppStore.getState().setView('workbench')

  const dialog = creating && (
    <NewProjectDialog
      onClose={() => setCreating(false)}
      onCreate={async ({ name, enabledLibraries, photos }) => {
        // The dialog stays open until the project is saved; it shows the error and keeps the draft if saving fails.
        // Closing it afterwards releases the thumbnails.
        if (!photos) {
          await store().newProject({ name, code: '', origin: 'blank', enabledLibraries })
          setCreating(false)
          toWorkbench()
          return
        }
        const saved: ProjectPhoto[] = []
        for (const p of photos.photos) saved.push({ id: p.id, blobId: await saveImage(p.blob), angle: p.angle, addedAt: Date.now() })
        await store().newProject({ name, code: '', origin: 'photos', enabledLibraries, photos: saved, brief: photos.brief, scale: photos.scale })
        setCreating(false)
        toWorkbench()
        void useAgentStore.getState().submit(photos.brief, undefined, { mode: 'agent', showPhotos: true })
      }}
    />
  )

  // With no project open the workbench shows the no-project card; only the dialog is left to render here.
  if (!project) return dialog || null
  const others = recent.filter((p) => p.id !== project.id)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    const result = await importFromText(await file.text())
    if (fileRef.current) fileRef.current.value = ''
    if (!result.ok) {
      setImportError({ file: file.name, error: result.error })
      return
    }
    setImportError(null)
    close()
    await store().openProject(result.projects[0]!.id)
    toWorkbench()
  }

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <button
        type="button"
        className="inline-flex h-(--control-sm) max-w-full items-center gap-1 rounded-sm px-2 whitespace-nowrap text-[14px] font-semibold text-ink hover:bg-panel-raised"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="truncate">{project.name}</span>
        <IconChevronDown className="pc-i shrink-0" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label="Project" className="absolute top-full left-0 z-20 mt-1 flex w-72 flex-col gap-1 rounded-lg border border-line bg-panel-raised p-2 shadow-pop">
          {mode === 'menu' && (
            <>
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  close()
                  setCreating(true)
                }}
              >
                <IconPlus className="pc-i" aria-hidden="true" />
                New project…
              </button>
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  setName(project.name)
                  setMode('rename')
                }}
              >
                Rename…
              </button>
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  close()
                  useAppStore.getState().setView('gallery')
                }}
              >
                <IconGallery className="pc-i" aria-hidden="true" />
                Examples
              </button>
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  close()
                  void saveProjectFile(project.id)
                }}
              >
                Export project (.json)
              </button>
              <button type="button" role="menuitem" className={item} onClick={() => fileRef.current?.click()}>
                <IconImport className="pc-i" aria-hidden="true" />
                Import project (.json)…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                aria-label="Project file"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              {others.length > 0 && <span className="pc-label px-2 pt-2">Recent</span>}
              {others.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="menuitem"
                  className={item}
                  onClick={() => {
                    close()
                    void store().openProject(p.id).then(toWorkbench)
                  }}
                >
                  {p.name}
                </button>
              ))}
              <button type="button" role="menuitem" className={`${item} text-error`} onClick={() => setMode('delete')}>
                Delete project…
              </button>
              {importError && (
                <div className="pc-callout is-error" role="alert">
                  <IconX className="pc-i" aria-hidden="true" />
                  <div className="pc-callout-body">
                    <strong>Couldn't import {importError.file}</strong>
                    {importError.error}
                  </div>
                </div>
              )}
            </>
          )}
          {mode === 'rename' && (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                close()
                void store().renameProject(name)
              }}
            >
              <div className="pc-field">
                <label htmlFor="project-name">Project name</label>
                <div className="pc-input">
                  <input id="project-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                </div>
              </div>
              <div className="pc-dialog-actions">
                <button type="button" className="pc-btn is-sm is-ghost" onClick={() => setMode('menu')}>
                  Cancel
                </button>
                <button type="submit" className="pc-btn is-sm is-primary" disabled={name.trim() === ''}>
                  Rename
                </button>
              </div>
            </form>
          )}
          {mode === 'delete' && (
            <div className="flex flex-col gap-2 p-1">
              <strong>Delete “{project.name}”?</strong>
              <p className="pc-caption">This removes its versions, chat and presets from this browser. Export it first if you want a copy.</p>
              <div className="pc-dialog-actions">
                <button type="button" className="pc-btn is-sm is-ghost" onClick={() => setMode('menu')}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="pc-btn is-sm is-danger"
                  onClick={() => {
                    close()
                    void store()
                      .deleteProject(project.id)
                      .then(() => {
                        if (!store().project) setCreating(true)
                      })
                  }}
                >
                  Delete project
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {dialog}
    </div>
  )
}
