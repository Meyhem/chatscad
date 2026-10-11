import {
  AmbientLight,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
} from 'three'
import type { MeshData } from '../render/types'
import { meshToGeometry } from '../viewer/geometry'
import type { CameraPose } from './frames'
import { flipRows } from './pixels'

export interface GlFrameRendererOptions {
  width: number
  height: number
  background: string | null
  filament: string
}

export interface GlFrameRenderer {
  setMesh(mesh: MeshData): void
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
  const material = new MeshStandardMaterial({ color: new Color(filament), roughness: 0.6, metalness: 0.1 })
  let model: Mesh<BufferGeometry, MeshStandardMaterial> | null = null
  const gl = renderer.getContext()
  const pixels = new Uint8Array(width * height * 4)

  return {
    setMesh(mesh) {
      if (model) {
        scene.remove(model)
        model.geometry.dispose()
      }
      model = new Mesh(meshToGeometry(mesh), material)
      scene.add(model)
    },
    render(pose) {
      camera.up.set(...(pose.up ?? [0, 0, 1]))
      camera.position.set(...pose.position)
      camera.lookAt(...pose.target)
      const distance = camera.position.distanceTo(new Vector3(...pose.target))
      camera.near = Math.max(distance / 1000, 0.01)
      camera.far = distance * 100
      camera.updateProjectionMatrix()
      renderer.render(scene, camera)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      return new ImageData(flipRows(pixels, width, height), width, height)
    },
    dispose() {
      model?.geometry.dispose()
      material.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
