import { useEffect, useRef, useState } from 'react'

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

  // The count is read when the timer fires, so frames that keep arriving do not restart the wait.
  const total = useRef(count)
  total.current = count
  const running = playing && visible && count >= 2
  useEffect(() => {
    if (!running) return
    const id = setTimeout(() => setIndex((i) => (i + 1) % total.current), delayMs)
    return () => clearTimeout(id)
  }, [index, delayMs, running])

  return count === 0 ? 0 : index % count
}
