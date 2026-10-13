import {
  AmbientLight,
  BufferAttribute,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
} from 'three'
import type { MeshData } from '../render/types'
import { meshToGeometry } from '../viewer/geometry'
import { FRAME_FOV, type CameraPose } from './frames'
import { flipRows } from './pixels'

export interface GlFrameRendererOptions {
  width: number
  height: number
  background: string | null
  filament: string
}

export interface GlFrameRenderer {
  /** `colours`: 3 floats per vertex (part colours); the filament colour otherwise. */
  setMesh(mesh: MeshData, colours?: Float32Array): void
  render(pose: CameraPose): ImageData
  dispose(): void
}

function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export function createGlFrameRenderer({ width, height, background, filament }: GlFrameRendererOptions): GlFrameRenderer {
  const renderer = new WebGLRenderer({
    canvas: createCanvas(width, height),
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    premultipliedAlpha: false,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  if (background) renderer.setClearColor(new Color(background), 1)
  else renderer.setClearColor(new Color(), 0)

  const scene = new Scene()
  // Same lights as the main viewer (white by default; no colour literal needed).
  scene.add(new AmbientLight(undefined, 0.6))
  const key = new DirectionalLight(undefined, 1.4)
  key.position.set(50, -80, 100)
  const fill = new DirectionalLight(undefined, 0.4)
  fill.position.set(-60, 40, -30)
  scene.add(key, fill)

  const camera = new PerspectiveCamera(45, width / height, 0.1, 10_000)
  const ortho = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10_000)
  const material = new MeshStandardMaterial({ color: new Color(filament), roughness: 0.6, metalness: 0.1 })
  // Part colours replace the filament colour; white keeps them unchanged.
  const coloured = new MeshStandardMaterial({ color: new Color(1, 1, 1), roughness: 0.6, metalness: 0.1, vertexColors: true })
  let model: Mesh<BufferGeometry, MeshStandardMaterial> | null = null
  const gl = renderer.getContext()
  const pixels = new Uint8Array(width * height * 4)

  return {
    setMesh(mesh, colours) {
      if (model) {
        scene.remove(model)
        model.geometry.dispose()
      }
      const geometry = meshToGeometry(mesh)
      if (colours) geometry.setAttribute('color', new BufferAttribute(colours, 3))
      model = new Mesh(geometry, colours ? coloured : material)
      scene.add(model)
    },
    render(pose) {
      const cam = pose.ortho ? ortho : camera
      cam.up.set(...(pose.up ?? [0, 0, 1]))
      cam.position.set(...pose.position)
      cam.lookAt(...pose.target)
      const distance = cam.position.distanceTo(new Vector3(...pose.target))
      cam.near = Math.max(distance / 1000, 0.01)
      cam.far = distance * 100
      if (pose.ortho) {
        const halfWidth = pose.ortho.halfHeight * (width / height)
        ortho.left = -halfWidth
        ortho.right = halfWidth
        ortho.top = pose.ortho.halfHeight
        ortho.bottom = -pose.ortho.halfHeight
      } else {
        camera.fov = pose.fov ?? FRAME_FOV
      }
      cam.updateProjectionMatrix()
      renderer.render(scene, cam)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      return new ImageData(flipRows(pixels, width, height), width, height)
    },
    dispose() {
      model?.geometry.dispose()
      material.dispose()
      coloured.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
