import { useEffect, useState } from 'react'
import type { Version } from '../db/db'
import { getBlob } from '../db/blobs'
import { BOX_GLYPH, FAILED_GLYPH, Glyph } from '../ui/Glyph'

export function VersionThumb({ version }: { version: Version }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    setUrl(null)
    if (!version.thumbnailBlobId) return
    let live = true
    let created: string | null = null
    void getBlob(version.thumbnailBlobId).then((stored) => {
      if (!live || !stored) return
      created = URL.createObjectURL(stored.data)
      setUrl(created)
    })
    return () => {
      live = false
      if (created) URL.revokeObjectURL(created)
    }
  }, [version.thumbnailBlobId])
  return (
    <span className="pc-thumb">
      {url ? <img src={url} alt="" className="size-full object-cover" /> : <Glyph shapes={version.compileStatus === 'error' ? FAILED_GLYPH : BOX_GLYPH} />}
    </span>
  )
}
