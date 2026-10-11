import { useEffect, useState } from 'react'

const hidden = () => document.visibilityState === 'hidden'

/** The frame to show in a looping preview of `count` frames. Holds still while not playing or while the page is hidden. */
export function useFrameLoop(count: number, delayMs: number, playing: boolean): number {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(() => !hidden())

  useEffect(() => {
    const onChange = () => setVisible(!hidden())
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])

  useEffect(() => {
    if (!playing || !visible || count < 2) return
    const id = setTimeout(() => setIndex((i) => (i + 1) % count), delayMs)
    return () => clearTimeout(id)
  }, [index, count, delayMs, playing, visible])

  return count === 0 ? 0 : index % count
}
