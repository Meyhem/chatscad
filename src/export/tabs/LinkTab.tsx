import { useEffect, useMemo, useState } from 'react'
import { useProjectStore } from '../../history/projectStore'
import { createShareLink, fileStem, MAX_SHARE_CHARS } from '../../share/link'
import { useAppStore } from '../../state/store'
import { formatSize } from '../../ui/bytes'
import { Callout } from '../../ui/Callout'
import { IconCopy } from '../../ui/icons'
import { saveFile } from '../saveFile'
import { TabFooter } from './layout'

export function LinkTab() {
  const code = useAppStore((s) => s.code)
  const params = useAppStore((s) => s.params)
  const name = useProjectStore((s) => s.project?.name ?? 'Untitled')
  const link = useMemo(() => createShareLink({ v: 1, name, code, params }, window.location.href), [name, code, params])
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => setCopy('idle'), [link.url])

  const copyLink = async () => {
    if (!link.url) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }
  const saveJson = () =>
    void saveFile(new Blob([JSON.stringify(link.payload, null, 2)], { type: 'application/json' }), `${fileStem(name)}.json`)
  const jsonFirst = link.level !== 'ok'

  return (
    <>
      <div className="flex flex-col gap-4 px-6 py-5">
        {link.url && (
          <div className="pc-field">
            <label htmlFor="share-link">Share link</label>
            <div className="pc-input is-mono">
              <input id="share-link" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
            </div>
            <span className="pc-hint">{formatSize(link.bytes)} · Code and parameter values only. No keys, chat or history.</span>
          </div>
        )}
        {link.level === 'long' && (
          <Callout tone="warn" title={`Long link: ${formatSize(link.bytes)}`}>
            Some apps cut links over 8 KB. Send the .json file instead; it opens from Import in the project menu.
          </Callout>
        )}
        {link.level === 'too-long' && (
          <Callout tone="error" title="Too large for a link">
            This model needs more than {formatSize(MAX_SHARE_CHARS)} of link text, which does not open reliably. Send the .json file
            instead; it opens from Import in the project menu.
          </Callout>
        )}
        {copy === 'failed' && (
          <p role="alert" className="pc-caption text-error">
            Copy failed. Select the link and copy it by hand.
          </p>
        )}
      </div>
      <TabFooter>
        <span className="flex-1" />
        <button type="button" className={`pc-btn ${jsonFirst ? 'is-primary' : ''}`} onClick={saveJson}>
          {jsonFirst ? 'Save .json instead' : 'Save .json'}
        </button>
        <button type="button" className={`pc-btn ${jsonFirst ? '' : 'is-primary'}`} disabled={!link.url} onClick={() => void copyLink()}>
          <IconCopy className="pc-i" aria-hidden="true" />
          {copy === 'copied' ? 'Copied' : 'Copy link'}
        </button>
      </TabFooter>
    </>
  )
}
