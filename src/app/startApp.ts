import { getProject, listRecentProjects } from '../db/projects'
import { installUsageHook } from '../db/usageLinks'
import { startChatPersistence } from '../history/chatPersistence'
import { onBeforeLeaveHead, useProjectStore } from '../history/projectStore'
import { startRecorder } from '../history/recorder'
import { useSettingsStore } from '../settings/settingsStore'
import { applyTheme } from '../settings/theme'
import { useAppStore } from '../state/store'
import { captureThumbnail } from '../viewer/thumbnail'

export interface StartedApp {
  stop(): void
}

export async function startApp(deps: { capture?(): Promise<Blob | null> } = {}): Promise<StartedApp> {
  await useSettingsStore.getState().load()
  applyTheme(useSettingsStore.getState().settings.theme)
  const stopTheme = useSettingsStore.subscribe((s, prev) => {
    if (s.settings.theme !== prev.settings.theme) applyTheme(s.settings.theme)
  })

  const uninstallUsage = installUsageHook(() => useProjectStore.getState().project?.id ?? null)
  const chat = startChatPersistence()
  const recorder = startRecorder({
    capture: deps.capture ?? (() => captureThumbnail()),
    onCommit: (v) => (v.source === 'ai' || v.source === 'autofix' ? chat.linkTurn(v) : undefined),
  })
  onBeforeLeaveHead(() => recorder.flush())
  const stopProject = useProjectStore.subscribe((s, prev) => {
    if (s.project && s.project.id !== prev.project?.id) void chat.load(s.project.id)
  })

  const store = useProjectStore.getState()
  const { lastProjectId } = useSettingsStore.getState().settings
  const last = lastProjectId ? await getProject(lastProjectId) : undefined
  const fallback = last ?? (await listRecentProjects(1))[0]
  if (fallback) await store.openProject(fallback.id)
  else await store.newProject({ code: useAppStore.getState().code, origin: 'blank' })

  return {
    stop() {
      stopProject()
      onBeforeLeaveHead(null)
      recorder.stop()
      chat.stop()
      uninstallUsage()
      stopTheme()
    },
  }
}
