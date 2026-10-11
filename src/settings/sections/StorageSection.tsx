import { useCallback, useEffect, useState } from 'react'
import { saveBackupFile } from '../../history/projectFile'
import { formatBytes } from '../format'

export function StorageSection() {
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)

  const refresh = useCallback(async () => {
    const storage = navigator.storage
    if (!storage) return
    const e = await storage.estimate?.()
    if (e) setEstimate({ usage: e.usage ?? 0, quota: e.quota ?? 0 })
    setPersisted((await storage.persisted?.()) ?? null)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <section aria-labelledby="storage-title" className="flex max-w-[640px] flex-col gap-5 p-6">
      <h2 id="storage-title" className="text-[20px] leading-[26px] font-semibold">
        Storage and backup
      </h2>
      <p className="pc-muted">Projects, versions and chats live only in this browser. There is no sync, so export a backup now and then.</p>
      {estimate && <span className="pc-mono">Using {formatBytes(estimate.usage)} of {formatBytes(estimate.quota)}</span>}
      {persisted === true && <p className="pc-caption">Storage is persistent: the browser won't clear your projects to free space.</p>}
      {persisted === false && (
        <div className="pc-row">
          <p className="pc-caption">The browser may clear projects when space runs low.</p>
          <button
            type="button"
            className="pc-btn is-sm"
            onClick={() => void navigator.storage.persist().then(refresh)}
          >
            Ask to keep data
          </button>
        </div>
      )}
      <div className="pc-row">
        <button type="button" className="pc-btn is-primary" onClick={() => void saveBackupFile()}>
          Export all projects (.json)
        </button>
      </div>
      <span className="pc-hint">Backups contain code, versions, chats and presets. API keys are never included.</span>
    </section>
  )
}
