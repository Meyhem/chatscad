import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { useRefineStore } from '../refine/refineStore'

/** Lets the chat send "a viewport screenshot with the selection outlined" (spec, click-to-refine fallback). */
export function ViewportCapture() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const setCapture = useRefineStore((s) => s.setCapture)
  useEffect(() => {
    // Render and read back in the same task, so the drawing buffer is still intact.
    setCapture(() => {
      gl.render(scene, camera)
      return gl.domElement.toDataURL('image/png')
    })
    return () => setCapture(null)
  }, [gl, scene, camera, setCapture])
  return null
}
