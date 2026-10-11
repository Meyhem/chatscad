import { useEffect, useState } from 'react'
import { loadImage } from '../db/images'

/** `load` must be a stable function (the default, or a module-level one), or the images reload on every render. */
export function MessageImages({ ids, load = loadImage }: { ids: readonly string[]; load?: (id: string) => Promise<Blob | null> }) {
  const [urls, setUrls] = useState<string[]>([])
  const key = ids.join(',')

  useEffect(() => {
    let cancelled = false
    const created: string[] = []
    const wanted = key === '' ? [] : key.split(',')
    void Promise.all(wanted.map((id) => load(id))).then((blobs) => {
      if (cancelled) return
      for (const blob of blobs) if (blob) created.push(URL.createObjectURL(blob))
      setUrls([...created])
    })
    return () => {
      cancelled = true
      for (const url of created) URL.revokeObjectURL(url)
    }
  }, [key, load])

  if (urls.length === 0) return null
  return (
    <div className="pc-row justify-end">
      {urls.map((url, i) => (
        <img key={url} src={url} alt={`Attached image ${i + 1} of ${urls.length}`} className="pc-msg-img object-cover" />
      ))}
    </div>
  )
}
